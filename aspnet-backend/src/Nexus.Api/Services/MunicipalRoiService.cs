// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class MunicipalRoiService
{
    private const string FeatureFlagKey = "features.caring_community";
    private const string HourlyRateKey = "caring_community.formal_care_hourly_rate_chf";
    private const decimal DefaultHourlyRateChf = 35m;
    private const decimal PreventionMultiplier = 2.0m;

    private readonly NexusDbContext _db;

    public MunicipalRoiService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == FeatureFlagKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<MunicipalRoiReport> ReportAsync(
        int tenantId,
        MunicipalRoiFilters filters,
        CancellationToken ct)
    {
        var period = ResolvePeriod(filters);
        var queryStart = DateTimeUtc(period.From);
        var queryEndExclusive = DateTimeUtc(period.To).AddDays(1);

        var checkIns = await _db.VolunteerCheckIns
            .IgnoreQueryFilters()
            .Include(checkIn => checkIn.Shift)
            .ThenInclude(shift => shift!.Opportunity)
            .Where(checkIn =>
                checkIn.TenantId == tenantId &&
                checkIn.CheckedOutAt != null &&
                checkIn.HoursLogged.HasValue &&
                checkIn.CreatedAt >= queryStart &&
                checkIn.CreatedAt < queryEndExclusive)
            .ToListAsync(ct);

        var categoryIds = checkIns
            .Select(checkIn => checkIn.Shift?.Opportunity?.CategoryId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToArray();

        var coefficients = await _db.Categories
            .IgnoreQueryFilters()
            .Where(category => category.TenantId == tenantId && categoryIds.Contains(category.Id))
            .Select(category => new
            {
                category.Id,
                category.SubstitutionCoefficient
            })
            .ToDictionaryAsync(category => category.Id, category => category.SubstitutionCoefficient, ct);

        var totalHours = checkIns.Sum(checkIn => checkIn.HoursLogged ?? 0m);
        var weightedHours = checkIns.Sum(checkIn =>
        {
            var categoryId = checkIn.Shift?.Opportunity?.CategoryId;
            var coefficient = categoryId.HasValue && coefficients.TryGetValue(categoryId.Value, out var value)
                ? value
                : 1.00m;

            return (checkIn.HoursLogged ?? 0m) * coefficient;
        });

        var activeMembers = checkIns
            .Select(checkIn => checkIn.UserId)
            .Distinct()
            .Count();

        var relationships = await _db.CaringCaregiverLinks
            .IgnoreQueryFilters()
            .Where(link =>
                link.TenantId == tenantId &&
                (link.Status == "active" || link.Status == "approved"))
            .Select(link => new
            {
                link.Id,
                link.CaredForId
            })
            .ToListAsync(ct);

        var hourlyRate = await ResolveHourlyRateAsync(tenantId, ct);
        var formalCareOffset = weightedHours * hourlyRate.RateChf;
        var preventionValue = formalCareOffset * PreventionMultiplier;

        return new MunicipalRoiReport(
            Round(totalHours),
            Round(weightedHours),
            activeMembers,
            relationships.Count,
            relationships.Select(link => link.CaredForId).Distinct().Count(),
            checkIns.Count,
            new MunicipalRoiValue(
                Round(hourlyRate.RateChf),
                Round(formalCareOffset),
                Round(preventionValue),
                relationships.Select(link => link.CaredForId).Distinct().Count()),
            new MunicipalRoiTrend(null),
            new MunicipalRoiPeriod(
                period.From.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                period.To.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            new MunicipalRoiFilterState(filters.ValidSubRegionId()),
            new MunicipalRoiMethodology(
                Round(hourlyRate.RateChf),
                hourlyRate.Source,
                PreventionMultiplier,
                coefficients.Values.Any(coefficient => coefficient != 1.00m)));
    }

    public async Task<MunicipalRoiExport> ExportAsync(
        int tenantId,
        MunicipalRoiFilters filters,
        CancellationToken ct)
    {
        var report = await ReportAsync(tenantId, filters, ct);
        var slug = await TenantSlugAsync(tenantId, ct);
        var filename = $"municipal-roi-{slug}-{report.Period.From}-to-{report.Period.To}.csv";

        var rows = new List<string[]>
        {
            new[] { "Metric", "Value", "Unit" },
            new[] { "Period start", report.Period.From, string.Empty },
            new[] { "Period end", report.Period.To, string.Empty },
            new[] { "Total approved hours", FormatNumber(report.TotalHours), "hours" },
            new[] { "Substitution-weighted hours", FormatNumber(report.WeightedHours), "hours" },
            new[] { "Formal care hourly rate", FormatNumber(report.Roi.HourlyRateChf), "CHF" },
            new[] { "Formal care offset", FormatNumber(report.Roi.FormalCareOffsetChf), "CHF" },
            new[] { "Prevention value (2x multiplier)", FormatNumber(report.Roi.PreventionValueChf), "CHF" },
            new[] { "Active members", report.ActiveMembers.ToString(CultureInfo.InvariantCulture), string.Empty },
            new[] { "Active relationships", report.ActiveRelationships.ToString(CultureInfo.InvariantCulture), string.Empty },
            new[] { "Care recipients (out of isolation)", report.RecipientCount.ToString(CultureInfo.InvariantCulture), string.Empty }
        };

        return new MunicipalRoiExport(filename, WithBom(ToCsv(rows)));
    }

    private async Task<MunicipalHourlyRate> ResolveHourlyRateAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == HourlyRateKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        if (decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) && parsed > 0)
        {
            return new MunicipalHourlyRate(parsed, "tenant_setting");
        }

        return new MunicipalHourlyRate(DefaultHourlyRateChf, "default");
    }

    private async Task<string> TenantSlugAsync(int tenantId, CancellationToken ct)
    {
        var tenant = await _db.Tenants
            .IgnoreQueryFilters()
            .Where(t => t.Id == tenantId)
            .Select(t => new
            {
                t.Slug,
                t.Name
            })
            .FirstOrDefaultAsync(ct);

        return SanitizeSlug(tenant?.Slug)
            ?? SanitizeSlug(tenant?.Name)
            ?? $"tenant-{tenantId.ToString(CultureInfo.InvariantCulture)}";
    }

    private static MunicipalRoiResolvedPeriod ResolvePeriod(MunicipalRoiFilters filters)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = TryParseDate(filters.From) ?? new DateOnly(today.Year, 1, 1);
        var to = TryParseDate(filters.To) ?? today;

        if (from > to)
        {
            from = to;
        }

        return new MunicipalRoiResolvedPeriod(from, to);
    }

    private static DateOnly? TryParseDate(string? raw)
    {
        return DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : null;
    }

    private static DateTime DateTimeUtc(DateOnly date)
    {
        return new DateTime(date.Year, date.Month, date.Day, 0, 0, 0, DateTimeKind.Utc);
    }

    private static string? SanitizeSlug(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var builder = new StringBuilder();
        foreach (var character in raw.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character) || character == '-' || character == '_')
            {
                builder.Append(character);
            }
            else if (char.IsWhiteSpace(character))
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length == 0 ? null : slug;
    }

    private static string ToCsv(IEnumerable<string[]> rows)
    {
        var builder = new StringBuilder();
        foreach (var row in rows)
        {
            builder.AppendJoin(',', row.Select(EscapeCsvCell)).Append('\n');
        }

        return builder.ToString();
    }

    private static string EscapeCsvCell(string value)
    {
        if (!value.Contains('"', StringComparison.Ordinal) &&
            !value.Contains(',', StringComparison.Ordinal) &&
            !value.Contains('\n', StringComparison.Ordinal) &&
            !value.Contains('\r', StringComparison.Ordinal))
        {
            return value;
        }

        return "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static byte[] WithBom(string content)
    {
        var body = Encoding.UTF8.GetBytes(content);
        var output = new byte[body.Length + 3];
        output[0] = 0xEF;
        output[1] = 0xBB;
        output[2] = 0xBF;
        Buffer.BlockCopy(body, 0, output, 3, body.Length);
        return output;
    }

    private static string FormatNumber(decimal value)
    {
        return value.ToString("0.00", CultureInfo.InvariantCulture);
    }

    private static decimal Round(decimal value)
    {
        return Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        if (bool.TryParse(raw, out var parsed))
        {
            return parsed;
        }

        return raw.Trim() switch
        {
            "1" => true,
            "0" => false,
            _ => null
        };
    }

    private sealed record MunicipalRoiResolvedPeriod(DateOnly From, DateOnly To);

    private sealed record MunicipalHourlyRate(decimal RateChf, string Source);
}

