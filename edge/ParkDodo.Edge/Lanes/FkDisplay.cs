using ParkDodo.Edge.Cameras;
using ParkDodo.Edge.FkProtocol;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge.Lanes;

/// <summary>
/// FK 顯示語音卡（經相機 RS-485 透傳）。只送「可自動發送」的顯示指令（臨時文字、QR、取消臨時顯示）；
/// 廣告、音量、地址、波特率、加解密等參數指令廠商註明自動發送可能損壞硬體，本程式不會發送。
/// 語音只在設定了語音編號時播放（各卡燒錄內容不同）。
/// </summary>
public sealed class FkDisplay(ILaneCamera camera, byte address, IReadOnlyDictionary<string, byte>? voices = null)
{
    private readonly FkPacketBuilder _fk = new(address);
    private readonly object _lock = new();

    public void Show(string line1, string? line2 = null, byte seconds = 15, byte color = 2, string? voice = null)
    {
        lock (_lock)
        {
            Send(_fk.TempText(1, Fit(line1), seconds, color));
            if (line2 is not null) Send(_fk.TempText(2, Fit(line2), seconds, color));
            if (voice is not null && voices is not null && voices.TryGetValue(voice, out var id)) Send(_fk.PlayVoice(id));
        }
    }

    public void ShowQr(string url, string label, byte seconds = 60)
    {
        lock (_lock) Send(_fk.ShowQrCode(url, mode: 1, leftText: label, seconds: seconds));
    }

    public void Clear() { lock (_lock) Send(_fk.CancelTemp()); }

    private void Send(byte[] packet)
    {
        if (!camera.SendRs485(packet)) Log.Warn($"顯示卡指令送出失敗（{camera.Name}）");
        Thread.Sleep(60);   // 連續封包間隔，避免顯示卡漏收
    }

    // 單行約 8 個中文字（16 bytes 寬）；超過就截斷
    private static string Fit(string s) => s.Length > 16 ? s[..16] : s;
}
