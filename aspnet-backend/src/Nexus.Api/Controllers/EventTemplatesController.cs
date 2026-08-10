// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/event-templates")]
[Route("api/v2/event-templates")]
public sealed class EventTemplatesController : ControllerBase
{
    private readonly EventTemplateService _templates;
    public EventTemplatesController(EventTemplateService templates) => _templates = templates;

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery] string status = "active", [FromQuery(Name = "source_event_id")] int? sourceEventId = null, [FromQuery] string? search = null, [FromQuery] long? cursor = null, [FromQuery(Name = "per_page")] int perPage = 20, CancellationToken ct = default)
        => Respond(await _templates.ListAsync(TenantId(), UserId(), status, sourceEventId, search, cursor, perPage, ct));

    [HttpGet("{templateId:long}")]
    public async Task<IActionResult> Show(long templateId, CancellationToken ct) => Respond(await _templates.ShowAsync(TenantId(), templateId, UserId(), ct));

    [HttpGet("{templateId:long}/history")]
    public async Task<IActionResult> History(long templateId, [FromQuery] long? cursor = null, [FromQuery(Name = "per_page")] int perPage = 50, CancellationToken ct = default)
        => Respond(await _templates.HistoryAsync(TenantId(), templateId, UserId(), cursor, perPage, ct));

    [HttpPost("/api/events/{sourceEventId:int}/template-preview")]
    [HttpPost("/api/v2/events/{sourceEventId:int}/template-preview")]
    public async Task<IActionResult> PreviewCapture(int sourceEventId, CancellationToken ct) => Respond(await _templates.PreviewCaptureAsync(TenantId(), sourceEventId, UserId(), ct));

    [HttpPost("/api/events/{sourceEventId:int}/templates")]
    [HttpPost("/api/v2/events/{sourceEventId:int}/templates")]
    public async Task<IActionResult> Capture(int sourceEventId, CancellationToken ct) => Respond(await _templates.CaptureAsync(TenantId(), sourceEventId, UserId(), IdempotencyKey(), ct));

    [HttpPost("{templateId:long}/revisions")]
    public async Task<IActionResult> Revise(long templateId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _templates.ReviseAsync(TenantId(), templateId, UserId(), Int(body, "expected_version"), IdempotencyKey(), ct));

    [HttpPost("{templateId:long}/archive")]
    public async Task<IActionResult> Archive(long templateId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _templates.ArchiveAsync(TenantId(), templateId, UserId(), Int(body, "expected_version"), String(body, "reason") ?? "", IdempotencyKey(), ct));

    [HttpPost("{templateId:long}/materialization-preview")]
    public async Task<IActionResult> PreviewMaterialization(long templateId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _templates.PreviewMaterializationAsync(TenantId(), templateId, UserId(), body, ct));

    [HttpPost("{templateId:long}/materializations")]
    public async Task<IActionResult> Materialize(long templateId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _templates.MaterializeAsync(TenantId(), templateId, UserId(), body, IdempotencyKey(), ct));

    private IActionResult Respond(EventTemplateResult result)
    {
        Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        if (!result.Succeeded) return StatusCode(result.Error!.Status, new { success = false, error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } });
        return result.Data is EventTemplateCollection collection
            ? StatusCode(result.Status, new { success = true, data = collection.Items, meta = collection.Meta })
            : StatusCode(result.Status, new { success = true, data = result.Data });
    }
    private int TenantId() => User.GetTenantId() ?? throw new UnauthorizedAccessException("Invalid tenant claim");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid user claim");
    private string IdempotencyKey() => Request.Headers["Idempotency-Key"].ToString();
    private static int Int(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.TryGetInt32(out var parsed) ? parsed : 0;
    private static string? String(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
