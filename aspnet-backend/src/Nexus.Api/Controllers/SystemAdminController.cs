// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// System administration controller for global settings, scheduled tasks,
/// announcements, and system health monitoring.
/// Phase 37: Advanced Admin.
/// </summary>
[ApiController]
[Route("api/admin/system")]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
public class SystemAdminController : ControllerBase
{
    private readonly SystemAdminService _systemAdmin;
    private readonly LockdownService _lockdownService;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<SystemAdminController> _logger;

    public SystemAdminController(
        SystemAdminService systemAdmin,
        LockdownService lockdownService,
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<SystemAdminController> logger)
    {
        _systemAdmin = systemAdmin;
        _lockdownService = lockdownService;
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region System Settings

    /// <summary>
    /// GET /api/admin/system/settings - List system settings.
    /// </summary>
    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings([FromQuery] string? category = null)
    {
        var settings = await _systemAdmin.GetSystemSettingsAsync(category);

        var response = settings.Select(s => new SettingResponse
        {
            Id = s.Id,
            Key = s.Key,
            Value = s.Value,
            Description = s.Description,
            Category = s.Category,
            IsSecret = s.IsSecret,
            UpdatedAt = s.UpdatedAt,
            CreatedAt = s.CreatedAt
        });

        return Ok(response);
    }

    /// <summary>
    /// PUT /api/admin/system/settings - Create or update a system setting.
    /// </summary>
    [HttpPut("settings")]
    public async Task<IActionResult> SetSetting([FromBody] SetSettingRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Key))
            return BadRequest(new { error = "key is required" });

        if (string.IsNullOrWhiteSpace(request.Value))
            return BadRequest(new { error = "value is required" });

        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var setting = await _systemAdmin.SetSystemSettingAsync(
            request.Key,
            request.Value,
            request.Description,
            request.Category,
            request.IsSecret,
            adminId.Value);

