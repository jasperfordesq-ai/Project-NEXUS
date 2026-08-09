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

public sealed class AdminEmailDeliverabilityService
{
    public const string SuppressionKeyPrefix = "email_deliverability.suppression.";
    public const string QueueKeyPrefix = "email_deliverability.queue.";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;

    public AdminEmailDeliverabilityService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<EmailDeliverabilitySummaryDto> SummaryAsync(int tenantId, int days, CancellationToken ct)
    {
        var windowDays = Math.Clamp(days <= 0 ? 7 : days, 1, 90);
        var since = DateTime.UtcNow.AddDays(-windowDays);
        var logs = await TenantEmailLogs(tenantId)
            .Where(log => log.CreatedAt >= since)
            .ToListAsync(ct);

        var byStatus = logs
            .GroupBy(log => StatusString(log.Status))
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        var sent = byStatus.GetValueOrDefault("sent");
        var delivered = byStatus.GetValueOrDefault("delivered");
        var bounced = byStatus.GetValueOrDefault("bounced");
        var failed = byStatus.GetValueOrDefault("failed");
        var suppressed = byStatus.GetValueOrDefault("suppressed");
        var total = sent + delivered + bounced + failed + suppressed + byStatus.GetValueOrDefault("pending");

        return new EmailDeliverabilitySummaryDto(
            windowDays,
            total,
            byStatus,
            total > 0 ? Math.Round(delivered / (double)total * 100, 1) : null,
            total > 0 ? Math.Round((sent + delivered) / (double)total * 100, 1) : null,
            sent,
            total > 0 ? Math.Round(bounced / (double)total * 100, 1) : null,
            [],
            TriggerAudit(windowDays * 24, logs));
    }

    public EmailPushSummaryDto PushSummary(int days)
    {
        return new EmailPushSummaryDto(
            false,
            Math.Clamp(days <= 0 ? 7 : days, 1, 90),
            0,
            0,
            0,
            0,
            null,
            0,
            0,
            0,
            new Dictionary<string, int>(),
            []);
    }

    public async Task<EmailTriggerAuditDto> TriggerAuditAsync(int tenantId, int hours, CancellationToken ct)
    {
        var windowHours = Math.Clamp(hours <= 0 ? 24 : hours, 1, 168);
        var since = DateTime.UtcNow.AddHours(-windowHours);
        var logs = await TenantEmailLogs(tenantId)
            .Where(log => log.CreatedAt >= since)
            .ToListAsync(ct);

        return TriggerAudit(windowHours, logs);
    }

