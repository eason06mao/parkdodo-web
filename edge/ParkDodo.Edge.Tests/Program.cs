// ParkDodo Edge 測試：計費與雲端一致、斷網判斷、事件佇列、車道流程（模擬相機、斷網）
using System.Text.Json.Nodes;
using ParkDodo.Edge;
using ParkDodo.Edge.Cameras;
using ParkDodo.Edge.Cloud;
using ParkDodo.Edge.Lanes;
using ParkDodo.Edge.Util;

var failed = 0; var passed = 0;
void Check(string name, bool ok, string detail = "")
{
    if (ok) { passed++; } else { failed++; Console.WriteLine($"FAIL {name} {detail}"); }
}

// ---------- 1. 計費：與雲端 TypeScript 逐筆比對 ----------
var doc = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fee_vectors.json")))!;
var schedules = doc["schedules"]!.AsArray().Select(s => RateSchedule.FromJson(s!.AsObject())).ToList();
var feeFails = 0;
foreach (var v in doc["vectors"]!.AsArray())
{
    var s = schedules[(int)v!["schedule"]!];
    var entry = DateTimeOffset.Parse((string)v["entry"]!);
    if ((string)v["kind"]! == "quote")
    {
        var at = DateTimeOffset.Parse((string)v["at"]!);
        var got = FeeEngine.Quote(s, entry, at).Amount;
        if (got != (long)v["amount"]!) { feeFails++; if (feeFails < 6) Console.WriteLine($"  計費不一致 schedule={v["schedule"]} {entry:o}→{at:o} TS={v["amount"]} C#={got}"); }
    }
    else
    {
        var got = FeeEngine.ExitCheck(s, entry, DateTimeOffset.Parse((string)v["paidAt"]!), (long)v["paidAmount"]!, DateTimeOffset.Parse((string)v["exit"]!));
        long? want = v["extra"] is null ? null : (long)v["extra"]!;
        if (got != want) { feeFails++; if (feeFails < 6) Console.WriteLine($"  出口判斷不一致 schedule={v["schedule"]} TS={want} C#={got}"); }
    }
}
var total = doc["vectors"]!.AsArray().Count;
Check($"計費與雲端一致（{total} 筆）", feeFails == 0, $"{feeFails} 筆不一致");

// ---------- 2. 本機副本：斷網出口判斷 ----------
var st = new LocalState();
var now = DateTimeOffset.Now;
st.Apply(new EdgeConfig
{
    Site = new SiteInfo("s", "TST", "測試站"),
    Rates = JsonNode.Parse("""{"base":{"freeMinutes":10,"unitMinutes":30,"unitPrice":30,"precision":"minute","dailyCap":null,"capWindow":"calendar_day","exitGraceMinutes":15,"promoMode":"entry_time","overstayMode":"recalc_from_entry"},"promotions":[]}""")!.AsObject(),
    OpenSessions = { new OpenSession("a", "ABC-1234", now.AddMinutes(-45), 0), new OpenSession("b", "FREE-01", now.AddMinutes(-5), 0) },
    ExitAuthorizations = { new ExitAuth("PAID-001", "c", now.AddMinutes(5)), new ExitAuth("LATE-001", "d", now.AddMinutes(-1)) },
    MonthlyWhitelist = { new MonthlyPlate("MON-8888", "M1", DateTime.Now.AddDays(10).ToString("yyyy-MM-dd")), new MonthlyPlate("OLD-0000", "M0", "2020-01-01") },
});
Check("斷網：已付款且在寬限內放行", st.OfflineExit("paid001", now).Action == "open");
Check("斷網：月租車放行", st.OfflineExit("MON8888", now) is { Action: "open", Reason: "monthly" });
Check("斷網：過期月租不算", st.OfflineExit("OLD-0000", now).Action == "hold");
Check("斷網：免費時間內放行", st.OfflineExit("FREE01", now) is { Action: "open", Reason: "free" });
Check("斷網：45 分鐘算出 60 元", st.OfflineExit("ABC1234", now) is { Action: "pay", Amount: 60 });
Check("斷網：沒有入場紀錄要人工處理", st.OfflineExit("ZZZ9999", now) is { Action: "hold", Reason: "no_entry_record" });
Check("車牌顯示格式", LaneController.Pretty("ABC1234") == "ABC-1234" && LaneController.Pretty("1234AB") == "1234-AB");

