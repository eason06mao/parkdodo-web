using System.Text.Json;
using ParkDodo.Edge.Cameras;
using ParkDodo.Edge.Cloud;
using ParkDodo.Edge.Lanes;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge;

/// <summary>
/// 工控機主程式：管理車道、和雲端同步。
///   心跳 15 秒；設定版本變更就重新下載；事件佇列有資料就上傳；遠端開閘指令每 2 秒取一次；照片背景上傳。
///   雲端連不上時車道照常運作（用本機副本判斷），恢復後自動補傳。
/// </summary>
public sealed class EdgeAgent : IAsyncDisposable
{
    private readonly Settings _s;
    private readonly Outbox _outbox;
    private readonly LocalState _state = new();
    private readonly CloudClient _cloud;
    private readonly Dictionary<string, LaneController> _lanes = new();
    private readonly SemaphoreSlim _flushSignal = new(0);
    private readonly CancellationTokenSource _stop = new();
    private DateTimeOffset _lastCloudOk = DateTimeOffset.MinValue;
    private long _configVersion = -1;
    private string _laneSignature = "";
    private string _siteCode = "SITE";
    private SimServer? _sim;
    private bool _keyRejected;
    private DateTimeOffset _offlineFrom = DateTimeOffset.MaxValue;   // 第一次連不上雲端的時間（之後發生的事件都標為補傳）

    public EdgeAgent(Settings s, string deviceKey)
    {
        _s = s;
        _outbox = new Outbox(s.DataDir);
        _cloud = new CloudClient(s.CloudUrl, deviceKey);
    }

    public IReadOnlyDictionary<string, LaneController> Lanes => _lanes;
    public LocalState State => _state;
    public bool CloudOnline => DateTimeOffset.Now - _lastCloudOk < TimeSpan.FromSeconds(40);
    private string ConfigCache => Path.Combine(_s.DataDir, "config.json");

    public async Task StartAsync()
    {
        Log.Info($"ParkDodo Edge {Program.Version} 啟動・雲端 {_s.CloudUrl}・{(_s.Simulate ? "模擬模式" : "實體設備")}・待上傳 {_outbox.EventCount} 筆");
        // 先用上次下載的設定啟動車道，雲端連不上也能運作
        if (File.Exists(ConfigCache))
        {
            try { ApplyConfig(JsonSerializer.Deserialize<EdgeConfig>(await File.ReadAllTextAsync(ConfigCache), Json.Options)!, fromCache: true); }
            catch (Exception e) { Log.Error("讀取本機設定副本失敗", e); }
        }
        await RefreshConfig();
        if (_s.Simulate) { _sim = new SimServer(this, _s.SimPort); _sim.Start(); }

        _ = Loop("心跳", TimeSpan.FromSeconds(15), Heartbeat);
        _ = Loop("指令", TimeSpan.FromSeconds(2), PollCommands);
        _ = Loop("出口確認", TimeSpan.FromSeconds(2), () => { foreach (var l in _lanes.Values) if (l.IsExit) l.Tick(); return Task.CompletedTask; });
        _ = Loop("照片", TimeSpan.FromSeconds(10), UploadImages);
        _ = FlushLoop();
    }

    public void FlushNow() => _flushSignal.Release();

    // ------------------------------------------------------------------ 設定

    private async Task RefreshConfig()
    {
        try
        {
            var cfg = await _cloud.Config(_stop.Token);
            CloudOk();
            ApplyConfig(cfg, fromCache: false);
            var tmp = ConfigCache + ".tmp";
            await File.WriteAllTextAsync(tmp, JsonSerializer.Serialize(cfg, Json.Options));
            File.Move(tmp, ConfigCache, true);
        }
        catch (Exception e) { CloudFail(e, "下載設定"); }
    }

