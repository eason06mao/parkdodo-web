// 計費引擎：與雲端 src/lib/billing/fee.ts 完全相同的規則（斷網時在工控機上算金額用）。
// 一致性由 ParkDodo.Edge.Tests 以雲端產生的測試向量（fee_vectors.json）逐筆比對。
// 規則摘要：免費短停 freeMinutes；超過就從入場起算；每 unitMinutes 一單位、未滿以一單位計；
// 付款後 exitGraceMinutes 內離場；可設當日上限（日曆日或每 24 小時）；促銷依 promoMode 計價。
using System.Text.Json.Nodes;

namespace ParkDodo.Edge.Lanes;

public sealed record RatePlan(
    int FreeMinutes, int UnitMinutes, long UnitPrice, string Precision, long? DailyCap,
    string CapWindow, int ExitGraceMinutes, string PromoMode, string OverstayMode)
{
    public static readonly RatePlan Default = new(10, 30, 30, "minute", null, "calendar_day", 15, "entry_time", "recalc_from_entry");

    public static RatePlan FromJson(JsonObject o) => new(
        (int?)o["freeMinutes"] ?? Default.FreeMinutes,
        (int?)o["unitMinutes"] ?? Default.UnitMinutes,
        (long?)o["unitPrice"] ?? Default.UnitPrice,
        (string?)o["precision"] ?? Default.Precision,
        o["dailyCap"] is JsonValue v ? (long?)v : null,
        (string?)o["capWindow"] ?? Default.CapWindow,
        (int?)o["exitGraceMinutes"] ?? Default.ExitGraceMinutes,
        (string?)o["promoMode"] ?? Default.PromoMode,
        (string?)o["overstayMode"] ?? Default.OverstayMode);

    /// <summary>套用促銷覆寫（只覆寫有出現的欄位；dailyCap 可明確設為 null）</summary>
    public RatePlan With(JsonObject? overrides)
    {
        if (overrides is null) return this;
        var p = this;
        if (overrides.TryGetPropertyValue("unitPrice", out var up) && up is not null) p = p with { UnitPrice = (long)up };
        if (overrides.TryGetPropertyValue("freeMinutes", out var fm) && fm is not null) p = p with { FreeMinutes = (int)fm };
        if (overrides.TryGetPropertyValue("dailyCap", out var dc)) p = p with { DailyCap = dc is null ? null : (long)dc };
        return p;
    }
}

public sealed record Promotion(string Id, string Name, DateTimeOffset StartsAt, DateTimeOffset EndsAt, JsonObject? Overrides);

public sealed record RateSchedule(RatePlan Base, IReadOnlyList<Promotion> Promotions)
{
    public static RateSchedule FromJson(JsonObject o)
    {
        var promos = new List<Promotion>();
        if (o["promotions"] is JsonArray arr)
            foreach (var n in arr.OfType<JsonObject>())
                promos.Add(new Promotion((string?)n["id"] ?? "", (string?)n["name"] ?? "",
                    DateTimeOffset.Parse((string)n["startsAt"]!), DateTimeOffset.Parse((string)n["endsAt"]!), n["overrides"] as JsonObject));
        return new RateSchedule(o["base"] is JsonObject b ? RatePlan.FromJson(b) : RatePlan.Default, promos);
    }
}

public sealed record FeeResult(long Amount, int BillableUnits, bool Free, bool Capped);

public static class FeeEngine
{
    private static readonly TimeSpan Taipei = TimeSpan.FromHours(8);   // 台灣沒有日光節約時間

    public static (RatePlan Plan, Promotion? Promo) PlanAt(RateSchedule s, DateTimeOffset at)
    {
        var promo = s.Promotions.Where(p => p.StartsAt <= at && at < p.EndsAt).OrderByDescending(p => p.StartsAt).FirstOrDefault();
        return promo is null ? (s.Base, null) : (s.Base.With(promo.Overrides), promo);
    }

    public static FeeResult Calculate(RatePlan plan, DateTimeOffset entry, DateTimeOffset exit, Func<DateTimeOffset, long>? priceAt = null)
    {
        var ms = Math.Max(0, (long)(exit - entry).TotalMilliseconds);
        var seconds = ms / 1000;
        var minutes = seconds / 60;
        var withinFree = plan.Precision == "minute" ? minutes <= plan.FreeMinutes : seconds <= plan.FreeMinutes * 60L;
        if (withinFree || (plan.UnitPrice == 0 && priceAt is null)) return new FeeResult(0, 0, withinFree, false);

        long unitSec = plan.UnitMinutes * 60L;
        int units = (int)(plan.Precision == "minute" ? CeilDiv(minutes, plan.UnitMinutes) : CeilDiv(seconds, unitSec));
        long UnitPrice(int k) => priceAt is null ? plan.UnitPrice : priceAt(entry.AddSeconds(k * unitSec));

        if (plan.DailyCap is null)
        {
            long sum = 0;
            for (var k = 0; k < units; k++) sum += UnitPrice(k);
            return new FeeResult(sum, units, false, false);
        }

        // 當日上限：每個計費單位歸屬於它「開始時」所在的期間
        var buckets = new Dictionary<string, long>();
        var order = new List<string>();
        for (var k = 0; k < units; k++)
        {
            var start = entry.AddSeconds(k * unitSec);
            var key = plan.CapWindow == "calendar_day"
                ? start.ToOffset(Taipei).ToString("yyyy-MM-dd")
                : $"D{(k * unitSec) / 86400 + 1}";
            if (!buckets.ContainsKey(key)) { buckets[key] = 0; order.Add(key); }
            buckets[key] += UnitPrice(k);
        }
        long amount = 0; var capped = false;
        foreach (var key in order)
        {
            var raw = buckets[key];
            var charged = Math.Min(raw, plan.DailyCap.Value);
            if (raw > charged) capped = true;
            amount += charged;
        }
        return new FeeResult(amount, units, false, capped);
    }

    public static FeeResult Quote(RateSchedule s, DateTimeOffset entry, DateTimeOffset at)
    {
        var (plan, _) = PlanAt(s, entry);
        if (plan.PromoMode == "segmented" && s.Promotions.Count > 0)
            return Calculate(plan, entry, at, t => PlanAt(s, t).Plan.UnitPrice);
        return Calculate(plan, entry, at);
    }

    /// <summary>出口判斷：付款後寬限內放行；超時依 overstayMode 補收。回傳 null 代表放行，否則為應補金額。</summary>
    public static long? ExitCheck(RateSchedule s, DateTimeOffset entry, DateTimeOffset paidAt, long paidAmount, DateTimeOffset exit)
    {
        var (plan, _) = PlanAt(s, entry);
        var graceEnd = paidAt.AddMinutes(plan.ExitGraceMinutes);
        if (exit <= graceEnd) return null;
        var extra = plan.OverstayMode == "from_grace_end"
            ? Calculate(plan with { FreeMinutes = 0 }, graceEnd, exit).Amount
            : Math.Max(0, Quote(s, entry, exit).Amount - paidAmount);
        return extra == 0 ? null : extra;
    }

    private static long CeilDiv(long a, long b) => (a + b - 1) / b;
}
