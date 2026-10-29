using System.Runtime.InteropServices;
using System.Text;

namespace ParkDodo.Edge.Util;

/// <summary>
/// 裝置金鑰保存：Windows 用 DPAPI（本機範圍）加密後存檔，檔案權限由安裝腳本限制為 SYSTEM 與系統管理員。
/// 其他系統（開發、測試）只用檔案權限保護。金鑰不寫入日誌。
/// </summary>
public static class KeyStore
{
    public static string PathFor(string dataDir) => Path.Combine(dataDir, "device.key");

    public static void Save(string dataDir, string key)
    {
        Directory.CreateDirectory(dataDir);
        var bytes = Encoding.UTF8.GetBytes(key);
        var data = OperatingSystem.IsWindows() ? Dpapi.Protect(bytes) : bytes;
        var tmp = PathFor(dataDir) + ".tmp";
        File.WriteAllBytes(tmp, data);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(tmp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.Move(tmp, PathFor(dataDir), overwrite: true);
    }

    public static string? Load(string dataDir)
    {
        var p = PathFor(dataDir);
        if (!File.Exists(p)) return null;
        var data = File.ReadAllBytes(p);
        return Encoding.UTF8.GetString(OperatingSystem.IsWindows() ? Dpapi.Unprotect(data) : data);
    }

    private static class Dpapi
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct Blob { public int Size; public IntPtr Data; }

        private const int LocalMachine = 0x4, UiForbidden = 0x1;

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptProtectData(ref Blob input, string? desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CryptUnprotectData(ref Blob input, IntPtr desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr h);

        public static byte[] Protect(byte[] plain) => Run(plain, true);
        public static byte[] Unprotect(byte[] cipher) => Run(cipher, false);

        private static byte[] Run(byte[] data, bool protect)
        {
            var h = GCHandle.Alloc(data, GCHandleType.Pinned);
            try
            {
                var input = new Blob { Size = data.Length, Data = h.AddrOfPinnedObject() };
                var ok = protect
                    ? CryptProtectData(ref input, "ParkDodo Edge", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, LocalMachine | UiForbidden, out var output)
                    : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out output);
                if (!ok) throw new InvalidOperationException($"DPAPI 失敗（{Marshal.GetLastWin32Error()}）");
                try
                {
                    var result = new byte[output.Size];
                    Marshal.Copy(output.Data, result, 0, output.Size);
                    return result;
                }
                finally { LocalFree(output.Data); }
            }
            finally { h.Free(); }
        }
    }
}