// ---------- 3. 佇列：依發生時間、重開後還在 ----------
var dir = Path.Combine(Path.GetTempPath(), "pd-edge-test-" + Guid.NewGuid().ToString("N"));
var ob = new Outbox(dir);
ob.Add(new EdgeEvent { Uid = "TST-late-00000001", Type = "plate_read", LaneCode = "IN-1", OccurredAt = now, Plate = "B" });
ob.Add(new EdgeEvent { Uid = "TST-early-0000001", Type = "plate_read", LaneCode = "IN-1", OccurredAt = now.AddMinutes(-3), Plate = "A" }, plateJpeg: new byte[] { 0xFF, 0xD8, 1 });
var ob2 = new Outbox(dir);
var peek = ob2.Peek(10);
Check("佇列依發生時間排序", peek.Count == 2 && peek[0].Event.Plate == "A");
Check("事件上傳前不傳照片", !ob2.PendingImages(peek.Select(p => p.Event.Uid).ToHashSet()).Any());
ob2.Ack(peek[0].File);
Check("確認後才刪除", ob2.EventCount == 1);
Check("事件上傳後照片可上傳", ob2.PendingImages(ob2.Peek(10).Select(p => p.Event.Uid).ToHashSet()).Count() == 1);

// ---------- 4. 車道流程（斷網、模擬相機） ----------
var settings = new Settings { DataDir = dir, Simulate = true };
var flushed = 0;
var ctx = new LaneController.Context(settings, ob2, st, () => null, "TST", () => flushed++);
var inCam = new SimCamera("IN"); var outCam = new SimCamera("OUT");
var entryLane = new LaneController(ctx, new LaneConfig { Code = "IN-1", Direction = "entry" }, inCam, new FkDisplay(inCam, 100), "cam-in", 0, 1);
var exitLane = new LaneController(ctx, new LaneConfig { Code = "OUT-1", Direction = "exit" }, outCam, new FkDisplay(outCam, 100), "cam-out", 0, 1);
entryLane.Start(); exitLane.Start();

inCam.InjectPlate("NEW-1234");
Check("入場：斷網也立刻開閘", inCam.GateOpens == 1);
Check("入場：顯示卡有送出歡迎文字", inCam.Rs485Sent.Count >= 2);
inCam.InjectPlate("NEW-1234");
Check("入場：10 秒內重複辨識只算一次", inCam.GateOpens == 1);
Check("入場：本機記錄在場", st.Inside("NEW1234") is not null);

outCam.InjectPlate("ABC-1234");
Check("出口：斷網未付款預設不開閘", outCam.GateOpens == 0);
outCam.InjectPlate("PAID-001");
Check("出口：斷網已付款放行", outCam.GateOpens == 1);
outCam.InjectPass(1);
Check("出口：通過後從場內移除", st.Inside("PAID001") is null);
outCam.InjectPlate("LOW-0001", confidence: 0.4);
Check("出口：信心值過低不開閘", outCam.GateOpens == 1);

settings.OfflineUnpaidExit = "open";
outCam.InjectPlate("ABC-1234", at: DateTimeOffset.Now.AddSeconds(30));
Check("出口：設定為斷網放行時開閘並記錄", outCam.GateOpens == 2);
var events = ob2.Peek(100).Select(p => p.Event).ToList();
Check("事件都有寫入佇列", events.Count(e => e.Type == "plate_read") >= 5 && events.Any(e => e.Type == "vehicle_passed"));
Check("斷網放行有記錄待補收金額", events.Any(e => e.Type == "gate_opened" && e.Payload is { } p && p.ContainsKey("offlineUnpaidAmount")));
Check("事件 uid 格式符合雲端規則", events.All(e => System.Text.RegularExpressions.Regex.IsMatch(e.Uid, @"^[\w.:-]{8,100}$")));

Directory.Delete(dir, true);
Console.WriteLine(failed == 0 ? $"ALL EDGE TESTS PASSED（{passed} 項）" : $"{failed} 項失敗，{passed} 項通過");
return failed == 0 ? 0 : 1;
