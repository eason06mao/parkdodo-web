using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using ParkDodo.Edge.Cloud;

namespace ParkDodo.Edge.Lanes;

/// <summary>
/// 斷網時用的本機副本：場內車輛、已付款可離場名單、月租白名單、費率。
/// 每次從雲端下載設定就更新；斷網期間本機入出場也會即時更新。
/// </summary>
public sealed class LocalState
{
    public sealed record Session(string? Id, DateTimeOffset EntryAt, long Paid, bool LocalOnly);

    private readonly ConcurrentDictionary<string, Session> _inside = new();
    private readonly ConcurrentDictionary<string, DateTimeOffset> _authorized = new();
    private readonly ConcurrentDictionary<string, string> _monthly = new();
    public RateSchedule? Rates { get; private set; }
    public string? PayUrlBase { get; private set; }

    public static string Normalize(string plate) => new(plate.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());

    public void Apply(EdgeConfig c)
    {
        var cloud = c.OpenSessions.ToDictionary(s => Normalize(s.Plate), s => new Session(s.Id, s.EntryAt, s.Paid, false));
        // 保留斷網期間本機新增、雲端還不知道的入場
        foreach (var (plate, s) in _inside)
            if (s.LocalOnly && !cloud.ContainsKey(plate) && s.EntryAt > DateTimeOffset.Now.AddDays(-2)) cloud[plate] = s;
        _inside.Clear();
        foreach (var (k, v) in cloud) _inside[k] = v;

        _authorized.Clear();
        foreach (var a in c.ExitAuthorizations) _authorized[Normalize(a.Plate)] = a.ValidUntil;
        _monthly.Clear();
        foreach (var m in c.MonthlyWhitelist) _monthly[Normalize(m.Plate)] = m.EndsOn;
        Rates = c.Rates is JsonObject r ? RateSchedule.FromJson(r) : null;
        PayUrlBase = c.PayUrlBase;
    }

    public void Entered(string plate, DateTimeOffset at, string? sessionId)
    {
        var p = Normalize(plate);
        _inside[p] = new Session(sessionId, at, 0, sessionId is null);
    }

    public void Exited(string plate)
    {
        var p = Normalize(plate);
        _inside.TryRemove(p, out _);
        _authorized.TryRemove(p, out _);
    }

    public Session? Inside(string plate) => _inside.TryGetValue(Normalize(plate), out var s) ? s : null;
    public bool IsMonthly(string plate) => _monthly.TryGetValue(Normalize(plate), out var ends)
        && DateOnly.TryParse(ends, out var d) && d >= DateOnly.FromDateTime(DateTime.Now);
    public bool IsAuthorized(string plate, DateTimeOffset at) => _authorized.TryGetValue(Normalize(plate), out var until) && until >= at;
    public int InsideCount => _inside.Count;

    /// <summary>斷網時的出口判斷（與雲端規則相同的順序：已付款 → 月租 → 費率計算）</summary>
    public Decision OfflineExit(string plate, DateTimeOffset at)
    {
        if (IsAuthorized(plate, at)) return new Decision { Action = "open", Reason = "paid" };
        if (IsMonthly(plate)) return new Decision { Action = "open", Reason = "monthly" };
        var s = Inside(plate);
        if (s is null) return new Decision { Action = "hold", Reason = "no_entry_record" };
        if (Rates is null) return new Decision { Action = "hold", Reason = "no_rates" };
        var amount = FeeEngine.Quote(Rates, s.EntryAt, at).Amount - s.Paid;
        return amount <= 0 ? new Decision { Action = "open", Reason = "free" } : new Decision { Action = "pay", Reason = "unpaid", Amount = amount };
    }
}
