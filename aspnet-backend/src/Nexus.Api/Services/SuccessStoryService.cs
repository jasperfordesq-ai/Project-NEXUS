// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class SuccessStoryService
{
    public const string SettingKey = "caring.success_stories";

    private static readonly string[] MetricSources = ["pilot_scoreboard", "municipal_roi", "manual"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;

    public SuccessStoryService(NexusDbContext db, TenantContext tenantContext)
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

    public async Task<SuccessStoryEnvelope> ListPublishedAsync(int tenantId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        return envelope with
        {
            Items = envelope.Items
                .Where(story => story.IsPublished)
                .ToArray()
        };
    }

    public Task<SuccessStoryEnvelope> ListAdminAsync(int tenantId, CancellationToken ct)
    {
        return LoadEnvelopeAsync(tenantId, ct);
    }

    public async Task<SuccessStoryMutationResult> CreateAsync(
        int tenantId,
        SuccessStoryRequest request,
        CancellationToken ct)
    {
        var errors = Validate(request, isPartial: false);
        if (errors.Count > 0)
        {
            return new SuccessStoryMutationResult(Errors: errors);
        }

        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var story = MakeStory(request, IsoNow());
        items.Add(story);
        await SaveAsync(tenantId, items, ct);
        return new SuccessStoryMutationResult(Story: story);
    }

    public async Task<SuccessStoryMutationResult> UpdateAsync(
        int tenantId,
        string storyId,
        SuccessStoryRequest request,
        CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var index = items.FindIndex(story => string.Equals(story.Id, storyId, StringComparison.Ordinal));
        if (index < 0)
        {
            return new SuccessStoryMutationResult(NotFound: true);
        }

        var errors = Validate(request, isPartial: true);
        if (errors.Count > 0)
        {
            return new SuccessStoryMutationResult(Errors: errors);
        }

        var existing = items[index];
        var updated = existing with
        {
            Title = request.Title is null ? existing.Title : request.Title.Trim(),
            Narrative = request.Narrative is null ? existing.Narrative : request.Narrative.Trim(),
            MetricSource = request.MetricSource is null ? existing.MetricSource : request.MetricSource,
            MetricKey = request.MetricKey is null ? existing.MetricKey : EmptyToNull(request.MetricKey),
            BeforeValue = request.BeforeValue ?? existing.BeforeValue,
            AfterValue = request.AfterValue ?? existing.AfterValue,
            Unit = request.Unit is null ? existing.Unit : request.Unit.Trim(),
            Audience = request.Audience is null ? existing.Audience : request.Audience.Trim(),
            SubRegionId = request.SubRegionId ?? existing.SubRegionId,
            MethodCaveat = request.MethodCaveat is null ? existing.MethodCaveat : request.MethodCaveat.Trim(),
            EvidenceSource = request.EvidenceSource is null ? existing.EvidenceSource : request.EvidenceSource.Trim(),
            IsDemo = request.IsDemo ?? existing.IsDemo,
            IsPublished = request.IsPublished ?? existing.IsPublished,
            UpdatedAt = IsoNow()
        };

        items[index] = updated;
        await SaveAsync(tenantId, items, ct);
        return new SuccessStoryMutationResult(Story: updated);
    }

    public async Task<SuccessStoryDeleteResult> DeleteAsync(int tenantId, string storyId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var items = envelope.Items.ToList();
        var index = items.FindIndex(story => string.Equals(story.Id, storyId, StringComparison.Ordinal));
        if (index < 0)
        {
            return new SuccessStoryDeleteResult(NotFound: true);
        }

        items.RemoveAt(index);
        await SaveAsync(tenantId, items, ct);
        return new SuccessStoryDeleteResult(Ok: true);
    }

    public async Task<SuccessStorySeedResult> SeedDemoAsync(int tenantId, CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        if (envelope.Items.Count > 0)
        {
            return new SuccessStorySeedResult(AlreadySeeded: true);
        }

        var now = IsoNow();
        var items = new[]
        {
            MakeStory(new SuccessStoryRequest
            {
                Title = "Neighbour check-ins reached isolated residents",
                Narrative = "Volunteer-led calls and visits helped residents get practical support before problems escalated.",
                MetricSource = "manual",
                BeforeValue = 14,
                AfterValue = 48,
                Unit = "residents",
                Audience = "municipality",
                MethodCaveat = "Demo metric based on coordinator sampling.",
                EvidenceSource = "Caring Community pilot notes",
                IsDemo = true,
                IsPublished = true
            }, now),
            MakeStory(new SuccessStoryRequest
            {
                Title = "Care handoffs became faster",
                Narrative = "Shared visibility across community coordinators reduced the time needed to connect residents with local help.",
                MetricSource = "manual",
                BeforeValue = 5,
                AfterValue = 2,
                Unit = "days",
                Audience = "care_coordinators",
                MethodCaveat = "Demo metric based on average handoff time.",
                EvidenceSource = "Municipal workshop synthesis",
                IsDemo = true,
                IsPublished = true
            }, now),
            MakeStory(new SuccessStoryRequest
            {
                Title = "Volunteer hours turned into municipal evidence",
                Narrative = "Coordinators could present aggregated volunteer activity with caveats and source notes attached.",
                MetricSource = "manual",
                BeforeValue = 0,
                AfterValue = 120,
                Unit = "hours",
                Audience = "municipality",
                MethodCaveat = "Demo metric intended for parity testing and onboarding.",
                EvidenceSource = "Pilot scoreboard export",
                IsDemo = true,
                IsPublished = true
            }, now)
        };

        var saved = await SaveAsync(tenantId, items, ct);
        return new SuccessStorySeedResult(saved.Items, saved.LastUpdatedAt);
    }

    public async Task<SuccessStoryRefreshResult> RefreshLiveMetricAsync(
        int tenantId,
        string storyId,
        CancellationToken ct)
    {
        var envelope = await LoadEnvelopeAsync(tenantId, ct);
        var story = envelope.Items.FirstOrDefault(item => string.Equals(item.Id, storyId, StringComparison.Ordinal));
        if (story is null)
        {
            return new SuccessStoryRefreshResult(NotFound: true);
        }

        if (string.Equals(story.MetricSource, "manual", StringComparison.Ordinal)
            || string.IsNullOrWhiteSpace(story.MetricKey))
        {
            return new SuccessStoryRefreshResult(
                ErrorCode: "MANUAL_METRIC",
                ErrorMessage: "Manual success-story metrics cannot be refreshed from live data.");
        }

        return new SuccessStoryRefreshResult(
            ErrorCode: "METRIC_UNAVAILABLE",
            ErrorMessage: "No live metric adapter is available for this success story.");
    }

    private async Task<SuccessStoryEnvelope> LoadEnvelopeAsync(int tenantId, CancellationToken ct)
    {
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (row is null || string.IsNullOrWhiteSpace(row.Value))
        {
            return new SuccessStoryEnvelope([], null);
        }

        try
        {
            var decoded = JsonSerializer.Deserialize<StoredSuccessStoryEnvelope>(row.Value, JsonOptions);
            if (decoded is null)
            {
                return new SuccessStoryEnvelope([], row.UpdatedAt?.ToUniversalTime().ToString("O"));
            }

            var items = decoded.Items
                .Where(story => !string.IsNullOrWhiteSpace(story.Id))
                .Select(NormalizeStory)
                .ToArray();

            var updatedAt = string.IsNullOrWhiteSpace(decoded.UpdatedAt)
                ? row.UpdatedAt?.ToUniversalTime().ToString("O")
                : decoded.UpdatedAt;

            return new SuccessStoryEnvelope(items, updatedAt);
        }
        catch (JsonException)
        {
            return new SuccessStoryEnvelope([], row.UpdatedAt?.ToUniversalTime().ToString("O"));
        }
    }

    private async Task<SuccessStoryEnvelope> SaveAsync(
        int tenantId,
        IReadOnlyList<SuccessStoryRow> items,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var updatedAt = now.ToString("O");
        var envelope = new StoredSuccessStoryEnvelope
        {
            Items = items.Select(NormalizeStory).ToList(),
            UpdatedAt = updatedAt
        };
        var payload = JsonSerializer.Serialize(envelope, JsonOptions);

        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == SettingKey, ct);

        if (existing is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = SettingKey,
                Value = payload,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            existing.Value = payload;
            existing.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
        return new SuccessStoryEnvelope(envelope.Items, updatedAt);
    }

    private static SuccessStoryRow MakeStory(SuccessStoryRequest request, string now)
    {
        return new SuccessStoryRow(
            Id: GenerateId(),
            Title: request.Title!.Trim(),
            Narrative: request.Narrative!.Trim(),
            MetricSource: string.IsNullOrWhiteSpace(request.MetricSource) ? "manual" : request.MetricSource,
            MetricKey: EmptyToNull(request.MetricKey),
            BeforeValue: request.BeforeValue,
            AfterValue: request.AfterValue,
            Unit: string.IsNullOrWhiteSpace(request.Unit) ? string.Empty : request.Unit.Trim(),
            Audience: string.IsNullOrWhiteSpace(request.Audience) ? "all_residents" : request.Audience.Trim(),
            SubRegionId: request.SubRegionId,
            MethodCaveat: request.MethodCaveat!.Trim(),
            EvidenceSource: request.EvidenceSource!.Trim(),
            IsDemo: request.IsDemo ?? true,
            IsPublished: request.IsPublished ?? false,
            CreatedAt: now,
            UpdatedAt: now);
    }

    private static SuccessStoryRow NormalizeStory(SuccessStoryRow story)
    {
        return story with
        {
            Title = story.Title ?? string.Empty,
            Narrative = story.Narrative ?? string.Empty,
            MetricSource = string.IsNullOrWhiteSpace(story.MetricSource) ? "manual" : story.MetricSource,
            MetricKey = EmptyToNull(story.MetricKey),
            Unit = story.Unit ?? string.Empty,
            Audience = string.IsNullOrWhiteSpace(story.Audience) ? "all_residents" : story.Audience,
            MethodCaveat = story.MethodCaveat ?? string.Empty,
            EvidenceSource = story.EvidenceSource ?? string.Empty,
            CreatedAt = story.CreatedAt ?? string.Empty,
            UpdatedAt = story.UpdatedAt ?? story.CreatedAt ?? string.Empty
        };
    }

    private static IReadOnlyList<SuccessStoryValidationError> Validate(SuccessStoryRequest request, bool isPartial)
    {
        var errors = new List<SuccessStoryValidationError>();

        ValidateRequiredString(errors, request.Title, "title", "Title is required.", isPartial, maxLength: 200);
        ValidateRequiredString(errors, request.Narrative, "narrative", "Narrative is required.", isPartial);
        ValidateRequiredString(errors, request.MethodCaveat, "method_caveat", "Method caveat is required.", isPartial);
        ValidateRequiredString(errors, request.EvidenceSource, "evidence_source", "Evidence source is required.", isPartial, maxLength: 255);

        if (request.MetricSource is not null && !MetricSources.Contains(request.MetricSource, StringComparer.Ordinal))
        {
            errors.Add(new SuccessStoryValidationError(
                "VALIDATION_ENUM",
                "Metric source is invalid.",
                "metric_source"));
        }

        if (request.Unit is not null && request.Unit.Trim().Length > 30)
        {
            errors.Add(new SuccessStoryValidationError(
                "VALIDATION_LENGTH",
                "Unit is too long.",
                "unit"));
        }

        if (request.Audience is not null && request.Audience.Trim().Length > 50)
        {
            errors.Add(new SuccessStoryValidationError(
                "VALIDATION_LENGTH",
                "Audience is too long.",
                "audience"));
        }

        return errors;
    }

    private static void ValidateRequiredString(
        List<SuccessStoryValidationError> errors,
        string? value,
        string field,
        string message,
        bool isPartial,
        int? maxLength = null)
    {
        if (!isPartial || value is not null)
        {
            var trimmed = value?.Trim() ?? string.Empty;
            if (trimmed.Length == 0)
            {
                errors.Add(new SuccessStoryValidationError("VALIDATION_REQUIRED", message, field));
                return;
            }

            if (maxLength.HasValue && trimmed.Length > maxLength.Value)
            {
                errors.Add(new SuccessStoryValidationError("VALIDATION_LENGTH", $"{field} is too long.", field));
            }
        }
    }

    private static string GenerateId()
    {
        return "story_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
    }

    private static string? EmptyToNull(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static string IsoNow() => DateTimeOffset.UtcNow.ToString("O");

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
}

public sealed class SuccessStoryRequest
{
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("narrative")] public string? Narrative { get; set; }
    [JsonPropertyName("metric_source")] public string? MetricSource { get; set; }
    [JsonPropertyName("metric_key")] public string? MetricKey { get; set; }
    [JsonPropertyName("before_value")] public double? BeforeValue { get; set; }
    [JsonPropertyName("after_value")] public double? AfterValue { get; set; }
    [JsonPropertyName("unit")] public string? Unit { get; set; }
    [JsonPropertyName("audience")] public string? Audience { get; set; }
    [JsonPropertyName("sub_region_id")] public int? SubRegionId { get; set; }
    [JsonPropertyName("method_caveat")] public string? MethodCaveat { get; set; }
    [JsonPropertyName("evidence_source")] public string? EvidenceSource { get; set; }
    [JsonPropertyName("is_demo")] public bool? IsDemo { get; set; }
    [JsonPropertyName("is_published")] public bool? IsPublished { get; set; }
}

public sealed record SuccessStoryEnvelope(
    [property: JsonPropertyName("items")] IReadOnlyList<SuccessStoryRow> Items,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt);

public sealed record SuccessStoryRow(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("narrative")] string Narrative,
    [property: JsonPropertyName("metric_source")] string MetricSource,
    [property: JsonPropertyName("metric_key")] string? MetricKey,
    [property: JsonPropertyName("before_value")] double? BeforeValue,
    [property: JsonPropertyName("after_value")] double? AfterValue,
    [property: JsonPropertyName("unit")] string Unit,
    [property: JsonPropertyName("audience")] string Audience,
    [property: JsonPropertyName("sub_region_id")] int? SubRegionId,
    [property: JsonPropertyName("method_caveat")] string MethodCaveat,
    [property: JsonPropertyName("evidence_source")] string EvidenceSource,
    [property: JsonPropertyName("is_demo")] bool IsDemo,
    [property: JsonPropertyName("is_published")] bool IsPublished,
    [property: JsonPropertyName("created_at")] string? CreatedAt,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record SuccessStoryValidationError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("field")] string Field);

public sealed record SuccessStoryMutationResult(
    SuccessStoryRow? Story = null,
    IReadOnlyList<SuccessStoryValidationError>? Errors = null,
    bool NotFound = false);

public sealed record SuccessStorySeedResult(
    IReadOnlyList<SuccessStoryRow>? Items = null,
    string? LastUpdatedAt = null,
    bool AlreadySeeded = false);

public sealed record SuccessStoryDeleteResult(bool Ok = false, bool NotFound = false);

public sealed record SuccessStoryRefreshResult(
    SuccessStoryRow? Story = null,
    string? ErrorCode = null,
    string? ErrorMessage = null,
    bool NotFound = false);

internal sealed class StoredSuccessStoryEnvelope
{
    [JsonPropertyName("items")] public List<SuccessStoryRow> Items { get; set; } = [];
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; set; }
}
