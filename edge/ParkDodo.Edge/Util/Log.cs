namespace ParkDodo.Edge.Util;

/// <summary>
/// 簡單的檔案日誌：每天一個檔，保留 30 天；同時輸出到主控台。
/// 主控台由背景執行緒輸出：視窗被「選取」暫停或卡住時，只會延後顯示，不會讓車道停下來。
/// </summary>
public static class Log
{
    private static readonly object Gate = new();
    private static string? _dir;
    private static readonly System.Collections.Concurrent.BlockingCollection<string> ConsoleQueue = new(boundedCapacity: 5000);

    static Log()
    {
        var t = new Thread(() => { foreach (var line in ConsoleQueue.GetConsumingEnumerable()) { try { Console.WriteLine(line); } catch { } } })
            { IsBackground = true, Name = "log-console" };
        t.Start();
    }

    /// <summary>程式結束前把還沒顯示的日誌印完（最多等 1 秒）</summary>
    public static void Drain()
    {
        var until = DateTime.UtcNow.AddSeconds(1);
        while (ConsoleQueue.Count > 0 && DateTime.UtcNow < until) Thread.Sleep(20);
    }

    public static void Init(string dataDir)
    {
        _dir = Path.Combine(dataDir, "logs");
        Directory.CreateDirectory(_dir);
        foreach (var f in Directory.GetFiles(_dir, "edge-*.log"))
            if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-30)) TryDelete(f);
    }

    public static void Info(string msg) => Write("INFO", msg);
    public static void Warn(string msg) => Write("WARN", msg);
    public static void Error(string msg, Exception? e = null) => Write("ERROR", e is null ? msg : $"{msg}：{e.GetType().Name} {e.Message}");

    private static void Write(string level, string msg)
    {
        var now = DateTimeOffset.Now;
        var line = $"{now:yyyy-MM-dd HH:mm:ss.fff} {level,-5} {msg}";
        ConsoleQueue.TryAdd(line);   // 滿了（主控台卡很久）就只寫檔案
        lock (Gate)
        {
            if (_dir is null) return;
            try { File.AppendAllText(Path.Combine(_dir, $"edge-{now:yyyyMMdd}.log"), line + Environment.NewLine); } catch { /* 磁碟問題不能讓程式停止 */ }
        }
    }

    private static void TryDelete(string f) { try { File.Delete(f); } catch { } }
}
