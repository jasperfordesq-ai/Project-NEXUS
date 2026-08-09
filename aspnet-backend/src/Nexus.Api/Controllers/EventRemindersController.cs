// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Event reminders controller - set and manage reminders for upcoming events.
/// </summary>
[ApiController]
[Authorize]
public class EventRemindersController : ControllerBase
{
    private readonly EventReminderService _reminderService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<EventRemindersController> _logger;

    public EventRemindersController(
        EventReminderService reminderService,
        TenantContext tenantContext,
        ILogger<EventRemindersController> logger)
    {
        _reminderService = reminderService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/events/{eventId}/reminders - Get my reminders for this event.
    /// </summary>
    [HttpGet("api/events/{eventId}/reminders")]
    public async Task<IActionResult> GetReminders(int eventId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var reminders = await _reminderService.GetRemindersAsync(eventId, userId.Value);

        return Ok(new
        {
            data = reminders.Select(r => new
            {
                r.Id,
                event_id = r.EventId,
                minutes_before = r.MinutesBefore,
                reminder_type = r.ReminderType,
                is_sent = r.IsSent,
                sent_at = r.SentAt,
                created_at = r.CreatedAt
            })
        });
    }

    /// <summary>
    /// POST /api/events/{eventId}/reminders - Set a reminder for this event.
    /// </summary>
    [HttpPost("api/events/{eventId}/reminders")]
    public async Task<IActionResult> SetReminder(int eventId, [FromBody] SetReminderRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var (reminder, error) = await _reminderService.SetReminderAsync(
            tenantId, eventId, userId.Value, request.MinutesBefore, request.ReminderType ?? "notification");

        if (error != null)
        {
            return BadRequest(new { error });
        }

        return CreatedAtAction(nameof(GetReminders), new { eventId }, new
        {
            success = true,
            message = "Reminder set",
            reminder = new
            {
                reminder!.Id,
                event_id = reminder.EventId,
                minutes_before = reminder.MinutesBefore,
                reminder_type = reminder.ReminderType,
                created_at = reminder.CreatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/events/{eventId}/reminders/{id} - Remove a reminder.
    /// </summary>
    [HttpDelete("api/events/{eventId}/reminders/{id:int}")]
    public async Task<IActionResult> DeleteReminder(int eventId, int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _reminderService.DeleteReminderAsync(id, userId.Value);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(new
        {
            success = true,
            message = "Reminder removed"
        });
    }

    /// <summary>
    /// GET /api/users/me/reminders - Get all my upcoming reminders.
    /// </summary>
    [HttpGet("api/users/me/reminders")]
    public async Task<IActionResult> GetMyReminders()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var reminders = await _reminderService.GetUserRemindersAsync(userId.Value);

        return Ok(new
        {
            data = reminders.Select(r => new
            {
                r.Id,
                event_id = r.EventId,
                minutes_before = r.MinutesBefore,
                reminder_type = r.ReminderType,
                is_sent = r.IsSent,
                created_at = r.CreatedAt,
                @event = r.Event != null ? new
                {
                    r.Event.Id,
                    r.Event.Title,
                    starts_at = r.Event.StartsAt,
                    r.Event.Location
                } : null
            }),
            total = reminders.Count
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class SetReminderRequest
{
    [JsonPropertyName("minutes_before")]
    public int MinutesBefore { get; set; } = 60;

    [JsonPropertyName("reminder_type")]
    public string? ReminderType { get; set; }
}
