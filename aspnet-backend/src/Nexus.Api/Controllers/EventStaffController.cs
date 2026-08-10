// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventStaffController : ControllerBase
{
    private readonly EventStaffService _staff; public EventStaffController(EventStaffService staff) => _staff = staff;
    [HttpGet("api/events/{id:int}/staff"), HttpGet("api/v2/events/{id:int}/staff")]
    public async Task<IActionResult> Index(int id, [FromQuery(Name="include_inactive")] string? raw, CancellationToken ct) { if (!Bool(raw, out var include)) return Respond(new(null, Error: new("EVENT_STAFF_VALIDATION_FAILED", "Validation failed", 422, "include_inactive"))); return Respond(await _staff.ListAsync(Tenant(), id, UserId(), include, ct)); }
    [HttpPost("api/events/{id:int}/staff"), HttpPost("api/v2/events/{id:int}/staff")]
    public async Task<IActionResult> Store(int id, [FromBody] JsonElement body, CancellationToken ct) { var expiry = Date(body, "expires_at", out var valid); if (!valid) return Respond(new(null, Error: new("EVENT_STAFF_VALIDATION_FAILED", "Validation failed", 422, "expires_at"))); return Respond(await _staff.GrantAsync(Tenant(), id, UserId(), Int(body,"user_id"), Text(body,"role") ?? "", expiry, Key(body), ct)); }
    [HttpDelete("api/events/{id:int}/staff/{assignmentId:long}"), HttpDelete("api/v2/events/{id:int}/staff/{assignmentId:long}")]
    public async Task<IActionResult> Destroy(int id, long assignmentId, CancellationToken ct) => Respond(await _staff.RevokeAsync(Tenant(), id, assignmentId, UserId(), Key(default), ct));
    private IActionResult Respond(EventStaffResult r) => r.Succeeded ? r.Meta is null ? StatusCode(r.Status, new { success = true, data = r.Data }) : StatusCode(r.Status, new { success = true, data = r.Data, meta = r.Meta }) : StatusCode(r.Error!.Status, new { success = false, error = new { code = r.Error.Code, message = r.Error.Message, field = r.Error.Field } }); private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException(); private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException(); private string? Key(JsonElement x) { var h = Request.Headers["Idempotency-Key"].ToString(); var b = x.ValueKind == JsonValueKind.Object ? Text(x,"idempotency_key") : null; return !string.IsNullOrWhiteSpace(h) && !string.IsNullOrWhiteSpace(b) && h != b ? new string('x',192) : !string.IsNullOrWhiteSpace(h) ? h.Trim() : b?.Trim(); } private static int Int(JsonElement x,string n) => x.TryGetProperty(n,out var p)&&p.TryGetInt32(out var v)?v:0; private static string? Text(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.ValueKind==JsonValueKind.String?p.GetString():null; private static DateTime? Date(JsonElement x,string n,out bool valid) { valid=true;if(!x.TryGetProperty(n,out var p)||p.ValueKind==JsonValueKind.Null)return null;if(p.ValueKind!=JsonValueKind.String||!DateTimeOffset.TryParse(p.GetString(),out var d)){valid=false;return null;}return d.UtcDateTime;} private static bool Bool(string? x,out bool value){if(x is null){value=false;return true;}return bool.TryParse(x,out value)||x=="1"&&(value=true)||x=="0"&&!(value=false);}
}
