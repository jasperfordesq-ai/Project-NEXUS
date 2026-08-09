// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing event reminders.
/// Handles creating, querying, and processing reminders for upcoming events.
/// </summary>
public class EventReminderService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<EventReminderService> _logger;

    public EventReminderService(NexusDbContext db, TenantContext tenantContext, ILogger<EventReminderService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Get all reminders for a specific event belonging to a specific user.
    /// </summary>
    public async Task<List<EventReminder>> GetRemindersAsync(int eventId, int userId)
    {
        return await _db.EventReminders
            .AsNoTracking()
            .Where(r => r.EventId == eventId && r.UserId == userId)
            .OrderBy(r => r.MinutesBefore)
            .ToListAsync();
    }

    /// <summary>
    /// Create a new reminder for an event.
    /// </summary>
    public async Task<(EventReminder? Reminder, string? Error)> SetReminderAsync(
        int tenantId, int eventId, int userId, int minutesBefore, string reminderType)
    {
        // Validate the event exists
        var eventEntity = await _db.Events
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == eventId);

        if (eventEntity == null)
        {
            return (null, "Event not found");
        }

        if (eventEntity.IsCancelled)
        {
            return (null, "Cannot set reminder for a cancelled event");
        }

        if (eventEntity.StartsAt <= DateTime.UtcNow)
        {
            return (null, "Cannot set reminder for a past event");
        }

        if (minutesBefore < 1 || minutesBefore > 10080) // Max 1 week
        {
            return (null, "Minutes before must be between 1 and 10080 (1 week)");
        }

        var validTypes = new[] { "notification", "email", "push" };
        if (!validTypes.Contains(reminderType))
        {
            return (null, $"Invalid reminder type. Valid types: {string.Join(", ", validTypes)}");
        }

        // Check for duplicate
        var existing = await _db.EventReminders
            .FirstOrDefaultAsync(r => r.EventId == eventId && r.UserId == userId && r.MinutesBefore == minutesBefore && r.ReminderType == reminderType);

        if (existing != null)
        {
            return (null, "A reminder with the same settings already exists for this event");
        }

        var reminder = new EventReminder
        {
            TenantId = tenantId,
            EventId = eventId,
            UserId = userId,
            MinutesBefore = minutesBefore,
            ReminderType = reminderType
        };

        _db.EventReminders.Add(reminder);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} set reminder for event {EventId}: {MinutesBefore}min before ({Type})",
            userId, eventId, minutesBefore, reminderType);

        return (reminder, null);
    }

    /// <summary>
    /// Delete a reminder by ID (must belong to the specified user).
    /// </summary>
    public async Task<(bool Success, string? Error)> DeleteReminderAsync(int id, int userId)
    {
        var reminder = await _db.EventReminders
            .FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId);

        if (reminder == null)
        {
            return (false, "Reminder not found");
        }

        _db.EventReminders.Remove(reminder);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted reminder {ReminderId}", userId, id);

        return (true, null);
    }

    /// <summary>
    /// Get all upcoming reminders for a user (only for future, non-cancelled events).
    /// </summary>
    public async Task<List<EventReminder>> GetUserRemindersAsync(int userId)
    {
        return await _db.EventReminders
            .AsNoTracking()
            .Include(r => r.Event)
            .Where(r => r.UserId == userId && !r.IsSent && r.Event != null && !r.Event.IsCancelled && r.Event.StartsAt > DateTime.UtcNow)
            .OrderBy(r => r.Event!.StartsAt)
            .ToListAsync();
    }

    /// <summary>
    /// Get all reminders that are due to be sent (for background job processing).
    /// A reminder is due when: event.StartsAt - minutesBefore <= now AND not yet sent.
    /// </summary>
    public async Task<List<EventReminder>> GetDueRemindersAsync()
    {
        var now = DateTime.UtcNow;

        return await _db.EventReminders
            .Include(r => r.Event)
            .Include(r => r.User)
            .Where(r => !r.IsSent
                && r.Event != null
                && !r.Event.IsCancelled
                && r.Event.StartsAt > now
                && r.Event.StartsAt.AddMinutes(-r.MinutesBefore) <= now)
            .ToListAsync();
    }

    /// <summary>
    /// Mark a reminder as sent.
    /// </summary>
    public async Task MarkSentAsync(int id)
    {
        var reminder = await _db.EventReminders.FirstOrDefaultAsync(x => x.Id == id);
        if (reminder != null)
        {
            reminder.IsSent = true;
            reminder.SentAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            _logger.LogInformation("Reminder {ReminderId} marked as sent", id);
        }
    }
}
