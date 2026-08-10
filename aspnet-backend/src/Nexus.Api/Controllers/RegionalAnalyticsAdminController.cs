// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Laravel React tenant-admin Regional Analytics dashboard contract.
/// </summary>
[ApiController]
[Route("api/v2/admin/regional-analytics")]
[Authorize(Policy = "AdminOnly")]
public sealed class RegionalAnalyticsAdminController : ControllerBase
{
    private static readonly string[] ValidPeriods = ["last_30d", "last_90d", "last_12m", "all_time"];
    private readonly NexusDbContext _db;

    public RegionalAnalyticsAdminController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("overview")]
    public async Task<IActionResult> Overview(CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var activeMembers = await _db.Users.CountAsync(u => u.TenantId == tenantId && u.IsActive, ct);
        var volHours = await _db.VolunteerLogs
            .Where(v => v.TenantId == tenantId && v.DateLogged >= DateOnly.FromDateTime(monthStart))
            .SumAsync(v => (decimal?)v.Hours, ct) ?? 0m;
        var helpRequests = await _db.Set<CaringHelpRequest>()
            .CountAsync(r => r.TenantId == tenantId && r.CreatedAt >= monthStart && r.DeletedAt == null, ct);
        var mostNeeded = await MostNeededCategoryAsync(tenantId.Value, ct);

        return Ok(Data(new
        {
            active_members = activeMembers,
            vol_hours_this_month = Math.Round(volHours, 2),
            help_requests_this_month = helpRequests,
            most_needed_category = mostNeeded
        }));
    }

    [HttpGet("heatmap")]
    public async Task<IActionResult> Heatmap([FromQuery] string? period, CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var cutoff = PeriodCutoff(NormalizePeriod(period, "last_90d"));
        var locations = await _db.UserLocations
            .Where(l => l.TenantId == tenantId && (cutoff == null || l.CreatedAt >= cutoff))
            .Select(l => new { l.Latitude, l.Longitude })
            .ToListAsync(ct);

        var cells = locations
            .GroupBy(l => new { Lat = Math.Round(l.Latitude, 2), Lng = Math.Round(l.Longitude, 2) })
            .Select(g => new { lat = g.Key.Lat, lng = g.Key.Lng, count = g.Count() })
            .Where(row => row.count >= 3)
            .OrderByDescending(row => row.count)
            .Take(500)
            .ToArray();

        return Ok(Data(cells));
    }

    [HttpGet("demand-supply")]
    public async Task<IActionResult> DemandSupply([FromQuery] string? period, CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var cutoff = PeriodCutoff(NormalizePeriod(period, "last_30d"));
        var listings = await _db.Listings
            .Where(l => l.TenantId == tenantId &&
                        (l.Status == ListingStatus.Active || l.Status == ListingStatus.Fulfilled) &&
                        (cutoff == null || l.CreatedAt >= cutoff))
            .Select(l => new { l.CategoryId, l.Type })
            .ToListAsync(ct);
        var categories = await _db.Categories
            .Where(c => c.TenantId == tenantId)
            .ToDictionaryAsync(c => c.Id, c => c.Name, ct);

        var rows = listings
            .GroupBy(l => l.CategoryId ?? 0)
            .Select(g =>
            {
                var requests = g.Count(l => l.Type == ListingType.Request);
                var offers = g.Count(l => l.Type == ListingType.Offer);
                var ratio = offers > 0 ? Math.Round(requests / (double)offers, 2) : requests > 0 ? 999d : 0d;
                return new
                {
                    category_id = g.Key,
                    category_name = categories.TryGetValue(g.Key, out var name) ? name : $"Category {g.Key}",
                    request_count = requests,
                    offer_count = offers,
                    ratio,
                    trend = "→"
                };
            })
            .OrderByDescending(row => row.request_count + row.offer_count)
            .Take(50)
            .ToArray();

        return Ok(Data(rows));
    }

    [HttpGet("demographics")]
    public async Task<IActionResult> Demographics(CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var users = await _db.Users
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.CreatedAt })
            .ToListAsync(ct);
        var languageRows = await _db.UserLanguagePreferences
            .Where(l => l.TenantId == tenantId)
            .GroupBy(l => l.PreferredLocale)
            .Select(g => new { language = g.Key, count = g.Count() })
            .OrderByDescending(row => row.count)
            .ToListAsync(ct);

        var months = MonthStarts(12);
        var monthlyGrowth = months
            .Select(month =>
            {
                var next = month.AddMonths(1);
                return new
                {
                    month = month.ToString("yyyy-MM"),
                    new_members = users.Count(u => u.CreatedAt >= month && u.CreatedAt < next),
                    cumulative = users.Count(u => u.CreatedAt < next)
                };
            })
            .ToArray();

        return Ok(Data(new
        {
            age_groups = AgeGroups(users.Count),
            languages = languageRows.Count == 0 ? [new { language = "en", count = users.Count }] : languageRows,
            monthly_growth = monthlyGrowth
        }));
    }

    [HttpGet("engagement-trends")]
    public async Task<IActionResult> EngagementTrends([FromQuery] string? period, CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var months = MonthsForPeriod(NormalizePeriod(period, "last_12m"));
        var users = await _db.Users.Where(u => u.TenantId == tenantId && u.IsActive).Select(u => u.CreatedAt).ToListAsync(ct);
        var logs = await _db.VolunteerLogs.Where(v => v.TenantId == tenantId).Select(v => new { v.DateLogged, v.Hours }).ToListAsync(ct);
        var listings = await _db.Listings.Where(l => l.TenantId == tenantId).Select(l => l.CreatedAt).ToListAsync(ct);
        var events = await _db.Events.Where(e => e.TenantId == tenantId).Select(e => e.CreatedAt).ToListAsync(ct);
        var help = await _db.Set<CaringHelpRequest>().Where(h => h.TenantId == tenantId && h.DeletedAt == null).Select(h => h.CreatedAt).ToListAsync(ct);

        var rows = months.Select(month =>
        {
            var next = month.AddMonths(1);
            var dateOnlyMonth = DateOnly.FromDateTime(month);
            var dateOnlyNext = DateOnly.FromDateTime(next);
            return new
            {
                month = month.ToString("yyyy-MM"),
                active_members = users.Count(created => created < next),
                vol_hours = Math.Round(logs.Where(log => log.DateLogged >= dateOnlyMonth && log.DateLogged < dateOnlyNext).Sum(log => log.Hours), 2),
                new_listings = listings.Count(created => created >= month && created < next),
                new_events = events.Count(created => created >= month && created < next),
                help_requests = help.Count(created => created >= month && created < next)
            };
        }).ToArray();

        return Ok(Data(rows));
    }

    [HttpGet("volunteer-breakdown")]
    public async Task<IActionResult> VolunteerBreakdown([FromQuery] string? period, CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var cutoff = PeriodCutoff(NormalizePeriod(period, "last_90d"));
        var cutoffDate = cutoff is null ? (DateOnly?)null : DateOnly.FromDateTime(cutoff.Value);
        var logs = await _db.VolunteerLogs
            .Where(v => v.TenantId == tenantId && (cutoffDate == null || v.DateLogged >= cutoffDate))
            .Select(v => new { v.OrganizationId, v.UserId, v.Hours })
            .ToListAsync(ct);
        var totalHours = logs.Sum(log => log.Hours);
        var volunteers = logs.Select(log => log.UserId).Distinct().Count();

        var topOrgs = logs
            .Where(log => log.OrganizationId.HasValue)
            .GroupBy(log => log.OrganizationId!.Value)
            .Select(g => new
            {
                org_id = g.Key,
                org_name = $"Organisation {g.Key}",
                total_hours = Math.Round(g.Sum(log => log.Hours), 2),
                volunteers = g.Select(log => log.UserId).Distinct().Count()
            })
            .OrderByDescending(row => row.total_hours)
            .Take(10)
            .ToArray();

        return Ok(Data(new
        {
            top_orgs = topOrgs,
            avg_hours_per_volunteer = volunteers > 0 ? Math.Round(totalHours / volunteers, 2) : 0m,
            total_hours = Math.Round(totalHours, 2),
            reciprocity_ratio = 1.0m
        }));
    }

    [HttpGet("help-requests")]
    public async Task<IActionResult> HelpRequests([FromQuery] string? period, CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var cutoff = PeriodCutoff(NormalizePeriod(period, "last_30d"));
        var rows = await _db.Set<CaringHelpRequest>()
            .Where(h => h.TenantId == tenantId && h.DeletedAt == null && (cutoff == null || h.CreatedAt >= cutoff))
            .Select(h => new { h.What, h.Status, h.CreatedAt, h.UpdatedAt })
            .ToListAsync(ct);

        var byCategory = rows
            .GroupBy(row => NormalizeHelpCategory(row.What))
            .Select(g =>
            {
                var total = g.Count();
                var resolved = g.Count(row => string.Equals(row.Status, "resolved", StringComparison.OrdinalIgnoreCase) || string.Equals(row.Status, "completed", StringComparison.OrdinalIgnoreCase));
                return new
                {
                    category = g.Key,
                    total,
                    resolved_count = resolved,
                    resolution_rate = total > 0 ? (int)Math.Round(resolved * 100d / total) : 0,
                    avg_resolution_days = (double?)null
                };
            })
            .OrderByDescending(row => row.total)
            .ToArray();

        var resolutionTrend = MonthStarts(6)
            .Select(month =>
            {
                var next = month.AddMonths(1);
                var monthRows = rows.Where(row => row.CreatedAt >= month && row.CreatedAt < next).ToArray();
                var total = monthRows.Length;
                var resolved = monthRows.Count(row => string.Equals(row.Status, "resolved", StringComparison.OrdinalIgnoreCase) || string.Equals(row.Status, "completed", StringComparison.OrdinalIgnoreCase));
                return new
                {
                    month = month.ToString("yyyy-MM"),
                    total,
                    resolved,
                    resolution_rate = total > 0 ? (int)Math.Round(resolved * 100d / total) : 0
                };
            })
            .ToArray();

        return Ok(Data(new { by_category = byCategory, resolution_trend = resolutionTrend }));
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] string? period, CancellationToken ct)
    {
        var normalizedPeriod = NormalizePeriod(period, "last_30d");
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        return Ok(Data(new
        {
            period = normalizedPeriod,
            generated_at = DateTime.UtcNow,
            overview = (await OverviewPayloadAsync(tenantId.Value, ct)),
            demographics = (await DemographicsPayloadAsync(tenantId.Value, ct))
        }));
    }

    [HttpPost("invalidate-cache")]
    public async Task<IActionResult> InvalidateCache(CancellationToken ct)
    {
        var tenantId = RequireTenantId();
        if (tenantId is null) return Unauthorized();

        var rows = await _db.RegionalAnalyticsCaches
            .Where(row => row.TenantId == tenantId)
            .ExecuteDeleteAsync(ct);

        return Ok(Data(new { invalidated = true, deleted_cache_entries = rows }));
    }

    private int? RequireTenantId() => User.GetTenantId();

    private static object Data(object data) => new
    {
        data,
        meta = new { base_url = "" }
    };

    private async Task<string> MostNeededCategoryAsync(int tenantId, CancellationToken ct)
    {
        var top = await _db.Listings
            .Where(l => l.TenantId == tenantId && l.Type == ListingType.Request && l.CategoryId != null)
            .GroupBy(l => l.CategoryId!.Value)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .FirstOrDefaultAsync(ct);
        if (top is null)
        {
            return "uncategorized";
        }

        return await _db.Categories
            .Where(c => c.TenantId == tenantId && c.Id == top.CategoryId)
            .Select(c => c.Name)
            .FirstOrDefaultAsync(ct) ?? $"Category {top.CategoryId}";
    }

    private async Task<object> OverviewPayloadAsync(int tenantId, CancellationToken ct)
    {
        var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var activeMembers = await _db.Users.CountAsync(u => u.TenantId == tenantId && u.IsActive, ct);
        var volHours = await _db.VolunteerLogs
            .Where(v => v.TenantId == tenantId && v.DateLogged >= DateOnly.FromDateTime(monthStart))
            .SumAsync(v => (decimal?)v.Hours, ct) ?? 0m;
        var helpRequests = await _db.Set<CaringHelpRequest>()
            .CountAsync(r => r.TenantId == tenantId && r.CreatedAt >= monthStart && r.DeletedAt == null, ct);

        return new
        {
            active_members = activeMembers,
            vol_hours_this_month = Math.Round(volHours, 2),
            help_requests_this_month = helpRequests,
            most_needed_category = await MostNeededCategoryAsync(tenantId, ct)
        };
    }

    private async Task<object> DemographicsPayloadAsync(int tenantId, CancellationToken ct)
    {
        var users = await _db.Users
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.CreatedAt })
            .ToListAsync(ct);
        var languageRows = await _db.UserLanguagePreferences
            .Where(l => l.TenantId == tenantId)
            .GroupBy(l => l.PreferredLocale)
            .Select(g => new { language = g.Key, count = g.Count() })
            .OrderByDescending(row => row.count)
            .ToListAsync(ct);

        return new
        {
            age_groups = AgeGroups(users.Count),
            languages = languageRows.Count == 0 ? [new { language = "en", count = users.Count }] : languageRows,
            monthly_growth = MonthStarts(12).Select(month => new
            {
                month = month.ToString("yyyy-MM"),
                new_members = users.Count(u => u.CreatedAt >= month && u.CreatedAt < month.AddMonths(1)),
                cumulative = users.Count(u => u.CreatedAt < month.AddMonths(1))
            }).ToArray()
        };
    }

    private static string NormalizePeriod(string? period, string fallback)
    {
        var normalized = (period ?? string.Empty).Trim().ToLowerInvariant();
        return ValidPeriods.Contains(normalized) ? normalized : fallback;
    }

    private static Dictionary<string, int> AgeGroups(int unknownCount) => new()
    {
        ["under_25"] = 0,
        ["25_34"] = 0,
        ["35_44"] = 0,
        ["45_54"] = 0,
        ["55_64"] = 0,
        ["65_plus"] = 0,
        ["unknown"] = unknownCount
    };

    private static string NormalizeHelpCategory(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "uncategorized";
        }

        return trimmed.Length <= 40 ? trimmed : trimmed[..40];
    }

    private static DateTime? PeriodCutoff(string period) => period switch
    {
        "last_30d" => DateTime.UtcNow.AddDays(-30),
        "last_90d" => DateTime.UtcNow.AddDays(-90),
        "last_12m" => DateTime.UtcNow.AddMonths(-12),
        "all_time" => null,
        _ => DateTime.UtcNow.AddDays(-90)
    };

    private static IReadOnlyList<DateTime> MonthsForPeriod(string period) =>
        MonthStarts(period == "last_30d" ? 1 : period == "last_90d" ? 3 : 12);

    private static IReadOnlyList<DateTime> MonthStarts(int count)
    {
        var current = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        return Enumerable.Range(0, count)
            .Select(offset => current.AddMonths(-(count - offset - 1)))
            .ToArray();
    }
}