    public async Task<PagedEmailLogDto> LogsAsync(
        int tenantId,
        int limit,
        int offset,
        int? userId,
        string? email,
        string? status,
        string? category,
        string? since,
        string? until,
        CancellationToken ct)
    {
        var rows = await TenantEmailLogs(tenantId).ToListAsync(ct);
        var filtered = rows.AsEnumerable();

        if (userId.HasValue && userId.Value > 0)
        {
            filtered = filtered.Where(log => log.UserId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(email))
        {
            filtered = filtered.Where(log =>
                log.ToEmail.Contains(email.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            filtered = filtered.Where(log =>
                string.Equals(StatusString(log.Status), status.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            filtered = filtered.Where(log =>
                log.TemplateKey.Contains(category.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (DateTime.TryParse(since, out var sinceDate))
        {
            filtered = filtered.Where(log => log.CreatedAt >= sinceDate);
        }

        if (DateTime.TryParse(until, out var untilDate))
        {
            filtered = filtered.Where(log => log.CreatedAt <= untilDate);
        }

        var limited = Math.Clamp(limit <= 0 ? 50 : limit, 1, 200);
        var skipped = Math.Max(0, offset);
        var materialized = filtered
            .OrderByDescending(log => log.Id)
            .ThenByDescending(log => log.CreatedAt)
            .ToArray();

        return new PagedEmailLogDto(
            materialized.Skip(skipped).Take(limited).Select(ToLogDto).ToArray(),
            materialized.Length,
            limited,
            skipped);
    }

    public async Task<EmailQueueDiagnosticsDto> QueuesAsync(
        int tenantId,
        int limit,
        string? status,
        string? source,
        CancellationToken ct)
    {
        var rows = await LoadConfigRowsAsync<EmailQueueDiagnosticRow>(tenantId, QueueKeyPrefix, ct);
        var filtered = rows.Select(row => row.Value);

        if (!string.IsNullOrWhiteSpace(status))
        {
            filtered = filtered.Where(row =>
                string.Equals(row.Status, status.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(source))
        {
            filtered = filtered.Where(row =>
                string.Equals(row.Source, source.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        var limited = Math.Clamp(limit <= 0 ? 50 : limit, 1, 100);
        return new EmailQueueDiagnosticsDto(
            filtered
                .OrderByDescending(row => row.CreatedAt ?? DateTime.MinValue)
                .ThenByDescending(row => row.Id)
                .Take(limited)
                .ToArray(),
            QueueDiagnosticsSummary(rows.Select(row => row.Value)));
    }

    public async Task<PagedEmailSuppressionDto> SuppressionsAsync(
        int tenantId,
        int limit,
        int offset,
        string? email,
        string? reason,
        CancellationToken ct)
    {
        var rows = await LoadConfigRowsAsync<EmailSuppressionRecord>(tenantId, SuppressionKeyPrefix, ct);
        var filtered = rows.Select(row => row.Value);

        if (!string.IsNullOrWhiteSpace(email))
        {
            filtered = filtered.Where(row =>
                row.Email.Contains(email.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (!string.IsNullOrWhiteSpace(reason))
        {
            filtered = filtered.Where(row =>
                string.Equals(row.Reason, reason.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        var limited = Math.Clamp(limit <= 0 ? 50 : limit, 1, 200);
        var skipped = Math.Max(0, offset);
        var materialized = filtered
            .OrderByDescending(row => row.SuppressedAt)
            .ThenByDescending(row => row.Id)
            .ToArray();

        return new PagedEmailSuppressionDto(
            materialized.Skip(skipped).Take(limited).ToArray(),
            materialized.Length,
            limited,
            skipped);
    }

    public async Task<EmailSuppressionRecord> UpsertSuppressionAsync(
        EmailSuppressionRecord record,
        CancellationToken ct)
    {
        return await UpsertSuppressionAsync(record.TenantId ?? 42, record, ct);
    }

    public async Task<EmailSuppressionRecord> UpsertSuppressionAsync(
        int tenantId,
        EmailSuppressionRecord record,
        CancellationToken ct)
    {
        var id = record.Id > 0 ? record.Id : await NextIdAsync(tenantId, SuppressionKeyPrefix, ct);
        var normalized = record with
        {
            Id = id,
            TenantId = tenantId,
            Email = record.Email.Trim(),
            Reason = string.IsNullOrWhiteSpace(record.Reason) ? "bounce" : record.Reason.Trim(),
            SuppressedAt = record.SuppressedAt == default ? DateTime.UtcNow : record.SuppressedAt,
            CreatedAt = record.CreatedAt ?? DateTime.UtcNow
        };

        await UpsertConfigRowAsync(tenantId, SuppressionKeyPrefix, id, normalized, ct);
        return normalized;
    }

    public async Task<EmailSuppressionRecord> RemoveSuppressionAsync(int tenantId, int id, CancellationToken ct)
    {
        var row = await FindConfigRowAsync(tenantId, SuppressionKeyPrefix, id, ct)
            ?? throw new AdminEmailDeliverabilityNotFoundException("Suppression entry not found.");
        var suppression = Decode<EmailSuppressionRecord>(row.Value)
            ?? throw new AdminEmailDeliverabilityNotFoundException("Suppression entry not found.");

        _db.TenantConfigs.Remove(row);
        await _db.SaveChangesAsync(ct);
        return suppression;
    }

    public async Task<EmailQueueDiagnosticRow> UpsertQueueRowAsync(
        int tenantId,
        EmailQueueDiagnosticRow row,
        CancellationToken ct)
    {
        var id = row.Id > 0 ? row.Id : await NextIdAsync(tenantId, QueueKeyPrefix, ct);
        var normalized = row with
        {
            Id = id,
            TenantId = tenantId,
            Source = string.IsNullOrWhiteSpace(row.Source) ? "notification_queue" : row.Source.Trim(),
            Status = string.IsNullOrWhiteSpace(row.Status) ? "pending" : row.Status.Trim(),
            CreatedAt = row.CreatedAt ?? DateTime.UtcNow
        };

        await UpsertConfigRowAsync(tenantId, QueueKeyPrefix, id, normalized, ct);
        return normalized;
    }

    public async Task<EmailUserHistoryDto> UserHistoryAsync(int tenantId, int userId, CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Id == userId, ct)
            ?? throw new AdminEmailDeliverabilityNotFoundException("User not found in this tenant.");

        var logs = await TenantEmailLogs(tenantId)
            .Where(log => log.UserId == userId)
            .OrderByDescending(log => log.Id)
            .Take(50)
            .ToListAsync(ct);
        var suppressions = await SuppressionsAsync(tenantId, 200, 0, user.Email, null, ct);

        return new EmailUserHistoryDto(
            new EmailDeliverabilityUserDto(
                user.Id,
                user.Email,
                user.FirstName,
                string.Join(' ', new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrWhiteSpace(part))).Trim(),
                user.EmailVerifiedAt,
                user.CreatedAt),
            logs.Select(ToLogDto).ToArray(),
            suppressions.Rows);
    }

    private IQueryable<EmailLog> TenantEmailLogs(int tenantId)
    {
        return _db.EmailLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == tenantId);
    }

    private static EmailLogRowDto ToLogDto(EmailLog log)
    {
        var status = StatusString(log.Status);
        return new EmailLogRowDto(
            log.Id,
            log.UserId,
            log.ToEmail,
            log.TemplateKey,
            log.Subject,
            log.Provider,
            status,
            log.ProviderMessageId,
            log.ErrorMessage,
            log.SentAt,
            status is "sent" or "delivered" ? log.SentAt : null,
            status == "bounced" ? log.CreatedAt : null,
            null,
            log.CreatedAt);
    }

    private static string StatusString(EmailSendStatus status)
    {
        return status switch
        {
            EmailSendStatus.Pending => "pending",
            EmailSendStatus.Sent => "sent",
            EmailSendStatus.Failed => "failed",
            EmailSendStatus.Bounced => "bounced",
            _ => status.ToString().ToLowerInvariant()
        };
    }

    private static EmailTriggerAuditDto TriggerAudit(int window, IReadOnlyCollection<EmailLog> logs)
    {
        var failed = logs.Count(log => log.Status is EmailSendStatus.Failed or EmailSendStatus.Bounced);
        var severity = failed > 0
            ? new Dictionary<string, int> { ["warning"] = failed }
            : new Dictionary<string, int>();
        var issues = failed > 0
            ?
            [
                new EmailTriggerAuditIssueDto(
                    "email_failures_detected",
                    "warning",
                    null,
                    "deliverability",
                    "email_log",
                    new Dictionary<string, object?> { ["count"] = failed, ["window"] = window })
            ]
            : Array.Empty<EmailTriggerAuditIssueDto>();

        return new EmailTriggerAuditDto(
            failed == 0 ? 100 : Math.Max(0, 100 - failed * 10),
            failed,
            logs.Count,
            severity,
            issues);
    }

    private static Dictionary<string, QueueSourceSummaryDto> QueueDiagnosticsSummary(
        IEnumerable<EmailQueueDiagnosticRow> rows)
    {
        return rows
            .GroupBy(row => row.Source)
            .ToDictionary(
                group => group.Key,
                group => new QueueSourceSummaryDto(
                    group.Count(row => string.Equals(row.Status, "pending", StringComparison.OrdinalIgnoreCase)),
                    group.Count(row => string.Equals(row.Status, "processing", StringComparison.OrdinalIgnoreCase)),
                    group.Count(row => string.Equals(row.Status, "failed", StringComparison.OrdinalIgnoreCase)),
                    group.Count(row => string.Equals(row.Status, "suppressed", StringComparison.OrdinalIgnoreCase)),
                    group.Min(row => row.CreatedAt),
                    group.Count()));
    }

    private async Task<int> NextIdAsync(int tenantId, string prefix, CancellationToken ct)
    {
        var rows = await LoadConfigRowsAsync<JsonElement>(tenantId, prefix, ct);
        var ids = rows
            .Select(row => int.TryParse(row.Row.Key[prefix.Length..], out var id) ? id : 0)
            .ToArray();

        return ids.Length == 0 ? 1 : ids.Max() + 1;
    }

    private async Task<TenantConfig?> FindConfigRowAsync(
        int tenantId,
        string prefix,
        int id,
        CancellationToken ct)
    {
        var key = prefix + id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Key == key, ct);
    }

    private async Task UpsertConfigRowAsync<T>(
        int tenantId,
        string prefix,
        int id,
        T value,
        CancellationToken ct)
    {
        var row = await FindConfigRowAsync(tenantId, prefix, id, ct);
        var now = DateTime.UtcNow;
        if (row is null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = prefix + id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                CreatedAt = now
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = JsonSerializer.Serialize(value, JsonOptions);
        row.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
    }

    private async Task<IReadOnlyList<(TenantConfig Row, T Value)>> LoadConfigRowsAsync<T>(
        int tenantId,
        string prefix,
        CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId && row.Key.StartsWith(prefix))
            .ToListAsync(ct);

        return rows
            .Select(row => (Row: row, Value: Decode<T>(row.Value)))
            .Where(row => row.Value is not null)
            .Select(row => (row.Row, row.Value!))
            .ToArray();
    }

    private static T? Decode<T>(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return default;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(value, JsonOptions);
        }
        catch (JsonException)
        {
            return default;
        }
    }
}

public sealed record EmailDeliverabilitySummaryDto(
    [property: JsonPropertyName("window_days")] int WindowDays,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("by_status")] IReadOnlyDictionary<string, int> ByStatus,
    [property: JsonPropertyName("delivered_pct")] double? DeliveredPct,
    [property: JsonPropertyName("accepted_pct")] double? AcceptedPct,
    [property: JsonPropertyName("unconfirmed_sent")] int UnconfirmedSent,
    [property: JsonPropertyName("bounced_pct")] double? BouncedPct,
    [property: JsonPropertyName("warnings")] IReadOnlyList<EmailWarningDto> Warnings,
    [property: JsonPropertyName("trigger_audit")] EmailTriggerAuditDto TriggerAudit);

public sealed record EmailWarningDto(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("message_key")] string MessageKey,
    [property: JsonPropertyName("params")] IReadOnlyDictionary<string, object?>? Params = null);

public sealed record EmailTriggerAuditDto(
    [property: JsonPropertyName("score")] int Score,
    [property: JsonPropertyName("issue_count")] int IssueCount,
    [property: JsonPropertyName("matrix_count")] int MatrixCount,
    [property: JsonPropertyName("issues_by_severity")] IReadOnlyDictionary<string, int> IssuesBySeverity,
    [property: JsonPropertyName("issues")] IReadOnlyList<EmailTriggerAuditIssueDto> Issues);

public sealed record EmailTriggerAuditIssueDto(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("severity")] string Severity,
    [property: JsonPropertyName("tenant_id")] int? TenantId,
    [property: JsonPropertyName("module")] string Module,
    [property: JsonPropertyName("event")] string Event,
    [property: JsonPropertyName("params")] IReadOnlyDictionary<string, object?>? Params);

public sealed record EmailPushSummaryDto(
    [property: JsonPropertyName("available")] bool Available,
    [property: JsonPropertyName("window_days")] int WindowDays,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("delivered")] int Delivered,
    [property: JsonPropertyName("partial")] int Partial,
    [property: JsonPropertyName("failed")] int Failed,
    [property: JsonPropertyName("success_pct")] double? SuccessPct,
    [property: JsonPropertyName("fcm_sent")] int FcmSent,
    [property: JsonPropertyName("fcm_failed")] int FcmFailed,
    [property: JsonPropertyName("web_delivered")] int WebDelivered,
    [property: JsonPropertyName("by_type")] IReadOnlyDictionary<string, int> ByType,
    [property: JsonPropertyName("recent_failures")] IReadOnlyList<PushFailureRowDto> RecentFailures);

public sealed record PushFailureRowDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("user_id")] int? UserId,
    [property: JsonPropertyName("activity_type")] string ActivityType,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("fcm_failed")] int FcmFailed,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("created_at")] DateTime? CreatedAt);

public sealed record PagedEmailLogDto(
    [property: JsonPropertyName("rows")] IReadOnlyList<EmailLogRowDto> Rows,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("limit")] int Limit,
    [property: JsonPropertyName("offset")] int Offset);

public sealed record EmailLogRowDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("user_id")] int? UserId,
    [property: JsonPropertyName("recipient_email")] string RecipientEmail,
    [property: JsonPropertyName("category")] string? Category,
    [property: JsonPropertyName("subject")] string? Subject,
    [property: JsonPropertyName("provider")] string? Provider,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("provider_message_id")] string? ProviderMessageId,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("sent_at")] DateTime? SentAt,
    [property: JsonPropertyName("delivered_at")] DateTime? DeliveredAt,
    [property: JsonPropertyName("bounced_at")] DateTime? BouncedAt,
    [property: JsonPropertyName("opened_at")] DateTime? OpenedAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt);

public sealed record EmailQueueDiagnosticsDto(
    [property: JsonPropertyName("rows")] IReadOnlyList<EmailQueueDiagnosticRow> Rows,
    [property: JsonPropertyName("diagnostics")] IReadOnlyDictionary<string, QueueSourceSummaryDto> Diagnostics);

public sealed record QueueSourceSummaryDto(
    [property: JsonPropertyName("pending_old")] int PendingOld,
    [property: JsonPropertyName("stale_processing")] int StaleProcessing,
    [property: JsonPropertyName("failed_recent")] int FailedRecent,
    [property: JsonPropertyName("suppressed_recent")] int SuppressedRecent,
    [property: JsonPropertyName("oldest_pending_at")] DateTime? OldestPendingAt,
    [property: JsonPropertyName("returned")] int Returned);

public sealed record EmailQueueDiagnosticRow
{
    [JsonPropertyName("tenant_id")] public int? TenantId { get; init; }
    [JsonPropertyName("source")] public string Source { get; init; } = "notification_queue";
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("status")] public string Status { get; init; } = "pending";
    [JsonPropertyName("frequency")] public string? Frequency { get; init; }
    [JsonPropertyName("attempts")] public int Attempts { get; init; }
    [JsonPropertyName("last_attempted_at")] public DateTime? LastAttemptedAt { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("processing_started_at")] public DateTime? ProcessingStartedAt { get; init; }
    [JsonPropertyName("created_at")] public DateTime? CreatedAt { get; init; }
}

