using System.Runtime.InteropServices;

namespace ParkDodo.Edge.Cameras;

/// <summary>
/// ICE IPC SDK V1.3.1.72（ice_ipcsdk.dll，Windows x64）。宣告依廠商標頭檔 ice_ipcsdk.h 撰寫，只宣告用到的函式。
/// DLL 與相依檔（avutil-52.dll、hi_h264dec_w64.dll、swscale-2.dll、draw.dll 等）需放在程式同一資料夾，
/// 由廠商 SDK 提供，不放進 Git。
/// </summary>
internal static unsafe class IceSdk
{
    private const string Dll = "ice_ipcsdk.dll";

    // typedef void (__stdcall *ICE_IPCSDK_OnPlate)(void*, const char* ip, T_LprResult*, const char* fullPic, int fullLen,
    //                                            const char* platePic, int plateLen, ICE_U32, ICE_U32)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void OnPlate(IntPtr param, IntPtr ip, IntPtr result, IntPtr fullPic, int fullLen, IntPtr platePic, int plateLen, uint r1, uint r2);

    // typedef void (__stdcall *ICE_IPCSDK_OnIOEvent)(void*, const char* ip, ICE_U32 type, ICE_U32 io1, io2, io3, io4)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void OnIoEvent(IntPtr param, IntPtr ip, uint type, uint io1, uint io2, uint io3, uint io4);

    // typedef void (__stdcall *ICE_IPCSDK_OnDeviceEvent)(void*, void* handle, const char* ip, ICE_U32 type(0 離線 1 上線), d1..d4)
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void OnDeviceEvent(IntPtr param, IntPtr handle, IntPtr ip, uint type, uint d1, uint d2, uint d3, uint d4);

    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_Init();
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_Fini();
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr ICE_IPCSDK_OpenDevice([MarshalAs(UnmanagedType.LPStr)] string ip);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_Close(IntPtr h);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern uint ICE_IPCSDK_GetStatus(IntPtr h);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_SetPlateCallback(IntPtr h, OnPlate cb, IntPtr param);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_SetIOEventCallBack(IntPtr h, OnIoEvent cb, IntPtr param);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern void ICE_IPCSDK_SetDeviceEventCallBack(IntPtr h, OnDeviceEvent cb, IntPtr param);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern uint ICE_IPCSDK_OpenGate(IntPtr h);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern uint ICE_IPCSDK_ControlAlarmOut(IntPtr h, uint index);
    [DllImport(Dll, CallingConvention = CallingConvention.Cdecl)] public static extern uint ICE_IPCSDK_TransSerialPort(IntPtr h, byte* data, uint len);

    // T_LprResult（ice_vdc_result.h，預設對齊）只讀需要的欄位：
    //   plateInfo.plateNum[128] @0、plateColor[32] @128、flasePlate(int) @160、confidence(float) @164
    //   capTime(T_TimeInfo：年月日時分秒 6 個 int) @1180
    public const int ResultReadBytes = 1204;
    public const int OffPlate = 0, OffFalsePlate = 160, OffConfidence = 164, OffCapTime = 1180;
}
