// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Federation;

public interface IFederationWebhookSubscriptionService
{
    Task EnsureLegacyMigratedAsync(int tenantId, CancellationToken ct = default);
    Task<List<FederationWebhookSubscription>> ListAsync(int tenantId, CancellationToken ct = default);
    Task<FederationWebhookSubscription?> GetAsync(int tenantId, int id, CancellationToken ct = default);
    Task<FederationWebhookSubscription> CreateAsync(int tenantId, long? createdBy, FederationWebhookSubscription input, CancellationToken ct = default);
    Task<FederationWebhookSubscription?> UpdateAsync(int tenantId, int id, FederationWebhookSubscription input, CancellationToken ct = default);
    Task<bool> DeleteAsync(int tenantId, int id, CancellationToken ct = default);
    Task<(bool success, string? reason)> DeliverAsync(int tenantId, int id, string payloadJson, string action, CancellationToken ct = default);
    Task<List<FederationWebhookDeliveryLog>> GetLogsAsync(int tenantId, int id, int limit = 50, CancellationToken ct = default);
    Task RecordDeliveryAsync(int tenantId, int subscriptionId, bool success, string? reason, string? action, string? payloadJson, CancellationToken ct = default);
}

public class FederationWebhookSubscriptionService : IFederationWebhookSubscriptionService
{
    public const string LegacyTenantConfigKey = "admin_explicit.federation.webhooks";

    private readonly NexusDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<FederationWebhookSubscriptionService> _logger;

    public FederationWebhookSubscriptionService(
        NexusDbContext db,
        IHttpClientFactory httpClientFactory,
        ILogger<FederationWebhookSubscriptionService> logger)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task EnsureLegacyMigratedAsync(int tenantId, CancellationToken ct = default)
    {
        var legacy = await _db.TenantConfigs
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == LegacyTenantConfigKey, ct);
        if (legacy == null || string.IsNullOrWhiteSpace(legacy.Value)) return;

