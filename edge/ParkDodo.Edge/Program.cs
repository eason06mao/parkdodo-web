using System.Reflection;
using ParkDodo.Edge;
using ParkDodo.Edge.Cloud;
using ParkDodo.Edge.Util;

// ParkDodo Edge 指令：
//   ParkDodo.Edge.exe pair <配對碼> [--url https://雲端網址]   第一次安裝：用後台產生的 8 位數配對碼取得裝置金鑰
//   ParkDodo.Edge.exe run                                       執行（安裝成開機自動執行後由系統啟動）
//   ParkDodo.Edge.exe status                                    顯示設定、配對狀態、待上傳筆數
public static partial class Program
{
    public static string Version => Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        var s = Settings.Load();
        Log.Init(s.DataDir);
        var cmd = args.FirstOrDefault() ?? "help";
        try
        {
            switch (cmd)
            {
                case "pair": return await Pair(s, args);
                case "run": return await Run(s);
                case "status": return Status(s);
                default:
                    Console.WriteLine("用法：ParkDodo.Edge pair <配對碼> [--url 雲端網址] | run | status");
                    return 2;
            }
        }
        catch (Exception e)
        {
            Log.Error($"{cmd} 失敗", e);
            return 1;
        }
    }

    private static async Task<int> Pair(Settings s, string[] args)
    {
        var code = args.ElementAtOrDefault(1)?.Replace(" ", "") ?? "";
        var i = Array.IndexOf(args, "--url");
        if (i > 0 && i + 1 < args.Length) { s.CloudUrl = args[i + 1].TrimEnd('/'); s.Save(); }
        if (string.IsNullOrWhiteSpace(s.CloudUrl)) { Console.WriteLine("請用 --url 指定雲端網址，或在 settings.json 設定 cloudUrl。"); return 2; }
        using var c = new CloudClient(s.CloudUrl, null);
        var r = await c.Pair(code, new
        {
            model = Environment.GetEnvironmentVariable("COMPUTERNAME") ?? Environment.MachineName,
            serialNo = Environment.MachineName, osVersion = Environment.OSVersion.VersionString, agentVersion = Version,
        }, CancellationToken.None);
        KeyStore.Save(s.DataDir, r.DeviceKey);
        Log.Info($"✅ 已配對：{r.Site.Name}（{r.Site.Code}）。裝置金鑰已加密保存，可以執行 run 或安裝開機自動執行。");
        return 0;
    }

    private static async Task<int> Run(Settings s)
    {
        var key = KeyStore.Load(s.DataDir);
        if (key is null) { Log.Error("尚未配對：請先在後台按「配對工控機」取得配對碼，再執行 pair <配對碼>。"); return 3; }
        await using var agent = new EdgeAgent(s, key);
        await agent.StartAsync();
        var done = new TaskCompletionSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.TrySetResult(); };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => done.TrySetResult();
        await done.Task;
        Log.Info("ParkDodo Edge 結束");
        return 0;
    }

    private static int Status(Settings s)
    {
        Console.WriteLine($"版本：{Version}");
        Console.WriteLine($"設定檔：{Settings.FilePath}");
        Console.WriteLine($"雲端：{(string.IsNullOrEmpty(s.CloudUrl) ? "（未設定）" : s.CloudUrl)}");
        Console.WriteLine($"資料夾：{s.DataDir}");
        Console.WriteLine($"模式：{(s.Simulate ? "模擬" : "實體設備")}");
        Console.WriteLine($"配對：{(File.Exists(KeyStore.PathFor(s.DataDir)) ? "已配對" : "尚未配對")}");
        Console.WriteLine($"待上傳事件：{new Outbox(s.DataDir).EventCount} 筆");
        return 0;
    }
}
