using ParkDodo.Edge.Cameras;
using ParkDodo.Edge.Cloud;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge.Lanes;

/// <summary>
/// 一條車道的現場邏輯。原則：開閘由現場決定（不等雲端就能放行入場），金額由雲端決定（斷網才用本機計算）。
///   入場：辨識到車牌 → 立刻開閘、顯示歡迎 → 事件寫入佇列上傳
///   出口：辨識到車牌 → 問雲端（最多 2.5 秒）→ 放行／顯示金額與付款 QR／請按對講
///         等待付款期間每 2 秒確認一次，付款完成立刻開閘
///   雷達通過訊號 → 記錄通過、出口結案
/// </summary>
public sealed class LaneController : IDisposable
{
    public sealed record Context(Settings Settings, Outbox Outbox, LocalState State, Func<CloudClient?> Cloud, string SiteCode, Action FlushNow);

    private readonly Context _ctx;
    private readonly ILaneCamera _camera;
    private readonly FkDisplay? _display;
    private readonly int _relay, _passIo;
    private readonly object _lock = new();
    private (string Plate, DateTimeOffset At)? _lastRead;
    private Waiting? _waiting;
    private (string Plate, string? SessionId, DateTimeOffset At)? _lastOpened;
    private DateTimeOffset _lastPass = DateTimeOffset.MinValue;

    private sealed record Waiting(string Plate, string? SessionId, DateTimeOffset Since, string Reason, long? Amount);

    public string Code { get; }
    public string Direction { get; }
    public bool Active { get; set; }
    public string CameraDeviceId { get; }
    public ILaneCamera Camera => _camera;
    public bool IsExit => Direction == "exit";

    public LaneController(Context ctx, LaneConfig lane, ILaneCamera camera, FkDisplay? display, string cameraDeviceId, int relayIndex, int passIoIndex)
    {
        _ctx = ctx; _camera = camera; _display = display;
        Code = lane.Code; Direction = lane.Direction; Active = lane.Active;
        CameraDeviceId = cameraDeviceId; _relay = relayIndex; _passIo = passIoIndex;
        camera.PlateRead += r => Safe(() => OnPlate(r));
        camera.IoChanged += (i, v) => Safe(() => OnIo(i, v));
        camera.OnlineChanged += on => Log.Info($"車道 {Code} 相機{(on ? "已連線" : "離線")}");
    }

    public void Start() => _camera.Start();

    // ------------------------------------------------------------------ 車牌

    private void OnPlate(PlateRead r)
    {
        var plate = LocalState.Normalize(r.Plate);
        if (plate.Length < 4 || r.FalsePlate) { Log.Info($"車道 {Code} 無效車牌「{r.Plate}」，忽略"); return; }
        lock (_lock)
        {
            if (_lastRead is { } last && last.Plate == plate && (r.At - last.At).TotalSeconds < _ctx.Settings.DuplicateSeconds) return;
            if (_waiting is { } w && w.Plate == plate) return;   // 同一台車還在出口等付款
            _lastRead = (plate, r.At);
        }
        Log.Info($"車道 {Code} 辨識 {plate}（信心 {r.Confidence:P0}）");
        if (!Active) { _display?.Show("車道暫停使用", "請洽服務人員", color: 1); return; }

        var ev = NewEvent("plate_read", r.At, plate, r.Confidence);
        _ctx.Outbox.Add(ev, r.PlateJpeg, r.FullJpeg);   // 先存本機，斷電也不會遺失

        if (!IsExit) { Entry(plate, r, ev); return; }
        Exit(plate, r, ev);
    }

    private void Entry(string plate, PlateRead r, EdgeEvent ev)
    {
        // 入場不等雲端：立刻開閘，紀錄由背景補上傳
        Open(plate, null, "entry");
        _display?.Show("歡迎光臨", Pretty(plate), voice: "welcome");
        _ctx.State.Entered(plate, r.At, null);
        _ctx.FlushNow();
    }