        return Ok(new SettingResponse
        {
            Id = setting.Id,
            Key = setting.Key,
            Value = setting.IsSecret ? "********" : setting.Value,
            Description = setting.Description,
            Category = setting.Category,
            IsSecret = setting.IsSecret,
            UpdatedAt = setting.UpdatedAt,
            CreatedAt = setting.CreatedAt
        });
    }

    #endregion

    #region Scheduled Tasks

    /// <summary>
    /// GET /api/admin/system/tasks - List scheduled tasks.
    /// </summary>
    [HttpGet("tasks")]
    public async Task<IActionResult> GetTasks()
    {
        var tasks = await _systemAdmin.GetScheduledTasksAsync();

        var response = tasks.Select(t => new TaskResponse
        {
            Id = t.Id,
            TaskName = t.TaskName,
            Status = t.Status.ToString().ToLowerInvariant(),
            LastRunAt = t.LastRunAt,
            NextRunAt = t.NextRunAt,
            CronExpression = t.CronExpression,
            Parameters = t.Parameters,
            ErrorMessage = t.ErrorMessage,
            RunCount = t.RunCount,
            AverageDurationMs = t.AverageDurationMs,
            CreatedAt = t.CreatedAt,
            UpdatedAt = t.UpdatedAt
        });

        return Ok(response);
    }

    #endregion

    #region Announcements (Admin)

    /// <summary>
    /// GET /api/admin/system/announcements - List announcements (includes inactive).
    /// </summary>
    [HttpGet("announcements")]
    public async Task<IActionResult> GetAnnouncements()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var announcements = await _db.PlatformAnnouncements
            .AsNoTracking()
            .Include(a => a.CreatedBy)
            .Where(a => a.TenantId == tenantId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync();

        var response = announcements.Select(MapAnnouncementResponse);
        return Ok(response);
    }

    /// <summary>
    /// POST /api/admin/system/announcements - Create a new announcement.
    /// </summary>
    [HttpPost("announcements")]
    public async Task<IActionResult> CreateAnnouncement([FromBody] CreateSystemAnnouncementRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "title is required" });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "content is required" });

        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        if (!Enum.TryParse<AnnouncementType>(request.Type, true, out var type))
            type = AnnouncementType.Info;

        var announcement = await _systemAdmin.CreateAnnouncementAsync(
            tenantId,
            adminId.Value,
            request.Title,
            request.Content,
            type,
            request.StartsAt,
            request.EndsAt);

        return Created($"/api/admin/system/announcements/{announcement.Id}", MapAnnouncementResponse(announcement));
    }

    /// <summary>
    /// PUT /api/admin/system/announcements/{id} - Update or reactivate an announcement.
    /// </summary>
    [HttpPut("announcements/{id:int}")]
    public async Task<IActionResult> UpdateAnnouncement(int id, [FromBody] UpdateSystemAnnouncementRequest request)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var announcement = await _db.PlatformAnnouncements
            .Include(a => a.CreatedBy)
            .FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);

        if (announcement == null)
            return NotFound(new { error = "Announcement not found" });

        if (request.Title != null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
                return BadRequest(new { error = "title cannot be empty" });
            announcement.Title = request.Title.Trim();
        }

        if (request.Content != null)
        {
            if (string.IsNullOrWhiteSpace(request.Content))
                return BadRequest(new { error = "content cannot be empty" });
            announcement.Content = request.Content.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Type) &&
            Enum.TryParse<AnnouncementType>(request.Type, true, out var type))
        {
            announcement.Type = type;
        }

        if (request.IsActive.HasValue)
            announcement.IsActive = request.IsActive.Value;
        if (request.StartsAt.HasValue)
            announcement.StartsAt = request.StartsAt;
        if (request.EndsAt.HasValue)
            announcement.EndsAt = request.EndsAt;

        announcement.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(MapAnnouncementResponse(announcement));
    }

    /// <summary>
    /// PUT /api/admin/system/announcements/{id}/deactivate - Deactivate an announcement.
    /// </summary>
    [HttpPut("announcements/{id:int}/deactivate")]
    public async Task<IActionResult> DeactivateAnnouncement(int id)
    {
        var success = await _systemAdmin.DeactivateAnnouncementAsync(id);

        if (!success)
            return NotFound(new { error = "Announcement not found" });

        return Ok(new { message = "Announcement deactivated" });
    }

    /// <summary>
    /// DELETE /api/admin/system/announcements/{id} - Delete an announcement.
    /// </summary>
    [HttpDelete("announcements/{id:int}")]
    public async Task<IActionResult> DeleteAnnouncement(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var announcement = await _db.PlatformAnnouncements
            .FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);

        if (announcement == null)
            return NotFound(new { error = "Announcement not found" });

        _db.PlatformAnnouncements.Remove(announcement);
        await _db.SaveChangesAsync();

        return Ok(new { message = "Announcement deleted" });
    }

    #endregion

    #region System Health

    /// <summary>
    /// GET /api/admin/system/health - System health metrics.
    /// </summary>
    [HttpGet("health")]
    public async Task<IActionResult> GetHealth()
    {
        var health = await _systemAdmin.GetSystemHealthAsync();

        return Ok(new HealthResponse
        {
            DatabaseSize = health.DatabaseSize,
            TotalUsers = health.TotalUsers,
            ActiveUsersLast24h = health.ActiveUsersLast24h,
            ActiveUsersLast7d = health.ActiveUsersLast7d,
            TotalTenants = health.TotalTenants,
            TotalListings = health.TotalListings,
            PendingScheduledTasks = health.PendingScheduledTasks,
            FailedScheduledTasks = health.FailedScheduledTasks,
            ServerTime = health.ServerTime
        });
    }

    #endregion

    #region Emergency Lockdown

    /// <summary>
    /// POST /api/admin/system/lockdown - Activate emergency lockdown.
    /// Deactivates all tenants and blocks non-admin requests platform-wide.
    /// </summary>
    [HttpPost("lockdown")]
    public async Task<IActionResult> ActivateLockdown([FromBody] ActivateLockdownRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(new { error = "reason is required" });

        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var status = await _lockdownService.ActivateLockdownAsync(adminId.Value, request.Reason);

        _logger.LogCritical("Emergency lockdown activated by admin {AdminId}: {Reason}", adminId.Value, request.Reason);

        return Ok(MapLockdownResponse(status));
    }

    /// <summary>
    /// DELETE /api/admin/system/lockdown - Deactivate emergency lockdown.
    /// Restores tenants to their pre-lockdown states.
    /// </summary>
    [HttpDelete("lockdown")]
    public async Task<IActionResult> DeactivateLockdown()
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var status = await _lockdownService.DeactivateLockdownAsync(adminId.Value);

        _logger.LogCritical("Emergency lockdown deactivated by admin {AdminId}", adminId.Value);

        return Ok(MapLockdownResponse(status));
    }

    /// <summary>
    /// GET /api/admin/system/lockdown - Get current lockdown status.
    /// </summary>
    [HttpGet("lockdown")]
    public async Task<IActionResult> GetLockdownStatus()
    {
        var status = await _lockdownService.GetLockdownStatusAsync();
        return Ok(MapLockdownResponse(status));
    }

    private static LockdownResponse MapLockdownResponse(LockdownStatus status) => new()
    {
        IsActive = status.IsActive,
        Reason = status.Reason,
        ActivatedAt = status.ActivatedAt,
        ActivatedBy = status.ActivatedBy
    };

    #endregion

    #region Super Admin User Management

    /// <summary>
    /// POST /api/admin/system/users/{userId}/grant-admin - Grant admin role to a user.
    /// Cross-tenant operation using IgnoreQueryFilters.
    /// </summary>
    [HttpPost("users/{userId}/grant-admin")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> GrantAdmin(int userId)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
            return NotFound(new { error = "User not found" });

        if (user.Role == "admin" || user.Role == "super_admin")
            return BadRequest(new { error = "User is already an admin" });

        user.Role = "admin";
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogWarning("Admin {AdminId} granted admin role to user {UserId} (tenant {TenantId})",
            adminId.Value, userId, user.TenantId);

        return Ok(new AdminUserResponse
        {
            Id = user.Id,
            Email = user.Email,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = user.Role,
            TenantId = user.TenantId,
            IsActive = user.IsActive
        });
    }

    /// <summary>
    /// POST /api/admin/system/users/{userId}/revoke-admin - Revoke admin role from a user.
    /// Cross-tenant operation using IgnoreQueryFilters.
    /// </summary>
    [HttpPost("users/{userId}/revoke-admin")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> RevokeAdmin(int userId)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        if (adminId.Value == userId)
            return BadRequest(new { error = "Cannot revoke your own admin role" });

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
            return NotFound(new { error = "User not found" });

        if (user.Role != "admin")
            return BadRequest(new { error = "User is not an admin" });

        user.Role = "member";
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogWarning("Admin {AdminId} revoked admin role from user {UserId} (tenant {TenantId})",
            adminId.Value, userId, user.TenantId);

        return Ok(new AdminUserResponse
        {
            Id = user.Id,
            Email = user.Email,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = user.Role,
            TenantId = user.TenantId,
            IsActive = user.IsActive
        });
    }

    /// <summary>
    /// POST /api/admin/system/users/{userId}/move-tenant - Move user to a different tenant.
    /// Cross-tenant operation using IgnoreQueryFilters.
    /// </summary>
    [HttpPost("users/{userId}/move-tenant")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> MoveTenant(int userId, [FromBody] MoveTenantRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
            return NotFound(new { error = "User not found" });

        var targetTenant = await _db.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == request.TargetTenantId);

        if (targetTenant == null)
            return BadRequest(new { error = "Target tenant not found" });

        if (user.TenantId == request.TargetTenantId)
            return BadRequest(new { error = "User is already in the target tenant" });

        var oldTenantId = user.TenantId;
        user.TenantId = request.TargetTenantId;

        if (request.PromoteToAdmin)
            user.Role = "admin";

        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogWarning("Admin {AdminId} moved user {UserId} from tenant {OldTenantId} to tenant {NewTenantId} (promote={Promote})",
            adminId.Value, userId, oldTenantId, request.TargetTenantId, request.PromoteToAdmin);

        return Ok(new AdminUserResponse
        {
            Id = user.Id,
            Email = user.Email,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Role = user.Role,
            TenantId = user.TenantId,
            IsActive = user.IsActive
        });
    }

    /// <summary>
    /// GET /api/admin/system/users/admins - List all admin users across all tenants.
    /// Cross-tenant operation using IgnoreQueryFilters.
    /// </summary>
    [HttpGet("users/admins")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> ListAdmins()
    {
        var admins = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.Role == "admin" || u.Role == "super_admin")
            .OrderBy(u => u.TenantId)
            .ThenBy(u => u.LastName)
            .Select(u => new AdminUserResponse
            {
                Id = u.Id,
                Email = u.Email,
                FirstName = u.FirstName,
                LastName = u.LastName,
                Role = u.Role,
                TenantId = u.TenantId,
                IsActive = u.IsActive
            })
            .ToListAsync();

        return Ok(admins);
    }

    /// <summary>
    /// POST /api/admin/system/bulk/deactivate-users - Bulk deactivate users across tenants.
    /// Cross-tenant operation using IgnoreQueryFilters.
    /// </summary>
    [HttpPost("bulk/deactivate-users")]
    [Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
    public async Task<IActionResult> BulkDeactivateUsers([FromBody] BulkDeactivateRequest request)
    {
        var adminId = GetCurrentUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.UserIds == null || request.UserIds.Length == 0)
            return BadRequest(new { error = "user_ids is required and must not be empty" });

        // Prevent self-deactivation
        if (request.UserIds.Contains(adminId.Value))
            return BadRequest(new { error = "Cannot deactivate yourself" });

        var users = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => request.UserIds.Contains(u.Id))
            .ToListAsync();

        var deactivatedCount = 0;
        foreach (var user in users)
        {
            if (user.IsActive)
            {
                user.IsActive = false;
                user.UpdatedAt = DateTime.UtcNow;
                deactivatedCount++;
            }
        }

        await _db.SaveChangesAsync();

        _logger.LogWarning("Admin {AdminId} bulk deactivated {Count} users (requested {Requested})",
            adminId.Value, deactivatedCount, request.UserIds.Length);

        return Ok(new
        {
            message = $"Deactivated {deactivatedCount} users",
            deactivated_count = deactivatedCount,
            requested_count = request.UserIds.Length,
            not_found_count = request.UserIds.Length - users.Count
        });
    }

    #endregion

    #region Helpers

    private static AnnouncementResponse MapAnnouncementResponse(PlatformAnnouncement a) => new()
    {
        Id = a.Id,
        Title = a.Title,
        Content = a.Content,
        Type = a.Type.ToString().ToLowerInvariant(),
        IsActive = a.IsActive,
        StartsAt = a.StartsAt,
        EndsAt = a.EndsAt,
        CreatedById = a.CreatedById,
        CreatedByName = a.CreatedBy != null ? $"{a.CreatedBy.FirstName} {a.CreatedBy.LastName}" : null,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt
    };

    #endregion

    #region Request/Response DTOs

    public class SetSettingRequest
    {
        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public string Value { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("is_secret")]
        public bool? IsSecret { get; set; }
    }

    public class SettingResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public string Value { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("category")]
        public string? Category { get; set; }

        [JsonPropertyName("is_secret")]
        public bool IsSecret { get; set; }

        [JsonPropertyName("updated_at")]
        public DateTime? UpdatedAt { get; set; }

        [JsonPropertyName("created_at")]
        public DateTime CreatedAt { get; set; }
    }

    public class TaskResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("task_name")]
        public string TaskName { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("last_run_at")]
        public DateTime? LastRunAt { get; set; }

        [JsonPropertyName("next_run_at")]
        public DateTime? NextRunAt { get; set; }

        [JsonPropertyName("cron_expression")]
        public string? CronExpression { get; set; }

        [JsonPropertyName("parameters")]
        public string? Parameters { get; set; }

        [JsonPropertyName("error_message")]
        public string? ErrorMessage { get; set; }

        [JsonPropertyName("run_count")]
        public int RunCount { get; set; }

        [JsonPropertyName("average_duration_ms")]
        public long AverageDurationMs { get; set; }

        [JsonPropertyName("created_at")]
        public DateTime CreatedAt { get; set; }

        [JsonPropertyName("updated_at")]
        public DateTime? UpdatedAt { get; set; }
    }

    public class CreateSystemAnnouncementRequest
    {
        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;

        [JsonPropertyName("type")]
        public string Type { get; set; } = "info";

        [JsonPropertyName("starts_at")]
        public DateTime? StartsAt { get; set; }

        [JsonPropertyName("ends_at")]
        public DateTime? EndsAt { get; set; }
    }

    public class UpdateSystemAnnouncementRequest
    {
        [JsonPropertyName("title")]
        public string? Title { get; set; }

        [JsonPropertyName("content")]
        public string? Content { get; set; }

        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("is_active")]
        public bool? IsActive { get; set; }

        [JsonPropertyName("starts_at")]
        public DateTime? StartsAt { get; set; }

        [JsonPropertyName("ends_at")]
        public DateTime? EndsAt { get; set; }
    }

    public class AnnouncementResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;

        [JsonPropertyName("type")]
        public string Type { get; set; } = string.Empty;

        [JsonPropertyName("is_active")]
        public bool IsActive { get; set; }

        [JsonPropertyName("starts_at")]
        public DateTime? StartsAt { get; set; }

        [JsonPropertyName("ends_at")]
        public DateTime? EndsAt { get; set; }

        [JsonPropertyName("created_by_id")]
        public int CreatedById { get; set; }

        [JsonPropertyName("created_by_name")]
        public string? CreatedByName { get; set; }

        [JsonPropertyName("created_at")]
        public DateTime CreatedAt { get; set; }

        [JsonPropertyName("updated_at")]
        public DateTime? UpdatedAt { get; set; }
    }

    public class ActivateLockdownRequest
    {
        [JsonPropertyName("reason")]
        public string Reason { get; set; } = string.Empty;
    }

    public class LockdownResponse
    {
        [JsonPropertyName("is_active")]
        public bool IsActive { get; set; }

        [JsonPropertyName("reason")]
        public string? Reason { get; set; }

        [JsonPropertyName("activated_at")]
        public DateTime? ActivatedAt { get; set; }

        [JsonPropertyName("activated_by")]
        public int? ActivatedBy { get; set; }
    }

    public class HealthResponse
    {
        [JsonPropertyName("database_size")]
        public string DatabaseSize { get; set; } = string.Empty;

        [JsonPropertyName("total_users")]
        public int TotalUsers { get; set; }

        [JsonPropertyName("active_users_last_24h")]
        public int ActiveUsersLast24h { get; set; }

        [JsonPropertyName("active_users_last_7d")]
        public int ActiveUsersLast7d { get; set; }

        [JsonPropertyName("total_tenants")]
        public int TotalTenants { get; set; }

        [JsonPropertyName("total_listings")]
        public int TotalListings { get; set; }

        [JsonPropertyName("pending_scheduled_tasks")]
        public int PendingScheduledTasks { get; set; }

        [JsonPropertyName("failed_scheduled_tasks")]
        public int FailedScheduledTasks { get; set; }

        [JsonPropertyName("server_time")]
        public DateTime ServerTime { get; set; }
    }

    public class AdminUserResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("email")]
        public string Email { get; set; } = string.Empty;

        [JsonPropertyName("first_name")]
        public string FirstName { get; set; } = string.Empty;

        [JsonPropertyName("last_name")]
        public string LastName { get; set; } = string.Empty;

        [JsonPropertyName("role")]
        public string Role { get; set; } = string.Empty;

        [JsonPropertyName("tenant_id")]
        public int TenantId { get; set; }

        [JsonPropertyName("is_active")]
        public bool IsActive { get; set; }
    }

    public class MoveTenantRequest
    {
        [JsonPropertyName("target_tenant_id")]
        public int TargetTenantId { get; set; }

        [JsonPropertyName("promote_to_admin")]
        public bool PromoteToAdmin { get; set; }
    }

    public class BulkDeactivateRequest
    {
        [JsonPropertyName("user_ids")]
        public int[] UserIds { get; set; } = Array.Empty<int>();
    }

    #endregion
}

/// <summary>
/// Public announcements controller - no authentication required.
/// Returns active announcements for the current tenant.
/// </summary>
[ApiController]
[Route("api/announcements")]
[AllowAnonymous]
public class AnnouncementsController : ControllerBase
{
    private readonly SystemAdminService _systemAdmin;
    private readonly TenantContext _tenantContext;

    public AnnouncementsController(
        SystemAdminService systemAdmin,
        TenantContext tenantContext)
    {
        _systemAdmin = systemAdmin;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/announcements - Get active announcements for current tenant (public).
    /// </summary>
    [HttpGet]
    [AllowAnonymous]
    public async Task<IActionResult> GetActiveAnnouncements()
    {
        var tenantId = _tenantContext.IsResolved ? _tenantContext.GetTenantIdOrThrow() : (int?)null;
        var announcements = await _systemAdmin.GetActiveAnnouncementsAsync(tenantId);

        var response = announcements.Select(a => new
        {
            id = a.Id,
            title = a.Title,
            content = a.Content,
            type = a.Type.ToString().ToLowerInvariant(),
            starts_at = a.StartsAt,
            ends_at = a.EndsAt,
            created_at = a.CreatedAt
        });

        return Ok(response);
    }
}
