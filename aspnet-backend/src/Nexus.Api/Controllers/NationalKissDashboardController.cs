// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Cross-tenant National KISS dashboard contract used by the Laravel React super-admin page.
/// </summary>
[ApiController]
[Route("api/v2/admin/national/kiss")]
[Authorize(Policy = "AdminOnly")]
public sealed class NationalKissDashboardController : ControllerBase
{
    private readonly NexusDbContext _db;

    public NationalKissDashboardController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("cooperatives")]
    public async Task<IActionResult> Cooperatives(CancellationToken ct)
    {
        var cooperatives = await ListCooperativesAsync(ct);
        return Ok(Data(new
        {
            cooperatives = cooperatives.Select(coop => new
            {
                tenant_id = coop.TenantId,
                slug = coop.Slug,
                name = coop.Name,
                locale = coop.Locale,
                member_count_bracket = Bucket(coop.MemberCount)
            }).ToArray()
        }));
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery(Name = "period_from")] string? periodFrom, [FromQuery(Name = "period_to")] string? periodTo, CancellationToken ct)
    {
        var range = ResolveRange(periodFrom, periodTo);
        var rows = await BuildRowsAsync(range, ct);
        var priorYear = new DateRange(range.From.AddYears(-1), range.To.AddYears(-1));
        var priorHours = 0m;
        foreach (var coop in rows.Select(row => row.Cooperative))
        {
            priorHours += await ApprovedHoursForTenantAsync(coop.TenantId, priorYear, ct);
        }

        var perCoop = rows
            .Select(row => new
            {
                tenant_id = row.Cooperative.TenantId,
                slug = row.Cooperative.Slug,
                name = row.Cooperative.Name,
                hours = Round1(row.Hours)
            })
            .OrderByDescending(row => row.hours)
            .ToArray();

        var activeCoops = perCoop.Where(row => row.hours > 0).ToArray();
        var totalHours = rows.Sum(row => row.Hours);
        var yoyGrowth = priorHours > 0 ? Math.Round((double)((totalHours - priorHours) / priorHours) * 100d, 1) : (double?)null;

        return Ok(Data(new
        {
            cooperatives_count = rows.Length,
            active_cooperatives_count = activeCoops.Length,
            total_approved_hours_national = Round1(totalHours),
            total_active_members_bucket = Bucket(rows.Sum(row => row.ActiveMembers)),
            total_recipients_reached_bucket = Bucket(rows.Sum(row => row.Recipients)),
            top_5_cooperatives_by_hours = perCoop.Take(5).ToArray(),
            bottom_5_active_cooperatives_by_hours = activeCoops.OrderBy(row => row.hours).Take(5).ToArray(),
            hours_growth_yoy_pct = yoyGrowth,
            active_tandems_total = rows.Sum(row => row.ActiveTandems),
            safeguarding_reports_total = rows.Sum(row => row.SafeguardingReports),
            generated_at = DateTime.UtcNow,
            period = new { from = ToIso(range.From), to = ToIso(range.To) }
        }));
    }

    [HttpGet("comparative")]
    public async Task<IActionResult> Comparative([FromQuery(Name = "period_from")] string? periodFrom, [FromQuery(Name = "period_to")] string? periodTo, CancellationToken ct)
    {
        var range = ResolveRange(periodFrom, periodTo);
        var rows = await BuildRowsAsync(range, ct);
        var periodDays = Math.Max(1, (range.To.DayNumber - range.From.DayNumber) + 1);
        var priorRange = new DateRange(range.From.AddDays(-periodDays), range.From.AddDays(-1));
        var priorYearRange = new DateRange(range.From.AddYears(-1), range.To.AddYears(-1));

        var output = new List<object>();
        foreach (var row in rows)
        {
            var priorParticipants = await ParticipantIdsAsync(row.Cooperative.TenantId, priorRange, ct);
            var retained = row.Participants.Intersect(priorParticipants).Count();
            var retention = priorParticipants.Count > 0 ? retained * 100m / priorParticipants.Count : 0m;
            var priorYearHours = await ApprovedHoursForTenantAsync(row.Cooperative.TenantId, priorYearRange, ct);
            var growth = priorYearHours > 0 ? (row.Hours - priorYearHours) * 100m / priorYearHours : 0m;

            output.Add(new
            {
                tenant_id = row.Cooperative.TenantId,
                slug = row.Cooperative.Slug,
                name = row.Cooperative.Name,
                hours = Round1(row.Hours),
                members_bracket = Bucket(row.ActiveMembers),
                recipients_bracket = Bucket(row.Recipients),
                active_tandems = row.ActiveTandems,
                retention_rate_pct = Round1(retention),
                reciprocity_pct = Round1(row.Reciprocity * 100m),
                status = ClassifyStatus(growth, retention)
            });
        }

        return Ok(Data(new { rows = output }));
    }

    [HttpGet("trend")]
    public async Task<IActionResult> Trend(CancellationToken ct)
    {
        var cooperatives = await ListCooperativesAsync(ct);
        var months = MonthStarts(12);
        var trend = new List<object>();

        foreach (var month in months)
        {
            var range = new DateRange(month, month.AddMonths(1).AddDays(-1));
            var total = 0m;
            var active = 0;
            foreach (var coop in cooperatives)
            {
                var hours = await ApprovedHoursForTenantAsync(coop.TenantId, range, ct);
                total += hours;
                if (hours > 0)
                {
                    active++;
                }
            }

            trend.Add(new
            {
                month = month.ToString("yyyy-MM"),
                total_hours_all_cooperatives = Round1(total),
                active_cooperatives = active
            });
        }

        return Ok(Data(new { trend }));
    }

    private static object Data(object data) => new
    {
        data,
        meta = new { base_url = "" }
    };

    private async Task<Cooperative[]> ListCooperativesAsync(CancellationToken ct)
    {
        var tenants = await _db.Tenants
            .AsNoTracking()
            .Where(t => t.IsActive)
            .OrderBy(t => t.Name)
            .Select(t => new { t.Id, t.Slug, t.Name })
            .ToListAsync(ct);

        var configs = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.Key == "tenant_category" || c.Key == "tenant.category" || c.Key == "default_locale" || c.Key == "locale")
            .Select(c => new { c.TenantId, c.Key, c.Value })
            .ToListAsync(ct);

        var byTenant = configs.GroupBy(c => c.TenantId).ToDictionary(g => g.Key, g => g.ToArray());
        var cooperatives = new List<Cooperative>();

        foreach (var tenant in tenants)
        {
            byTenant.TryGetValue(tenant.Id, out var tenantConfigs);
            var category = tenantConfigs?
                .FirstOrDefault(c => c.Key == "tenant_category" || c.Key == "tenant.category")?
                .Value
                .Trim('"');

            var isKiss = string.Equals(category, "kiss_cooperative", StringComparison.OrdinalIgnoreCase)
                || tenant.Slug.Contains("kiss", StringComparison.OrdinalIgnoreCase)
                || tenant.Name.Contains("KISS", StringComparison.OrdinalIgnoreCase);
            if (!isKiss)
            {
                continue;
            }

            var locale = tenantConfigs?
                .FirstOrDefault(c => c.Key == "default_locale" || c.Key == "locale")?
                .Value
                .Trim('"');
            var memberCount = await _db.Users
                .IgnoreQueryFilters()
                .CountAsync(u => u.TenantId == tenant.Id && u.IsActive, ct);

            cooperatives.Add(new Cooperative(tenant.Id, tenant.Slug, tenant.Name, string.IsNullOrWhiteSpace(locale) ? null : locale, memberCount));
        }

        return cooperatives.ToArray();
    }

    private async Task<MetricRow[]> BuildRowsAsync(DateRange range, CancellationToken ct)
    {
        var cooperatives = await ListCooperativesAsync(ct);
        var rows = new List<MetricRow>();
        foreach (var coop in cooperatives)
        {
            var participants = await ParticipantIdsAsync(coop.TenantId, range, ct);
            var recipients = await RecipientIdsAsync(coop.TenantId, range, ct);
            rows.Add(new MetricRow(
                coop,
                await ApprovedHoursForTenantAsync(coop.TenantId, range, ct),
                participants.Count,
                recipients.Count,
                await ActiveTandemsAsync(coop.TenantId, range, ct),
                await SafeguardingReportsAsync(coop.TenantId, range, ct),
                await ReciprocityAsync(coop.TenantId, range, ct),
                participants));
        }

        return rows.ToArray();
    }

    private async Task<decimal> ApprovedHoursForTenantAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        var fromDateTime = StartOfDayUtc(range.From);
        var toExclusive = StartOfDayUtc(range.To.AddDays(1));
        var volHours = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(v => v.TenantId == tenantId &&
                        v.Status == "approved" &&
                        v.DateLogged >= range.From &&
                        v.DateLogged <= range.To)
            .SumAsync(v => (decimal?)v.Hours, ct) ?? 0m;
        var transactionHours = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId &&
                        t.Status == TransactionStatus.Completed &&
                        t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType &&
                        t.CreatedAt >= fromDateTime &&
                        t.CreatedAt < toExclusive)
            .SumAsync(t => (decimal?)t.Amount, ct) ?? 0m;

        return volHours + transactionHours;
    }

    private async Task<HashSet<int>> ParticipantIdsAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        var fromDateTime = StartOfDayUtc(range.From);
        var toExclusive = StartOfDayUtc(range.To.AddDays(1));
        var ids = new HashSet<int>();

        var volunteerIds = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(v => v.TenantId == tenantId &&
                        v.Status == "approved" &&
                        v.DateLogged >= range.From &&
                        v.DateLogged <= range.To)
            .Select(v => v.UserId)
            .ToListAsync(ct);
        ids.UnionWith(volunteerIds);

        var transactionIds = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId &&
                        t.Status == TransactionStatus.Completed &&
                        t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType &&
                        t.CreatedAt >= fromDateTime &&
                        t.CreatedAt < toExclusive)
            .Select(t => new { t.SenderId, t.ReceiverId })
            .ToListAsync(ct);
        foreach (var tx in transactionIds)
        {
            if (tx.SenderId.HasValue)
                ids.Add(tx.SenderId.Value);
            if (tx.ReceiverId.HasValue)
                ids.Add(tx.ReceiverId.Value);
        }

        return ids;
    }

    private async Task<HashSet<int>> RecipientIdsAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        var fromDateTime = StartOfDayUtc(range.From);
        var toExclusive = StartOfDayUtc(range.To.AddDays(1));
        var ids = new HashSet<int>();

        var volunteerRecipients = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .Where(v => v.TenantId == tenantId &&
                        v.Status == "approved" &&
                        v.SupportRecipientId != null &&
                        v.DateLogged >= range.From &&
                        v.DateLogged <= range.To)
            .Select(v => v.SupportRecipientId!.Value)
            .ToListAsync(ct);
        ids.UnionWith(volunteerRecipients);

        var transactionRecipients = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId &&
                        t.Status == TransactionStatus.Completed &&
                        t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType &&
                        t.CreatedAt >= fromDateTime &&
                        t.CreatedAt < toExclusive)
            .Where(t => t.ReceiverId.HasValue)
            .Select(t => t.ReceiverId!.Value)
            .ToListAsync(ct);
        ids.UnionWith(transactionRecipients);

        return ids;
    }

    private async Task<int> ActiveTandemsAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        return await _db.CaringSupportRelationships
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId &&
                             (r.Status == "active" || r.Status == "paused") &&
                             r.StartDate <= range.To &&
                             (r.EndDate == null || r.EndDate >= range.From), ct);
    }

    private async Task<int> SafeguardingReportsAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        var fromDateTime = StartOfDayUtc(range.From);
        var toExclusive = StartOfDayUtc(range.To.AddDays(1));
        return await _db.SafeguardingReports
            .IgnoreQueryFilters()
            .CountAsync(r => r.TenantId == tenantId && r.CreatedAt >= fromDateTime && r.CreatedAt < toExclusive, ct);
    }

    private async Task<decimal> ReciprocityAsync(int tenantId, DateRange range, CancellationToken ct)
    {
        var fromDateTime = StartOfDayUtc(range.From);
        var toExclusive = StartOfDayUtc(range.To.AddDays(1));
        var rows = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId &&
                        t.Status == TransactionStatus.Completed &&
                        t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType &&
                        t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType &&
                        t.CreatedAt >= fromDateTime &&
                        t.CreatedAt < toExclusive)
            .Select(t => new { t.SenderId, t.ReceiverId })
            .ToListAsync(ct);

        var supporters = rows.Select(row => row.SenderId).ToHashSet();
        if (supporters.Count == 0)
        {
            return 0m;
        }

        var receivers = rows.Select(row => row.ReceiverId).ToHashSet();
        return supporters.Intersect(receivers).Count() / (decimal)supporters.Count;
    }

    private static DateRange ResolveRange(string? from, string? to)
    {
        var fallbackTo = DateOnly.FromDateTime(DateTime.UtcNow);
        var fallbackFrom = fallbackTo.AddDays(-90);
        var parsedFrom = DateOnly.TryParseExact(from, "yyyy-MM-dd", out var fromDate) ? fromDate : fallbackFrom;
        var parsedTo = DateOnly.TryParseExact(to, "yyyy-MM-dd", out var toDate) ? toDate : fallbackTo;
        return parsedFrom <= parsedTo ? new DateRange(parsedFrom, parsedTo) : new DateRange(parsedTo, parsedFrom);
    }

    private static IReadOnlyList<DateOnly> MonthStarts(int count)
    {
        var current = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        return Enumerable.Range(0, count)
            .Select(offset => current.AddMonths(-(count - offset - 1)))
            .ToArray();
    }

    private static DateTime StartOfDayUtc(DateOnly date) =>
        new(date.Year, date.Month, date.Day, 0, 0, 0, DateTimeKind.Utc);

    private static string Bucket(int count) => count switch
    {
        <= 0 => "0",
        < 10 => "1-9",
        < 25 => "10-24",
        < 50 => "25-49",
        < 100 => "50-99",
        < 250 => "100-249",
        < 500 => "250-499",
        < 1000 => "500-999",
        < 2500 => "1000-2499",
        < 5000 => "2500-4999",
        _ => "5000+"
    };

    private static double Round1(decimal value) => Math.Round((double)value, 1);

    private static string ClassifyStatus(decimal hoursGrowthPct, decimal retentionPct)
    {
        if (hoursGrowthPct < -10m || retentionPct < 50m)
        {
            return "struggling";
        }

        return hoursGrowthPct >= 10m && retentionPct >= 80m ? "thriving" : "stable";
    }

    private static string ToIso(DateOnly date) => date.ToString("yyyy-MM-dd");

    private sealed record Cooperative(int TenantId, string Slug, string Name, string? Locale, int MemberCount);
    private sealed record DateRange(DateOnly From, DateOnly To);
    private sealed record MetricRow(
        Cooperative Cooperative,
        decimal Hours,
        int ActiveMembers,
        int Recipients,
        int ActiveTandems,
        int SafeguardingReports,
        decimal Reciprocity,
        HashSet<int> Participants);
}
