// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringEmergencyAlertService
{
    private static readonly string[] ValidSeverities = ["info", "warning", "danger"];

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public CaringEmergencyAlertService(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
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

    public async Task<IReadOnlyList<CaringEmergencyAlertRow>> ActiveAlertsAsync(int tenantId, int userId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var alerts = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.IsActive && (a.ExpiresAt == null || a.ExpiresAt > now))
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);

        return alerts
            .Where(alert => AlertTargetsUser(alert.TargetUserIds, userId))
            .Select(Map)
            .ToArray();
    }

    public async Task<IReadOnlyList<CaringEmergencyAlertRow>> AllAlertsAsync(int tenantId, CancellationToken ct)
    {
        var alerts = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);

        return alerts.Select(Map).ToArray();
    }

    public async Task<CaringEmergencyAlertRow> CreateAsync(
        int tenantId,
        int createdBy,
        CaringEmergencyAlertRequest request,
        CancellationToken ct)
    {
        Validate(request);
        var targetUserIds = await ResolveTargetUserIdsAsync(tenantId, request.TargetUserIds, ct);
        var now = DateTime.UtcNow;
        var pushResult = new
        {
            status = "queued",
            channel = "fcm_high_priority",
            recipient_count = targetUserIds.Length,
            note = "FCM transport parity is tracked separately from the admin emergency-alert contract."
        };

        var alert = new CaringEmergencyAlert
        {
            TenantId = tenantId,
            Title = request.Title.Trim(),
            Body = request.Body.Trim(),
            Severity = NormalizeSeverity(request.Severity),
            GeographicScope = request.GeographicScope is null ? null : JsonSerializer.Serialize(request.GeographicScope),
            TargetUserIds = request.TargetUserIds is null ? null : JsonSerializer.Serialize(targetUserIds),
            ExpiresAt = request.ExpiresAt,
            IsActive = true,
            CreatedBy = createdBy,
            DismissedCount = 0,
            PushSent = true,
            PushResult = JsonSerializer.Serialize(pushResult),
            SentAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringEmergencyAlerts.Add(alert);
        await _db.SaveChangesAsync(ct);
        return Map(alert);
    }

    public async Task RecordDismissalAsync(int tenantId, int id, CancellationToken ct)
    {
        var alert = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == id, ct);
        if (alert is null)
        {
            return;
        }

        alert.DismissedCount += 1;
        alert.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    public async Task DeactivateAsync(int tenantId, int id, CancellationToken ct)
    {
        var alert = await _db.CaringEmergencyAlerts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.Id == id, ct);
        if (alert is null)
        {
            return;
        }

        alert.IsActive = false;
        alert.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<int[]> ResolveTargetUserIdsAsync(int tenantId, int[]? requested, CancellationToken ct)
    {
        if (requested is null || requested.Length == 0)
        {
            return [];
        }

        var requestedIds = requested.Where(id => id > 0).Distinct().ToArray();
        if (requestedIds.Length == 0)
        {
            return [];
        }

        return await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && u.IsActive && requestedIds.Contains(u.Id))
            .OrderBy(u => u.Id)
            .Select(u => u.Id)
            .ToArrayAsync(ct);
    }

    private static CaringEmergencyAlertRow Map(CaringEmergencyAlert alert)
    {
        return new CaringEmergencyAlertRow(
            alert.Id,
            alert.TenantId,
            alert.Title,
            alert.Body,
            alert.Severity,
            ParseJson(alert.GeographicScope),
            ParseIntArray(alert.TargetUserIds),
            alert.SentAt,
            alert.ExpiresAt,
            alert.IsActive,
            alert.CreatedBy,
            alert.DismissedCount,
            alert.PushSent,
            ParseJson(alert.PushResult),
            alert.CreatedAt,
            alert.UpdatedAt);
    }

    private static void Validate(CaringEmergencyAlertRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Body))
        {
            throw new CaringEmergencyAlertValidationException("Validation failed.");
        }

        if (!ValidSeverities.Contains(NormalizeSeverity(request.Severity), StringComparer.Ordinal))
        {
            throw new CaringEmergencyAlertValidationException("Validation failed.");
        }
    }

    private static string NormalizeSeverity(string? severity)
    {
        var normalized = (severity ?? "warning").Trim().ToLowerInvariant();
        return string.IsNullOrWhiteSpace(normalized) ? "warning" : normalized;
    }

    private static bool AlertTargetsUser(string? targetUserIds, int userId)
    {
        if (string.IsNullOrWhiteSpace(targetUserIds))
        {
            return true;
        }

        var ids = ParseIntArray(targetUserIds);
        return ids is null || ids.Contains(userId);
    }

    private static int[]? ParseIntArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<int[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

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
}

public sealed class CaringEmergencyAlertValidationException : Exception
{
    public CaringEmergencyAlertValidationException(string message) : base(message) { }
}

public sealed class CaringEmergencyAlertRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("body")] public string Body { get; set; } = string.Empty;
    [JsonPropertyName("severity")] public string? Severity { get; set; }
    [JsonPropertyName("geographic_scope")] public object? GeographicScope { get; set; }
    [JsonPropertyName("target_user_ids")] public int[]? TargetUserIds { get; set; }
    [JsonPropertyName("expires_at")] public DateTime? ExpiresAt { get; set; }
}

public sealed record CaringEmergencyAlertRow(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body")] string Body,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("geographic_scope")] object? GeographicScope,
    [property: JsonPropertyName("target_user_ids")] int[]? TargetUserIds,
    [property: JsonPropertyName("sent_at")] DateTime? SentAt,
    [property: JsonPropertyName("expires_at")] DateTime? ExpiresAt,
    [property: JsonPropertyName("is_active")] bool IsActive,
    [property: JsonPropertyName("created_by")] int? CreatedBy,
    [property: JsonPropertyName("dismissed_count")] int DismissedCount,
    [property: JsonPropertyName("push_sent")] bool PushSent,
    [property: JsonPropertyName("push_result")] object? PushResult,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt,
    [property: JsonPropertyName("updated_at")] DateTime? UpdatedAt);
