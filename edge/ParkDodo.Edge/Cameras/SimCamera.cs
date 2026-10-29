using ParkDodo.Edge.Util;

namespace ParkDodo.Edge.Cameras;

/// <summary>
/// 模擬相機：沒有實體設備時測試整個流程。透過本機模擬網頁（http://127.0.0.1:8787）送出車牌、雷達通過訊號；
/// 開閘與顯示卡封包只寫入日誌，並保留最近的紀錄供測試檢查。
/// </summary>
public sealed class SimCamera(string name) : ILaneCamera
{
    public string Name { get; } = name;
    public bool Online { get; private set; }
    public event Action<PlateRead>? PlateRead;
    public event Action<int, int>? IoChanged;
    public event Action<bool>? OnlineChanged;
    public int GateOpens { get; private set; }
    public List<byte[]> Rs485Sent { get; } = new();

    public void Start() { Online = true; OnlineChanged?.Invoke(true); }

    public bool OpenGate(int relayIndex)
    {
        GateOpens++;
        Log.Info($"[模擬] {Name} 開閘（繼電器 IO{(relayIndex < 0 ? 1 : relayIndex + 1)}）");
        return true;
    }

    public bool SendRs485(byte[] data)
    {
        lock (Rs485Sent) { Rs485Sent.Add(data); if (Rs485Sent.Count > 50) Rs485Sent.RemoveAt(0); }
        return true;
    }

    public void InjectPlate(string plate, double confidence = 0.97, DateTimeOffset? at = null) =>
        PlateRead?.Invoke(new PlateRead(plate, confidence, at ?? DateTimeOffset.Now, null, null, false));

    /// <summary>模擬雷達：IO 輸入先變 1（有車）再回 0（通過）</summary>
    public void InjectPass(int ioIndex)
    {
        IoChanged?.Invoke(ioIndex, 1);
        IoChanged?.Invoke(ioIndex, 0);
    }

    public void SetOnline(bool v) { Online = v; OnlineChanged?.Invoke(v); }
    public void Dispose() { }
}
