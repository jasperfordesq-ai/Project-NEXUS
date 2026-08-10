// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Notifications controller - in-app notification system.
/// Phase 10: List, read, and manage notifications.
/// </summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<NotificationsController> _logger;

    public NotificationsController(NexusDbContext db, ILogger<NotificationsController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/notifications - List notifications for the current user.
    /// Returns paginated notifications, newest first.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetNotifications(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] bool? unread_only = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Notifications
            .Where(n => n.UserId == userId);

        // Filter by unread if requested
        if (unread_only == true)
        {
            query = query.Where(n => !n.IsRead);
        }

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var rows = await query
            .OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var notifications = rows.Select(MapNotification).ToList();

        // Get unread count
        var unreadCount = await _db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .CountAsync();

        return Ok(new
        {
            data = notifications,
            unread_count = unreadCount,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    /// <summary>
    /// GET /api/notifications/unread-count - Get count of unread notifications.
    /// </summary>
    [HttpGet("unread-count")]
    public async Task<IActionResult> GetUnreadCount()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var count = await _db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .CountAsync();

        return Ok(new { unread_count = count });
    }

    /// <summary>
    /// GET /api/notifications/{id} - Get a single notification by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetNotification(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var notification = await _db.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId);

        if (notification == null)
        {
            return NotFound(new { error = "Notification not found" });
        }

        return Ok(MapNotification(notification));
    }

    /// <summary>
    /// PUT /api/notifications/{id}/read - Mark a notification as read.
    /// </summary>
    [HttpPut("{id:int}/read")]
    public async Task<IActionResult> MarkAsRead(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var notification = await _db.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId);

        if (notification == null)
        {
            return NotFound(new { error = "Notification not found" });
        }

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            notification.ReadAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            _logger.LogInformation("Notification {NotificationId} marked as read by user {UserId}", id, userId);
        }

        return Ok(new
        {
            success = true,
            message = "Notification marked as read",
            notification = new
            {
                notification.Id,
                notification.IsRead,
                notification.ReadAt
            }
        });
    }

    /// <summary>
    /// PUT /api/notifications/read-all - Mark all notifications as read.
    /// </summary>
    [HttpPut("read-all")]
    public async Task<IActionResult> MarkAllAsRead()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var now = DateTime.UtcNow;
        var count = await _db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(n => n.IsRead, true)
                .SetProperty(n => n.ReadAt, now));

        _logger.LogInformation("User {UserId} marked {Count} notifications as read", userId, count);

        return Ok(new
        {
            success = true,
            message = $"Marked {count} notification(s) as read",
            marked_count = count
        });
    }

    /// <summary>
    /// GET /api/notifications/counts - Get notification and message counts.
    /// </summary>
    [HttpGet("counts")]
    public async Task<IActionResult> GetCounts()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var unreadCount = await _db.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .CountAsync();

        // Count unread messages (messages in user's conversations sent by others, not yet read)
        var conversationIds = await _db.Conversations
            .Where(c => c.Participant1Id == userId.Value || c.Participant2Id == userId.Value)
            .Select(c => c.Id)
            .ToListAsync();

        var unreadMessages = conversationIds.Count > 0
            ? await _db.Messages
                .Where(m => conversationIds.Contains(m.ConversationId)
                    && m.SenderId != userId.Value
                    && !m.IsRead)
                .CountAsync()
            : 0;

        return Ok(new
        {
            total = unreadCount,
            unread = unreadCount,
            messages = unreadMessages
        });
    }

    /// <summary>
    /// POST /api/notifications/{id}/read - Mark a notification as read (alias for PUT).
    /// </summary>
    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> MarkAsReadPost(int id)
    {
        return await MarkAsRead(id);
    }

    /// <summary>
    /// POST /api/notifications/read-all - Mark all notifications as read (alias for PUT).
    /// </summary>
    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllAsReadPost()
    {
        return await MarkAllAsRead();
    }

    /// <summary>
    /// DELETE /api/notifications/{id} - Delete a notification.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteNotification(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var notification = await _db.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId);

        if (notification == null)
        {
            return NotFound(new { error = "Notification not found" });
        }

        _db.Notifications.Remove(notification);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Notification {NotificationId} deleted by user {UserId}", id, userId);

        return Ok(new
        {
            success = true,
            message = "Notification deleted"
        });
    }

    private static object MapNotification(Notification notification) => new
    {
        id = notification.Id,
        type = notification.Type,
        title = notification.Title,
        body = notification.Body,
        message = notification.Body,
        link = notification.Link,
        data = ParseNotificationData(notification.Data),
        isRead = notification.IsRead,
        createdAt = notification.CreatedAt,
        readAt = notification.ReadAt,
        is_read = notification.IsRead,
        created_at = notification.CreatedAt,
        read_at = notification.ReadAt
    };

    private static JsonElement? ParseNotificationData(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<JsonElement>(raw);
            return parsed.ValueKind == JsonValueKind.Object
                ? parsed
                : JsonSerializer.SerializeToElement(new { value = parsed });
        }
        catch (JsonException)
        {
            return JsonSerializer.SerializeToElement(new { value = raw });
        }
    }

    private int? GetCurrentUserId() => User.GetUserId();
}
