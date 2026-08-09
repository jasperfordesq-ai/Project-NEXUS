// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringCommunityForecastService
{
    private const int HistoryMonths = 6;
    private const decimal CoefficientDriftFlag = 0.15m;
    private const int ChurnPriorWindowDaysStart = 90;
    private const int ChurnPriorWindowDaysEnd = 60;
    private const int ChurnLapsedDays = 30;

    private readonly NexusDbContext _db;

    public CaringCommunityForecastService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringCommunityForecastDashboard> DashboardAsync(int tenantId, CancellationToken ct)
    {
        return new CaringCommunityForecastDashboard(
            await ForecastHoursAsync(tenantId, 3, ct),
            await ForecastMembersAsync(tenantId, 3, ct),
            await ForecastRecipientsAsync(tenantId, 3, ct),
            await SubRegionDemandAsync(tenantId, ct),
            await HelperChurnAsync(tenantId, ct),
            await CategoryCoefficientDriftAsync(tenantId, ct),
            await ActiveAlertsAsync(tenantId, ct),
            DateTime.UtcNow);
    }

    private async Task<CaringForecastMetric> ForecastHoursAsync(int tenantId, int monthsAhead, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "hours"], ct))
        {
            return BuildForecast(EmptyHistory(), monthsAhead);
        }

        var start = HistoryStart();
        var rows = await QueryRowsAsync(
            """
            SELECT to_char(date_trunc('month', date_logged), 'YYYY-MM') AS bucket,
                   COALESCE(SUM(hours), 0) AS total
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @start_date
            GROUP BY bucket
            """,
            ct,
            ("tenant_id", tenantId),
            ("start_date", start));

        return BuildForecast(HydrateHistory(rows), monthsAhead);
    }

    private async Task<CaringForecastMetric> ForecastMembersAsync(int tenantId, int monthsAhead, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "user_id"], ct))
        {
            return BuildForecast(EmptyHistory(), monthsAhead);
        }

        var start = HistoryStart();
        var rows = await QueryRowsAsync(
            """
            SELECT to_char(date_trunc('month', date_logged), 'YYYY-MM') AS bucket,
                   COUNT(DISTINCT user_id) AS total
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @start_date
            GROUP BY bucket
            """,
            ct,
            ("tenant_id", tenantId),
            ("start_date", start));

        return BuildForecast(HydrateHistory(rows), monthsAhead);
    }

    private async Task<CaringForecastMetric> ForecastRecipientsAsync(int tenantId, int monthsAhead, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "support_recipient_id"], ct))
        {
            return BuildForecast(EmptyHistory(), monthsAhead);
        }

        var start = HistoryStart();
        var rows = await QueryRowsAsync(
            """
            SELECT to_char(date_trunc('month', date_logged), 'YYYY-MM') AS bucket,
                   COUNT(DISTINCT support_recipient_id) AS total
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND support_recipient_id IS NOT NULL
              AND date_logged >= @start_date
            GROUP BY bucket
            """,
            ct,
            ("tenant_id", tenantId),
            ("start_date", start));

        return BuildForecast(HydrateHistory(rows), monthsAhead);
    }

    private async Task<CaringSubRegionDemand> SubRegionDemandAsync(int tenantId, CancellationToken ct)
    {
        var empty = new CaringSubRegionDemand(new CaringDemandWindows(30, 90), [], 0);
        if (!await HasTableAsync("caring_sub_regions", ct)
            || !await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "hours", "user_id"], ct)
            || !await HasTableAsync("caring_help_requests", ct)
            || !await HasColumnAsync("users", "location", ct))
        {
            return empty;
        }

        var requestReady = await HasColumnsAsync(
            "caring_help_requests",
            ["tenant_id", "user_id", "created_at", "id"],
            ct);
        if (!requestReady)
        {
            return empty;
        }

        var regions = await _db.CaringSubRegions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId && r.Status == "active")
            .OrderBy(r => r.Name)
            .Select(r => new
            {
                r.Id,
                r.Name,
                r.Slug,
                r.PostalCodes
            })
            .ToListAsync(ct);

        if (regions.Count == 0)
        {
            return empty;
        }

        var shortStart = DateTime.UtcNow.Date.AddDays(-30);
        var longStart = DateTime.UtcNow.Date.AddDays(-90);
        var rows = new List<CaringSubRegionDemandRow>();
        var underSupplied = 0;

        foreach (var region in regions)
        {
            var postalCodes = DecodePostalCodes(region.PostalCodes);
            var requested30 = await SumRequestedHoursForRegionAsync(tenantId, region.Name, postalCodes, shortStart, ct);
            var requested90 = await SumRequestedHoursForRegionAsync(tenantId, region.Name, postalCodes, longStart, ct);
            var fulfilled30 = await SumFulfilledHoursForRegionAsync(tenantId, region.Name, postalCodes, shortStart, ct);
            var fulfilled90 = await SumFulfilledHoursForRegionAsync(tenantId, region.Name, postalCodes, longStart, ct);
            var cov30 = requested30 > 0.001m ? decimal.Round(fulfilled30 / requested30, 3) : 0m;
            var cov90 = requested90 > 0.001m ? decimal.Round(fulfilled90 / requested90, 3) : 0m;
            var flagged = requested90 > 0m && cov90 < 0.5m;
            if (flagged)
            {
                underSupplied++;
            }

            rows.Add(new CaringSubRegionDemandRow(
                region.Id,
                region.Name,
                region.Slug,
                Round2(requested30),
                Round2(fulfilled30),
                cov30,
                Round2(requested90),
                Round2(fulfilled90),
                cov90,
                flagged));
        }

        return new CaringSubRegionDemand(new CaringDemandWindows(30, 90), rows, underSupplied);
    }

    private async Task<CaringHelperChurn> HelperChurnAsync(int tenantId, CancellationToken ct)
    {
        var empty = EmptyChurn();
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "user_id"], ct))
        {
            return empty;
        }

        var priorStart = DateTime.UtcNow.Date.AddDays(-ChurnPriorWindowDaysStart);
        var priorEnd = DateTime.UtcNow.Date.AddDays(-ChurnPriorWindowDaysEnd);
        var recentStart = DateTime.UtcNow.Date.AddDays(-ChurnLapsedDays);

        var priorActive = await QueryIntColumnAsync(
            """
            SELECT DISTINCT user_id
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged BETWEEN @prior_start AND @prior_end
            """,
            ct,
            ("tenant_id", tenantId),
            ("prior_start", priorStart),
            ("prior_end", priorEnd));

        if (priorActive.Count == 0)
        {
            return empty;
        }

        var stillActive = await QueryIntColumnAsync(
            """
            SELECT DISTINCT user_id
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @recent_start
              AND user_id = ANY(@prior_active)
            """,
            ct,
            ("tenant_id", tenantId),
            ("recent_start", recentStart),
            ("prior_active", priorActive.ToArray()));

        var stillSet = stillActive.ToHashSet();
        var lapsed = priorActive.Where(id => !stillSet.Contains(id)).Order().ToArray();
        var priorCount = priorActive.Count;
        var lapsedCount = lapsed.Length;
        var churnRate = priorCount > 0 ? decimal.Round((decimal)lapsedCount / priorCount, 3) : 0m;

        return new CaringHelperChurn(
            new CaringChurnPriorWindow(ChurnPriorWindowDaysStart, ChurnPriorWindowDaysEnd),
            ChurnLapsedDays,
            new CaringHelperChurnOverall(priorCount, lapsedCount, churnRate),
            await ChurnByCategoryAsync(tenantId, priorActive, stillActive, ct),
            lapsed);
    }

    private async Task<CaringCoefficientDrift> CategoryCoefficientDriftAsync(int tenantId, CancellationToken ct)
    {
        var empty = new CaringCoefficientDrift(CoefficientDriftFlag, [], 0);
        if (!await HasColumnsAsync("categories", ["tenant_id", "id", "name", "substitution_coefficient"], ct)
            || !await HasColumnsAsync("caring_support_relationships", ["tenant_id", "category_id", "status", "expected_hours"], ct)
            || !await HasVolLogsColumnsAsync(["tenant_id", "status", "hours", "caring_support_relationship_id"], ct))
        {
            return empty;
        }

        var categories = await _db.Categories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsActive)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name, c.SubstitutionCoefficient })
            .ToListAsync(ct);

        var rows = new List<CaringCoefficientDriftCategory>();
        var driftCount = 0;
        foreach (var category in categories)
        {
            var expected = await ScalarDecimalAsync(
                """
                SELECT COALESCE(AVG(expected_hours), 0)
                FROM caring_support_relationships
                WHERE tenant_id = @tenant_id
                  AND category_id = @category_id
                  AND status = 'active'
                """,
                ct,
                ("tenant_id", tenantId),
                ("category_id", category.Id));
            var sample = await ScalarIntAsync(
                """
                SELECT COUNT(l.id)
                FROM vol_logs l
                INNER JOIN caring_support_relationships r
                  ON r.id = l.caring_support_relationship_id
                 AND r.tenant_id = l.tenant_id
                WHERE l.tenant_id = @tenant_id
                  AND l.status = 'approved'
                  AND r.status = 'active'
                  AND r.category_id = @category_id
                """,
                ct,
                ("tenant_id", tenantId),
                ("category_id", category.Id));
            var observed = sample > 0
                ? await ScalarDecimalAsync(
                    """
                    SELECT COALESCE(AVG(l.hours), 0)
                    FROM vol_logs l
                    INNER JOIN caring_support_relationships r
                      ON r.id = l.caring_support_relationship_id
                     AND r.tenant_id = l.tenant_id
                    WHERE l.tenant_id = @tenant_id
                      AND l.status = 'approved'
                      AND r.status = 'active'
                      AND r.category_id = @category_id
                    """,
                    ct,
                    ("tenant_id", tenantId),
                    ("category_id", category.Id))
                : 0m;

            if (expected < 0.001m || sample < 3)
            {
                rows.Add(new CaringCoefficientDriftCategory(
                    category.Id,
                    category.Name,
                    decimal.Round(category.SubstitutionCoefficient, 4),
                    Round2(expected),
                    Round2(observed),
                    0m,
                    false,
                    sample));
                continue;
            }

            var drift = decimal.Round((observed / expected) - 1m, 3);
            var flagged = decimal.Abs(drift) > CoefficientDriftFlag;
            if (flagged)
            {
                driftCount++;
            }

            rows.Add(new CaringCoefficientDriftCategory(
                category.Id,
                category.Name,
                decimal.Round(category.SubstitutionCoefficient, 4),
                Round2(expected),
                Round2(observed),
                drift,
                flagged,
                sample));
        }

        return new CaringCoefficientDrift(CoefficientDriftFlag, rows, driftCount);
    }

    private async Task<IReadOnlyList<CaringForecastAlert>> ActiveAlertsAsync(int tenantId, CancellationToken ct)
    {
        var alerts = new List<CaringForecastAlert?>();
        alerts.Add(await RecipientsWithoutTandemAsync(tenantId, ct));
        alerts.Add(await InactiveMembersAsync(tenantId, ct));
        alerts.Add(await OverdueReviewsAsync(tenantId, ct));
        alerts.Add(await CoordinatorsOverloadedAsync(tenantId, ct));
        alerts.Add(await RetentionDroppingAsync(tenantId, ct));
        alerts.Add(await OverdueCheckInsAsync(tenantId, ct));
        alerts.Add(await LowSupplyAsync(tenantId, ct));

        return alerts
            .Where(alert => alert is not null && alert.Count > 0)
            .Cast<CaringForecastAlert>()
            .ToArray();
    }

    private async Task<CaringForecastAlert?> RecipientsWithoutTandemAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "support_recipient_id"], ct)
            || !await HasColumnsAsync("caring_support_relationships", ["tenant_id", "recipient_id", "status"], ct))
        {
            return null;
        }

        var count = await ScalarIntAsync(
            """
            SELECT COUNT(DISTINCT vl.support_recipient_id)
            FROM vol_logs vl
            WHERE vl.tenant_id = @tenant_id
              AND vl.status = 'approved'
              AND vl.support_recipient_id IS NOT NULL
              AND vl.date_logged >= @since
              AND NOT EXISTS (
                  SELECT 1
                  FROM caring_support_relationships csr
                  WHERE csr.tenant_id = vl.tenant_id
                    AND csr.recipient_id = vl.support_recipient_id
                    AND csr.status = 'active'
              )
            """,
            ct,
            ("tenant_id", tenantId),
            ("since", DateTime.UtcNow.AddMonths(-6)));

        return new CaringForecastAlert(
            "recipients_without_tandem",
            "warning",
            "Recipients need tandem supporters",
            "Recipients reached in the last six months do not yet have an active support relationship.",
            count,
            "See suggestions",
            "/admin/caring-community/workflow#tandem-suggestions");
    }

    private async Task<CaringForecastAlert?> InactiveMembersAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "user_id"], ct))
        {
            return null;
        }

        var activePredicate = await HasColumnAsync("users", "status", ct)
            ? "(u.is_active = TRUE OR u.status = 'active')"
            : "u.is_active = TRUE";
        var count = await ScalarIntAsync(
            $"""
            SELECT COUNT(DISTINCT u.id)
            FROM users u
            WHERE u.tenant_id = @tenant_id
              AND {activePredicate}
              AND EXISTS (
                  SELECT 1
                  FROM vol_logs vl
                  WHERE vl.tenant_id = u.tenant_id
                    AND vl.user_id = u.id
                    AND vl.status = 'approved'
                    AND vl.date_logged >= @six_months
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM vol_logs vl2
                  WHERE vl2.tenant_id = u.tenant_id
                    AND vl2.user_id = u.id
                    AND vl2.date_logged >= @thirty_days
              )
            """,
            ct,
            ("tenant_id", tenantId),
            ("six_months", DateTime.UtcNow.AddMonths(-6)),
            ("thirty_days", DateTime.UtcNow.AddDays(-30)));

        return new CaringForecastAlert(
            "inactive_members",
            "info",
            "Previously active members are quiet",
            "Members who helped recently have not logged approved time in the last 30 days.",
            count,
            "View members",
            "/admin/members");
    }

    private async Task<CaringForecastAlert?> OverdueReviewsAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "created_at"], ct))
        {
            return null;
        }

        var sla = await ReviewSlaDaysAsync(tenantId, ct);
        var count = await ScalarIntAsync(
            """
            SELECT COUNT(*)
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'pending'
              AND created_at < @cutoff
            """,
            ct,
            ("tenant_id", tenantId),
            ("cutoff", DateTime.UtcNow.AddDays(-sla)));

        return new CaringForecastAlert(
            "overdue_reviews",
            "warning",
            "Reviews are overdue",
            $"Pending volunteer logs are older than the {sla}-day review SLA.",
            count,
            "Review now",
            "/admin/caring-community/workflow");
    }

    private async Task<CaringForecastAlert?> CoordinatorsOverloadedAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "assigned_to"], ct))
        {
            return null;
        }

        var count = await ScalarIntAsync(
            """
            SELECT COUNT(*)
            FROM (
                SELECT assigned_to
                FROM vol_logs
                WHERE tenant_id = @tenant_id
                  AND status = 'pending'
                  AND assigned_to IS NOT NULL
                GROUP BY assigned_to
                HAVING COUNT(*) > 10
            ) overloaded
            """,
            ct,
            ("tenant_id", tenantId));

        return new CaringForecastAlert(
            "coordinators_overloaded",
            "critical",
            "Coordinator queues are overloaded",
            "One or more coordinators have more than ten pending reviews.",
            count,
            "Reassign reviews",
            "/admin/caring-community/workflow");
    }

    private async Task<CaringForecastAlert?> RetentionDroppingAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasVolLogsColumnsAsync(["tenant_id", "status", "date_logged", "user_id"], ct))
        {
            return null;
        }

        var currentMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var current = await ScalarIntAsync(
            """
            SELECT COUNT(DISTINCT user_id)
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @current_month
            """,
            ct,
            ("tenant_id", tenantId),
            ("current_month", currentMonth));

        var rows = await QueryRowsAsync(
            """
            SELECT to_char(date_trunc('month', date_logged), 'YYYY-MM') AS bucket,
                   COUNT(DISTINCT user_id) AS total
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @prior_start
              AND date_logged < @current_month
            GROUP BY bucket
            """,
            ct,
            ("tenant_id", tenantId),
            ("prior_start", currentMonth.AddMonths(-3)),
            ("current_month", currentMonth));

        if (rows.Count == 0)
        {
            return null;
        }

        var avg = rows.Values.Average(v => (double)v);
        if (avg < 1.0d)
        {
            return null;
        }

        var threshold = avg * 0.85d;
        if (current >= threshold)
        {
            return null;
        }

        var drop = Math.Max(0, (int)Math.Round(threshold - current));
        return new CaringForecastAlert(
            "retention_dropping",
            "warning",
            "Active member count is sliding",
            string.Create(CultureInfo.InvariantCulture,
                $"This month's active members ({current}) are below 85% of the recent 3-month average ({avg:0}). Consider an outreach nudge."),
            drop,
            "Open reports",
            "/admin/reports/members");
    }

    private async Task<CaringForecastAlert?> OverdueCheckInsAsync(int tenantId, CancellationToken ct)
    {
        if (!await HasColumnsAsync("caring_support_relationships", ["tenant_id", "status", "next_check_in_at"], ct))
        {
            return null;
        }

        var count = await ScalarIntAsync(
            """
            SELECT COUNT(*)
            FROM caring_support_relationships
            WHERE tenant_id = @tenant_id
              AND status = 'active'
              AND next_check_in_at IS NOT NULL
              AND next_check_in_at < @now
            """,
            ct,
            ("tenant_id", tenantId),
            ("now", DateTime.UtcNow));

        return new CaringForecastAlert(
            "overdue_check_ins",
            "warning",
            "Support relationship check-ins are overdue",
            "Active caring relationships have overdue check-ins.",
            count,
            "View tandems",
            "/admin/caring-community/workflow#support-relationships");
    }

    private async Task<CaringForecastAlert?> LowSupplyAsync(int tenantId, CancellationToken ct)
    {
        var grouped = await _db.Listings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(l => l.TenantId == tenantId
                && l.Status == ListingStatus.Active
                && l.CategoryId != null)
            .GroupBy(l => l.CategoryId)
            .Select(g => new
            {
                Offers = g.Count(l => l.Type == ListingType.Offer),
                Requests = g.Count(l => l.Type == ListingType.Request)
            })
            .ToListAsync(ct);

        var count = grouped.Count(row => row.Offers < row.Requests);
        return new CaringForecastAlert(
            "low_supply",
            "info",
            "Some request categories have low supply",
            "Active listing categories contain more requests than offers.",
            count,
            "View listings",
            "/admin/listings");
    }

    private async Task<IReadOnlyList<CaringHelperChurnCategory>> ChurnByCategoryAsync(
        int tenantId,
        IReadOnlyList<int> priorActive,
        IReadOnlyList<int> stillActive,
        CancellationToken ct)
    {
        if (priorActive.Count == 0
            || !await HasColumnsAsync("caring_support_relationships", ["tenant_id", "supporter_id", "category_id"], ct)
            || !await HasColumnsAsync("categories", ["id", "name"], ct))
        {
            return [];
        }

        var rows = await QueryChurnCategoryRowsAsync(tenantId, priorActive, ct);
        var stillSet = stillActive.ToHashSet();
        return rows
            .GroupBy(row => row.CategoryId?.ToString(CultureInfo.InvariantCulture) ?? "uncategorised")
            .Select(group =>
            {
                var first = group.First();
                var prior = group.Select(row => row.SupporterId).Distinct().ToArray();
                var still = prior.Count(stillSet.Contains);
                var lapsed = Math.Max(0, prior.Length - still);
                var rate = prior.Length > 0 ? decimal.Round((decimal)lapsed / prior.Length, 3) : 0m;
                return new CaringHelperChurnCategory(
                    first.CategoryId,
                    first.CategoryName ?? "Uncategorised",
                    prior.Length,
                    lapsed,
                    rate);
            })
            .OrderByDescending(row => row.ChurnRate)
            .ToArray();
    }

    private async Task<IReadOnlyList<ChurnCategoryRawRow>> QueryChurnCategoryRowsAsync(
        int tenantId,
        IReadOnlyList<int> priorActive,
        CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        return await WithCommandAsync(
            """
            SELECT r.supporter_id, r.category_id, c.name AS category_name
            FROM caring_support_relationships r
            LEFT JOIN categories c
              ON c.id = r.category_id
             AND (c.tenant_id = r.tenant_id OR c.tenant_id IS NULL)
            WHERE r.tenant_id = @tenant_id
              AND r.supporter_id = ANY(@prior_active)
            """,
            async command =>
            {
                AddParameter(command, "tenant_id", tenantId);
                AddParameter(command, "prior_active", priorActive.ToArray());
                var rows = new List<ChurnCategoryRawRow>();
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    rows.Add(new ChurnCategoryRawRow(
                        Convert.ToInt32(reader["supporter_id"], CultureInfo.InvariantCulture),
                        reader["category_id"] is DBNull ? null : Convert.ToInt32(reader["category_id"], CultureInfo.InvariantCulture),
                        reader["category_name"] is DBNull ? null : Convert.ToString(reader["category_name"], CultureInfo.InvariantCulture)));
                }

                return rows;
            },
            ct);
    }

    private async Task<decimal> SumRequestedHoursForRegionAsync(
        int tenantId,
        string name,
        IReadOnlyList<string> postalCodes,
        DateTime sinceDate,
        CancellationToken ct)
    {
        var where = BuildLocationPredicate("u.location", name, postalCodes, out var parameters);
        return await ScalarDecimalAsync(
            $"""
            SELECT COUNT(hr.id)
            FROM caring_help_requests hr
            INNER JOIN users u
              ON u.id = hr.user_id
             AND u.tenant_id = hr.tenant_id
            WHERE hr.tenant_id = @tenant_id
              AND hr.created_at >= @since
              AND ({where})
            """,
            ct,
            [("tenant_id", tenantId), ("since", sinceDate), .. parameters]);
    }

    private async Task<decimal> SumFulfilledHoursForRegionAsync(
        int tenantId,
        string name,
        IReadOnlyList<string> postalCodes,
        DateTime sinceDate,
        CancellationToken ct)
    {
        var hasRecipient = await HasColumnAsync("vol_logs", "support_recipient_id", ct);
        if (hasRecipient)
        {
            var where = BuildLocationPredicate(
                ["helper.location", "recip.location"],
                name,
                postalCodes,
                out var parameters);
            return await ScalarDecimalAsync(
                $"""
                SELECT COALESCE(SUM(l.hours), 0)
                FROM vol_logs l
                LEFT JOIN users helper
                  ON helper.id = l.user_id
                 AND helper.tenant_id = l.tenant_id
                LEFT JOIN users recip
                  ON recip.id = l.support_recipient_id
                 AND recip.tenant_id = l.tenant_id
                WHERE l.tenant_id = @tenant_id
                  AND l.status = 'approved'
                  AND l.date_logged >= @since
                  AND ({where})
                """,
                ct,
                [("tenant_id", tenantId), ("since", sinceDate), .. parameters]);
        }

        var fallbackWhere = BuildLocationPredicate("helper.location", name, postalCodes, out var fallbackParameters);
        return await ScalarDecimalAsync(
            $"""
            SELECT COALESCE(SUM(l.hours), 0)
            FROM vol_logs l
            INNER JOIN users helper
              ON helper.id = l.user_id
             AND helper.tenant_id = l.tenant_id
            WHERE l.tenant_id = @tenant_id
              AND l.status = 'approved'
              AND l.date_logged >= @since
              AND ({fallbackWhere})
            """,
            ct,
            [("tenant_id", tenantId), ("since", sinceDate), .. fallbackParameters]);
    }

    private static CaringHelperChurn EmptyChurn()
    {
        return new CaringHelperChurn(
            new CaringChurnPriorWindow(ChurnPriorWindowDaysStart, ChurnPriorWindowDaysEnd),
            ChurnLapsedDays,
            new CaringHelperChurnOverall(0, 0, 0m),
            [],
            []);
    }

    private static List<CaringForecastHistoryPoint> EmptyHistory()
    {
        var bins = new List<CaringForecastHistoryPoint>();
        var cursor = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc)
            .AddMonths(-(HistoryMonths - 1));
        for (var i = 0; i < HistoryMonths; i++)
        {
            bins.Add(new CaringForecastHistoryPoint(cursor.ToString("yyyy-MM", CultureInfo.InvariantCulture), 0m));
            cursor = cursor.AddMonths(1);
        }

        return bins;
    }

    private static DateTime HistoryStart()
    {
        return new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc)
            .AddMonths(-(HistoryMonths - 1));
    }

    private static List<CaringForecastHistoryPoint> HydrateHistory(IReadOnlyDictionary<string, decimal> values)
    {
        return EmptyHistory()
            .Select(point => point with
            {
                Hours = values.TryGetValue(point.Month, out var value) ? Round2(value) : 0m
            })
            .ToList();
    }

    private static CaringForecastMetric BuildForecast(IReadOnlyList<CaringForecastHistoryPoint> history, int monthsAhead)
    {
        monthsAhead = Math.Max(1, Math.Min(12, monthsAhead));
        var points = history.Select((row, idx) => ((decimal)idx, row.Hours)).ToArray();
        var values = points.Select(point => point.Hours).ToArray();
        var meanY = values.Length > 0 ? values.Average() : 0m;
        var nonZeroCount = values.Count(value => value > 0m);
        if (nonZeroCount < 3)
        {
            return new CaringForecastMetric(history, [], "stable", 0m, "low");
        }

        var regression = LinearRegression(points);
        var residualSum = points.Sum(point =>
        {
            var predicted = regression.Slope * point.Item1 + regression.Intercept;
            var diff = point.Hours - predicted;
            return diff * diff;
        });
        var residualSd = points.Length > 0 ? (decimal)Math.Sqrt((double)(residualSum / points.Length)) : 0m;

        var threshold = decimal.Abs(meanY) * 0.05m;
        var trend = threshold < 0.001m
            ? "stable"
            : regression.Slope > threshold
                ? "growing"
                : regression.Slope < -threshold ? "declining" : "stable";
        var growthRatePct = meanY > 0.001m ? decimal.Round((regression.Slope / meanY) * 100m, 1) : 0m;
        var confidence = regression.RSquared >= 0.7m ? "high" : regression.RSquared >= 0.4m ? "medium" : "low";

        var forecast = new List<CaringForecastPoint>();
        var lastMonth = ParseMonth(history[^1].Month);
        for (var k = 1; k <= monthsAhead; k++)
        {
            var x = points.Length - 1 + k;
            var yHat = Math.Max(0m, regression.Slope * x + regression.Intercept);
            var lower = Math.Max(0m, yHat - residualSd);
            var upper = yHat + residualSd;
            forecast.Add(new CaringForecastPoint(
                lastMonth.AddMonths(k).ToString("yyyy-MM", CultureInfo.InvariantCulture),
                Round2(yHat),
                Round2(lower),
                Round2(upper)));
        }

        return new CaringForecastMetric(history, forecast, trend, growthRatePct, confidence);
    }

    private static (decimal Slope, decimal Intercept, decimal RSquared) LinearRegression(
        IReadOnlyList<(decimal X, decimal Hours)> points)
    {
        var n = points.Count;
        if (n < 2)
        {
            return (0m, 0m, 0m);
        }

        var meanX = points.Average(point => point.X);
        var meanY = points.Average(point => point.Hours);
        var sumXy = 0m;
        var sumXx = 0m;
        var sumYy = 0m;
        foreach (var point in points)
        {
            sumXy += (point.X - meanX) * (point.Hours - meanY);
            sumXx += (point.X - meanX) * (point.X - meanX);
            sumYy += (point.Hours - meanY) * (point.Hours - meanY);
        }

        if (sumXx < 0.000000000001m)
        {
            return (0m, meanY, 0m);
        }

        var slope = sumXy / sumXx;
        var intercept = meanY - slope * meanX;
        var rSquared = sumYy > 0.000000000001m ? (slope * sumXy) / sumYy : 0m;
        rSquared = Math.Max(0m, Math.Min(1m, rSquared));
        return (slope, intercept, rSquared);
    }

    private async Task<int> ReviewSlaDaysAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && (c.Key == "caring.workflow_policy" || c.Key == "caring.operating_policy"))
            .OrderBy(c => c.Key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(value))
        {
            return 7;
        }

        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.TryGetProperty("review_sla_days", out var reviewSla)
                && reviewSla.TryGetInt32(out var days))
            {
                return Math.Max(1, days);
            }
        }
        catch (JsonException)
        {
            return 7;
        }

        return 7;
    }

    private async Task<bool> HasVolLogsColumnsAsync(IReadOnlyList<string> columns, CancellationToken ct)
    {
        return await HasColumnsAsync("vol_logs", columns, ct);
    }

    private async Task<bool> HasColumnsAsync(string tableName, IReadOnlyList<string> columnNames, CancellationToken ct)
    {
        if (!await HasTableAsync(tableName, ct))
        {
            return false;
        }

        foreach (var column in columnNames)
        {
            if (!await HasColumnAsync(tableName, column, ct))
            {
                return false;
            }
        }

        return true;
    }

    private async Task<bool> HasTableAsync(string tableName, CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return false;
        }

        var result = await ScalarObjectAsync(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = ANY (current_schemas(false))
                  AND table_name = @table_name
            )
            """,
            ct,
            ("table_name", tableName));

        return result is bool value && value;
    }

    private async Task<bool> HasColumnAsync(string tableName, string columnName, CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return false;
        }

        var result = await ScalarObjectAsync(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = ANY (current_schemas(false))
                  AND table_name = @table_name
                  AND column_name = @column_name
            )
            """,
            ct,
            ("table_name", tableName),
            ("column_name", columnName));

        return result is bool value && value;
    }

    private async Task<Dictionary<string, decimal>> QueryRowsAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        return await WithCommandAsync(
            sql,
            async command =>
            {
                foreach (var parameter in parameters)
                {
                    AddParameter(command, parameter.Name, parameter.Value);
                }

                var rows = new Dictionary<string, decimal>(StringComparer.Ordinal);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var bucket = Convert.ToString(reader["bucket"], CultureInfo.InvariantCulture);
                    if (!string.IsNullOrWhiteSpace(bucket))
                    {
                        rows[bucket] = Convert.ToDecimal(reader["total"], CultureInfo.InvariantCulture);
                    }
                }

                return rows;
            },
            ct);
    }

    private async Task<IReadOnlyList<int>> QueryIntColumnAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        return await WithCommandAsync(
            sql,
            async command =>
            {
                foreach (var parameter in parameters)
                {
                    AddParameter(command, parameter.Name, parameter.Value);
                }

                var values = new List<int>();
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    values.Add(Convert.ToInt32(reader.GetValue(0), CultureInfo.InvariantCulture));
                }

                return values;
            },
            ct);
    }

    private async Task<int> ScalarIntAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        var value = await ScalarObjectAsync(sql, ct, parameters);
        return value is null || value is DBNull ? 0 : Convert.ToInt32(value, CultureInfo.InvariantCulture);
    }

    private async Task<decimal> ScalarDecimalAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        var value = await ScalarObjectAsync(sql, ct, parameters);
        return value is null || value is DBNull ? 0m : Convert.ToDecimal(value, CultureInfo.InvariantCulture);
    }

    private async Task<object?> ScalarObjectAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return null;
        }

        return await WithCommandAsync(
            sql,
            async command =>
            {
                foreach (var parameter in parameters)
                {
                    AddParameter(command, parameter.Name, parameter.Value);
                }

                return await command.ExecuteScalarAsync(ct);
            },
            ct);
    }

    private async Task<T> WithCommandAsync<T>(
        string sql,
        Func<DbCommand, Task<T>> run,
        CancellationToken ct)
    {
        var connection = _db.Database.GetDbConnection();
        var openedHere = connection.State != ConnectionState.Open;
        if (openedHere)
        {
            await connection.OpenAsync(ct);
        }

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            if (_db.Database.CurrentTransaction is not null)
            {
                command.Transaction = _db.Database.CurrentTransaction.GetDbTransaction();
            }

            return await run(command);
        }
        finally
        {
            if (openedHere)
            {
                await connection.CloseAsync();
            }
        }
    }

    private static void AddParameter(DbCommand command, string name, object? value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value ?? DBNull.Value;
        command.Parameters.Add(parameter);
    }

    private static string BuildLocationPredicate(
        string column,
        string name,
        IReadOnlyList<string> postalCodes,
        out (string Name, object? Value)[] parameters)
    {
        return BuildLocationPredicate([column], name, postalCodes, out parameters);
    }

    private static string BuildLocationPredicate(
        IReadOnlyList<string> columns,
        string name,
        IReadOnlyList<string> postalCodes,
        out (string Name, object? Value)[] parameters)
    {
        var parts = new List<string>();
        var values = new List<(string Name, object? Value)>();
        var idx = 0;
        foreach (var term in new[] { name }.Concat(postalCodes).Where(v => !string.IsNullOrWhiteSpace(v)))
        {
            var paramName = $"loc_{idx++}";
            foreach (var column in columns)
            {
                parts.Add($"{column} ILIKE @{paramName}");
            }

            values.Add((paramName, "%" + term.Trim() + "%"));
        }

        parameters = values.ToArray();
        return parts.Count == 0 ? "FALSE" : string.Join(" OR ", parts);
    }

    private static IReadOnlyList<string> DecodePostalCodes(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            var decoded = JsonSerializer.Deserialize<string[]>(raw);
            return decoded?
                .Where(code => !string.IsNullOrWhiteSpace(code))
                .Select(code => code.Trim())
                .ToArray() ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static DateTime ParseMonth(string month)
    {
        return DateTime.TryParseExact(
            month + "-01",
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var value)
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
    }

    private static decimal Round2(decimal value) => decimal.Round(value, 2);

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private sealed record ChurnCategoryRawRow(int SupporterId, int? CategoryId, string? CategoryName);
}

