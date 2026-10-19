using ParkDodo.Edge.FkProtocol;
int ok = 0, fail = 0;
foreach (var line in File.ReadAllLines("vendor_packets.txt"))
{
    var p = Convert.FromHexString(line.Trim());
    if (FkPacketBuilder.Verify(p)) ok++; else { fail++; Console.WriteLine("FAIL " + line); }
}
Console.WriteLine($"廠商紀錄封包 CRC 驗證：通過 {ok}，失敗 {fail}");

// 用產生器重建廠商紀錄中的一個封包，確認位元組完全相同
var b = new FkPacketBuilder();
for (int i = 0; i < 0x1F; i++) b.QueryVersion();   // 推進流水號到 0x1F
var qr = b.ShowQrCode("http://www.baidu.com", mode: 0, seconds: 0, color: 1);
var expected = "AA551F6400280017000001687474703A2F2F7777772E62616964752E636F6D90F6AF";
Console.WriteLine($"QR 封包重建：{(Convert.ToHexString(qr) == expected ? "與廠商封包一致" : "不一致 " + Convert.ToHexString(qr))}");
return fail == 0 && Convert.ToHexString(qr) == expected ? 0 : 1;
