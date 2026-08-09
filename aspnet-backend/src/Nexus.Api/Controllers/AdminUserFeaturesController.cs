// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminUserFeaturesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<AdminUserFeaturesController> _logger;

    public AdminUserFeaturesController(NexusDbContext db, TenantContext tenant, ILogger<AdminUserFeaturesController> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    // Sessions

    [HttpGet("sessions")]
    public async Task<IActionResult> GetSessions([FromQuery] int page = 1, [FromQuery] int limit = 50, [FromQuery] bool active_only = true)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.UserSessions
            .AsNoTracking()
            .Include(s => s.User)
            .Where(s => s.User != null && s.User.TenantId == tenantId);

        if (active_only)
            query = query.Where(s => s.IsActive && s.ExpiresAt > DateTime.UtcNow);

        var total = await query.CountAsync();
        var sessions = await query
            .OrderByDescending(s => s.LastActivityAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => new
            {
                s.Id,
                user_id = s.UserId,
                user_name = s.User != null ? s.User.FirstName + " " + s.User.LastName : "Unknown",
                user_email = s.User != null ? s.User.Email : null,
                ip_address = s.IpAddress,
                user_agent = s.UserAgent,
                device_info = s.DeviceInfo,
                s.IsActive,
                s.CreatedAt,
                s.LastActivityAt,
                s.ExpiresAt
            })
            .ToListAsync();

        return Ok(new { data = sessions, total, page, limit });
    }

    [HttpDelete("sessions/{id:int}")]
    public async Task<IActionResult> TerminateSession(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var session = await _db.UserSessions
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Id == id && s.User != null && s.User.TenantId == tenantId);

        if (session == null) return NotFound(new { error = "Session not found" });

        session.IsActive = false;
        await _db.SaveChangesAsync();

        var adminId = User.GetUserId();
        _logger.LogInformation("Admin {AdminId} terminated session {SessionId} for user {UserId}", adminId, id, session.UserId);

        return Ok(new { success = true, message = "Session terminated" });
    }

    [HttpDelete("sessions/user/{userId}")]
    public async Task<IActionResult> TerminateUserSessions(int userId)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
        if (user == null) return NotFound(new { error = "User not found" });

        var count = await _db.UserSessions
            .Where(s => s.UserId == userId && s.IsActive)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsActive, false));

        var adminId = User.GetUserId();
        _logger.LogInformation("Admin {AdminId} terminated {Count} sessions for user {UserId}", adminId, count, userId);

        return Ok(new { success = true, message = $"Terminated {count} session(s)", terminated_count = count });
    }

    // Saved Searches

    [HttpGet("saved-searches")]
    public async Task<IActionResult> GetSavedSearches([FromQuery] int page = 1, [FromQuery] int limit = 50, [FromQuery] string? search_type = null)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.SavedSearches
            .AsNoTracking()
            .Include(s => s.User)
            .Where(s => s.TenantId == tenantId);

        if (!string.IsNullOrEmpty(search_type))
            query = query.Where(s => s.SearchType == search_type);

        var total = await query.CountAsync();
        var searches = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => new
            {
                s.Id,
                s.UserId,
                user_name = s.User != null ? s.User.FirstName + " " + s.User.LastName : "Unknown",
                s.Name,
                s.SearchType,
                s.QueryJson,
                s.NotifyOnNewResults,
                s.LastResultCount,
                s.LastRunAt,
                s.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = searches, total, page, limit });
    }

    [HttpDelete("saved-searches/{id:int}")]
    public async Task<IActionResult> DeleteSavedSearch(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var search = await _db.SavedSearches.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
        if (search == null) return NotFound(new { error = "Saved search not found" });

        _db.SavedSearches.Remove(search);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Saved search deleted" });
    }

    // Sub-Accounts

    [HttpGet("sub-accounts")]
    public async Task<IActionResult> GetSubAccounts([FromQuery] int page = 1, [FromQuery] int limit = 50)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.SubAccounts
            .AsNoTracking()
            .Include(s => s.PrimaryUser)
            .Include(s => s.SubUser)
            .Where(s => s.TenantId == tenantId);

        var total = await query.CountAsync();
        var subAccounts = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(s => new
            {
                s.Id,
                s.PrimaryUserId,
                primary_user_name = s.PrimaryUser != null ? s.PrimaryUser.FirstName + " " + s.PrimaryUser.LastName : "Unknown",
                s.SubUserId,
                sub_user_name = s.SubUser != null ? s.SubUser.FirstName + " " + s.SubUser.LastName : "Unknown",
                s.Relationship,
                s.DisplayName,
                s.CanTransact,
                s.CanMessage,
                s.CanJoinGroups,
                s.IsActive,
                s.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = subAccounts, total, page, limit });
    }

    [HttpPut("sub-accounts/{id:int}/deactivate")]
    public async Task<IActionResult> DeactivateSubAccount(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var subAccount = await _db.SubAccounts.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
        if (subAccount == null) return NotFound(new { error = "Sub-account not found" });

        subAccount.IsActive = false;
        subAccount.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Sub-account deactivated" });
    }

    [HttpDelete("sub-accounts/{id:int}")]
    public async Task<IActionResult> DeleteSubAccount(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var subAccount = await _db.SubAccounts.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
        if (subAccount == null) return NotFound(new { error = "Sub-account not found" });

        _db.SubAccounts.Remove(subAccount);
        await _db.SaveChangesAsync();

        return Ok(new { success = true, message = "Sub-account relationship removed" });
    }
}