public sealed record CaringCommunityForecastDashboard(
    [property: JsonPropertyName("hours")] CaringForecastMetric Hours,
    [property: JsonPropertyName("members")] CaringForecastMetric Members,
    [property: JsonPropertyName("recipients")] CaringForecastMetric Recipients,
    [property: JsonPropertyName("sub_region_demand")] CaringSubRegionDemand SubRegionDemand,
    [property: JsonPropertyName("helper_churn")] CaringHelperChurn HelperChurn,
    [property: JsonPropertyName("coefficient_drift")] CaringCoefficientDrift CoefficientDrift,
    [property: JsonPropertyName("alerts")] IReadOnlyList<CaringForecastAlert> Alerts,
    [property: JsonPropertyName("generated_at")] DateTime GeneratedAt);

public sealed record CaringForecastMetric(
    [property: JsonPropertyName("history")] IReadOnlyList<CaringForecastHistoryPoint> History,
    [property: JsonPropertyName("forecast")] IReadOnlyList<CaringForecastPoint> Forecast,
    [property: JsonPropertyName("trend")] string Trend,
    [property: JsonPropertyName("growth_rate_pct")] decimal GrowthRatePct,
    [property: JsonPropertyName("confidence")] string Confidence);

public sealed record CaringForecastHistoryPoint(
    [property: JsonPropertyName("month")] string Month,
    [property: JsonPropertyName("hours")] decimal Hours);

