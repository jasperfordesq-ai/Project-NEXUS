// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventRecurrenceController(
    EventRecurrenceService recurrence,
    EventRecurrenceDefinitionBlueprintService blueprints,
    EventContractProjectionService projection) : ControllerBase
{
    [HttpGet("api/events/recurrence-capabilities")]
    [HttpGet("api/v2/events/recurrence-capabilities")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrenceReadPolicy)]
    public IActionResult Capabilities()
    {
        PrivateHeaders();
        return Ok(new { success = true, data = recurrence.Capabilities() });
    }

    [HttpPost("api/events/recurring")]
    [HttpPost("api/v2/events/recurring")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrenceCommitPolicy)]
    public async Task<IActionResult> Create([FromBody] JsonElement body, CancellationToken ct)
    {
        var result = await recurrence.CreateAsync(Tenant(), UserId(), body, ct);
        PrivateHeaders();
        if (!result.Succeeded) return Error(result.Error!);
        var created = (EventRecurrenceCreateData)result.Data!;
        var template = await projection.DetailAsync(Tenant(), created.RootEventId, UserId(), ct);
        return StatusCode(201, new { success = true, data = new { template, occurrences_created = created.OccurrencesCreated } });
    }

    [HttpPost("api/events/{id:int}/recurrence-revisions/preview")]
    [HttpPost("api/v2/events/{id:int}/recurrence-revisions/preview")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrencePreviewPolicy)]
    public async Task<IActionResult> PreviewRevision(int id, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await recurrence.PreviewRevisionAsync(Tenant(), id, UserId(), body, ct));

    [HttpPost("api/events/{id:int}/recurrence-revisions/commit")]
    [HttpPost("api/v2/events/{id:int}/recurrence-revisions/commit")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrenceCommitPolicy)]
    public async Task<IActionResult> CommitRevision(int id, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await recurrence.CommitRevisionAsync(Tenant(), id, UserId(), body, Request.Headers["Idempotency-Key"].ToString(), ct));

    [HttpGet("api/events/{id:int}/recurrence-definition-blueprints")]
    [HttpGet("api/v2/events/{id:int}/recurrence-definition-blueprints")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrenceReadPolicy)]
    public async Task<IActionResult> BlueprintHistory(int id, [FromQuery] string? limit, [FromQuery(Name = "before_version")] string? beforeVersion, CancellationToken ct)
    {
        if (!Positive(limit, 25, out var parsedLimit) || parsedLimit > 100) return Error(new("EVENT_RECURRENCE_DEFINITION_VALIDATION_FAILED", "Validation failed", 422, "limit"));
        int? parsedBefore = null;
        if (beforeVersion is not null)
        {
            if (!Positive(beforeVersion, 0, out var before)) return Error(new("EVENT_RECURRENCE_DEFINITION_VALIDATION_FAILED", "Validation failed", 422, "before_version"));
            parsedBefore = before;
        }
        return Respond(await blueprints.HistoryAsync(Tenant(), id, UserId(), parsedLimit, parsedBefore, ct));
    }

    [HttpPost("api/events/{id:int}/recurrence-definition-blueprints/preview")]
    [HttpPost("api/v2/events/{id:int}/recurrence-definition-blueprints/preview")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrencePreviewPolicy)]
    public async Task<IActionResult> PreviewBlueprint(int id, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await blueprints.PreviewAsync(Tenant(), id, UserId(), body, ct));

    [HttpPost("api/events/{id:int}/recurrence-definition-blueprints/commit")]
    [HttpPost("api/v2/events/{id:int}/recurrence-definition-blueprints/commit")]
    [EnableRateLimiting(RateLimitingExtensions.EventRecurrenceCommitPolicy)]
    public async Task<IActionResult> CommitBlueprint(int id, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await blueprints.CommitAsync(Tenant(), id, UserId(), body, Request.Headers["Idempotency-Key"].ToString(), ct));

    private IActionResult Respond(EventRecurrenceResult result)
    {
        PrivateHeaders();
        return result.Succeeded
            ? StatusCode(result.Status, new { success = true, data = result.Data })
            : Error(result.Error!);
    }

    private IActionResult Error(EventRecurrenceError error)
    {
        PrivateHeaders();
        return StatusCode(error.Status, new { success = false, code = error.Code, message = error.Message, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }

    private static bool Positive(string? raw, int fallback, out int value)
    {
        value = fallback;
        if (raw is null) return true;
        return raw.Length > 0 && raw.All(char.IsAsciiDigit) && raw[0] != '0' && int.TryParse(raw, out value) && value > 0;
    }
    private void PrivateHeaders() { Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID"; Response.Headers["API-Version"] = "2.0"; }
    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
}