    private void ApplyConfig(EdgeConfig cfg, bool fromCache)
    {
        _siteCode = cfg.Site.Code;
        _state.Apply(cfg);
        _configVersion = cfg.ConfigVersion;
        var sig = string.Join("|", cfg.Lanes.Select(l => $"{l.Code}:{l.Direction}:" + string.Join(",", l.Devices.Select(d => $"{d.Id}/{d.Ip}/{d.Rs485Address}/{d.Connection?.ToJsonString()}"))));
        foreach (var l in cfg.Lanes) if (_lanes.TryGetValue(l.Code, out var lc)) lc.Active = l.Active;
        if (sig == _laneSignature) { Log.Info($"設定已更新（版本 {cfg.ConfigVersion}{(fromCache ? "，本機副本" : "")}）"); return; }

        foreach (var l in _lanes.Values) l.Dispose();
        _lanes.Clear();
        _laneSignature = sig;
        var ctx = new LaneController.Context(_s, _outbox, _state, () => CloudOnline || _lastCloudOk == DateTimeOffset.MinValue ? _cloud : null, _siteCode, FlushNow);
        foreach (var lane in cfg.Lanes)
        {
            var cam = lane.Devices.FirstOrDefault(d => d.Type == "lpr_camera");
            if (cam is null) { Log.Warn($"車道 {lane.Code} 沒有登錄車牌辨識攝影機，略過"); continue; }
            var fk = lane.Devices.FirstOrDefault(d => d.Type == "led_voice_card");
            ILaneCamera camera = _s.Simulate ? new SimCamera($"{lane.Code} 模擬相機") : new IceCamera(lane.Code, cam.Ip ?? throw new InvalidOperationException($"車道 {lane.Code} 相機沒有 IP"));
            var display = fk is null ? null : new FkDisplay(camera, (byte)(fk.Rs485Address ?? 100), _s.Voices);
            var lc = new LaneController(ctx, lane, camera, display, cam.Id, cam.ConnInt("gate_relay", 0), cam.ConnInt("pass_io_input", 1));
            try { lc.Start(); } catch (Exception e) { Log.Error($"車道 {lane.Code} 相機啟動失敗（會繼續重試連線）", e); }
            _lanes[lane.Code] = lc;
        }
        Log.Info($"{cfg.Site.Name}（{cfg.Site.Code}）：車道 {string.Join("、", _lanes.Keys)}・場內 {_state.InsideCount} 台・設定版本 {cfg.ConfigVersion}{(fromCache ? "（本機副本）" : "")}");
    }

    // ------------------------------------------------------------------ 同步

