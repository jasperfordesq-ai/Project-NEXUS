// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Events controller - community events management.
/// Phase 11: Create, manage, and RSVP to events.
/// </summary>
[ApiController]
[Route("api/events")]
[Authorize]
public class EventsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<EventsController> _logger;
    private readonly GamificationService _gamification;

    public EventsController(NexusDbContext db, ILogger<EventsController> logger, GamificationService gamification)
    {
        _db = db;
        _logger = logger;
        _gamification = gamification;
    }

    /// <summary>
    /// GET /api/events - List all events (paginated).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetEvents(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] int? group_id = null,
        [FromQuery] bool? upcoming_only = null,
        [FromQuery] string? search = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.Events.Where(e => !e.IsCancelled);

        // Filter by group
        if (group_id.HasValue)
        {
            query = query.Where(e => e.GroupId == group_id.Value);
        }

        // Filter upcoming events
        if (upcoming_only == true)
        {
            query = query.Where(e => e.StartsAt > DateTime.UtcNow);
        }

        // Search by title (case-insensitive)
        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.ToLower();
            query = query.Where(e => e.Title.ToLower().Contains(searchLower));
        }

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var events = await query
            .AsNoTracking()
            .OrderBy(e => e.StartsAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(e => new
            {
                e.Id,
                e.Title,
                e.Description,
                e.Location,
                starts_at = e.StartsAt,
                ends_at = e.EndsAt,
                max_attendees = e.MaxAttendees,
                e.ImageUrl,
                image_url = e.ImageUrl,
                cover_image = e.ImageUrl,
                e.CreatedAt,
                created_by = e.CreatedBy != null
                    ? new { e.CreatedBy.Id, e.CreatedBy.FirstName, e.CreatedBy.LastName, name = (e.CreatedBy.FirstName + " " + e.CreatedBy.LastName).Trim(), avatar_url = e.CreatedBy.AvatarUrl }
                    : null,
                group = e.GroupId != null && e.Group != null
                    ? new { e.Group.Id, e.Group.Name }
                    : null,
                rsvp_count = e.Rsvps.Count(r => r.Status == Event.RsvpStatus.Going)
            })
            .ToListAsync();

        return Ok(new
        {
            data = events,
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
    /// GET /api/events/my - List events the current user has RSVP'd to.
    /// </summary>
    [HttpGet("my")]
    public async Task<IActionResult> GetMyEvents(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.EventRsvps
            .AsNoTracking()
            .Where(r => r.UserId == userId && r.Event != null && !r.Event.IsCancelled);

        var total = await query.CountAsync();

        var events = await query
            .OrderBy(r => r.Event!.StartsAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(r => new
            {
                r.Event!.Id,
                r.Event.Title,
                r.Event.Description,
                r.Event.Location,
                starts_at = r.Event.StartsAt,
                ends_at = r.Event.EndsAt,
                r.Event.ImageUrl,
                image_url = r.Event.ImageUrl,
                cover_image = r.Event.ImageUrl,
                my_rsvp = r.Status,
                responded_at = r.RespondedAt,
                group = r.Event.GroupId != null && r.Event.Group != null
                    ? new { r.Event.Group.Id, r.Event.Group.Name }
                    : null,
                rsvp_count = r.Event!.Rsvps.Count(rsvp => rsvp.Status == Event.RsvpStatus.Going)
            })
            .ToListAsync();

        return Ok(new
        {
            data = events,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// GET /api/events/{id} - Get a single event by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetEvent(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventEntity = await _db.Events
            .AsNoTracking()
            .Where(e => e.Id == id)
            .Select(e => new
            {
                e.Id,
                e.Title,
                e.Description,
                e.Location,
                starts_at = e.StartsAt,
                ends_at = e.EndsAt,
                max_attendees = e.MaxAttendees,
                e.ImageUrl,
                image_url = e.ImageUrl,
                cover_image = e.ImageUrl,
                e.IsCancelled,
                e.CreatedAt,
                e.UpdatedAt,
                created_by = e.CreatedBy != null
                    ? new { e.CreatedBy.Id, e.CreatedBy.FirstName, e.CreatedBy.LastName, name = (e.CreatedBy.FirstName + " " + e.CreatedBy.LastName).Trim(), avatar_url = e.CreatedBy.AvatarUrl }
                    : null,
                group = e.GroupId != null && e.Group != null
                    ? new { e.Group.Id, e.Group.Name }
                    : null,
                rsvp_counts = new
                {
                    going = e.Rsvps.Count(r => r.Status == Event.RsvpStatus.Going),
                    maybe = e.Rsvps.Count(r => r.Status == Event.RsvpStatus.Maybe),
                    not_going = e.Rsvps.Count(r => r.Status == Event.RsvpStatus.NotGoing)
                }
            })
            .FirstOrDefaultAsync();

        if (eventEntity == null)
        {
            return NotFound(new { error = "Event not found" });
        }

        // Get current user's RSVP
        var myRsvp = await _db.EventRsvps
            .AsNoTracking()
            .Where(r => r.EventId == id && r.UserId == userId)
            .Select(r => new { r.Status, r.RespondedAt })
            .FirstOrDefaultAsync();

        return Ok(new
        {
            @event = eventEntity,
            my_rsvp = myRsvp
        });
    }

    /// <summary>
    /// POST /api/events - Create a new event.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreateEvent([FromBody] CreateEventRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return BadRequest(new { error = "Event title is required" });
        }

        if (request.Title.Length > 255)
        {
            return BadRequest(new { error = "Event title cannot exceed 255 characters" });
        }

        if (request.StartsAt <= DateTime.UtcNow)
        {
            return BadRequest(new { error = "Event start time must be in the future" });
        }

        if (request.EndsAt.HasValue && request.EndsAt <= request.StartsAt)
        {
            return BadRequest(new { error = "Event end time must be after start time" });
        }

        // If group_id is provided, verify user is a member
        if (request.GroupId.HasValue)
        {
            var isMember = await _db.GroupMembers
                .AnyAsync(gm => gm.GroupId == request.GroupId && gm.UserId == userId);

            if (!isMember)
            {
                return StatusCode(403, new { error = "You must be a member of the group to create events for it" });
            }
        }

        var eventEntity = new Event
        {
            CreatedById = userId.Value,
            GroupId = request.GroupId,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim(),
            Location = request.Location?.Trim(),
            StartsAt = request.StartsAt,
            EndsAt = request.EndsAt,
            MaxAttendees = request.MaxAttendees,
            ImageUrl = request.ImageUrl?.Trim()
        };

        // Use transaction to ensure event + creator RSVP are created atomically
        await using var transaction = await _db.Database.BeginTransactionAsync();

        _db.Events.Add(eventEntity);
        await _db.SaveChangesAsync();

        // Creator automatically RSVPs as going
        var rsvp = new EventRsvp
        {
            EventId = eventEntity.Id,
            UserId = userId.Value,
            Status = Event.RsvpStatus.Going
        };

        _db.EventRsvps.Add(rsvp);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        // Award XP and check badges for creating an event (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.EventCreated, XpLog.Sources.EventCreated, eventEntity.Id, $"Created event: {eventEntity.Title}");
            await _gamification.CheckAndAwardBadgesAsync(userId.Value, "event_created");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for event {EventId}", eventEntity.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for event {EventId}", eventEntity.Id);
        }

        _logger.LogInformation("User {UserId} created event {EventId}: {Title}", userId, eventEntity.Id, eventEntity.Title);

        return CreatedAtAction(nameof(GetEvent), new { id = eventEntity.Id }, new
        {
            success = true,
            message = "Event created",
            @event = new
            {
                eventEntity.Id,
                eventEntity.Title,
                eventEntity.Description,
                eventEntity.Location,
                starts_at = eventEntity.StartsAt,
                ends_at = eventEntity.EndsAt,
                max_attendees = eventEntity.MaxAttendees,
                eventEntity.ImageUrl,
                image_url = eventEntity.ImageUrl,
                cover_image = eventEntity.ImageUrl,
                eventEntity.CreatedAt,
                group_id = eventEntity.GroupId,
                my_rsvp = Event.RsvpStatus.Going
            }
        });
    }

    /// <summary>
    /// PUT /api/events/{id} - Update an event (creator only).
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateEvent(int id, [FromBody] UpdateEventRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventEntity = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (eventEntity == null)
        {
            return NotFound(new { error = "Event not found" });
        }

        // Only creator can update
        if (eventEntity.CreatedById != userId)
        {
            // Unless user is a group admin/owner
            if (eventEntity.GroupId.HasValue)
            {
                var membership = await _db.GroupMembers
                    .FirstOrDefaultAsync(gm => gm.GroupId == eventEntity.GroupId && gm.UserId == userId);

                if (membership == null || (membership.Role != Group.Roles.Admin && membership.Role != Group.Roles.Owner))
                {
                    return StatusCode(403, new { error = "Only the event creator or group admins can update this event" });
                }
            }
            else
            {
                return StatusCode(403, new { error = "Only the event creator can update this event" });
            }
        }

        if (request.Title != null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return BadRequest(new { error = "Event title cannot be empty" });
            }
            if (request.Title.Length > 255)
            {
                return BadRequest(new { error = "Event title cannot exceed 255 characters" });
            }
            eventEntity.Title = request.Title.Trim();
        }

        if (request.Description != null)
        {
            eventEntity.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        }

        if (request.Location != null)
        {
            eventEntity.Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();
        }

        if (request.StartsAt.HasValue)
        {
            if (request.StartsAt.Value <= DateTime.UtcNow)
            {
                return BadRequest(new { error = "Event start time must be in the future" });
            }
            eventEntity.StartsAt = request.StartsAt.Value;
        }

        if (request.EndsAt.HasValue)
        {
            eventEntity.EndsAt = request.EndsAt.Value;
        }

        // Validate end is after start (check after both may have been updated)
        if (eventEntity.EndsAt.HasValue && eventEntity.EndsAt.Value <= eventEntity.StartsAt)
        {
            return BadRequest(new { error = "Event end time must be after start time" });
        }

        if (request.MaxAttendees.HasValue)
        {
            eventEntity.MaxAttendees = request.MaxAttendees.Value > 0 ? request.MaxAttendees.Value : null;
        }

        if (request.ImageUrl != null)
        {
            eventEntity.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();
        }

        eventEntity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} updated event {EventId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Event updated",
            @event = new
            {
                eventEntity.Id,
                eventEntity.Title,
                eventEntity.Description,
                eventEntity.Location,
                starts_at = eventEntity.StartsAt,
                ends_at = eventEntity.EndsAt,
                max_attendees = eventEntity.MaxAttendees,
                eventEntity.ImageUrl,
                image_url = eventEntity.ImageUrl,
                cover_image = eventEntity.ImageUrl,
                eventEntity.CreatedAt,
                eventEntity.UpdatedAt
            }
        });
    }

    /// <summary>
    /// PUT /api/events/{id}/cancel - Cancel an event (creator only).
    /// </summary>
    [HttpPut("{id:int}/cancel")]
    public async Task<IActionResult> CancelEvent(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventEntity = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (eventEntity == null)
        {
            return NotFound(new { error = "Event not found" });
        }

        // Only creator can cancel (or group admin/owner)
        var canCancel = eventEntity.CreatedById == userId;

        if (!canCancel && eventEntity.GroupId.HasValue)
        {
            var membership = await _db.GroupMembers
                .FirstOrDefaultAsync(gm => gm.GroupId == eventEntity.GroupId && gm.UserId == userId);

            canCancel = membership != null && (membership.Role == Group.Roles.Admin || membership.Role == Group.Roles.Owner);
        }

        if (!canCancel)
        {
            return StatusCode(403, new { error = "Only the event creator or group admins can cancel this event" });
        }

        eventEntity.IsCancelled = true;
        eventEntity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} cancelled event {EventId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Event cancelled"
        });
    }

    /// <summary>
    /// DELETE /api/events/{id} - Delete an event (creator only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteEvent(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventEntity = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (eventEntity == null)
        {
            return NotFound(new { error = "Event not found" });
        }

        // Only creator can delete (or group admin/owner)
        var canDelete = eventEntity.CreatedById == userId;

        if (!canDelete && eventEntity.GroupId.HasValue)
        {
            var membership = await _db.GroupMembers
                .FirstOrDefaultAsync(gm => gm.GroupId == eventEntity.GroupId && gm.UserId == userId);

            canDelete = membership != null && (membership.Role == Group.Roles.Admin || membership.Role == Group.Roles.Owner);
        }

        if (!canDelete)
        {
            return StatusCode(403, new { error = "Only the event creator or group admins can delete this event" });
        }

        _db.Events.Remove(eventEntity);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted event {EventId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Event deleted"
        });
    }

    /// <summary>
    /// GET /api/events/{id}/rsvps - Get all RSVPs for an event.
    /// </summary>
    [HttpGet("{id:int}/rsvps")]
    public async Task<IActionResult> GetEventRsvps(int id, [FromQuery] string? status = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventExists = await _db.Events.AnyAsync(e => e.Id == id);
        if (!eventExists)
        {
            return NotFound(new { error = "Event not found" });
        }

        var query = _db.EventRsvps.Where(r => r.EventId == id);

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(r => r.Status == status);
        }

        var rsvps = await query
            .OrderBy(r => r.RespondedAt)
            .Select(r => new
            {
                r.User!.Id,
                r.User.FirstName,
                r.User.LastName,
                r.Status,
                responded_at = r.RespondedAt
            })
            .ToListAsync();

        return Ok(new { data = rsvps });
    }

    /// <summary>
    /// POST /api/events/{id}/rsvp - RSVP to an event.
    /// </summary>
    [HttpPost("{id:int}/rsvp")]
    public async Task<IActionResult> Rsvp(int id, [FromBody] RsvpRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var eventEntity = await _db.Events
            .Include(e => e.Rsvps)
            .FirstOrDefaultAsync(e => e.Id == id);

        if (eventEntity == null)
        {
            return NotFound(new { error = "Event not found" });
        }

        if (eventEntity.IsCancelled)
        {
            return BadRequest(new { error = "Cannot RSVP to a cancelled event" });
        }

        if (eventEntity.StartsAt <= DateTime.UtcNow)
        {
            return BadRequest(new { error = "Cannot RSVP to a past event" });
        }

        // Validate status
        var validStatuses = new[] { Event.RsvpStatus.Going, Event.RsvpStatus.Maybe, Event.RsvpStatus.NotGoing };
        if (!validStatuses.Contains(request.Status))
        {
            return BadRequest(new { error = $"Invalid RSVP status. Valid values: {string.Join(", ", validStatuses)}" });
        }

        // Use SERIALIZABLE transaction to prevent race condition on capacity check
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable);

        try
        {
            // Re-query going count inside transaction for accurate capacity check
            if (request.Status == Event.RsvpStatus.Going && eventEntity.MaxAttendees.HasValue)
            {
                var goingCount = await _db.EventRsvps.CountAsync(
                    r => r.EventId == id && r.Status == Event.RsvpStatus.Going && r.UserId != userId);
                if (goingCount >= eventEntity.MaxAttendees.Value)
                {
                    await transaction.RollbackAsync();
                    return BadRequest(new { error = "Event is at maximum capacity" });
                }
            }

            // Check for existing RSVP
            var existingRsvp = await _db.EventRsvps
                .FirstOrDefaultAsync(r => r.EventId == id && r.UserId == userId);

            if (existingRsvp != null)
            {
                existingRsvp.Status = request.Status;
                existingRsvp.RespondedAt = DateTime.UtcNow;
            }
            else
            {
                var rsvp = new EventRsvp
                {
                    EventId = id,
                    UserId = userId.Value,
                    Status = request.Status
                };
                _db.EventRsvps.Add(rsvp);
            }

            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        catch (System.Data.Common.DbException ex)
        {
            _logger.LogWarning(ex, "RSVP transaction failed for event {EventId}, rolling back", id);
            await transaction.RollbackAsync();
            throw;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "RSVP transaction failed for event {EventId}, rolling back", id);
            await transaction.RollbackAsync();
            throw;
        }

        _logger.LogInformation("User {UserId} RSVP'd {Status} to event {EventId}", userId, request.Status, id);

        return Ok(new
        {
            success = true,
            message = "RSVP recorded",
            rsvp = new
            {
                event_id = id,
                status = request.Status,
                responded_at = DateTime.UtcNow
            }
        });
    }

    /// <summary>
    /// DELETE /api/events/{id}/rsvp - Remove RSVP from an event.
    /// </summary>
    [HttpDelete("{id:int}/rsvp")]
    public async Task<IActionResult> RemoveRsvp(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var rsvp = await _db.EventRsvps
            .FirstOrDefaultAsync(r => r.EventId == id && r.UserId == userId);

        if (rsvp == null)
        {
            return NotFound(new { error = "RSVP not found" });
        }

        _db.EventRsvps.Remove(rsvp);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} removed RSVP from event {EventId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "RSVP removed"
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class CreateEventRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt { get; set; }

    [JsonPropertyName("max_attendees")]
    public int? MaxAttendees { get; set; }

    [JsonPropertyName("group_id")]
    public int? GroupId { get; set; }

    [JsonPropertyName("image_url")]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }
}

public class UpdateEventRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("starts_at")]
    public DateTime? StartsAt { get; set; }

    [JsonPropertyName("ends_at")]
    public DateTime? EndsAt { get; set; }

    [JsonPropertyName("max_attendees")]
    public int? MaxAttendees { get; set; }

    [JsonPropertyName("image_url")]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }
}

public class RsvpRequest
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = Event.RsvpStatus.Going;
}
