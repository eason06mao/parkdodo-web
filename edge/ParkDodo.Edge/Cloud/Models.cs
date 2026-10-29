using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace ParkDodo.Edge.Cloud;

// 與雲端 /api/edge/v1 的資料格式（欄位名稱 camelCase，與 src/lib/edge/service.ts 相同）

public sealed record PairResponse(string GatewayId, string DeviceKey, SiteInfo Site);
public sealed record SiteInfo(string Id, string Code, string Name, string? Timezone = null);

public sealed record HeartbeatResponse(string ServerTime, long ConfigVersion, int PendingCommands, int Protocol);

public sealed class EdgeConfig
{
    public int Protocol { get; set; }
    public long ConfigVersion { get; set; }
    public SiteInfo Site { get; set; } = new("", "", "");
    public List<LaneConfig> Lanes { get; set; } = new();
    public JsonObject? Rates { get; set; }
    public string? RateVersionId { get; set; }
    public List<ExitAuth> ExitAuthorizations { get; set; } = new();
    public List<MonthlyPlate> MonthlyWhitelist { get; set; } = new();
    public List<OpenSession> OpenSessions { get; set; } = new();
    public string? PayUrlBase { get; set; }
}

public sealed class LaneConfig
{
    public string Id { get; set; } = "";
    public string Code { get; set; } = "";
    public string Direction { get; set; } = "entry";   // entry | exit | bidirectional
    public bool Active { get; set; } = true;
    public List<DeviceConfig> Devices { get; set; } = new();
}

public sealed class DeviceConfig
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";              // lpr_camera | led_voice_card | barrier | radar ...
    public string? Vendor { get; set; }
    public string? Model { get; set; }
    public string? Ip { get; set; }
    public int? Rs485Address { get; set; }
    public JsonObject? Connection { get; set; }          // 例：{"gate_relay":0,"pass_io_input":1}
    public List<string> Capabilities { get; set; } = new();

    public int ConnInt(string key, int fallback) =>
        Connection is not null && Connection.TryGetPropertyValue(key, out var v) && v is JsonValue jv && jv.TryGetValue<int>(out var i) ? i : fallback;
}

public sealed record ExitAuth(string Plate, string SessionId, DateTimeOffset ValidUntil);
public sealed record MonthlyPlate(string Plate, string ContractNo, string EndsOn);
public sealed record OpenSession(string Id, string Plate, DateTimeOffset EntryAt, long Paid);

public sealed class EdgeEvent
{
    public string Uid { get; set; } = "";
    public string Type { get; set; } = "";
    public string LaneCode { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
    public bool Replayed { get; set; }
    public string? Plate { get; set; }
    public double? Confidence { get; set; }
    public string? SessionId { get; set; }
    public string? DeviceId { get; set; }
    public Dictionary<string, object?>? Payload { get; set; }
}

public sealed class Decision
{
    public string Action { get; set; } = "";             // open | pay | hold
    public string Reason { get; set; } = "";
    public long? Amount { get; set; }
}

public sealed class EventResult
{
    public string Uid { get; set; } = "";
    public string Status { get; set; } = "";             // accepted | duplicate | rejected
    public string? Error { get; set; }
    public string? SessionId { get; set; }
    public Decision? Decision { get; set; }
    public long? Amount { get; set; }
}

public sealed record EventsResponse(List<EventResult> Results);
public sealed record ExitCheckResponse(string? SessionId, long? Amount, Decision? Decision);
public sealed record GateCommand(string Id, string Command, string LaneCode, string? Plate, string? SessionId, DateTimeOffset ExpiresAt, string Reason);
public sealed record CommandsResponse(List<GateCommand> Commands, string ServerTime);

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}
