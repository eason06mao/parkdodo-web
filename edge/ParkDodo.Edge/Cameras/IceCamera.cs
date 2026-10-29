using System.Runtime.InteropServices;
using System.Text;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge.Cameras;

/// <summary>ICE 車牌辨識攝影機（透過廠商 SDK）。SDK 的回呼在 SDK 執行緒上，這裡只複製資料後丟給事件處理。</summary>
public sealed class IceCamera : ILaneCamera
{
    private static int _sdkRefs;
    private static readonly object SdkLock = new();
    private static readonly Encoding Gbk;

    private readonly string _ip;
    private IntPtr _h;
    private volatile bool _online;
    // 回呼委派要一直被參照，避免被 GC 回收後 SDK 呼叫到無效位址
    private readonly IceSdk.OnPlate _onPlate;
    private readonly IceSdk.OnIoEvent _onIo;
    private readonly IceSdk.OnDeviceEvent _onDevice;
    private readonly uint[] _io = new uint[4];

    static IceCamera()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        Gbk = Encoding.GetEncoding("GBK");
    }

    public IceCamera(string name, string ip)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("ICE SDK 只支援 Windows。開發測試請用模擬模式（simulate: true）。");
        Name = name; _ip = ip;
        _onPlate = HandlePlate; _onIo = HandleIo; _onDevice = HandleDevice;
    }

    public string Name { get; }
    public bool Online => _online;
    public event Action<PlateRead>? PlateRead;
    public event Action<int, int>? IoChanged;
    public event Action<bool>? OnlineChanged;

    public void Start()
    {
        lock (SdkLock) { if (_sdkRefs++ == 0) IceSdk.ICE_IPCSDK_Init(); }
        // OpenDevice 不需要影像串流；SDK 會自動重連
        _h = IceSdk.ICE_IPCSDK_OpenDevice(_ip);
        if (_h == IntPtr.Zero) throw new InvalidOperationException($"無法連線相機 {_ip}");
        IceSdk.ICE_IPCSDK_SetPlateCallback(_h, _onPlate, IntPtr.Zero);
        IceSdk.ICE_IPCSDK_SetIOEventCallBack(_h, _onIo, IntPtr.Zero);
        IceSdk.ICE_IPCSDK_SetDeviceEventCallBack(_h, _onDevice, IntPtr.Zero);
        SetOnline(IceSdk.ICE_IPCSDK_GetStatus(_h) == 1);
        Log.Info($"相機 {Name}（{_ip}）已啟動，狀態：{(_online ? "連線" : "離線")}");
    }

    public bool OpenGate(int relayIndex)
    {
        if (_h == IntPtr.Zero) return false;
        var ok = relayIndex < 0 ? IceSdk.ICE_IPCSDK_OpenGate(_h) == 1 : IceSdk.ICE_IPCSDK_ControlAlarmOut(_h, (uint)relayIndex) == 1;
        if (!ok) Log.Warn($"相機 {Name} 開閘指令失敗");
        return ok;
    }

    public unsafe bool SendRs485(byte[] data)
    {
        if (_h == IntPtr.Zero || data.Length == 0) return false;
        fixed (byte* p = data) return IceSdk.ICE_IPCSDK_TransSerialPort(_h, p, (uint)data.Length) == 1;
    }

    private void HandlePlate(IntPtr param, IntPtr ip, IntPtr result, IntPtr fullPic, int fullLen, IntPtr platePic, int plateLen, uint r1, uint r2)
    {
        try
        {
            var buf = new byte[IceSdk.ResultReadBytes];
            Marshal.Copy(result, buf, 0, buf.Length);
            var plate = CString(buf, IceSdk.OffPlate, 128);
            var falsePlate = BitConverter.ToInt32(buf, IceSdk.OffFalsePlate) != 0;
            double conf = BitConverter.ToSingle(buf, IceSdk.OffConfidence);
            if (conf > 1) conf /= 100.0;                       // 廠商可能回 0–100
            var at = CapTime(buf) ?? DateTimeOffset.Now;
            var plateJpeg = Copy(platePic, plateLen);
            var fullJpeg = Copy(fullPic, fullLen);
            ThreadPool.QueueUserWorkItem(_ => PlateRead?.Invoke(new PlateRead(plate, conf, at, plateJpeg, fullJpeg, falsePlate)));
        }
        catch (Exception e) { Log.Error($"相機 {Name} 車牌資料解析失敗", e); }
    }

    private void HandleIo(IntPtr param, IntPtr ip, uint type, uint io1, uint io2, uint io3, uint io4)
    {
        if (type != 0) return;
        var now = new[] { io1, io2, io3, io4 };
        for (var i = 0; i < 4; i++)
        {
            if (now[i] == _io[i]) continue;
            _io[i] = now[i];
            var idx = i; var val = (int)now[i];
            ThreadPool.QueueUserWorkItem(_ => IoChanged?.Invoke(idx, val));
        }
    }

    private void HandleDevice(IntPtr param, IntPtr handle, IntPtr ip, uint type, uint d1, uint d2, uint d3, uint d4) => SetOnline(type == 1);

    private void SetOnline(bool v)
    {
        if (_online == v) return;
        _online = v;
        ThreadPool.QueueUserWorkItem(_ => OnlineChanged?.Invoke(v));
    }

    private static string CString(byte[] b, int off, int max)
    {
        var len = Array.IndexOf(b, (byte)0, off, max) is var z and >= 0 ? z - off : max;
        return Gbk.GetString(b, off, len).Trim();
    }

    private static DateTimeOffset? CapTime(byte[] b)
    {
        int I(int k) => BitConverter.ToInt32(b, IceSdk.OffCapTime + k * 4);
        try { return I(0) > 2000 ? new DateTimeOffset(I(0), I(1), I(2), I(3), I(4), I(5), TimeSpan.FromHours(8)) : null; }
        catch { return null; }
    }

    private static byte[]? Copy(IntPtr p, int len)
    {
        if (p == IntPtr.Zero || len <= 0 || len > 4_000_000) return null;
        var b = new byte[len];
        Marshal.Copy(p, b, 0, len);
        return b;
    }

    public void Dispose()
    {
        if (_h != IntPtr.Zero) { IceSdk.ICE_IPCSDK_Close(_h); _h = IntPtr.Zero; }
        lock (SdkLock) { if (--_sdkRefs == 0) IceSdk.ICE_IPCSDK_Fini(); }
    }
}
