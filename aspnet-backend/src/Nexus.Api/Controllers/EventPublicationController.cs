// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventPublicationController(
    EventLifecycleService lifecycle,
    EventLifecycleHistoryQueryService history,
    EventContractProjectionService projection) : ControllerBase
{
    [HttpPost("api/events/{id:int}/submit")]
    [HttpPost("api/v2/events/{id:int}/submit")]
    [EnableRateLimiting(RateLimitingExtensions.EventPublicationPolicy)]
    public Task<IActionResult> Submit(int id, CancellationToken ct) => Transition(id, "submit_for_review", ct);

    [HttpPost("api/events/{id:int}/publish")]
    [HttpPost("api/v2/events/{id:int}/publish")]
    [EnableRateLimiting(RateLimitingExtensions.EventPublicationPolicy)]
    public Task<IActionResult> Publish(int id, CancellationToken ct) => Transition(id, "publish", ct);

    [HttpGet("api/events/{id:int}/lifecycle-history")]
    [HttpGet("api/v2/events/{id:int}/lifecycle-history")]
    [EnableRateLimiting(RateLimitingExtensions.EventRegistrationReadPolicy)]
    public async Task<IActionResult> History(int id, [FromQuery(Name = "cursor")] string? cursor, [FromQuery(Name = "per_page")] string? rawPerPage, CancellationToken ct)
    {
        PrivateHeaders();
        if (rawPerPage is not null && (!int.TryParse(rawPerPage, out var parsed) || parsed is < 1 or > 100))
            return Error(new("EVENT_LIFECYCLE_HISTORY_VALIDATION_FAILED", "Validation failed", 422, "per_page"));
        var perPage = rawPerPage is null ? 20 : int.Parse(rawPerPage);
        var result = await history.IndexAsync(Tenant(), id, UserId(), cursor, perPage, ct);
        return result.Succeeded
            ? Ok(new { success = true, data = result.Data, meta = result.Meta })
            : Error(result.Error!);
    }

    private async Task<IActionResult> Transition(int id, string action, CancellationToken ct)
    {
        var result = await lifecycle.TransitionAsync(Tenant(), id, UserId(), action, null, ct);
        PrivateHeaders();
        if (!result.Succeeded) return LifecycleError(result.Error!);
        var data = await projection.DetailAsync(Tenant(), id, UserId(), ct);
        return data is null
            ? LifecycleError(new("NOT_FOUND", "Event not found", 404))
            : Ok(new { success = true, data });
    }

    private IActionResult LifecycleError(EventLifecycleError error)
        => StatusCode(error.Status, new { success = false, code = error.Code, message = error.Message, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });

    private IActionResult Error(EventLifecycleHistoryError error)
        => StatusCode(error.Status, new { success = false, code = error.Code, message = error.Message, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });

    private void PrivateHeaders()
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        Response.Headers["API-Version"] = "2.0";
    }
    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
}
