using System.Net;
using System.Text;
using System.Text.Json;
using ParkDodo.Edge.Cameras;
using ParkDodo.Edge.Cloud;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge;

/// <summary>
/// 模擬模式的本機操作頁 http://localhost:8787 ：輸入車牌模擬入場／出場、模擬雷達通過，看柵欄與顯示卡的反應。
/// 只聽本機（localhost），外部連不到。
/// </summary>
public sealed class SimServer(EdgeAgent agent, int port) : IDisposable
{
    private readonly HttpListener _http = new();

    public void Start()
    {
        _http.Prefixes.Add($"http://localhost:{port}/");
        _http.Start();
        Log.Info($"模擬操作頁：http://localhost:{port}");
        _ = Task.Run(async () =>
        {
            while (_http.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await _http.GetContextAsync(); } catch { break; }
                _ = Task.Run(() => Handle(ctx));
            }
        });
    }

    private void Handle(HttpListenerContext ctx)
    {
        try
        {
            var q = ctx.Request.QueryString;
            var path = ctx.Request.Url!.AbsolutePath;
            var lane = q["lane"] is { } code && agent.Lanes.TryGetValue(code, out var l) ? l : null;
            object result;
            switch (path)
            {
                case "/sim/plate" when lane?.Camera is SimCamera cam && q["plate"] is { Length: > 0 } plate:
                    cam.InjectPlate(plate, double.TryParse(q["confidence"], out var c) ? c : 0.97);
                    result = new { ok = true };
                    break;
                case "/sim/pass" when lane?.Camera is SimCamera cam:
                    cam.InjectPass(int.TryParse(q["io"], out var io) ? io : 1);
                    result = new { ok = true };
                    break;
                case "/sim/state":
                    result = new
                    {
                        cloudOnline = agent.CloudOnline,
                        lanes = agent.Lanes.Values.Select(x => new
                        {
                            code = x.Code, direction = x.Direction,
                            gateOpens = (x.Camera as SimCamera)?.GateOpens ?? 0,
                            displayPackets = (x.Camera as SimCamera)?.Rs485Sent.Count ?? 0,
                        }),
                        inside = agent.State.InsideCount,
                    };
                    break;
                case "/":
                    Write(ctx, 200, "text/html; charset=utf-8", Page());
                    return;
                default:
                    result = new { ok = false, error = "unknown" };
                    ctx.Response.StatusCode = 404;
                    break;
            }
            Write(ctx, ctx.Response.StatusCode, "application/json; charset=utf-8", JsonSerializer.Serialize(result, Json.Options));
        }
        catch (Exception e) { Log.Error("模擬頁錯誤", e); try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { } }
    }

    private string Page()
    {
        var opts = string.Join("", agent.Lanes.Values.Select(l => $"<option value=\"{l.Code}\">{l.Code}（{(l.IsExit ? "出口" : "入口")}）</option>"));
        return $$"""
<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ParkDodo Edge 模擬</title>
<style>body{font-family:system-ui,"Microsoft JhengHei",sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#1D2A2E;background:#F5F3EF}
form,pre{background:#fff;border:1px solid #D9D4CC;border-radius:12px;padding:16px;display:grid;gap:10px}input,select,button{font:inherit;min-height:40px;padding:0 10px}
button{background:#1F7A6D;color:#fff;border:0;border-radius:8px}</style>
<h1>Edge 模擬操作</h1><p>不接實體相機，模擬車輛進出。實際開閘與顯示會寫在 Edge 日誌。</p>
<form onsubmit="go(event,'plate')"><label>車道 <select id="lane">{{opts}}</select></label>
<label>車牌 <input id="plate" value="ABC-1234"></label><button>模擬辨識到車牌</button></form>
<p><button onclick="go(event,'pass')">模擬雷達：車輛通過</button></p><pre id="out"></pre>
<script>
async function go(e,k){e.preventDefault();const l=document.getElementById('lane').value,p=document.getElementById('plate').value;
await fetch(`/sim/${k}?lane=${encodeURIComponent(l)}&plate=${encodeURIComponent(p)}`);setTimeout(st,800)}
async function st(){document.getElementById('out').textContent=JSON.stringify(await (await fetch('/sim/state')).json(),null,2)}st();
</script></html>
""";
    }

    private static void Write(HttpListenerContext ctx, int status, string type, string body)
    {
        var b = Encoding.UTF8.GetBytes(body);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = type;
        ctx.Response.OutputStream.Write(b);
        ctx.Response.Close();
    }

    public void Dispose() { try { _http.Stop(); _http.Close(); } catch { } }
}
