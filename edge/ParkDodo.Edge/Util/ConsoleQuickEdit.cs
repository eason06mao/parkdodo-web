using System.Runtime.InteropServices;

namespace ParkDodo.Edge.Util;

/// <summary>
/// 關閉 Windows 主控台的「快速編輯（選取）」模式。
/// 開著的話，滑鼠點一下黑色視窗就會讓程式暫停輸出，看起來像當機。背景服務沒有視窗，不受影響。
/// </summary>
public static partial class ConsoleQuickEdit
{
    private const int StdInput = -10;
    private const uint EnableQuickEdit = 0x0040, EnableExtendedFlags = 0x0080;

    [LibraryImport("kernel32.dll", SetLastError = true)] private static partial IntPtr GetStdHandle(int n);
    [LibraryImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GetConsoleMode(IntPtr h, out uint mode);
    [LibraryImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool SetConsoleMode(IntPtr h, uint mode);

    public static void Disable()
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            var h = GetStdHandle(StdInput);
            if (h == IntPtr.Zero || h == new IntPtr(-1) || !GetConsoleMode(h, out var mode)) return;   // 沒有主控台（背景服務）
            if (SetConsoleMode(h, (mode & ~EnableQuickEdit) | EnableExtendedFlags)) Log.Info("已關閉主控台「選取」模式，點視窗不會暫停程式");
        }
        catch { /* 不影響執行 */ }
    }
}