public sealed record CaringForecastPoint(
    [property: JsonPropertyName("month")] string Month,
    [property: JsonPropertyName("hours")] decimal Hours,
    [property: JsonPropertyName("lower")] decimal Lower,
    [property: JsonPropertyName("upper")] decimal Upper);

public sealed record CaringSubRegionDemand(
    [property: JsonPropertyName("window_days")] CaringDemandWindows WindowDays,
    [property: JsonPropertyName("sub_regions")] IReadOnlyList<CaringSubRegionDemandRow> SubRegions,
    [property: JsonPropertyName("under_supplied_count")] int UnderSuppliedCount);

public sealed record CaringDemandWindows(
    [property: JsonPropertyName("short")] int Short,
    [property: JsonPropertyName("long")] int Long);

public sealed record CaringSubRegionDemandRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("slug")] string Slug,
    [property: JsonPropertyName("requested_30d")] decimal Requested30d,
    [property: JsonPropertyName("fulfilled_30d")] decimal Fulfilled30d,
    [property: JsonPropertyName("coverage_ratio_30d")] decimal CoverageRatio30d,
    [property: JsonPropertyName("requested_90d")] decimal Requested90d,
    [property: JsonPropertyName("fulfilled_90d")] decimal Fulfilled90d,
    [property: JsonPropertyName("coverage_ratio_90d")] decimal CoverageRatio90d,
    [property: JsonPropertyName("flagged")] bool Flagged);

