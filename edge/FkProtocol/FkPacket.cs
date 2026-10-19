// ParkDodo Edge — FK 小語種顯示語音控制卡封包產生器
// 依廠商 Demo 工具（Fyun168.FKLED）實際行為整理，並以工具紀錄中 114 個真實封包驗證 CRC。
//
// 封包：AA 55 | 流水號 | 地址 | 保留(00) | 指令 | 長度(2, 高位在前) | 資料 | CRC16(2, 高位在前) | AF
// CRC ：CRC-16/MODBUS（初值 0xFFFF、多項式 0xA001 反射），
//       計算範圍＝流水號 … 資料，再加上 2 bytes 密碼（未加密時為 00 00）。
//
// 安全規則：本類別只提供「可由程式自動發送」的指令。
// 廣告、勿擾、音量、加解密、改地址、改波特率等參數類指令，廠商文件註明自動發送可能造成硬體永久損壞，
// 一律不放在這裡，只能由後台人工操作。
using System;
using System.Collections.Generic;
using System.Text;

namespace ParkDodo.Edge.FkProtocol;

public sealed class FkPacketBuilder
{
    public const byte CmdQueryVersion = 0x02;   // 唯一會回應的指令，可當心跳
    public const byte CmdCancelTemp   = 0x21;   // 取消臨時顯示
    public const byte CmdPlayVoice    = 0x22;   // 播放語音（立即中斷前一段）
    public const byte CmdShowQrCode   = 0x28;   // 顯示 QR Code（文件未列，取自 Demo 工具）
    public const byte CmdColorTemp    = 0x37;   // 全彩臨時顯示（文件未列，取自 Demo 工具）
    public const byte CmdTempText     = 0x47;   // 臨時顯示（Unicode / UCS-2）

    private readonly byte _address;
    private readonly ushort _password;
    private byte _serial;
    private static readonly Encoding Gbk;

    static FkPacketBuilder()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Gbk = Encoding.GetEncoding("GBK");
    }

    public FkPacketBuilder(byte address = 100, ushort password = 0x0000)
    {
        _address = address;
        _password = password;
    }

    /// <summary>查詢版本（心跳）。</summary>
    public byte[] QueryVersion() => Build(CmdQueryVersion, Array.Empty<byte>());

    /// <summary>播放語音編號（0–255，對應已燒錄的 WAV）；可一次排多段。</summary>
    public byte[] PlayVoice(params byte[] voiceIds)
    {
        if (voiceIds.Length is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(voiceIds));
        return Build(CmdPlayVoice, voiceIds);
    }

    /// <summary>取消臨時顯示，恢復廣告內容。lineMask：bit0=第 1 行 … bit3=第 4 行。</summary>
    public byte[] CancelTemp(byte lineMask = 0x0F) => Build(CmdCancelTemp, new[] { lineMask });

    /// <summary>臨時顯示（0x47）。seconds=0 代表常駐直到取消。color：1 紅 2 綠 3 黃 4 藍 5 紫 6 青 7 白。</summary>
    public byte[] TempText(byte line, string text, byte seconds = 10, byte color = 2)
    {
        if (line is < 1 or > 4) throw new ArgumentOutOfRangeException(nameof(line));
        var body = new List<byte> { line, seconds, color, 0x00 };   // 0x00 = Unicode
        body.AddRange(Encoding.BigEndianUnicode.GetBytes(text));     // UCS-2，高位在前
        return Build(CmdTempText, body.ToArray());
    }

    /// <summary>全彩臨時顯示（0x37，GBK 編碼）。</summary>
    public byte[] ColorTempText(byte line, string text, byte seconds = 10, byte color = 2)
    {
        var body = new List<byte> { line, seconds, color, 0x00 };
        body.AddRange(Gbk.GetBytes(text));
        return Build(CmdColorTemp, body.ToArray());
    }

    /// <summary>
    /// 顯示 QR Code（0x28）。mode 0 = 只顯示 QR；mode 1 = QR＋左側文字（最多 8 bytes GBK，約 4 個中文字）。
    /// seconds=0 代表常駐。內容建議放出口一次性付款網址，並先確認 LED 解析度能被手機辨識。
    /// </summary>
    public byte[] ShowQrCode(string url, byte mode = 0, string? leftText = null, byte seconds = 0, byte color = 1)
    {
        var body = new List<byte> { mode, seconds, color };
        body.AddRange(Gbk.GetBytes(url));
        if (mode == 1)
        {
            var label = new byte[8];
            var src = Gbk.GetBytes(leftText ?? string.Empty);
            Array.Copy(src, label, Math.Min(8, src.Length));
            body.AddRange(label);
        }
        return Build(CmdShowQrCode, body.ToArray());
    }

    /// <summary>依指令與資料組出完整封包（含流水號、CRC、結束符）。</summary>
    public byte[] Build(byte cmd, byte[] data)
    {
        if (data.Length > 244) throw new ArgumentException("資料最多 244 bytes（單包上限 255）");
        var serial = _serial++;
        var core = new List<byte>(8 + data.Length)
        {
            serial, _address, 0x00, cmd, (byte)(data.Length >> 8), (byte)data.Length
        };
        core.AddRange(data);

        var crcInput = new List<byte>(core) { (byte)(_password >> 8), (byte)_password };
        ushort crc = Crc16Modbus(crcInput);

        var packet = new List<byte>(core.Count + 5) { 0xAA, 0x55 };
        packet.AddRange(core);
        packet.Add((byte)(crc >> 8));
        packet.Add((byte)crc);
        packet.Add(0xAF);
        return packet.ToArray();
    }

    public static ushort Crc16Modbus(IReadOnlyList<byte> bytes)
    {
        ushort crc = 0xFFFF;
        foreach (var b in bytes)
        {
            crc ^= b;
            for (int i = 0; i < 8; i++)
                crc = (crc & 1) != 0 ? (ushort)((crc >> 1) ^ 0xA001) : (ushort)(crc >> 1);
        }
        return crc;
    }

    /// <summary>驗證收到或記錄中的封包 CRC 是否正確。</summary>
    public static bool Verify(byte[] packet, ushort password = 0x0000)
    {
        if (packet.Length < 11 || packet[0] != 0xAA || packet[1] != 0x55 || packet[^1] != 0xAF) return false;
        int len = (packet[6] << 8) | packet[7];
        if (packet.Length != 11 + len) return false;
        var crcInput = new List<byte>(packet[2..^3]) { (byte)(password >> 8), (byte)password };
        ushort crc = Crc16Modbus(crcInput);
        return packet[^3] == (byte)(crc >> 8) && packet[^2] == (byte)crc;
    }
}
