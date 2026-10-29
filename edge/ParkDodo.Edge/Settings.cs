using System.Text.Json;
using ParkDodo.Edge.Cloud;

namespace ParkDodo.Edge;

/// <summary>工控機本機設定（settings.json）。車道、設備、費率都由雲端下載，這裡只放連線與現場行為。</summary>
public sealed class Settings
{
    public string CloudUrl { get; set; } = "";
    public string DataDir { get; set; } = DefaultDataDir();
    /// <summary>true＝不連實體相機，用本機模擬網頁送車牌（開發、教育訓練、現場驗收前測試）</summary>
    public bool Simulate { get; set; }
    public int SimPort { get; set; } = 8787;
    /// <summary>斷網且未付款時：hold＝不開閘、顯示請按對講；open＝放行並記錄待補收</summary>
    public string OfflineUnpaidExit { get; set; } = "hold";
    public double MinConfidence { get; set; } = 0.7;
    /// <summary>同一車道、同一車牌在幾秒內重複辨識只算一次</summary>
    public int DuplicateSeconds { get; set; } = 10;
    /// <summary>出口等待付款最長幾分鐘（期間每 2 秒向雲端確認）</summary>
    public int ExitWaitMinutes { get; set; } = 5;
    /// <summary>雷達通過訊號：rise＝IO 由 0 變 1 時算通過；fall＝由 1 變 0</summary>
    public string PassSignalEdge { get; set; } = "rise";
    /// <summary>FK 語音編號（依顯示卡燒錄內容設定；沒設定就只顯示文字）例：{"welcome":1,"goodbye":2,"pay":3}</summary>
    public Dictionary<string, byte>? Voices { get; set; }

    public static string DefaultDataDir() => OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ParkDodo", "Edge")
        : Path.Combine(AppContext.BaseDirectory, "data");

    public static string FilePath => Path.Combine(AppContext.BaseDirectory, "settings.json");

    public static Settings Load()
    {
        var s = File.Exists(FilePath) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), Json.Options) ?? new() : new();
        if (string.IsNullOrWhiteSpace(s.DataDir)) s.DataDir = DefaultDataDir();
        return s;
    }

    public void Save() => File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions(Json.Options) { WriteIndented = true }));
}
