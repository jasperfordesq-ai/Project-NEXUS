// Copyright © 2024–2026 Jasper Ford
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
/// Processes incoming HMAC-SHA256 signed webhooks from the PHP platform
/// and creates CRM notes, tasks, and tags based on volunteering events.
/// </summary>
public class VolunteerWebhookService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly AdminCrmService _crmService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<VolunteerWebhookService> _logger;

    public VolunteerWebhookService(
        NexusDbContext db,
        TenantContext tenantContext,
        AdminCrmService crmService,
        IConfiguration configuration,
        ILogger<VolunteerWebhookService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _crmService = crmService;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Validates the HMAC-SHA256 signature from the X-Nexus-Signature header.
    /// Uses constant-time comparison to prevent timing attacks.
    /// </summary>
    public bool ValidateSignature(string body, string? signature)
    {
        if (string.IsNullOrEmpty(signature))
            return false;

        var secret = _configuration["Webhooks:SharedSecret"];
        if (string.IsNullOrEmpty(secret))
        {
            _logger.LogError("Webhooks:SharedSecret is not configured");
            return false;
        }

        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var keyBytes = Encoding.UTF8.GetBytes(secret);

        using var hmac = new HMACSHA256(keyBytes);
        var computedHash = hmac.ComputeHash(bodyBytes);
        var computedSignature = Convert.ToHexString(computedHash).ToLowerInvariant();

        var signatureBytes = Encoding.UTF8.GetBytes(computedSignature);
        var providedBytes = Encoding.UTF8.GetBytes(signature.ToLowerInvariant());

        if (signatureBytes.Length != providedBytes.Length)
            return false;

        return CryptographicOperations.FixedTimeEquals(signatureBytes, providedBytes);
    }

    /// <summary>
    /// Processes a webhook event envelope and dispatches to the appropriate handler.
    /// Logs every event to the WebhookEvent table for audit.
    /// </summary>
    /// <param name="externalEventId">
    /// Sender's event id (e.g. PHP <c>X-Nexus-Webhook-Id</c>) used for
    /// idempotent dedup. If a prior delivery with the same
    /// (TenantId, Provider, ExternalEventId) was already processed, this
    /// returns success without re-dispatching the side effects (CRM
    /// notes / tasks / tags).
    /// </param>
    public async Task<(bool Success, string? Error)> ProcessEventAsync(string eventType, JsonElement payload, string? externalEventId = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var systemAdminId = _configuration.GetValue("Webhooks:SystemAdminId", 1);
        const string provider = "php-platform";

        // Idempotency check (HIGH audit fix): if the sender stamps an event id
        // and we've already processed it for this tenant + provider, treat as
        // a duplicate delivery and return success without re-running CRM side
        // effects.
        if (!string.IsNullOrWhiteSpace(externalEventId))
        {
            var existing = await _db.Set<WebhookEvent>()
                .IgnoreQueryFilters()
                .Where(w => w.TenantId == tenantId
                    && w.Provider == provider
                    && w.ExternalEventId == externalEventId)
                .Select(w => new { w.Id, w.Status })
                .FirstOrDefaultAsync();
            if (existing != null)
            {
                _logger.LogInformation(
                    "Duplicate webhook delivery for tenant {TenantId} event {EventType} external id {ExternalId} (prior row {Id}, status {Status}) — returning idempotent success",
                    tenantId, eventType, externalEventId, existing.Id, existing.Status);
                return (true, null);
            }
        }

        var webhookEvent = new WebhookEvent
        {
            TenantId = tenantId,
            EventType = eventType,
            Source = provider,
            Provider = provider,
            ExternalEventId = externalEventId,
            PayloadJson = payload.GetRawText(),
            Status = "processed",
            ReceivedAt = DateTime.UtcNow
        };

        try
        {
            await DispatchEventAsync(eventType, payload, tenantId, systemAdminId);

            _db.Set<WebhookEvent>().Add(webhookEvent);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                // Concurrent duplicate delivery won the race — the other writer
                // already inserted the dedup row. Treat as idempotent success.
                _logger.LogInformation(
                    "Concurrent duplicate webhook delivery detected for tenant {TenantId} external id {ExternalId}",
                    tenantId, externalEventId);
                return (true, null);
            }

            _logger.LogInformation(
                "Webhook event {EventType} processed successfully for tenant {TenantId}",
                eventType, tenantId);

            return (true, null);
        }
        catch (Exception ex)
        {
            webhookEvent.Status = "failed";
            webhookEvent.ErrorMessage = ex.Message;

            _db.Set<WebhookEvent>().Add(webhookEvent);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException uex) when (IsUniqueViolation(uex))
            {
                // Same dedup race as above, but on the failed-path audit write.
            }

            _logger.LogError(ex,
                "Failed to process webhook event {EventType} for tenant {TenantId}",
                eventType, tenantId);

            return (false, ex.Message);
        }
    }

    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        var inner = ex.InnerException;
        while (inner != null)
        {
            if (inner.GetType().Name == "PostgresException")
            {
                var sqlStateProp = inner.GetType().GetProperty("SqlState");
                var sqlState = sqlStateProp?.GetValue(inner) as string;
                if (sqlState == "23505") return true;
            }
            inner = inner.InnerException;
        }
        return false;
    }

    private async Task DispatchEventAsync(string eventType, JsonElement payload, int tenantId, int systemAdminId)
    {
        var userId = payload.TryGetProperty("user_id", out var uid) ? uid.GetInt32() : 0;
        if (userId == 0)
        {
            _logger.LogWarning("Webhook event {EventType} missing user_id in payload", eventType);
            return;
        }

        switch (eventType)
        {
            case "volunteer.applied":
                await HandleVolunteerAppliedAsync(userId, systemAdminId, tenantId, payload);
                break;

            case "volunteer.approved":
                await HandleSimpleNoteAsync(userId, systemAdminId, "volunteering", false,
                    BuildNoteContent("Volunteer application approved", payload));
                break;

            case "volunteer.declined":
                await HandleSimpleNoteAsync(userId, systemAdminId, "volunteering", true,
                    BuildNoteContent("Volunteer application declined", payload));
                break;

            case "shift.completed":
                await HandleSimpleNoteAsync(userId, systemAdminId, "volunteering", false,
                    BuildNoteContent("Shift completed", payload));
                break;

            case "shift.noshow":
                await HandleShiftNoshowAsync(userId, systemAdminId, tenantId, payload);
                break;

            case "hours.verified":
                await HandleSimpleNoteAsync(userId, systemAdminId, "volunteering", false,
                    BuildNoteContent("Volunteer hours verified", payload));
                break;

            case "expense.submitted":
                await HandleSimpleNoteAsync(userId, systemAdminId, "expenses", false,
                    BuildNoteContent("Expense submitted", payload));
                break;

            case "expense.approved":
                await HandleSimpleNoteAsync(userId, systemAdminId, "expenses", false,
                    BuildNoteContent("Expense approved", payload));
                break;

            case "safeguarding.incident":
                await HandleSafeguardingIncidentAsync(userId, systemAdminId, tenantId, payload);
                break;

            case "training.expired":
                await HandleTrainingExpiredAsync(userId, systemAdminId, tenantId, payload);
                break;

            case "credential.expiring":
                await HandleCredentialExpiringAsync(userId, systemAdminId, tenantId, payload);
                break;

            default:
                _logger.LogWarning("Unrecognised webhook event type: {EventType}", eventType);
                break;
        }
    }

    private async Task HandleVolunteerAppliedAsync(int userId, int adminId, int tenantId, JsonElement payload)
    {
        await _crmService.AddNoteAsync(userId, adminId,
            BuildNoteContent("Volunteer application received", payload), "volunteering");

        await _crmService.AddTagToUserAsync(tenantId, userId, adminId, "volunteer");
    }

    private async Task HandleShiftNoshowAsync(int userId, int adminId, int tenantId, JsonElement payload)
    {
        await _crmService.AddNoteAsync(userId, adminId,
            BuildNoteContent("Volunteer no-show for shift", payload), "volunteering", isFlagged: true);

        await _crmService.CreateCrmTaskAsync(
            tenantId, userId, adminId,
            "Follow up: volunteer no-show",
            BuildNoteContent("Volunteer did not show up for scheduled shift", payload),
            "medium", DateTime.UtcNow.AddDays(3));
    }

    private async Task HandleSafeguardingIncidentAsync(int userId, int adminId, int tenantId, JsonElement payload)
    {
        await _crmService.AddNoteAsync(userId, adminId,
            BuildNoteContent("Safeguarding incident reported", payload), "safeguarding", isFlagged: true);

        await _crmService.CreateCrmTaskAsync(
            tenantId, userId, adminId,
            "Review safeguarding incident",
            BuildNoteContent("Safeguarding incident requires review", payload),
            "high", DateTime.UtcNow.AddDays(1));
    }

    private async Task HandleTrainingExpiredAsync(int userId, int adminId, int tenantId, JsonElement payload)
    {
        await _crmService.CreateCrmTaskAsync(
            tenantId, userId, adminId,
            "Follow up: expired training",
            BuildNoteContent("Training certification has expired", payload),
            "medium", DateTime.UtcNow.AddDays(7));
    }

    private async Task HandleCredentialExpiringAsync(int userId, int adminId, int tenantId, JsonElement payload)
    {
        await _crmService.CreateCrmTaskAsync(
            tenantId, userId, adminId,
            "Follow up: credential expiring soon",
            BuildNoteContent("Credential is approaching expiry", payload),
            "medium", DateTime.UtcNow.AddDays(14));
    }

    private async Task HandleSimpleNoteAsync(int userId, int adminId, string category, bool flagged, string content)
    {
        await _crmService.AddNoteAsync(userId, adminId, content, category, isFlagged: flagged);
    }

    /// <summary>
    /// Builds a human-readable note from the event payload, including
    /// any details or description fields from the webhook data.
    /// </summary>
    private static string BuildNoteContent(string prefix, JsonElement payload)
    {
        var sb = new StringBuilder();
        sb.Append($"[Webhook] {prefix}");

        if (payload.TryGetProperty("opportunity_title", out var title))
            sb.Append($" - {title.GetString()}");

        if (payload.TryGetProperty("shift_date", out var shiftDate))
            sb.Append($" on {shiftDate.GetString()}");

        if (payload.TryGetProperty("hours", out var hours))
            sb.Append($" ({hours} hours)");

        if (payload.TryGetProperty("amount", out var amount))
            sb.Append($" - amount: {amount}");

        if (payload.TryGetProperty("description", out var desc))
            sb.Append($". Details: {desc.GetString()}");

        return sb.ToString();
    }
}
