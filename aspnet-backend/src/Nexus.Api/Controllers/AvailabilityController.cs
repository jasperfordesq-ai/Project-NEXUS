// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Member availability controller - scheduling and availability management.
/// Phase 44: Member Availability.
/// </summary>
[ApiController]
[Authorize]
public class AvailabilityController : ControllerBase
{
    private readonly AvailabilityService _availabilityService;

    public AvailabilityController(AvailabilityService availabilityService)
        => _availabilityService = availabilityService;

    /// <summary>
    /// GET /api/availability - Get my weekly schedule.
    /// </summary>
    [HttpGet("api/availability")]
    public async Task<IActionResult> GetMySchedule()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var slots = await _availabilityService.GetScheduleAsync(userId.Value);

        return Ok(new
        {
            data = slots.Select(s => new
            {
                id = s.Id, day_of_week = s.DayOfWeek,
                start_time = s.StartTime, end_time = s.EndTime,
                note = s.Note, is_active = s.IsActive
            })
        });
    }

    /// <summary>
    /// GET /api/availability/users/{userId} - Get another user's schedule.
    /// </summary>
    [HttpGet("api/availability/users/{userId:int}")]
    public async Task<IActionResult> GetUserSchedule(int userId)
    {
        var slots = await _availabilityService.GetScheduleAsync(userId);

        return Ok(new
        {
            user_id = userId,
            data = slots.Select(s => new
            {
                day_of_week = s.DayOfWeek,
                start_time = s.StartTime, end_time = s.EndTime,
                note = s.Note
            })
        });
    }

    /// <summary>
    /// POST /api/availability - Add an availability slot.
    /// </summary>
    [HttpPost("api/availability")]
    public async Task<IActionResult> AddSlot([FromBody] AddSlotRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.DayOfWeek < 0 || request.DayOfWeek > 6)
            return BadRequest(new { error = "DayOfWeek must be 0 (Sunday) through 6 (Saturday)" });

        var (slot, error) = await _availabilityService.SetSlotAsync(
            userId.Value, request.DayOfWeek, request.StartTime, request.EndTime, request.Note);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetMySchedule), null, new
        {
            id = slot!.Id, day_of_week = slot.DayOfWeek,
            start_time = slot.StartTime, end_time = slot.EndTime, note = slot.Note
        });
    }

    /// <summary>
    /// PUT /api/availability/bulk - Replace entire weekly schedule.
    /// </summary>
    [HttpPut("api/availability/bulk")]
    public async Task<IActionResult> BulkSetSchedule([FromBody] BulkScheduleRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var timePattern = new System.Text.RegularExpressions.Regex(@"^([01]\d|2[0-3]):[0-5]\d$");
        var errors = new List<string>();
        for (int i = 0; i < request.Slots.Count; i++)
        {
            var s = request.Slots[i];
            if (s.DayOfWeek < 0 || s.DayOfWeek > 6)
                errors.Add($"Slot {i}: DayOfWeek must be 0 (Sunday) through 6 (Saturday)");
            if (!timePattern.IsMatch(s.StartTime))
                errors.Add($"Slot {i}: StartTime must be in HH:mm format");
            if (!timePattern.IsMatch(s.EndTime))
                errors.Add($"Slot {i}: EndTime must be in HH:mm format");
        }
        if (errors.Count > 0)
            return BadRequest(new { error = "One or more slots failed validation", details = errors });

        var slots = request.Slots.Select(s => (s.DayOfWeek, s.StartTime, s.EndTime, s.Note)).ToList();
        var result = await _availabilityService.BulkSetScheduleAsync(userId.Value, slots);

        return Ok(new
        {
            data = result.Select(s => new
            {
                id = s.Id, day_of_week = s.DayOfWeek,
                start_time = s.StartTime, end_time = s.EndTime, note = s.Note
            }),
            message = $"Schedule updated with {result.Count} slots"
        });
    }

    /// <summary>
    /// DELETE /api/availability/{id} - Remove a slot.
    /// </summary>
    [HttpDelete("api/availability/{id:int}")]
    public async Task<IActionResult> RemoveSlot(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _availabilityService.RemoveSlotAsync(id, userId.Value);
        if (!success) return BadRequest(new { error });

        return Ok(new { message = "Slot removed" });
    }

    /// <summary>
    /// GET /api/availability/exceptions - Get my availability exceptions.
    /// </summary>
    [HttpGet("api/availability/exceptions")]
    public async Task<IActionResult> GetExceptions([FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exceptions = await _availabilityService.GetExceptionsAsync(userId.Value, from, to);

        return Ok(new
        {
            data = exceptions.Select(e => new
            {
                id = e.Id, date = e.Date, type = e.Type,
                start_time = e.StartTime, end_time = e.EndTime, reason = e.Reason
            })
        });
    }

    /// <summary>
    /// POST /api/availability/exceptions - Add an availability exception.
    /// </summary>
    [HttpPost("api/availability/exceptions")]
    public async Task<IActionResult> AddException([FromBody] AddExceptionRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var validTypes = new[] { "unavailable", "available", "holiday" };
        if (!validTypes.Contains(request.Type?.ToLowerInvariant()))
            return BadRequest(new { error = "Type must be one of: unavailable, available, holiday" });

        if (request.Date.Date < DateTime.UtcNow.Date)
            return BadRequest(new { error = "Exception date cannot be in the past" });

        var exception = await _availabilityService.AddExceptionAsync(
            userId.Value, request.Date, request.Type!, request.StartTime, request.EndTime, request.Reason);

        return CreatedAtAction(nameof(GetExceptions), null, new
        {
            id = exception.Id, date = exception.Date, type = exception.Type,
            start_time = exception.StartTime, end_time = exception.EndTime, reason = exception.Reason
        });
    }

    /// <summary>
    /// DELETE /api/availability/exceptions/{id} - Remove an exception.
    /// </summary>
    [HttpDelete("api/availability/exceptions/{id:int}")]
    public async Task<IActionResult> RemoveException(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _availabilityService.RemoveExceptionAsync(id, userId.Value);
        if (!success) return BadRequest(new { error });

        return Ok(new { message = "Exception removed" });
    }
}

public class AddSlotRequest
{
    [JsonPropertyName("day_of_week")] public int DayOfWeek { get; set; }
    [JsonPropertyName("start_time")] public string StartTime { get; set; } = "09:00";
    [JsonPropertyName("end_time")] public string EndTime { get; set; } = "17:00";
    [JsonPropertyName("note")] public string? Note { get; set; }
}

public class BulkScheduleRequest
{
    [JsonPropertyName("slots")] public List<AddSlotRequest> Slots { get; set; } = new();
}

public class AddExceptionRequest
{
    [JsonPropertyName("date")] public DateTime Date { get; set; }
    [JsonPropertyName("type")] public string Type { get; set; } = "unavailable";
    [JsonPropertyName("start_time")] public string? StartTime { get; set; }
    [JsonPropertyName("end_time")] public string? EndTime { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}
