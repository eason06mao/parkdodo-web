using System.Text.Json;
using ParkDodo.Edge.Cloud;

namespace ParkDodo.Edge.Util;

/// <summary>
/// 待上傳佇列：每筆事件一個檔案（先寫暫存檔再改名，斷電也不會寫一半），雲端確認收到才刪除。
/// 斷網期間累積的事件，恢復後依發生時間補傳。照片放在 images/，事件上傳成功後再傳。
/// </summary>
public sealed class Outbox
{
    private readonly string _events;
    private readonly string _images;
    public const long MaxBytes = 2L * 1024 * 1024 * 1024;   // 照片最多佔 2GB，超過先刪最舊的照片（事件永遠保留）

    public Outbox(string dataDir)
    {
        _events = Path.Combine(dataDir, "outbox", "events");
        _images = Path.Combine(dataDir, "outbox", "images");
        Directory.CreateDirectory(_events);
        Directory.CreateDirectory(_images);
    }

    public int EventCount => Directory.GetFiles(_events, "*.json").Length;

    public void Add(EdgeEvent e, byte[]? plateJpeg = null, byte[]? fullJpeg = null)
    {
        // 照片先寫，避免事件上傳後找不到照片
        if (plateJpeg is { Length: > 0 }) Atomic(Path.Combine(_images, $"{e.Uid}.plate.jpg"), plateJpeg);
        if (fullJpeg is { Length: > 0 }) Atomic(Path.Combine(_images, $"{e.Uid}.full.jpg"), fullJpeg);
        var name = $"{e.OccurredAt.UtcTicks:D20}_{e.Uid}.json";
        Atomic(Path.Combine(_events, name), JsonSerializer.SerializeToUtf8Bytes(e, Json.Options));
    }

    /// <summary>依發生時間取最舊的 n 筆</summary>
    public List<(string File, EdgeEvent Event)> Peek(int n)
    {
        var list = new List<(string, EdgeEvent)>();
        foreach (var f in Directory.GetFiles(_events, "*.json").OrderBy(x => Path.GetFileName(x), StringComparer.Ordinal).Take(n))
        {
            try
            {
                var e = JsonSerializer.Deserialize<EdgeEvent>(File.ReadAllBytes(f), Json.Options);
                if (e is not null) list.Add((f, e));
            }
            catch (Exception ex)
            {
                Log.Error($"佇列檔案損壞，移到 broken/：{Path.GetFileName(f)}", ex);
                var broken = Path.Combine(Path.GetDirectoryName(_events)!, "broken");
                Directory.CreateDirectory(broken);
                File.Move(f, Path.Combine(broken, Path.GetFileName(f)), true);
            }
        }
        return list;
    }

    public void Ack(string file) { try { File.Delete(file); } catch (FileNotFoundException) { } }

    public IEnumerable<(string File, string EventUid, string Kind)> PendingImages(ISet<string> pendingEventUids)
    {
        foreach (var f in Directory.GetFiles(_images, "*.jpg").OrderBy(File.GetCreationTimeUtc))
        {
            var name = Path.GetFileNameWithoutExtension(f);           // <uid>.plate
            var dot = name.LastIndexOf('.');
            if (dot <= 0) continue;
            var uid = name[..dot];
            if (pendingEventUids.Contains(uid)) continue;             // 事件還沒上傳
            yield return (f, uid, name[(dot + 1)..]);
        }
    }

    public void TrimImages()
    {
        var files = Directory.GetFiles(_images, "*.jpg").Select(f => new FileInfo(f)).OrderBy(f => f.CreationTimeUtc).ToList();
        var total = files.Sum(f => f.Length);
        foreach (var f in files)
        {
            if (total <= MaxBytes) break;
            total -= f.Length;
            try { f.Delete(); } catch { }
        }
    }

    private static void Atomic(string path, byte[] data)
    {
        var tmp = path + ".tmp";
        File.WriteAllBytes(tmp, data);
        File.Move(tmp, path, overwrite: true);
    }
}