    private void Exit(string plate, PlateRead r, EdgeEvent ev)
    {
        if (r.Confidence < _ctx.Settings.MinConfidence)
        {
            _display?.Show("辨識中 請稍候", "請將車輛停妥", color: 3);
            Log.Info($"車道 {Code} 信心值過低，等待重新辨識");
            return;
        }
        Decision? d = null; string? sessionId = null;
        var cloud = _ctx.Cloud();
        if (cloud is not null)
        {
            try
            {
                var res = cloud.Events(new[] { ev }, TimeSpan.FromSeconds(2.5), CancellationToken.None).GetAwaiter().GetResult();
                var er = res.Results.FirstOrDefault();
                if (er is { Status: "accepted" or "duplicate" })
                {
                    _ctx.Outbox.Ack(OutboxFileFor(ev));
                    d = er.Decision; sessionId = er.SessionId;
                }
            }
            catch (Exception e) { Log.Warn($"車道 {Code} 雲端查詢失敗，改用本機判斷：{e.Message}"); }
        }
        var offline = d is null;
        d ??= _ctx.State.OfflineExit(plate, r.At);
        Apply(plate, sessionId, d, offline);
    }

    private void Apply(string plate, string? sessionId, Decision d, bool offline)
    {
        switch (d.Action)
        {
            case "open":
                lock (_lock) _waiting = null;
                Open(plate, sessionId, d.Reason);
                _display?.Show(d.Reason == "monthly" ? "月租車 一路順風" : "一路順風", Pretty(plate), voice: "goodbye");
                break;
            case "pay" when offline && _ctx.Settings.OfflineUnpaidExit == "open":
                Open(plate, sessionId, "offline_unpaid", new() { ["offlineUnpaidAmount"] = d.Amount });
                _display?.Show("一路順風", Pretty(plate), voice: "goodbye");
                Log.Warn($"車道 {Code} 斷網放行未付款車輛 {plate}（NT${d.Amount}），已記錄待補收");
                break;
            case "pay":
                lock (_lock) _waiting = new Waiting(plate, sessionId, DateTimeOffset.Now, d.Reason, d.Amount);
                if (offline)
                {
                    _display?.Show($"應繳 NT${d.Amount}", "網路異常 請按對講", color: 1);
                }
                else
                {
                    _display?.Show($"請繳費 NT${d.Amount}", d.Reason == "overstay" ? "逾時離場需補繳" : "請掃碼付款", color: 3, voice: "pay");
                    if (_ctx.State.PayUrlBase is { } url) _display?.ShowQr($"{url}&plate={plate}", "掃碼繳費");
                }
                break;
            default: // hold
                lock (_lock) _waiting = new Waiting(plate, sessionId, DateTimeOffset.Now, d.Reason, null);
                _display?.Show(d.Reason == "no_entry_record" ? "查無入場紀錄" : "請稍候", "請按對講鈕", color: 1);
                Log.Info($"車道 {Code} 暫不放行 {plate}：{d.Reason}");
                break;
        }
    }

    /// <summary>每 2 秒：出口等待付款中的車，問雲端付好了沒</summary>
    public void Tick()
    {
        Waiting? w;
        lock (_lock) w = _waiting;
        if (w is null) return;
        if (DateTimeOffset.Now - w.Since > TimeSpan.FromMinutes(_ctx.Settings.ExitWaitMinutes))
        {
            lock (_lock) _waiting = null;
            _display?.Clear();
            Log.Info($"車道 {Code} {w.Plate} 等待逾時，停止確認付款");
            return;
        }
        var cloud = _ctx.Cloud();
        if (cloud is null || w.Reason is not ("unpaid" or "overstay")) return;
        try
        {
            var r = cloud.ExitCheck(Code, w.Plate, CancellationToken.None).GetAwaiter().GetResult();
            if (r.Decision?.Action == "open")
            {
                Log.Info($"車道 {Code} {w.Plate} 已付款，開閘");
                Apply(w.Plate, r.SessionId ?? w.SessionId, r.Decision, offline: false);
            }
        }
        catch (Exception e) { Log.Warn($"車道 {Code} 付款確認失敗：{e.Message}"); }
    }