        List<JsonElement> records;
        try
        {
            using var doc = JsonDocument.Parse(legacy.Value);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                legacy.Value = string.Empty;
                legacy.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                return;
            }
            records = doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
        }
        catch (JsonException)
        {
            legacy.Value = string.Empty;
            legacy.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return;
        }

        foreach (var record in records)
        {
            if (record.ValueKind != JsonValueKind.Object) continue;

            if (record.TryGetProperty("deleted_at", out var del) && del.ValueKind != JsonValueKind.Null) continue;

            JsonElement payload = default;
            record.TryGetProperty("payload", out payload);

            string? targetUrl = TryString(record, "target_url")
                ?? TryString(payload, "target_url")
                ?? TryString(payload, "url");
            string? name = TryString(record, "name") ?? TryString(payload, "name") ?? "Migrated webhook";
            string? events = TryString(payload, "event_types") ?? TryString(payload, "events");
            string? secret = TryString(payload, "secret");
            var directionStr = (TryString(payload, "direction") ?? "outbound").ToLowerInvariant();
            var statusStr = (TryString(record, "status") ?? TryString(payload, "status") ?? "active").ToLowerInvariant();

            if (string.IsNullOrWhiteSpace(targetUrl)) continue;

            var sub = new FederationWebhookSubscription
            {
                TenantId = tenantId,
                Name = name!,
                TargetUrl = targetUrl!,
                EventTypes = events ?? string.Empty,
                Secret = secret,
                Direction = directionStr == "inbound"
                    ? FederationWebhookDirection.Inbound
                    : FederationWebhookDirection.Outbound,
                Status = statusStr switch
                {
                    "paused" or "disabled" or "inactive" => FederationWebhookStatus.Paused,
                    "failed" or "error" => FederationWebhookStatus.Failed,
                    _ => FederationWebhookStatus.Active
                },
                CreatedAt = TryDate(record, "created_at") ?? DateTime.UtcNow,
                UpdatedAt = TryDate(record, "updated_at") ?? DateTime.UtcNow,
            };
            _db.FederationWebhookSubscriptions.Add(sub);
        }

        legacy.Value = string.Empty;
        legacy.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Migrated legacy federation webhooks for tenant {TenantId}: {Count} records", tenantId, records.Count);
    }

    public async Task<List<FederationWebhookSubscription>> ListAsync(int tenantId, CancellationToken ct = default)
    {
        await EnsureLegacyMigratedAsync(tenantId, ct);
        return await _db.FederationWebhookSubscriptions
            .Where(s => s.TenantId == tenantId)
            .OrderBy(s => s.Id)
            .ToListAsync(ct);
    }

    public async Task<FederationWebhookSubscription?> GetAsync(int tenantId, int id, CancellationToken ct = default)
    {
        return await _db.FederationWebhookSubscriptions
            .Where(s => s.TenantId == tenantId && s.Id == id)
            .FirstOrDefaultAsync(ct);
    }

    public async Task<FederationWebhookSubscription> CreateAsync(int tenantId, long? createdBy, FederationWebhookSubscription input, CancellationToken ct = default)
    {
        var sub = new FederationWebhookSubscription
        {
            TenantId = tenantId,
            Name = input.Name ?? string.Empty,
            TargetUrl = input.TargetUrl ?? string.Empty,
            EventTypes = input.EventTypes ?? string.Empty,
            Direction = input.Direction,
            Status = input.Status,
            Secret = input.Secret,
            CreatedBy = createdBy,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        _db.FederationWebhookSubscriptions.Add(sub);
        await _db.SaveChangesAsync(ct);
        return sub;
    }

    public async Task<FederationWebhookSubscription?> UpdateAsync(int tenantId, int id, FederationWebhookSubscription input, CancellationToken ct = default)
    {
        var existing = await _db.FederationWebhookSubscriptions
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == id, ct);
        if (existing == null) return null;
        if (!string.IsNullOrWhiteSpace(input.Name)) existing.Name = input.Name;
        if (!string.IsNullOrWhiteSpace(input.TargetUrl)) existing.TargetUrl = input.TargetUrl;
        if (input.EventTypes != null) existing.EventTypes = input.EventTypes;
        existing.Direction = input.Direction;
        existing.Status = input.Status;
        if (input.Secret != null) existing.Secret = input.Secret;
        existing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<bool> DeleteAsync(int tenantId, int id, CancellationToken ct = default)
    {
        var existing = await _db.FederationWebhookSubscriptions
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == id, ct);
        if (existing == null) return false;
        _db.FederationWebhookSubscriptions.Remove(existing);
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<(bool success, string? reason)> DeliverAsync(int tenantId, int id, string payloadJson, string action, CancellationToken ct = default)
    {
        var sub = await GetAsync(tenantId, id, ct);
        if (sub == null) return (false, "subscription_not_found");
        if (sub.Direction != FederationWebhookDirection.Outbound)
        {
            await RecordDeliveryAsync(tenantId, id, false, "inbound_webhook_not_deliverable", action, payloadJson, ct);
            return (false, "inbound_webhook_not_deliverable");
        }
        if (string.IsNullOrWhiteSpace(sub.TargetUrl))
        {
            await RecordDeliveryAsync(tenantId, id, false, "missing_target_url", action, payloadJson, ct);
            return (false, "missing_target_url");
        }

        try
        {
            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);
            using var content = new StringContent(payloadJson ?? "{}", Encoding.UTF8, "application/json");
            using var resp = await client.PostAsync(sub.TargetUrl, content, ct);
            var ok = resp.IsSuccessStatusCode;
            var reason = ok ? null : $"http_{(int)resp.StatusCode}";
            await RecordDeliveryAsync(tenantId, id, ok, reason, action, payloadJson, ct);
            return (ok, reason);
        }
        catch (Exception ex)
        {
            await RecordDeliveryAsync(tenantId, id, false, ex.GetType().Name + ": " + ex.Message, action, payloadJson, ct);
            return (false, ex.Message);
        }
    }

    public async Task<List<FederationWebhookDeliveryLog>> GetLogsAsync(int tenantId, int id, int limit = 50, CancellationToken ct = default)
    {
        if (limit < 1) limit = 1;
        if (limit > 500) limit = 500;
        return await _db.FederationWebhookDeliveryLogs
            .Where(l => l.TenantId == tenantId && l.SubscriptionId == id)
            .OrderByDescending(l => l.CreatedAt)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task RecordDeliveryAsync(int tenantId, int subscriptionId, bool success, string? reason, string? action, string? payloadJson, CancellationToken ct = default)
    {
        _db.FederationWebhookDeliveryLogs.Add(new FederationWebhookDeliveryLog
        {
            TenantId = tenantId,
            SubscriptionId = subscriptionId,
            Success = success,
            Reason = reason,
            Action = action,
            PayloadJson = payloadJson,
            CreatedAt = DateTime.UtcNow,
        });

        var sub = await _db.FederationWebhookSubscriptions
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == subscriptionId, ct);
        if (sub != null)
        {
            var now = DateTime.UtcNow;
            if (success)
            {
                sub.LastDeliveredAt = now;
                sub.RetryCount = 0;
                if (sub.Status == FederationWebhookStatus.Failed) sub.Status = FederationWebhookStatus.Active;
            }
            else
            {
                sub.LastFailureAt = now;
                sub.LastFailureReason = reason;
                sub.RetryCount += 1;
            }
            sub.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
    }

    private static string? TryString(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.ToString(),
            _ => null
        };
    }

    private static DateTime? TryDate(JsonElement el, string name)
    {
        var s = TryString(el, name);
        if (!DateTime.TryParse(s, null, System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out var dt))
            return null;
        return DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }
}
