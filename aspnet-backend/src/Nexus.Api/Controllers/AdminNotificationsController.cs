// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin notification management - broadcast, stats.
/// </summary>
[ApiController]
[Route("api/admin/notifications")]
[Authorize(Policy = "AdminOnly")]
public class AdminNotificationsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;

    public AdminNotificationsController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/admin/notifications - List recent notifications with pagination.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListNotifications(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var total = await _db.Notifications.CountAsync();

        var notifications = await _db.Notifications
            .AsNoTracking()
            .OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(n => new
            {
                n.Id,
                n.Title,
                message = n.Body,
                type = n.Type,
                user_id = n.UserId,
                is_read = n.IsRead,
                created_at = n.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = notifications,
            total,
            page,
            limit
        });
    }

    /// <summary>
    /// GET /api/admin/notifications/stats - Notification statistics.
    /// </summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        // EF global query filters handle tenant isolation for normal LINQ queries
        var total = await _db.Notifications.CountAsync();
        var unread = await _db.Notifications.CountAsync(n => !n.IsRead);
        var today = await _db.Notifications.CountAsync(n => n.CreatedAt >= DateTime.UtcNow.Date);

        return Ok(new { data = new { total, unread, sent_today = today } });
    }

    /// <summary>
    /// POST /api/admin/notifications/broadcast - Send notification to all users.
    /// </summary>
    [HttpPost("broadcast")]
    public async Task<IActionResult> Broadcast([FromBody] BroadcastNotificationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "Title is required" });
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest(new { error = "Message is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var notificationType = string.IsNullOrWhiteSpace(request.Type) ? "info" : request.Type.Trim();
        var targetRole = string.IsNullOrWhiteSpace(request.TargetRole) ? null : request.TargetRole.Trim().ToLowerInvariant();

        // Use batched processing to avoid loading all users into memory at once
        const int batchSize = 500;
        var totalSent = 0;
        var skip = 0;

        while (true)
        {
            var usersQuery = _db.Users
                .Where(u => u.IsActive);

            if (targetRole is not null)
                usersQuery = usersQuery.Where(u => u.Role.ToLower() == targetRole);

            var userIds = await usersQuery
                .OrderBy(u => u.Id)
                .Skip(skip)
                .Take(batchSize)
                .Select(u => u.Id)
                .ToListAsync();

            if (userIds.Count == 0) break;

            var notifications = userIds.Select(userId => new Notification
            {
                TenantId = tenantId,
                UserId = userId,
                Type = notificationType,
                Title = request.Title,
                Body = request.Message,
                IsRead = false
            }).ToList();

            _db.Notifications.AddRange(notifications);
            await _db.SaveChangesAsync();

            totalSent += notifications.Count;
            skip += batchSize;
        }

        return Ok(new { message = $"Broadcast sent to {totalSent} users", sent_count = totalSent, target_role = targetRole });
    }

    /// <summary>
    /// DELETE /api/admin/notifications/cleanup - Delete old read notifications.
    /// </summary>
    [HttpDelete("cleanup")]
    public async Task<IActionResult> Cleanup([FromQuery] int days_old = 90)
    {
        if (days_old < 1) days_old = 1;

        // ExecuteDeleteAsync bypasses EF global query filters, so we must
        // explicitly enforce tenant isolation in the WHERE clause.
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var cutoff = DateTime.UtcNow.AddDays(-days_old);
        var deletedCount = await _db.Notifications
            .Where(n => n.TenantId == tenantId && n.IsRead && n.CreatedAt < cutoff)
            .ExecuteDeleteAsync();

        return Ok(new { message = $"Deleted {deletedCount} old notifications", deleted_count = deletedCount });
    }
}

public class BroadcastNotificationRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("target_role")] public string? TargetRole { get; set; }
}
