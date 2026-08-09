// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Builds the member Future Care Fund / Zeitvorsorge summary from caring timebank records.
/// </summary>
public sealed class CaringCommunityFutureCareFundService
{
    private const string WorkflowPrefix = "caring_community.workflow.";

    private readonly NexusDbContext _db;

    public CaringCommunityFutureCareFundService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<object> SummaryAsync(int tenantId, int userId, CancellationToken ct)
    {
        var hourValueChf = await HourValueChfAsync(tenantId, ct);
        var given = await LifetimeGivenAsync(tenantId, userId, ct);
        var received = await LifetimeReceivedAsync(tenantId, userId, ct);

        var lifetimeGiven = RoundHours(given.Hours);
        var lifetimeReceived = RoundHours(received.Hours);
        var netBalance = RoundHours(lifetimeGiven - lifetimeReceived);
        var reciprocityRatio = ReciprocityRatio(lifetimeGiven, lifetimeReceived);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);

        return new Dictionary<string, object?>
        {
            ["total_banked_hours"] = lifetimeGiven,
            ["hours_received"] = lifetimeReceived,
            ["net_balance"] = netBalance,
            ["chf_value_estimate"] = RoundHours(netBalance * hourValueChf),
            ["hour_value_chf"] = hourValueChf,
            ["lifetime_given"] = lifetimeGiven,
            ["lifetime_received"] = lifetimeReceived,
            ["reciprocity_ratio"] = reciprocityRatio,
            ["first_contribution_date"] = EarliestDate(given.FirstDate, received.FirstDate),
            ["active_months"] = ActiveMonths(given.FirstDate, received.FirstDate),
            ["partner_organisations_helped"] = await PartnerOrganisationsHelpedAsync(tenantId, userId, ct),
            ["this_month_hours_given"] = RoundHours(await GivenInRangeAsync(tenantId, userId, monthStart, monthEnd, ct)),
            ["this_month_hours_received"] = RoundHours(await ReceivedInRangeAsync(tenantId, userId, monthStart, monthEnd, ct)),
            ["by_year"] = await ByYearAsync(tenantId, userId, ct)
        };
    }

    private async Task<int> HourValueChfAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == WorkflowPrefix + "default_hour_value_chf")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return Clamp(ParseInt(raw, 35), 0, 500);
    }

    private async Task<HoursWithFirstDate> LifetimeGivenAsync(int tenantId, int userId, CancellationToken ct)
    {
        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId && log.UserId == userId && log.Status == "approved")
            .Select(log => new
            {
                log.Hours,
                log.DateLogged
            })
            .ToListAsync(ct);

        return new HoursWithFirstDate(
            logs.Sum(log => log.Hours),
            logs.Count == 0 ? null : logs.Min(log => log.DateLogged).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    private async Task<HoursWithFirstDate> LifetimeReceivedAsync(int tenantId, int userId, CancellationToken ct)
    {
        var transactions = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ExcludeInternalWalletAdapters()
            .Where(tx => tx.TenantId == tenantId && tx.SenderId == userId && tx.Status == TransactionStatus.Completed)
            .Select(tx => new
            {
                tx.Amount,
                tx.CreatedAt
            })
            .ToListAsync(ct);

        var relationshipLogs = await ReceivedRelationshipLogsQuery(tenantId, userId)
            .Select(row => new
            {
                row.Hours,
                row.DateLogged
            })
            .ToListAsync(ct);

        var firstDates = new List<string>();
        if (transactions.Count > 0)
        {
            firstDates.Add(transactions.Min(tx => tx.CreatedAt).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        }

        if (relationshipLogs.Count > 0)
        {
            firstDates.Add(relationshipLogs.Min(log => log.DateLogged).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        }

        return new HoursWithFirstDate(
            transactions.Sum(tx => tx.Amount) + relationshipLogs.Sum(log => log.Hours),
            MinDate(firstDates));
    }

    private async Task<decimal> GivenInRangeAsync(
        int tenantId,
        int userId,
        DateOnly start,
        DateOnly end,
        CancellationToken ct)
    {
        var rows = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId
                && log.UserId == userId
                && log.Status == "approved"
                && log.DateLogged >= start
                && log.DateLogged <= end)
            .Select(log => log.Hours)
            .ToListAsync(ct);

        return rows.Sum();
    }

    private async Task<decimal> ReceivedInRangeAsync(
        int tenantId,
        int userId,
        DateOnly start,
        DateOnly end,
        CancellationToken ct)
    {
        var startDateTime = start.ToDateTime(TimeOnly.MinValue);
        var endExclusive = end.AddDays(1).ToDateTime(TimeOnly.MinValue);
        var transactions = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ExcludeInternalWalletAdapters()
            .Where(tx =>
                tx.TenantId == tenantId
                && tx.SenderId == userId
                && tx.Status == TransactionStatus.Completed
                && tx.CreatedAt >= startDateTime
                && tx.CreatedAt < endExclusive)
            .Select(tx => tx.Amount)
            .ToListAsync(ct);

        var relationshipHours = await ReceivedRelationshipLogsQuery(tenantId, userId)
            .Where(row => row.DateLogged >= start && row.DateLogged <= end)
            .Select(row => row.Hours)
            .ToListAsync(ct);

        return transactions.Sum() + relationshipHours.Sum();
    }

    private async Task<int> PartnerOrganisationsHelpedAsync(int tenantId, int userId, CancellationToken ct)
    {
        return await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId
                && log.UserId == userId
                && log.Status == "approved"
                && log.OrganizationId != null)
            .Select(log => log.OrganizationId!.Value)
            .Distinct()
            .CountAsync(ct);
    }

    private async Task<object[]> ByYearAsync(int tenantId, int userId, CancellationToken ct)
    {
        var years = new Dictionary<int, YearTotals>();

        var given = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId && log.UserId == userId && log.Status == "approved")
            .GroupBy(log => log.DateLogged.Year)
            .Select(group => new
            {
                Year = group.Key,
                Hours = group.Sum(log => log.Hours)
            })
            .ToListAsync(ct);

        foreach (var row in given)
        {
            var total = GetOrCreateYear(years, row.Year);
            total.HoursGiven += row.Hours;
        }

        var transactionRows = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ExcludeInternalWalletAdapters()
            .Where(tx => tx.TenantId == tenantId && tx.SenderId == userId && tx.Status == TransactionStatus.Completed)
            .GroupBy(tx => tx.CreatedAt.Year)
            .Select(group => new
            {
                Year = group.Key,
                Hours = group.Sum(tx => tx.Amount)
            })
            .ToListAsync(ct);

        foreach (var row in transactionRows)
        {
            var total = GetOrCreateYear(years, row.Year);
            total.HoursReceived += row.Hours;
        }

        var relationshipRows = await ReceivedRelationshipLogsQuery(tenantId, userId)
            .GroupBy(row => row.DateLogged.Year)
            .Select(group => new
            {
                Year = group.Key,
                Hours = group.Sum(row => row.Hours)
            })
            .ToListAsync(ct);

        foreach (var row in relationshipRows)
        {
            var total = GetOrCreateYear(years, row.Year);
            total.HoursReceived += row.Hours;
        }

        return years
            .OrderByDescending(row => row.Key)
            .Select(row => new Dictionary<string, object?>
            {
                ["year"] = row.Key,
                ["hours_given"] = RoundHours(row.Value.HoursGiven),
                ["hours_received"] = RoundHours(row.Value.HoursReceived)
            })
            .Cast<object>()
            .ToArray();
    }

    private IQueryable<VolunteerLog> ReceivedRelationshipLogsQuery(int tenantId, int userId)
    {
        return _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log =>
                log.TenantId == tenantId
                && log.Status == "approved"
                && log.CaringSupportRelationshipId != null)
            .Join(
                _db.CaringSupportRelationships.IgnoreQueryFilters().AsNoTracking()
                    .Where(relationship => relationship.TenantId == tenantId && relationship.RecipientId == userId),
                log => new { log.TenantId, RelationshipId = log.CaringSupportRelationshipId!.Value },
                relationship => new { relationship.TenantId, RelationshipId = relationship.Id },
                (log, relationship) => log);
    }

    private static YearTotals GetOrCreateYear(Dictionary<int, YearTotals> years, int year)
    {
        if (!years.TryGetValue(year, out var total))
        {
            total = new YearTotals();
            years[year] = total;
        }

        return total;
    }

    private static decimal ReciprocityRatio(decimal lifetimeGiven, decimal lifetimeReceived)
    {
        if (lifetimeGiven > 0)
        {
            return Math.Min(2.0m, Math.Round(lifetimeReceived / lifetimeGiven, 3, MidpointRounding.AwayFromZero));
        }

        return lifetimeReceived > 0 ? 2.0m : 0.0m;
    }

    private static int ActiveMonths(string? givenFirst, string? receivedFirst)
    {
        var first = EarliestDate(givenFirst, receivedFirst);
        if (first is null || !DateOnly.TryParse(first, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return 0;
        }

        var months = (int)Math.Floor((DateTime.UtcNow - parsed.ToDateTime(TimeOnly.MinValue)).TotalDays / 30.4375);
        return Math.Max(0, months);
    }

    private static string? EarliestDate(string? a, string? b)
    {
        return MinDate(new[] { a, b }.Where(date => !string.IsNullOrWhiteSpace(date)).Select(date => date!));
    }

    private static string? MinDate(IEnumerable<string> dates)
    {
        return dates
            .Where(date => !string.IsNullOrWhiteSpace(date))
            .Order(StringComparer.Ordinal)
            .FirstOrDefault();
    }

    private static decimal RoundHours(decimal hours)
    {
        return Math.Round(hours, 2, MidpointRounding.AwayFromZero);
    }

    private static int ParseInt(string? raw, int fallback)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    private static int Clamp(int value, int min, int max)
    {
        return Math.Max(min, Math.Min(max, value));
    }

    private sealed record HoursWithFirstDate(decimal Hours, string? FirstDate);

    private sealed class YearTotals
    {
        public decimal HoursGiven { get; set; }
        public decimal HoursReceived { get; set; }
    }
}