public sealed record MunicipalRoiFilters(string? From, string? To, int? SubRegionId)
{
    public int? ValidSubRegionId()
    {
        return SubRegionId is >= 1 ? SubRegionId : null;
    }
}

public sealed record MunicipalRoiExport(string Filename, byte[] FileContents);

public sealed record MunicipalRoiReport(
    [property: JsonPropertyName("total_hours")] decimal TotalHours,
    [property: JsonPropertyName("weighted_hours")] decimal WeightedHours,
    [property: JsonPropertyName("active_members")] int ActiveMembers,
    [property: JsonPropertyName("active_relationships")] int ActiveRelationships,
    [property: JsonPropertyName("recipient_count")] int RecipientCount,
    [property: JsonPropertyName("total_exchanges")] int TotalExchanges,
    [property: JsonPropertyName("roi")] MunicipalRoiValue Roi,
    [property: JsonPropertyName("trend")] MunicipalRoiTrend Trend,
    [property: JsonPropertyName("period")] MunicipalRoiPeriod Period,
    [property: JsonPropertyName("filters")] MunicipalRoiFilterState Filters,
    [property: JsonPropertyName("methodology")] MunicipalRoiMethodology Methodology);

public sealed record MunicipalRoiValue(
    [property: JsonPropertyName("hourly_rate_chf")] decimal HourlyRateChf,
    [property: JsonPropertyName("formal_care_offset_chf")] decimal FormalCareOffsetChf,
    [property: JsonPropertyName("prevention_value_chf")] decimal PreventionValueChf,
    [property: JsonPropertyName("social_isolation_prevented")] int SocialIsolationPrevented);

public sealed record MunicipalRoiTrend(
    [property: JsonPropertyName("hours_yoy_pct")] decimal? HoursYoyPct);

public sealed record MunicipalRoiPeriod(
    [property: JsonPropertyName("from")] string From,
    [property: JsonPropertyName("to")] string To);

public sealed record MunicipalRoiFilterState(
    [property: JsonPropertyName("sub_region_id")] int? SubRegionId);

public sealed record MunicipalRoiMethodology(
    [property: JsonPropertyName("hourly_rate_chf")] decimal HourlyRateChf,
    [property: JsonPropertyName("hourly_rate_source")] string HourlyRateSource,
    [property: JsonPropertyName("prevention_multiplier")] decimal PreventionMultiplier,
    [property: JsonPropertyName("substitution_applied")] bool SubstitutionApplied);
