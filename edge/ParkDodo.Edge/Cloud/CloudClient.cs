using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ParkDodo.Edge.Util;

namespace ParkDodo.Edge.Cloud;

public sealed class CloudException(string message, HttpStatusCode? status = null) : Exception(message)
{
    public HttpStatusCode? Status { get; } = status;
    public bool Unauthorized => Status == HttpStatusCode.Unauthorized;
}

/// <summary>雲端 API。每個呼叫都有逾時，斷網時快速失敗，由呼叫端改用本機判斷。</summary>
public sealed class CloudClient : IDisposable
{
    private readonly HttpClient _http;
    public string BaseUrl { get; }

    public CloudClient(string baseUrl, string? deviceKey)
    {
        BaseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5), ConnectTimeout = TimeSpan.FromSeconds(4) })
        {
            BaseAddress = new Uri(BaseUrl + "/api/edge/v1/"),
            Timeout = Timeout.InfiniteTimeSpan,
        };
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("ParkDodo-Edge", Program.Version));
        if (deviceKey is not null) _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", deviceKey);
    }

    public Task<PairResponse> Pair(string code, object hardware, CancellationToken ct) =>
        Send<PairResponse>(HttpMethod.Post, "pair", new { code, hardware }, TimeSpan.FromSeconds(15), ct);

    public Task<HeartbeatResponse> Heartbeat(object body, CancellationToken ct) =>
        Send<HeartbeatResponse>(HttpMethod.Post, "heartbeat", body, TimeSpan.FromSeconds(8), ct);

    public Task<EdgeConfig> Config(CancellationToken ct) => Send<EdgeConfig>(HttpMethod.Get, "config", null, TimeSpan.FromSeconds(15), ct);

    public Task<EventsResponse> Events(IReadOnlyList<EdgeEvent> events, TimeSpan timeout, CancellationToken ct) =>
        Send<EventsResponse>(HttpMethod.Post, "events", new { events }, timeout, ct);

    public Task<ExitCheckResponse> ExitCheck(string laneCode, string plate, CancellationToken ct) =>
        Send<ExitCheckResponse>(HttpMethod.Post, "exit-check", new { laneCode, plate }, TimeSpan.FromSeconds(3), ct);

    public Task<CommandsResponse> Commands(CancellationToken ct) => Send<CommandsResponse>(HttpMethod.Get, "commands?wait=0", null, TimeSpan.FromSeconds(6), ct);

    public Task CommandResult(string id, bool ok, string detail, CancellationToken ct) =>
        Send<object>(HttpMethod.Post, $"commands/{id}", new { ok, detail }, TimeSpan.FromSeconds(6), ct);

    public async Task UploadImage(string eventUid, string kind, byte[] jpeg, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(30));
        using var content = new ByteArrayContent(jpeg);
        content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        using var r = await _http.PostAsync($"images?eventUid={Uri.EscapeDataString(eventUid)}&kind={kind}", content, cts.Token);
        if (r.StatusCode == HttpStatusCode.NotFound) return;       // 事件不存在（已被拒絕）：丟棄照片
        await EnsureOk(r, cts.Token);
    }

    private async Task<T> Send<T>(HttpMethod method, string path, object? body, TimeSpan timeout, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: Json.Options);
        try
        {
            using var r = await _http.SendAsync(req, cts.Token);
            await EnsureOk(r, cts.Token);
            return (await r.Content.ReadFromJsonAsync<T>(Json.Options, cts.Token))!;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new CloudException($"雲端逾時（{timeout.TotalSeconds:0} 秒）：{path}");
        }
        catch (HttpRequestException e)
        {
            throw new CloudException($"連不上雲端：{e.Message}");
        }
    }

    private static async Task EnsureOk(HttpResponseMessage r, CancellationToken ct)
    {
        if (r.IsSuccessStatusCode) return;
        string msg;
        try { msg = (await r.Content.ReadFromJsonAsync<Dictionary<string, object>>(Json.Options, ct))?.GetValueOrDefault("message")?.ToString() ?? ""; }
        catch { msg = ""; }
        throw new CloudException($"雲端回應 {(int)r.StatusCode} {msg}".Trim(), r.StatusCode);
    }

    public void Dispose() => _http.Dispose();
}
