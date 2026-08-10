// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Tenant-scoped Caring Community research partnership read model.
/// </summary>
public sealed class CaringResearchPartnershipService
{
    private readonly NexusDbContext _db;

    public CaringResearchPartnershipService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsCaringCommunityEnabledAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(value);
    }

    public async Task<IReadOnlyList<object>> ListPartnersAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringResearchPartners
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(partner => partner.TenantId == tenantId)
            .OrderByDescending(partner => partner.CreatedAt)
            .ThenByDescending(partner => partner.Id)
            .ToListAsync(ct);

        return rows.Select(PartnerRow).Cast<object>().ToArray();
    }

    public async Task<object> CreatePartnerAsync(
        int tenantId,
        int actorId,
        CaringResearchPartnerCreateInput input,
        CancellationToken ct)
    {
        var name = Truncate(input.Name.Trim(), 255);
        var institution = Truncate(input.Institution.Trim(), 255);
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(institution))
        {
            throw new CaringResearchValidationException("Research partner name and institution are required.");
        }

        var now = DateTime.UtcNow;
        var row = new CaringResearchPartner
        {
            TenantId = tenantId,
            Name = name,
            Institution = institution,
            ContactEmail = TruncateNullable(input.ContactEmail, 255),
            AgreementReference = TruncateNullable(input.AgreementReference, 255),
            MethodologyUrl = TruncateNullable(input.MethodologyUrl, 255),
            Status = input.Status,
            DataScope = JsonSerializer.Serialize(NormalizeDataScope(input.DataScope)),
            StartsAt = input.StartsAt,
            EndsAt = input.EndsAt,
            CreatedBy = actorId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringResearchPartners.Add(row);
        await _db.SaveChangesAsync(ct);

        return PartnerRow(row);
    }

    public async Task<IReadOnlyList<object>> ListDatasetExportsAsync(int tenantId, long? partnerId, CancellationToken ct)
    {
        var query =
            from export in _db.CaringResearchDatasetExports.IgnoreQueryFilters().AsNoTracking()
            where export.TenantId == tenantId
            join partner in _db.CaringResearchPartners.IgnoreQueryFilters().AsNoTracking()
                on new { export.TenantId, Id = export.PartnerId } equals new { partner.TenantId, partner.Id }
                into partners
            from partner in partners.DefaultIfEmpty()
            select new { export, partner };

        if (partnerId is not null)
        {
            query = query.Where(row => row.export.PartnerId == partnerId.Value);
        }

        var rows = await query
            .OrderByDescending(row => row.export.GeneratedAt)
            .ThenByDescending(row => row.export.Id)
            .ToListAsync(ct);

        return rows.Select(row => ExportRow(row.export, row.partner)).Cast<object>().ToArray();
    }

    public async Task<object> GenerateDatasetExportAsync(
        int tenantId,
        long partnerId,
        int actorId,
        DateOnly periodStart,
        DateOnly periodEnd,
        CancellationToken ct)
    {
        var partner = await _db.CaringResearchPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == partnerId, ct);

        if (partner is null)
        {
            throw new InvalidOperationException("Research partner not found.");
        }

        if (partner.Status != "active")
        {
            throw new InvalidOperationException("Research partner is not active.");
        }

        var dataset = await AggregateDatasetAsync(tenantId, periodStart, periodEnd, ct);
        var datasetJson = JsonSerializer.Serialize(dataset);
        var now = DateTime.UtcNow;
        var export = new CaringResearchDatasetExport
        {
            TenantId = tenantId,
            PartnerId = partnerId,
            RequestedBy = actorId,
            DatasetKey = "caring_community_aggregate_v1",
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            Status = "generated",
            RowCount = ((IReadOnlyCollection<object>)dataset.rows).Count,
            AnonymizationVersion = "aggregate-v1",
            DataHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(datasetJson))).ToLowerInvariant(),
            GeneratedAt = now,
            Metadata = JsonSerializer.Serialize(new
            {
                partner_name = partner.Name,
                methodology = "tenant-scoped aggregate metrics only; no direct identifiers, no row-level member records",
                suppression_threshold = 5
            }),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringResearchDatasetExports.Add(export);
        await _db.SaveChangesAsync(ct);

        return new
        {
            export = ExportRow(export, null),
            dataset
        };
    }

    public async Task<object> RevokeDatasetExportAsync(int tenantId, long exportId, int actorId, CancellationToken ct)
    {
        var row = await _db.CaringResearchDatasetExports
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(export => export.TenantId == tenantId && export.Id == exportId, ct);

        if (row is null)
        {
            throw new KeyNotFoundException("Research dataset export not found.");
        }

        var now = DateTime.UtcNow;
        var metadata = DecodeJsonObject(row.Metadata);
        metadata["revoked_by"] = actorId;
        metadata["revoked_at"] = now.ToString("O", System.Globalization.CultureInfo.InvariantCulture);

        row.Status = "revoked";
        row.Metadata = JsonSerializer.Serialize(metadata);
        row.UpdatedAt = now;

        await _db.SaveChangesAsync(ct);

        return ExportRow(row, null);
    }

    public async Task<object> GetConsentAsync(int tenantId, int userId, CancellationToken ct)
    {
        var row = await _db.CaringResearchConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(consent => consent.TenantId == tenantId && consent.UserId == userId, ct);

        return row is null
            ? new
            {
                tenant_id = tenantId,
                user_id = userId,
                consent_status = "opted_out",
                consent_version = "research-v1",
                consented_at = (DateTime?)null,
                revoked_at = (DateTime?)null,
                notes = (string?)null
            }
            : ConsentRow(row);
    }

    public async Task<object> RecordConsentAsync(
        int tenantId,
        int userId,
        string status,
        string? notes,
        CancellationToken ct)
    {
        if (status is not ("opted_in" or "opted_out" or "revoked"))
        {
            throw new CaringResearchValidationException("Research consent status must be opted_in, opted_out, or revoked.");
        }

        var now = DateTime.UtcNow;
        var row = await _db.CaringResearchConsents
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(consent => consent.TenantId == tenantId && consent.UserId == userId, ct);

        if (row is null)
        {
            row = new CaringResearchConsent
            {
                TenantId = tenantId,
                UserId = userId
            };
            _db.CaringResearchConsents.Add(row);
        }

        row.ConsentStatus = status;
        row.ConsentVersion = "research-v1";
        row.ConsentedAt = status == "opted_in" ? now : null;
        row.RevokedAt = status == "revoked" ? now : null;
        row.Notes = string.IsNullOrWhiteSpace(notes) ? null : notes;
        row.CreatedAt = now;
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);

        return await GetConsentAsync(tenantId, userId, ct);
    }

    private static object PartnerRow(CaringResearchPartner row)
    {
        return new
        {
            id = row.Id,
            tenant_id = row.TenantId,
            name = row.Name,
            institution = row.Institution,
            contact_email = row.ContactEmail,
            agreement_reference = row.AgreementReference,
            methodology_url = row.MethodologyUrl,
            status = row.Status,
            data_scope = DecodeJsonOrEmptyArray(row.DataScope),
            starts_at = row.StartsAt,
            ends_at = row.EndsAt,
            created_by = row.CreatedBy,
            created_at = row.CreatedAt,
            updated_at = row.UpdatedAt
        };
    }

    private static object ExportRow(CaringResearchDatasetExport row, CaringResearchPartner? partner)
    {
        return new
        {
            id = row.Id,
            tenant_id = row.TenantId,
            partner_id = row.PartnerId,
            requested_by = row.RequestedBy,
            dataset_key = row.DatasetKey,
            period_start = row.PeriodStart,
            period_end = row.PeriodEnd,
            status = row.Status,
            row_count = row.RowCount,
            anonymization_version = row.AnonymizationVersion,
            data_hash = row.DataHash,
            generated_at = row.GeneratedAt,
            metadata = DecodeJsonOrEmptyArray(row.Metadata),
            partner_name = partner?.Name,
            partner_institution = partner?.Institution
        };
    }

    private static object ConsentRow(CaringResearchConsent row)
    {
        return new
        {
            tenant_id = row.TenantId,
            user_id = row.UserId,
            consent_status = row.ConsentStatus,
            consent_version = row.ConsentVersion,
            consented_at = row.ConsentedAt,
            revoked_at = row.RevokedAt,
            notes = row.Notes
        };
    }

    private async Task<ResearchAggregateDataset> AggregateDatasetAsync(
        int tenantId,
        DateOnly periodStart,
        DateOnly periodEnd,
        CancellationToken ct)
    {
        var consentedUserIds = await _db.CaringResearchConsents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(consent => consent.TenantId == tenantId
                && consent.ConsentStatus == "opted_in"
                && consent.ConsentedAt != null
                && consent.RevokedAt == null)
            .Select(consent => consent.UserId)
            .ToListAsync(ct);

        if (consentedUserIds.Count == 0)
        {
            return ResearchAggregateDataset.Empty(periodStart, periodEnd);
        }

        var consented = consentedUserIds.ToHashSet();
        var logs = await _db.VolunteerLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId
                && log.Status == "approved"
                && log.DateLogged >= periodStart
                && log.DateLogged <= periodEnd)
            .ToListAsync(ct);

        var rows = logs
            .Where(log => consented.Contains(log.UserId))
            .GroupBy(log => $"{log.DateLogged.Year:D4}-{log.DateLogged.Month:D2}")
            .OrderBy(group => group.Key)
            .Select(group => new
            {
                period = group.Key,
                metric_family = "volunteering",
                activity_count = group.Count(),
                participant_count = group.Select(log => log.UserId).Distinct().Count(),
                approved_hours = decimal.Round(group.Sum(log => log.Hours), 2),
                suppressed = false
            })
            .Where(row => row.participant_count >= 5)
            .Cast<object>()
            .ToArray();

        return new ResearchAggregateDataset(
            "caring_community_aggregate_v1",
            new { start = periodStart, end = periodEnd },
            new
            {
                version = "aggregate-v1",
                direct_identifiers = false,
                row_level_member_records = false,
                suppression_threshold = 5,
                suppressed_rows_omitted = true
            },
            rows);
    }

    private static object DecodeJsonOrEmptyArray(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Array.Empty<object>();
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Array.Empty<object>();
        }
    }

    private static Dictionary<string, object?> DecodeJsonObject(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new Dictionary<string, object?>();
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return new Dictionary<string, object?>();
            }

            return document.RootElement.EnumerateObject()
                .ToDictionary(
                    property => property.Name,
                    property => JsonSerializer.Deserialize<object?>(property.Value.GetRawText()));
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>();
        }
    }

    private static object NormalizeDataScope(object? scope)
    {
        var datasets = ExtractDatasetList(scope);
        if (datasets.Count == 0)
        {
            datasets.Add("caring_community_aggregate_v1");
        }

        return new { datasets };
    }

    private static List<string> ExtractDatasetList(object? scope)
    {
        if (scope is JsonElement json)
        {
            if (json.ValueKind != JsonValueKind.Object
                || !json.TryGetProperty("datasets", out var datasets)
                || datasets.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return datasets.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!)
                .ToList();
        }

        if (scope is IDictionary<string, object?> dictionary
            && dictionary.TryGetValue("datasets", out var rawDatasets))
        {
            return ExtractDatasetValues(rawDatasets);
        }

        return [];
    }

    private static List<string> ExtractDatasetValues(object? rawDatasets)
    {
        if (rawDatasets is JsonElement json)
        {
            return json.ValueKind == JsonValueKind.Array
                ? json.EnumerateArray()
                    .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText())
                    .Where(item => !string.IsNullOrWhiteSpace(item))
                    .Select(item => item!)
                    .ToList()
                : [];
        }

        if (rawDatasets is IEnumerable<string> strings)
        {
            return strings
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item.Trim())
                .ToList();
        }

        if (rawDatasets is System.Collections.IEnumerable enumerable
            && rawDatasets is not string)
        {
            return enumerable
                .Cast<object?>()
                .Where(item => item is not null)
                .Select(item => Convert.ToString(item, System.Globalization.CultureInfo.InvariantCulture))
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!.Trim())
                .ToList();
        }

        return [];
    }

    private static string Truncate(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static string? TruncateNullable(string? value, int maxLength)
    {
        return string.IsNullOrWhiteSpace(value) ? null : Truncate(value.Trim(), maxLength);
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }
}

public sealed class CaringResearchValidationException : Exception
{
    public CaringResearchValidationException(string message) : base(message) { }
}

public sealed record CaringResearchPartnerCreateInput(
    string Name,
    string Institution,
    string? ContactEmail,
    string? AgreementReference,
    string? MethodologyUrl,
    string Status,
    object? DataScope,
    DateOnly? StartsAt,
    DateOnly? EndsAt);

public sealed record ResearchAggregateDataset(
    string dataset_key,
    object period,
    object anonymization,
    IReadOnlyList<object> rows)
{
    public static ResearchAggregateDataset Empty(DateOnly periodStart, DateOnly periodEnd)
    {
        return new ResearchAggregateDataset(
            "caring_community_aggregate_v1",
            new { start = periodStart, end = periodEnd },
            new
            {
                version = "aggregate-v1",
                direct_identifiers = false,
                row_level_member_records = false,
                suppression_threshold = 5,
                suppressed_rows_omitted = true
            },
            []);
    }
}
