namespace ParkDodo.Edge.Cameras;

public sealed record PlateRead(string Plate, double Confidence, DateTimeOffset At, byte[]? PlateJpeg, byte[]? FullJpeg, bool FalsePlate);

/// <summary>
/// 車道相機（ICE 車牌辨識攝影機）。柵欄由相機繼電器控制、雷達「已通過」接相機 IO 輸入、FK 顯示卡接相機 RS-485，
/// 所以工控機只要用網路線連相機。
/// </summary>
public interface ILaneCamera : IDisposable
{
    string Name { get; }
    bool Online { get; }
    event Action<PlateRead>? PlateRead;
    /// <summary>IO 輸入變化：index 0–3 對應 IO1–IO4，value 為目前狀態</summary>
    event Action<int, int>? IoChanged;
    event Action<bool>? OnlineChanged;
    void Start();
    /// <summary>觸發繼電器開閘；relayIndex 0–3＝IO1–IO4（-1＝使用相機預設開閘輸出）</summary>
    bool OpenGate(int relayIndex);
    /// <summary>經相機 RS-485 透傳資料（FK 顯示語音卡）</summary>
    bool SendRs485(byte[] data);
}
