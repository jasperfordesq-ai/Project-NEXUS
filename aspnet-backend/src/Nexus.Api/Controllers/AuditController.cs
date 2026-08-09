// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Audit log controller - tenant-scoped audit log queries and management.
/// Requires "admin" role for all endpoints.
/// </summary>
[ApiController]
[Route("api/admin/audit")]
[Authorize(Policy = "AdminOnly")]
public class AuditController : ControllerBase
{
    private readonly AuditLogService _auditLogService;
    private readonly ILogger<AuditController> _logger;

    public AuditController(AuditLogService auditLogService, ILogger<AuditController> logger)
    {
        _auditLogService = auditLogService;
        _logger = logger;
    }

    /// <summary>
    /// Query audit logs with optional filters.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> QueryLogs(
        [FromQuery(Name = "user_id")] int? userId,
        [FromQuery(Name = "action")] string? action,
        [FromQuery(Name = "entity_type")] string? entityType,
        [FromQuery(Name = "entity_id")] int? entityId,
        [FromQuery(Name = "date_from")] DateTime? dateFrom,
        [FromQuery(Name = "date_to")] DateTime? dateTo,
        [FromQuery(Name = "severity")] string? severity,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "limit")] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        AuditSeverity? severityEnum = null;
        if (!string.IsNullOrWhiteSpace(severity))
        {
            if (!Enum.TryParse<AuditSeverity>(severity, ignoreCase: true, out var parsed))
            {
                return BadRequest(new { error = "Invalid severity. Valid values: info, warning, critical." });
            }
            severityEnum = parsed;
        }

        var filter = new AuditLogFilter
        {
            UserId = userId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            DateFrom = dateFrom,
            DateTo = dateTo,
            Severity = severityEnum,
            Page = page,
            Limit = limit
        };

        var result = await _auditLogService.QueryLogsAsync(filter);

        return Ok(new AuditLogListResponse
        {
            Items = result.Items,
            TotalCount = result.TotalCount,
            Page = result.Page,
            Limit = result.Limit
        });
    }

    /// <summary>
    /// Get a user's activity timeline.
    /// </summary>
    [HttpGet("user/{userId:int}")]
    public async Task<IActionResult> GetUserActivity(
        int userId,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "limit")] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var result = await _auditLogService.GetUserActivityAsync(userId, page, limit);

        return Ok(new AuditLogListResponse
        {
            Items = result.Items,
            TotalCount = result.TotalCount,
            Page = result.Page,
            Limit = result.Limit
        });
    }

    /// <summary>
    /// Get recent critical audit events.
    /// </summary>
    [HttpGet("critical")]
    public async Task<IActionResult> GetRecentCritical(
        [FromQuery(Name = "limit")] int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 100);

        var items = await _auditLogService.GetRecentCriticalAsync(limit);
        return Ok(new { items, total_count = items.Count });
    }

    /// <summary>
    /// Laravel-compatible tenant audit log CSV export.
    /// </summary>
    [HttpGet("/api/admin/audit-log/export.csv")]
    public async Task<IActionResult> ExportCsv(
        [FromQuery(Name = "log")] string? log,
        [FromQuery(Name = "date_from")] DateTime? dateFrom,
        [FromQuery(Name = "date_to")] DateTime? dateTo,
        [FromQuery(Name = "user_id")] int? userId,
        [FromQuery(Name = "action")] string? action)
    {
        var exportKind = string.Equals(log, "admin", StringComparison.OrdinalIgnoreCase)
            ? "admin"
            : "activity";

        var rows = await _auditLogService.ExportLogsAsync(new AuditLogFilter
        {
            UserId = userId,
            Action = action,
            DateFrom = dateFrom,
            DateTo = dateTo
        });

        var csv = BuildActivityCsv(rows);
        var bytes = Encoding.UTF8.GetBytes('\uFEFF' + csv);
        var filename = $"audit-log-{exportKind}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv";

        return File(bytes, "text/csv; charset=utf-8", filename);
    }

    /// <summary>
    /// Purge audit logs older than the specified number of days.
    /// </summary>
    [HttpDelete("purge")]
    public async Task<IActionResult> PurgeLogs(
        [FromQuery(Name = "older_than_days")] int? olderThanDays)
    {
        if (!olderThanDays.HasValue || olderThanDays.Value < 1)
        {
            return BadRequest(new { error = "older_than_days query parameter is required and must be at least 1." });
        }

        var deleted = await _auditLogService.PurgeOldLogsAsync(olderThanDays.Value);

        _logger.LogWarning(
            "Admin purged {Count} audit logs older than {Days} days",
            deleted, olderThanDays.Value);

        return Ok(new AuditPurgeResponse
        {
            DeletedCount = deleted,
            OlderThanDays = olderThanDays.Value
        });
    }

    private static string BuildActivityCsv(IEnumerable<AuditLogExportRow> rows)
    {
        var builder = new StringBuilder();
        AppendCsvRow(builder, ["ID", "User ID", "User", "Action", "Action Type", "Entity Type", "Entity ID", "Details", "IP Address", "Date"]);

        foreach (var row in rows)
        {
            AppendCsvRow(builder,
            [
                row.Id,
                row.UserId,
                row.UserName,
                row.Action,
                string.Empty,
                row.EntityType,
                row.EntityId,
                row.Details,
                row.IpAddress,
                row.CreatedAt.ToString("O")
            ]);
        }

        return builder.ToString();
    }

    private static void AppendCsvRow(StringBuilder builder, IReadOnlyList<object?> row)
    {
        for (var i = 0; i < row.Count; i++)
        {
            if (i > 0)
                builder.Append(',');

            builder.Append(EscapeCsvCell(row[i]));
        }

        builder.AppendLine();
    }

    private static string EscapeCsvCell(object? value)
    {
        var text = value switch
        {
            null => string.Empty,
            DateTime dateTime => dateTime.ToString("O"),
            _ => value.ToString() ?? string.Empty
        };

        if (text.Length > 0 && (text[0] == '=' || text[0] == '+' || text[0] == '-' || text[0] == '@' || text[0] == '\t' || text[0] == '\r'))
            text = "'" + text;

        return text.Contains('"') || text.Contains(',') || text.Contains('\n') || text.Contains('\r')
            ? "\"" + text.Replace("\"", "\"\"") + "\""
            : text;
    }
}

public class AuditLogListResponse
{
    [JsonPropertyName("items")]
    public List<AuditLogDto> Items { get; set; } = new();

    [JsonPropertyName("total_count")]
    public int TotalCount { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }
}

public class AuditPurgeResponse
{
    [JsonPropertyName("deleted_count")]
    public int DeletedCount { get; set; }

    [JsonPropertyName("older_than_days")]
    public int OlderThanDays { get; set; }
}
