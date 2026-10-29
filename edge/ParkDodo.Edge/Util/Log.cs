namespace ParkDodo.Edge.Util;

/// <summary>簡單的檔案日誌：每天一個檔，保留 30 天；同時輸出到主控台。</summary>
public static class Log
{
    private static readonly object Gate = new();
    private static string? _dir;

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
        lock (Gate)
        {
            Console.WriteLine(line);
            if (_dir is null) return;
            try { File.AppendAllText(Path.Combine(_dir, $"edge-{now:yyyyMMdd}.log"), line + Environment.NewLine); } catch { /* 磁碟問題不能讓程式停止 */ }
        }
    }

    private static void TryDelete(string f) { try { File.Delete(f); } catch { } }
}
