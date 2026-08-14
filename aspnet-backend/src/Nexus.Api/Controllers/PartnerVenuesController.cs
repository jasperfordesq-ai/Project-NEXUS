// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Member-facing partner-venues endpoints — Laravel parity for
/// PartnerVenueController: directory, member pass QR, pass rotation, visit
/// history, and the staff-scanned visit verify. All under /api/v2 only
/// (Laravel registers no legacy spellings for this subsystem).
/// </summary>
[ApiController]
[Authorize]
public class PartnerVenuesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly PartnerVenueService _venues;
    private readonly PartnerVenueVisitService _visits;

    public PartnerVenuesController(
        NexusDbContext db, PartnerVenueService venues, PartnerVenueVisitService visits)
    {
        _db = db;
        _venues = venues;
        _visits = visits;
    }

    [HttpGet("api/v2/partner-venues")]
    public async Task<IActionResult> Index()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var venues = await _venues.DirectoryAsync(HttpContext.RequestAborted);
        return LaravelData(new { venues });
    }

    [HttpGet("api/v2/partner-venues/pass")]
    public async Task<IActionResult> Pass()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var pass = await _visits.GetOrCreatePassAsync(
            TenantId, UserId, await CheckinBaseUrlAsync(), HttpContext.RequestAborted);
        return LaravelData(new
        {
            token = pass.Token,
            qr_url = pass.QrUrl,
            status = pass.Status,
            last_used_at = pass.LastUsedAt
        });
    }

    [HttpPost("api/v2/partner-venues/pass/rotate")]
    public async Task<IActionResult> RotatePass()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var pass = await _visits.RotatePassAsync(
            TenantId, UserId, await CheckinBaseUrlAsync(), HttpContext.RequestAborted);
        return LaravelData(new
        {
            token = pass.Token,
            qr_url = pass.QrUrl,
            status = pass.Status,
            last_used_at = pass.LastUsedAt
        });
    }

    [HttpGet("api/v2/partner-venues/my-visits")]
    public async Task<IActionResult> MyVisits()
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        var visits = await _visits.MyVisitsAsync(UserId, 50, HttpContext.RequestAborted);
        return LaravelData(new { visits });
    }

    /// <summary>
    /// POST-only by design: member details are revealed only after an
    /// authorised staff account confirms the scan, so a prefetch can never
    /// disclose them. {token} is the 64-hex pass token, never an id.
    /// </summary>
    [HttpPost("api/v2/partner-venues/visits/verify/{token}")]
    public async Task<IActionResult> RecordVisit(string token, [FromBody] JsonElement? body)
    {
        var gate = await GateAsync();
        if (gate is not null) return gate;

        int? venueId = null;
        if (body.HasValue && body.Value.ValueKind == JsonValueKind.Object
            && body.Value.TryGetProperty("venue_id", out var rawVenueId))
        {
            if (rawVenueId.ValueKind == JsonValueKind.Number && rawVenueId.TryGetInt32(out var parsed))
                venueId = parsed;
            else if (rawVenueId.ValueKind == JsonValueKind.String
                && int.TryParse(rawVenueId.GetString(), out var parsedString))
                venueId = parsedString;
        }

        var result = await _visits.RecordVisitAsync(
            TenantId, token, UserId, venueId, HttpContext.RequestAborted);

        return result.Status switch
        {
            "invalid_pass" => LaravelError(404, "NOT_FOUND", "This membership pass is not valid"),
            "forbidden" => LaravelError(403, "FORBIDDEN",
                "You do not have permission to record visits for this venue"),
            _ => LaravelData(result.Payload!)
        };
    }

    private int TenantId => User.GetTenantId() ?? 0;
    private int UserId => User.GetUserId() ?? 0;

    /// <summary>
    /// Feature gate first (the Laravel route middleware body, verbatim:
    /// errors[] + success:false with the generic service_unavailable string),
    /// then authentication sanity.
    /// </summary>
    private async Task<IActionResult?> GateAsync()
    {
        if (TenantId == 0 || UserId == 0)
        {
            return StatusCode(StatusCodes.Status401Unauthorized,
                new { success = false, error = "Authentication required", code = "AUTH_REQUIRED" });
        }

        if (!await _venues.IsFeatureEnabledAsync(TenantId, HttpContext.RequestAborted))
        {
            Response.Headers["API-Version"] = "2.0";
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                errors = new[] { new { code = "FEATURE_DISABLED", message = "Service unavailable" } },
                success = false
            });
        }

        return null;
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = TenantId.ToString();
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(int status, string code, string message)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = TenantId.ToString();
        return StatusCode(status, new { errors = new[] { new { code, message } } });
    }

    /// <summary>
    /// Laravel passUrl(): tenant frontend URL + slug prefix + /venues/checkin.
    /// A tenant on its own domain gets no slug prefix; a slug-served tenant
    /// gets /{slug}.
    /// </summary>
    private async Task<string> CheckinBaseUrlAsync()
    {
        var tenant = await _db.Tenants
            .AsNoTracking()
            .Where(t => t.Id == TenantId)
            .Select(t => new { t.Domain, t.Slug })
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        if (tenant is null) return $"{Request.Scheme}://{Request.Host}/venues/checkin";
        return string.IsNullOrWhiteSpace(tenant.Domain)
            ? $"{Request.Scheme}://{Request.Host}/{tenant.Slug}/venues/checkin"
            : $"{tenant.Domain.TrimEnd('/')}/venues/checkin";
    }
}