public sealed record CaringHelperChurn(
    [property: JsonPropertyName("prior_window_days")] CaringChurnPriorWindow PriorWindowDays,
    [property: JsonPropertyName("lapsed_threshold_days")] int LapsedThresholdDays,
    [property: JsonPropertyName("overall")] CaringHelperChurnOverall Overall,
    [property: JsonPropertyName("by_category")] IReadOnlyList<CaringHelperChurnCategory> ByCategory,
    [property: JsonPropertyName("lapsed_helper_ids")] IReadOnlyList<int> LapsedHelperIds);

public sealed record CaringChurnPriorWindow(
    [property: JsonPropertyName("start")] int Start,
    [property: JsonPropertyName("end")] int End);

public sealed record CaringHelperChurnOverall(
    [property: JsonPropertyName("prior_active")] int PriorActive,
    [property: JsonPropertyName("lapsed")] int Lapsed,
    [property: JsonPropertyName("churn_rate")] decimal ChurnRate);

public sealed record CaringHelperChurnCategory(
    [property: JsonPropertyName("category_id")] int? CategoryId,
    [property: JsonPropertyName("category_name")] string CategoryName,
    [property: JsonPropertyName("prior_active")] int PriorActive,
    [property: JsonPropertyName("lapsed")] int Lapsed,
    [property: JsonPropertyName("churn_rate")] decimal ChurnRate);

public sealed record CaringCoefficientDrift(
    [property: JsonPropertyName("threshold")] decimal Threshold,
    [property: JsonPropertyName("categories")] IReadOnlyList<CaringCoefficientDriftCategory> Categories,
    [property: JsonPropertyName("drift_count")] int DriftCount);

public sealed record CaringCoefficientDriftCategory(
    [property: JsonPropertyName("category_id")] int CategoryId,
    [property: JsonPropertyName("category_name")] string CategoryName,
    [property: JsonPropertyName("baseline_coefficient")] decimal BaselineCoefficient,
    [property: JsonPropertyName("expected_session_hours")] decimal ExpectedSessionHours,
    [property: JsonPropertyName("observed_session_hours")] decimal ObservedSessionHours,
    [property: JsonPropertyName("drift")] decimal Drift,
    [property: JsonPropertyName("flagged")] bool Flagged,
    [property: JsonPropertyName("sample_size")] int SampleSize);

public sealed record CaringForecastAlert(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("action_label")] string? ActionLabel,
    [property: JsonPropertyName("action_url")] string? ActionUrl);