    // ------------------------------------------------------------------ 開閘與通過

    private void Open(string plate, string? sessionId, string reason, Dictionary<string, object?>? extra = null, string? commandId = null)
    {
        var ok = _camera.OpenGate(_relay);
        lock (_lock) _lastOpened = (plate, sessionId, DateTimeOffset.Now);
        var payload = new Dictionary<string, object?> { ["by"] = commandId is null ? "auto" : "remote", ["reason"] = reason, ["relayOk"] = ok };
        if (commandId is not null) payload["commandId"] = commandId;
        if (extra is not null) foreach (var (k, v) in extra) payload[k] = v;
        var ev = NewEvent("gate_opened", DateTimeOffset.Now, plate == "" ? null : plate, null, sessionId, payload);
        _ctx.Outbox.Add(ev);
        _ctx.FlushNow();
    }

    public bool RemoteOpen(GateCommand c)
    {
        Log.Info($"車道 {Code} 執行遠端開閘（{c.Reason}）");
        string plate; string? sid;
        lock (_lock) { plate = c.Plate ?? _waiting?.Plate ?? ""; sid = c.SessionId ?? _waiting?.SessionId; _waiting = null; }
        Open(plate, sid, "remote", null, c.Id);
        _display?.Show("已遠端開閘", "請通行", color: 2);
        return true;
    }

    private void OnIo(int index, int value)
    {
        if (index != _passIo) return;
        var passed = _ctx.Settings.PassSignalEdge == "fall" ? value == 0 : value == 1;
        if (!passed) return;
        var now = DateTimeOffset.Now;
        (string Plate, string? SessionId, DateTimeOffset At)? opened;
        lock (_lock)
        {
            if ((now - _lastPass).TotalSeconds < 3) return;   // 防彈跳
            _lastPass = now;
            opened = _lastOpened;
            _lastOpened = null;
        }
        // 只把「開閘後 2 分鐘內」的通過訊號對應到那台車
        var plate = opened is { } o && (now - o.At).TotalMinutes < 2 ? o.Plate : null;
        var ev = NewEvent("vehicle_passed", now, string.IsNullOrEmpty(plate) ? null : plate, null, opened?.SessionId);
        _ctx.Outbox.Add(ev);
        if (IsExit && !string.IsNullOrEmpty(plate)) _ctx.State.Exited(plate);
        _ctx.FlushNow();
        Log.Info($"車道 {Code} 車輛通過{(plate is null ? "" : $"：{plate}")}");
    }

    // ------------------------------------------------------------------ 工具

    private EdgeEvent NewEvent(string type, DateTimeOffset at, string? plate, double? confidence = null, string? sessionId = null, Dictionary<string, object?>? payload = null) => new()
    {
        Uid = $"{_ctx.SiteCode}-{Guid.NewGuid():N}",
        Type = type, LaneCode = Code, OccurredAt = at, Plate = plate, Confidence = confidence, SessionId = sessionId,
        DeviceId = CameraDeviceId, Payload = payload,
    };

    private string OutboxFileFor(EdgeEvent e) =>
        Path.Combine(_ctx.Settings.DataDir, "outbox", "events", $"{e.OccurredAt.UtcTicks:D20}_{e.Uid}.json");

    /// <summary>ABC1234 → ABC-1234（顯示用）</summary>
    public static string Pretty(string plate)
    {
        var i = 0;
        while (i < plate.Length && char.IsLetter(plate[i]) == char.IsLetter(plate[0])) i++;
        return i > 0 && i < plate.Length ? $"{plate[..i]}-{plate[i..]}" : plate;
    }

    private void Safe(Action a)
    {
        try { a(); } catch (Exception e) { Log.Error($"車道 {Code} 處理失敗", e); }
    }

    public void Dispose() => _camera.Dispose();
}
