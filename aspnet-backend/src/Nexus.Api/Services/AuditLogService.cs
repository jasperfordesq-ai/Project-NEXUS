// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Services;

/// <summary>
/// Service for creating and querying audit log entries.
/// All operations are tenant-scoped via EF Core global filters.
/// </summary>
public class AuditLogService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AuditLogService> _logger;

    public AuditLogService(NexusDbContext db, TenantContext tenantContext, ILogger<AuditLogService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Create an audit log entry.
    /// </summary>
    public async Task LogAsync(
        int? userId,
        string action,
        string? entityType = null,
        int? entityId = null,
        string? oldValues = null,
        string? newValues = null,
        string? ipAddress = null,
        string? userAgent = null,
        string? metadata = null,
        AuditSeverity severity = AuditSeverity.Info)
    {
        var entry = new AuditLog
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            OldValues = oldValues,
            NewValues = newValues,
            IpAddress = ipAddress,
            UserAgent = userAgent,
            Metadata = metadata,
            Severity = severity,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<AuditLog>().Add(entry);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Audit: {Action} by user {UserId} on {EntityType}#{EntityId} (severity: {Severity})",
            action, userId, entityType, entityId, severity);
    }

    /// <summary>
    /// Create an audit log entry, extracting userId, IP, and user agent from HttpContext.
    /// </summary>
    public async Task LogFromContextAsync(
        HttpContext httpContext,
        string action,
        string? entityType = null,
        int? entityId = null,
        string? oldValues = null,
        string? newValues = null,
        string? metadata = null,
        AuditSeverity severity = AuditSeverity.Info)
    {
        var userId = httpContext.User.GetUserId();
        var ipAddress = httpContext.Connection.RemoteIpAddress?.ToString();
        var userAgent = httpContext.Request.Headers.UserAgent.ToString();

        if (userAgent?.Length > 500)
        {
            userAgent = userAgent[..500];
        }

        await LogAsync(userId, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent, metadata, severity);
    }

    /// <summary>
    /// Query audit logs with optional filters. Results are paged and ordered by most recent first.
    /// </summary>
    public async Task<AuditLogQueryResult> QueryLogsAsync(AuditLogFilter filter)
    {
        var query = _db.Set<AuditLog>()
            .AsNoTracking()
            .AsQueryable();

        if (filter.UserId.HasValue)
            query = query.Where(a => a.UserId == filter.UserId.Value);

        if (!string.IsNullOrWhiteSpace(filter.Action))
            query = query.Where(a => a.Action.Contains(filter.Action));

        if (!string.IsNullOrWhiteSpace(filter.EntityType))
            query = query.Where(a => a.EntityType == filter.EntityType);

        if (filter.EntityId.HasValue)
            query = query.Where(a => a.EntityId == filter.EntityId.Value);

        if (filter.DateFrom.HasValue)
            query = query.Where(a => a.CreatedAt >= filter.DateFrom.Value);

        if (filter.DateTo.HasValue)
            query = query.Where(a => a.CreatedAt <= filter.DateTo.Value);

        if (filter.Severity.HasValue)
            query = query.Where(a => a.Severity == filter.Severity.Value);

        var totalCount = await query.CountAsync();

        var page = Math.Max(1, filter.Page);
        var limit = Math.Clamp(filter.Limit, 1, 100);

        var items = await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(a => MapToDto(a))
            .ToListAsync();

        return new AuditLogQueryResult
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            Limit = limit
        };
    }

    /// <summary>
    /// Get a user's activity timeline, ordered by most recent first.
    /// </summary>
    public async Task<AuditLogQueryResult> GetUserActivityAsync(int userId, int page = 1, int limit = 20)
    {
        return await QueryLogsAsync(new AuditLogFilter
        {
            UserId = userId,
            Page = page,
            Limit = limit
        });
    }

    /// <summary>
    /// Export tenant-scoped audit logs, ordered newest first, for CSV download.
    /// </summary>
    public async Task<List<AuditLogExportRow>> ExportLogsAsync(AuditLogFilter filter, int maxRows = 100000)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        maxRows = Math.Clamp(maxRows, 1, 100000);

        var query = _db.Set<AuditLog>()
            .AsNoTracking()
            .Include(a => a.User)
            .Where(a => a.TenantId == tenantId);

        if (filter.UserId.HasValue)
            query = query.Where(a => a.UserId == filter.UserId.Value);

        if (!string.IsNullOrWhiteSpace(filter.Action))
            query = query.Where(a => a.Action == filter.Action);

        if (!string.IsNullOrWhiteSpace(filter.EntityType))
            query = query.Where(a => a.EntityType == filter.EntityType);

        if (filter.EntityId.HasValue)
            query = query.Where(a => a.EntityId == filter.EntityId.Value);

        if (filter.DateFrom.HasValue)
            query = query.Where(a => a.CreatedAt >= filter.DateFrom.Value.Date);

        if (filter.DateTo.HasValue)
        {
            var endOfDay = filter.DateTo.Value.Date.AddDays(1).AddTicks(-1);
            query = query.Where(a => a.CreatedAt <= endOfDay);
        }

        if (filter.Severity.HasValue)
            query = query.Where(a => a.Severity == filter.Severity.Value);

        return await query
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id)
            .Take(maxRows)
            .Select(a => new AuditLogExportRow
            {
                Id = a.Id,
                UserId = a.UserId,
                UserName = a.User == null
                    ? string.Empty
                    : ((a.User.FirstName ?? string.Empty) + " " + (a.User.LastName ?? string.Empty)).Trim(),
                Action = a.Action,
                EntityType = a.EntityType,
                EntityId = a.EntityId,
                Details = a.Metadata ?? a.NewValues ?? a.OldValues,
                IpAddress = a.IpAddress,
                CreatedAt = a.CreatedAt
            })
            .ToListAsync();
    }

    /// <summary>
    /// Get recent critical audit events.
    /// </summary>
    public async Task<List<AuditLogDto>> GetRecentCriticalAsync(int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 100);

        return await _db.Set<AuditLog>()
            .AsNoTracking()
            .Where(a => a.Severity == AuditSeverity.Critical)
            .OrderByDescending(a => a.CreatedAt)
            .Take(limit)
            .Select(a => MapToDto(a))
            .ToListAsync();
    }

    /// <summary>
    /// Purge audit logs older than the specified number of days.
    /// Returns the number of records deleted.
    /// </summary>
    public async Task<int> PurgeOldLogsAsync(int olderThanDays)
    {
        if (olderThanDays < 1)
            throw new ArgumentException("olderThanDays must be at least 1.", nameof(olderThanDays));

        var cutoff = DateTime.UtcNow.AddDays(-olderThanDays);
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Use ExecuteDeleteAsync for efficient bulk delete
        var deleted = await _db.Set<AuditLog>()
            .Where(a => a.TenantId == tenantId && a.CreatedAt < cutoff)
            .ExecuteDeleteAsync();

        _logger.LogInformation(
            "Purged {Count} audit logs older than {Days} days for tenant {TenantId}",
            deleted, olderThanDays, tenantId);

        return deleted;
    }

    private static AuditLogDto MapToDto(AuditLog a) => new()
    {
        Id = a.Id,
        UserId = a.UserId,
        Action = a.Action,
        EntityType = a.EntityType,
        EntityId = a.EntityId,
        OldValues = a.OldValues,
        NewValues = a.NewValues,
        IpAddress = a.IpAddress,
        UserAgent = a.UserAgent,
        Metadata = a.Metadata,
        Severity = a.Severity.ToString().ToLowerInvariant(),
        CreatedAt = a.CreatedAt
    };
}

/// <summary>
/// Filters for querying audit logs.
/// </summary>
public class AuditLogFilter
{
    public int? UserId { get; set; }
    public string? Action { get; set; }
    public string? EntityType { get; set; }
    public int? EntityId { get; set; }
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public AuditSeverity? Severity { get; set; }
    public int Page { get; set; } = 1;
    public int Limit { get; set; } = 20;
}

/// <summary>
/// Result of an audit log query with pagination metadata.
/// </summary>
public class AuditLogQueryResult
{
    public List<AuditLogDto> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int Limit { get; set; }
}

/// <summary>
/// DTO for audit log entries returned from the API.
/// </summary>
public class AuditLogDto
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public int? EntityId { get; set; }
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public string? Metadata { get; set; }
    public string Severity { get; set; } = "info";
    public DateTime CreatedAt { get; set; }
}

public class AuditLogExportRow
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public int? EntityId { get; set; }
    public string? Details { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
}