    private async Task Heartbeat()
    {
        var devices = _lanes.Values.Select(l => new { id = l.CameraDeviceId, status = l.Camera.Online ? "online" : "offline" }).ToList();
        var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(_s.DataDir))!);
        try
        {
            var hb = await _cloud.Heartbeat(new
            {
                agentVersion = Program.Version, osVersion = Environment.OSVersion.VersionString,
                queueDepth = _outbox.EventCount, diskFreeMb = drive.AvailableFreeSpace / 1048576, devices,
            }, _stop.Token);
            CloudOk();
            if (hb.ConfigVersion != _configVersion) await RefreshConfig();
        }
        catch (Exception e) { CloudFail(e, "心跳"); }
        _outbox.TrimImages();
    }

    private async Task FlushLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            await _flushSignal.WaitAsync(TimeSpan.FromSeconds(5), _stop.Token).ContinueWith(_ => { });
            while (_flushSignal.CurrentCount > 0) await _flushSignal.WaitAsync(0);
            try
            {
                for (;;)
                {
                    var batch = _outbox.Peek(100);
                    if (batch.Count == 0) break;
                    foreach (var (_, e) in batch)
                        if (e.OccurredAt >= _offlineFrom.AddSeconds(-5) || DateTimeOffset.Now - e.OccurredAt > TimeSpan.FromMinutes(1)) e.Replayed = true;
                    var res = await _cloud.Events(batch.Select(b => b.Event).ToList(), TimeSpan.FromSeconds(15), _stop.Token);
                    CloudOk();
                    var byUid = res.Results.ToDictionary(r => r.Uid);
                    foreach (var (file, e) in batch)
                    {
                        if (!byUid.TryGetValue(e.Uid, out var r)) continue;
                        if (r.Status == "rejected") Log.Warn($"雲端拒絕事件 {e.Type}（{e.LaneCode} {e.Plate}）：{r.Error}");
                        if (r.Status == "accepted" && e.Type == "plate_read" && r.SessionId is not null && e.Plate is not null
                            && _lanes.TryGetValue(e.LaneCode, out var lane) && !lane.IsExit) _state.Entered(e.Plate, e.OccurredAt, r.SessionId);
                        _outbox.Ack(file);
                    }
                    if (batch.Count < 100) break;
                }
                if (_offlineFrom != DateTimeOffset.MaxValue && _lastCloudOk > _offlineFrom && _outbox.EventCount == 0)
                {
                    Log.Info($"斷網期間的事件已全部補傳（離線開始於 {_offlineFrom:HH:mm:ss}）");
                    _offlineFrom = DateTimeOffset.MaxValue;
                }
            }
            catch (Exception e) { CloudFail(e, "上傳事件"); await Task.Delay(TimeSpan.FromSeconds(5)).ContinueWith(_ => { }); }
        }
    }

    private async Task PollCommands()
    {
        if (!CloudOnline) return;
        try
        {
            var r = await _cloud.Commands(_stop.Token);
            foreach (var c in r.Commands)
            {
                var ok = false; var detail = "";
                if (c.ExpiresAt < DateTimeOffset.Now) detail = "指令已過期，未執行";
                else if (c.Command != "open_once") detail = $"尚未支援 {c.Command}";
                else if (!_lanes.TryGetValue(c.LaneCode, out var lane)) detail = $"找不到車道 {c.LaneCode}";
                else { ok = lane.RemoteOpen(c); detail = ok ? "相機繼電器已觸發" : "開閘失敗"; }
                await _cloud.CommandResult(c.Id, ok, detail, _stop.Token);
            }
        }
        catch (Exception e) { CloudFail(e, "取遠端指令"); }
    }

    private async Task UploadImages()
    {
        if (!CloudOnline) return;
        var pending = _outbox.Peek(500).Select(x => x.Event.Uid).ToHashSet();
        foreach (var (file, uid, kind) in _outbox.PendingImages(pending).Take(20))
        {
            try
            {
                await _cloud.UploadImage(uid, kind, await File.ReadAllBytesAsync(file), _stop.Token);
                File.Delete(file);
            }
            catch (Exception e) { CloudFail(e, "上傳照片"); return; }
        }
    }

    private void CloudOk()
    {
        if (!CloudOnline && _lastCloudOk != DateTimeOffset.MinValue) Log.Info("雲端連線恢復");
        _lastCloudOk = DateTimeOffset.Now;
        _keyRejected = false;
    }

    private void CloudFail(Exception e, string what)
    {
        if (e is CloudException { Unauthorized: true })
        {
            if (!_keyRejected) Log.Error("雲端拒絕裝置金鑰：這台工控機可能已被更換或停用，請在後台重新產生配對碼並執行 pair。車道仍以本機模式運作。");
            _keyRejected = true;
            return;
        }
        if (_offlineFrom == DateTimeOffset.MaxValue)
        {
            _offlineFrom = DateTimeOffset.Now;
            Log.Warn($"雲端連線中斷（{what}：{e.Message}），車道改用本機判斷，事件先存在本機");
        }
    }

    private async Task Loop(string name, TimeSpan every, Func<Task> body)
    {
        while (!_stop.IsCancellationRequested)
        {
            try { await body(); } catch (Exception e) { Log.Error($"{name}迴圈錯誤", e); }
            await Task.Delay(every, _stop.Token).ContinueWith(_ => { });
        }
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        _sim?.Dispose();
        foreach (var l in _lanes.Values) l.Dispose();
        _cloud.Dispose();
        await Task.CompletedTask;
    }
}