public sealed record PagedEmailSuppressionDto(
    [property: JsonPropertyName("rows")] IReadOnlyList<EmailSuppressionRecord> Rows,
    [property: JsonPropertyName("total")] int Total,
    [property: JsonPropertyName("limit")] int Limit,
    [property: JsonPropertyName("offset")] int Offset);

public sealed record EmailSuppressionRecord
{
    [JsonPropertyName("tenant_id")] public int? TenantId { get; init; }
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("email")] public string Email { get; init; } = string.Empty;
    [JsonPropertyName("reason")] public string Reason { get; init; } = "bounce";
    [JsonPropertyName("detail")] public string? Detail { get; init; }
    [JsonPropertyName("suppressed_at")] public DateTime SuppressedAt { get; init; } = DateTime.UtcNow;
    [JsonPropertyName("created_at")] public DateTime? CreatedAt { get; init; }
}

public sealed record EmailUserHistoryDto(
    [property: JsonPropertyName("user")] EmailDeliverabilityUserDto User,
    [property: JsonPropertyName("logs")] IReadOnlyList<EmailLogRowDto> Logs,
    [property: JsonPropertyName("suppressions")] IReadOnlyList<EmailSuppressionRecord> Suppressions);

public sealed record EmailDeliverabilityUserDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("first_name")] string FirstName,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("email_verified_at")] DateTime? EmailVerifiedAt,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt);

public sealed class AdminEmailDeliverabilityNotFoundException : Exception
{
    public AdminEmailDeliverabilityNotFoundException(string message) : base(message) { }
}
