// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for system-wide administration: settings, scheduled tasks,
/// announcements, and system health monitoring.
/// </summary>
public class SystemAdminService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<SystemAdminService> _logger;

    public SystemAdminService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<SystemAdminService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    #region System Settings

    /// <summary>
    /// Get all system settings, optionally filtered by category.
    /// Secret values are redacted in the response.
    /// </summary>
    public async Task<List<SystemSettingDto>> GetSystemSettingsAsync(string? category = null)
    {
        var query = _db.Set<SystemSetting>().AsNoTracking();

        if (!string.IsNullOrWhiteSpace(category))
            query = query.Where(s => s.Category == category);

        var settings = await query
            .OrderBy(s => s.Category)
            .ThenBy(s => s.Key)
            .ToListAsync();

        return settings.Select(s => new SystemSettingDto
        {
            Id = s.Id,
            Key = s.Key,
            Value = s.IsSecret ? "********" : s.Value,
            Description = s.Description,
            Category = s.Category,
            IsSecret = s.IsSecret,
            UpdatedAt = s.UpdatedAt,
            CreatedAt = s.CreatedAt
        }).ToList();
    }

    /// <summary>
    /// Create or update a system setting by key.
    /// </summary>
    public async Task<SystemSetting> SetSystemSettingAsync(
        string key, string value, string? description = null,
        string? category = null, bool? isSecret = null, int? adminId = null)
    {
        var existing = await _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == key);

        if (existing != null)
        {
            existing.Value = value;
            if (description != null) existing.Description = description;
            if (category != null) existing.Category = category;
            if (isSecret.HasValue) existing.IsSecret = isSecret.Value;
            existing.UpdatedById = adminId;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new SystemSetting
            {
                Key = key,
                Value = value,
                Description = description,
                Category = category,
                IsSecret = isSecret ?? false,
                UpdatedById = adminId
            };
            _db.Set<SystemSetting>().Add(existing);
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "System setting '{Key}' updated by admin {AdminId}",
            key, adminId);

        return existing;
    }

    #endregion

    #region Scheduled Tasks

    /// <summary>
    /// Get all scheduled tasks for the current tenant.
    /// </summary>
    public async Task<List<ScheduledTask>> GetScheduledTasksAsync()
    {
        return await _db.Set<ScheduledTask>()
            .AsNoTracking()
            .OrderBy(t => t.NextRunAt)
            .ThenBy(t => t.TaskName)
            .ToListAsync();
    }

    /// <summary>
    /// Update the status of a scheduled task.
    /// </summary>
    public async Task<ScheduledTask?> UpdateScheduledTaskStatusAsync(
        int taskId, ScheduledTaskStatus status, string? errorMessage = null)
    {
        var task = await _db.Set<ScheduledTask>()
            .FirstOrDefaultAsync(t => t.Id == taskId);

        if (task == null) return null;

        task.Status = status;
        task.UpdatedAt = DateTime.UtcNow;

        if (status == ScheduledTaskStatus.Running)
        {
            task.LastRunAt = DateTime.UtcNow;
        }
        else if (status == ScheduledTaskStatus.Failed)
        {
            task.ErrorMessage = errorMessage;
        }
        else if (status == ScheduledTaskStatus.Completed)
        {
            task.RunCount++;
            task.ErrorMessage = null;
        }

        await _db.SaveChangesAsync();
        return task;
    }

    #endregion

    #region Announcements

    /// <summary>
    /// Get active announcements, optionally filtered by tenant.
    /// Only returns announcements within their active time window.
    /// </summary>
    public async Task<List<PlatformAnnouncement>> GetActiveAnnouncementsAsync(int? tenantId = null)
    {
        var now = DateTime.UtcNow;

        var query = _db.Set<PlatformAnnouncement>()
            .AsNoTracking()
            .Where(a => a.IsActive)
            .Where(a => a.StartsAt == null || a.StartsAt <= now)
            .Where(a => a.EndsAt == null || a.EndsAt >= now);

        if (tenantId.HasValue)
            query = query.Where(a => a.TenantId == tenantId.Value);

        return await query
            .OrderByDescending(a => a.Type)
            .ThenByDescending(a => a.CreatedAt)
            .Include(a => a.CreatedBy)
            .ToListAsync();
    }

    /// <summary>
    /// Create a new platform announcement.
    /// </summary>
    public async Task<PlatformAnnouncement> CreateAnnouncementAsync(
        int tenantId, int adminId, string title, string content,
        AnnouncementType type, DateTime? startsAt = null, DateTime? endsAt = null)
    {
        var announcement = new PlatformAnnouncement
        {
            TenantId = tenantId,
            Title = title,
            Content = content,
            Type = type,
            CreatedById = adminId,
            StartsAt = startsAt,
            EndsAt = endsAt
        };

        _db.Set<PlatformAnnouncement>().Add(announcement);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Announcement '{Title}' created by admin {AdminId} for tenant {TenantId}",
            title, adminId, tenantId);

        return announcement;
    }

    /// <summary>
    /// Deactivate an announcement by ID.
    /// </summary>
    public async Task<bool> DeactivateAnnouncementAsync(int id)
    {
        var announcement = await _db.Set<PlatformAnnouncement>()
            .FirstOrDefaultAsync(a => a.Id == id);

        if (announcement == null) return false;

        announcement.IsActive = false;
        announcement.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Announcement {Id} deactivated", id);
        return true;
    }

    #endregion

    #region System Health

    /// <summary>
    /// Get system health metrics: database size, active users, entity counts.
    /// </summary>
    public async Task<SystemHealthResult> GetSystemHealthAsync()
    {
        var now = DateTime.UtcNow;
        var last24h = now.AddHours(-24);
        var last7d = now.AddDays(-7);

        // Database size (PostgreSQL-specific)
        string? dbSize = null;
        try
        {
            var connection = _db.Database.GetDbConnection();
            await connection.OpenAsync();
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT pg_size_pretty(pg_database_size(current_database()))";
            dbSize = (await cmd.ExecuteScalarAsync())?.ToString();
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.Data.Common.DbException or OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to get database size");
            dbSize = "unavailable";
        }

        // Active users (logged in within last 7 days) — cross-tenant for system admin
        var activeUsers7d = await _db.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync(u => u.LastLoginAt >= last7d);

        var activeUsers24h = await _db.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync(u => u.LastLoginAt >= last24h);

        var totalUsers = await _db.Users
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync();

        var totalTenants = await _db.Tenants
            .AsNoTracking()
            .CountAsync();

        var totalListings = await _db.Listings
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync();

        var pendingTasks = await _db.Set<ScheduledTask>()
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync(t => t.Status == ScheduledTaskStatus.Pending || t.Status == ScheduledTaskStatus.Running);

        var failedTasks = await _db.Set<ScheduledTask>()
            .AsNoTracking()
            .IgnoreQueryFilters()
            .CountAsync(t => t.Status == ScheduledTaskStatus.Failed);

        return new SystemHealthResult
        {
            DatabaseSize = dbSize ?? "unknown",
            TotalUsers = totalUsers,
            ActiveUsersLast24h = activeUsers24h,
            ActiveUsersLast7d = activeUsers7d,
            TotalTenants = totalTenants,
            TotalListings = totalListings,
            PendingScheduledTasks = pendingTasks,
            FailedScheduledTasks = failedTasks,
            ServerTime = now
        };
    }

    #endregion
}

#region DTOs

public class SystemSettingDto
{
    public int Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Category { get; set; }
    public bool IsSecret { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class SystemHealthResult
{
    public string DatabaseSize { get; set; } = string.Empty;
    public int TotalUsers { get; set; }
    public int ActiveUsersLast24h { get; set; }
    public int ActiveUsersLast7d { get; set; }
    public int TotalTenants { get; set; }
    public int TotalListings { get; set; }
    public int PendingScheduledTasks { get; set; }
    public int FailedScheduledTasks { get; set; }
    public DateTime ServerTime { get; set; }
}

#endregion
