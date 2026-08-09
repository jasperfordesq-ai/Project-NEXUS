// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/municipality")]
[AllowAnonymous]
public sealed class MunicipalityEventsCalendarController : ControllerBase
{
    private const string CaringCommunityFeatureKey = "features.caring_community";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;

    public MunicipalityEventsCalendarController(NexusDbContext db, TenantContext tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    [HttpGet("events-calendar")]
    public async Task<IActionResult> DefaultEventsCalendar(
        [FromQuery] string? period = "month",
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var municipalityCode = await _db.VereinFederationConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent => consent.TenantId == tenantId
                && consent.IsActive
                && (consent.SharingScope == "events" || consent.SharingScope == "both")
                && consent.MunicipalityCode != null
                && consent.MunicipalityCode != string.Empty)
            .OrderBy(consent => consent.MunicipalityCode)
            .Select(consent => consent.MunicipalityCode)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(municipalityCode))
        {
            return Ok(new { data = EmptyCalendar(NormalizePeriod(period)) });
        }

        var data = await BuildCalendarAsync(tenantId, municipalityCode, NormalizePeriod(period), ct);
        return Ok(new { data });
    }

    [HttpGet("{municipalityCode}/events-calendar")]
    public async Task<IActionResult> EventsCalendar(
        string municipalityCode,
        [FromQuery] string? period = "month",
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var data = await BuildCalendarAsync(tenantId, municipalityCode, NormalizePeriod(period), ct);
        return Ok(new { data });
    }

    private async Task<object> BuildCalendarAsync(
        int tenantId,
        string municipalityCode,
        string period,
        CancellationToken ct)
    {
        var (start, end) = ResolveWindow(period);

        var rows = await (
            from consent in _db.VereinFederationConsents.IgnoreQueryFilters().AsNoTracking()
            join organisation in _db.Organisations.IgnoreQueryFilters().AsNoTracking()
                on new { consent.TenantId, Id = consent.OrganizationId }
                equals new { organisation.TenantId, organisation.Id }
            join calendarEvent in _db.Events.IgnoreQueryFilters().AsNoTracking()
                on new { organisation.TenantId, OwnerId = organisation.OwnerId }
                equals new { calendarEvent.TenantId, OwnerId = calendarEvent.CreatedById }
            where consent.TenantId == tenantId
                && consent.IsActive
                && (consent.SharingScope == "events" || consent.SharingScope == "both")
                && consent.MunicipalityCode == municipalityCode
                && organisation.Type == "club"
                && !calendarEvent.IsCancelled
                && calendarEvent.StartsAt >= start
                && calendarEvent.StartsAt <= end
            orderby calendarEvent.StartsAt
            select new
            {
                calendarEvent.Id,
                calendarEvent.Title,
                calendarEvent.StartsAt,
                calendarEvent.Location,
                calendarEvent.ImageUrl,
                OrganizationId = organisation.Id,
                OrganizationName = organisation.Name
            }).ToListAsync(ct);

        var buckets = rows
            .GroupBy(row => row.StartsAt.ToString("yyyy-MM-dd"))
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => new
                {
                    id = row.Id,
                    title = row.Title,
                    start_time = row.StartsAt,
                    location = row.Location,
                    image_url = row.ImageUrl,
                    organization_id = row.OrganizationId,
                    organization_name = row.OrganizationName
                }).ToArray());

        return new
        {
            municipality_code = municipalityCode,
            period,
            start = start.ToString("yyyy-MM-dd"),
            end = end.ToString("yyyy-MM-dd"),
            buckets
        };
    }

    private static object EmptyCalendar(string period)
    {
        var (start, end) = ResolveWindow(period);
        return new
        {
            municipality_code = (string?)null,
            period,
            start = start.ToString("yyyy-MM-dd"),
            end = end.ToString("yyyy-MM-dd"),
            buckets = new Dictionary<string, object[]>()
        };
    }

    private async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == CaringCommunityFeatureKey)
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    private static (DateTime Start, DateTime End) ResolveWindow(string period)
    {
        var start = DateTime.UtcNow.Date;
        var end = period switch
        {
            "week" => start.AddDays(7),
            "year" => start.AddYears(1),
            _ => start.AddMonths(1)
        };

        return (start, end);
    }

    private static string NormalizePeriod(string? period)
    {
        return period?.Trim().ToLowerInvariant() switch
        {
            "week" => "week",
            "year" => "year",
            _ => "month"
        };
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new
                {
                    code,
                    message
                }
            }
        };
    }
}
