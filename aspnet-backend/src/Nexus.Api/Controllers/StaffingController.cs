// Copyright © 2024–2026 Jasper Ford
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
/// Predictive staffing controller.
/// User endpoints for managing availability; admin endpoints for predictions and dashboards.
/// Phase 36: Predictive Staffing.
/// </summary>
[ApiController]
[Authorize]
public class StaffingController : ControllerBase
{
    private readonly PredictiveStaffingService _staffing;
    private readonly ILogger<StaffingController> _logger;

    public StaffingController(
        PredictiveStaffingService staffing,
        ILogger<StaffingController> logger)
    {
        _staffing = staffing;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region User Endpoints

    /// <summary>
    /// GET /api/volunteering/availability/my - Get current user's availability.
    /// </summary>
    [HttpGet("api/volunteering/availability/my")]
    public async Task<IActionResult> GetMyAvailability()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var availability = await _staffing.GetMyAvailabilityAsync(userId.Value);

        var response = availability.Select(a => new AvailabilityResponse
        {
            Id = a.Id,
            DayOfWeek = a.DayOfWeek,
            DayName = ((DayOfWeek)a.DayOfWeek).ToString(),
            StartTime = a.StartTime.ToString("HH:mm"),
            EndTime = a.EndTime.ToString("HH:mm"),
            IsRecurring = a.IsRecurring,
            EffectiveFrom = a.EffectiveFrom,
            EffectiveUntil = a.EffectiveUntil
        });

        return Ok(response);
    }

    /// <summary>
    /// PUT /api/volunteering/availability - Set availability for current user.
    /// </summary>
    [HttpPut("api/volunteering/availability")]
    public async Task<IActionResult> SetAvailability([FromBody] SetAvailabilityRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.DayOfWeek < 0 || request.DayOfWeek > 6)
            return BadRequest(new { error = "day_of_week must be 0 (Sunday) to 6 (Saturday)" });

        if (!TimeOnly.TryParse(request.StartTime, out var startTime))
            return BadRequest(new { error = "Invalid start_time format. Use HH:mm" });

        if (!TimeOnly.TryParse(request.EndTime, out var endTime))
            return BadRequest(new { error = "Invalid end_time format. Use HH:mm" });

        if (endTime <= startTime)
            return BadRequest(new { error = "end_time must be after start_time" });

        var result = await _staffing.SetAvailabilityAsync(
            userId.Value,
            request.DayOfWeek,
            startTime,
            endTime,
            request.IsRecurring,
            request.EffectiveFrom,
            request.EffectiveUntil);

        return Ok(new AvailabilityResponse
        {
            Id = result.Id,
            DayOfWeek = result.DayOfWeek,
            DayName = ((DayOfWeek)result.DayOfWeek).ToString(),
            StartTime = result.StartTime.ToString("HH:mm"),
            EndTime = result.EndTime.ToString("HH:mm"),
            IsRecurring = result.IsRecurring,
            EffectiveFrom = result.EffectiveFrom,
            EffectiveUntil = result.EffectiveUntil
        });
    }

    #endregion

    #region Admin Endpoints

    /// <summary>
    /// GET /api/admin/staffing/predictions - Staffing predictions for upcoming days.
    /// </summary>
    [HttpGet("api/admin/staffing/predictions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetPredictions(
        [FromQuery(Name = "days_ahead")] int daysAhead = 14,
        [FromQuery(Name = "opportunity_id")] int? opportunityId = null)
    {
        if (daysAhead < 1 || daysAhead > 90)
            return BadRequest(new { error = "days_ahead must be between 1 and 90" });

        var predictions = await _staffing.PredictStaffingNeedsAsync(opportunityId, daysAhead);

        var response = predictions.Select(p => new PredictionResponse
        {
            PredictedDate = p.PredictedDate,
            OpportunityId = p.OpportunityId,
            PredictedVolunteersNeeded = p.PredictedVolunteersNeeded,
            PredictedVolunteersAvailable = p.PredictedVolunteersAvailable,
            ShortfallRisk = p.ShortfallRisk,
            Factors = p.Factors
        });

        return Ok(response);
    }

    /// <summary>
    /// GET /api/admin/staffing/available - Available volunteers for a specific date.
    /// </summary>
    [HttpGet("api/admin/staffing/available")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetAvailableVolunteers(
        [FromQuery] DateTime date,
        [FromQuery(Name = "start_time")] string? startTime = null,
        [FromQuery(Name = "end_time")] string? endTime = null)
    {
        TimeOnly? start = null;
        TimeOnly? end = null;

        if (!string.IsNullOrWhiteSpace(startTime))
        {
            if (!TimeOnly.TryParse(startTime, out var parsed))
                return BadRequest(new { error = "Invalid start_time format. Use HH:mm" });
            start = parsed;
        }

        if (!string.IsNullOrWhiteSpace(endTime))
        {
            if (!TimeOnly.TryParse(endTime, out var parsed))
                return BadRequest(new { error = "Invalid end_time format. Use HH:mm" });
            end = parsed;
        }

        var volunteers = await _staffing.GetAvailableVolunteersAsync(date, start, end);

        var response = volunteers.Select(v => new AvailableVolunteerResponse
        {
            UserId = v.UserId,
            FirstName = v.FirstName,
            LastName = v.LastName,
            Email = v.Email,
            AvailableFrom = v.AvailableFrom.ToString("HH:mm"),
            AvailableTo = v.AvailableTo.ToString("HH:mm"),
            IsRecurring = v.IsRecurring
        });

        return Ok(response);
    }

    /// <summary>
    /// GET /api/admin/staffing/dashboard - Staffing dashboard overview.
    /// </summary>
    [HttpGet("api/admin/staffing/dashboard")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetDashboard()
    {
        var dashboard = await _staffing.GetStaffingDashboardAsync();

        return Ok(new StaffingDashboardResponse
        {
            UpcomingShifts = dashboard.UpcomingShifts.Select(s => new ShiftResponse
            {
                ShiftId = s.ShiftId,
                OpportunityId = s.OpportunityId,
                Title = s.Title,
                StartsAt = s.StartsAt,
                EndsAt = s.EndsAt,
                MaxVolunteers = s.MaxVolunteers,
                CurrentVolunteers = s.CurrentVolunteers
            }).ToList(),
            ShortfallPredictions = dashboard.ShortfallPredictions.Select(p => new PredictionResponse
            {
                PredictedDate = p.PredictedDate,
                OpportunityId = p.OpportunityId,
                PredictedVolunteersNeeded = p.PredictedVolunteersNeeded,
                PredictedVolunteersAvailable = p.PredictedVolunteersAvailable,
                ShortfallRisk = p.ShortfallRisk,
                Factors = p.Factors
            }).ToList(),
            AvailableVolunteersToday = dashboard.AvailableVolunteersToday,
            TotalUpcomingShifts = dashboard.TotalUpcomingShifts,
            ShiftsNeedingVolunteers = dashboard.ShiftsNeedingVolunteers
        });
    }

    /// <summary>
    /// GET /api/admin/staffing/patterns - Historical volunteer patterns.
    /// </summary>
    [HttpGet("api/admin/staffing/patterns")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetHistoricalPatterns(
        [FromQuery] int months = 6)
    {
        if (months < 1 || months > 24)
            return BadRequest(new { error = "months must be between 1 and 24" });

        var patterns = await _staffing.GetHistoricalPatternsAsync(months);

        return Ok(new PatternsResponse
        {
            PeriodMonths = patterns.PeriodMonths,
            TotalCheckIns = patterns.TotalCheckIns,
            TotalHoursLogged = patterns.TotalHoursLogged,
            CompletionRate = patterns.CompletionRate,
            NoShowRate = patterns.NoShowRate,
            ByDayOfWeek = patterns.ByDayOfWeek.Select(d => new DayPatternResponse
            {
                DayOfWeek = d.DayOfWeek,
                DayName = d.DayName,
                AverageCheckIns = d.AverageCheckIns,
                AverageHoursLogged = d.AverageHoursLogged
            }).ToList(),
            ByMonth = patterns.ByMonth.Select(m => new MonthPatternResponse
            {
                Year = m.Year,
                Month = m.Month,
                TotalCheckIns = m.TotalCheckIns,
                TotalHoursLogged = m.TotalHoursLogged,
                UniqueVolunteers = m.UniqueVolunteers
            }).ToList()
        });
    }

    #endregion

    #region Request/Response DTOs

    public class SetAvailabilityRequest
    {
        [JsonPropertyName("day_of_week")]
        public int DayOfWeek { get; set; }

        [JsonPropertyName("start_time")]
        public string StartTime { get; set; } = string.Empty;

        [JsonPropertyName("end_time")]
        public string EndTime { get; set; } = string.Empty;

        [JsonPropertyName("is_recurring")]
        public bool IsRecurring { get; set; } = true;

        [JsonPropertyName("effective_from")]
        public DateTime? EffectiveFrom { get; set; }

        [JsonPropertyName("effective_until")]
        public DateTime? EffectiveUntil { get; set; }
    }

    public class AvailabilityResponse
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("day_of_week")]
        public int DayOfWeek { get; set; }

        [JsonPropertyName("day_name")]
        public string DayName { get; set; } = string.Empty;

        [JsonPropertyName("start_time")]
        public string StartTime { get; set; } = string.Empty;

        [JsonPropertyName("end_time")]
        public string EndTime { get; set; } = string.Empty;

        [JsonPropertyName("is_recurring")]
        public bool IsRecurring { get; set; }

        [JsonPropertyName("effective_from")]
        public DateTime? EffectiveFrom { get; set; }

        [JsonPropertyName("effective_until")]
        public DateTime? EffectiveUntil { get; set; }
    }

    public class PredictionResponse
    {
        [JsonPropertyName("predicted_date")]
        public DateTime PredictedDate { get; set; }

        [JsonPropertyName("opportunity_id")]
        public int? OpportunityId { get; set; }

        [JsonPropertyName("predicted_volunteers_needed")]
        public int PredictedVolunteersNeeded { get; set; }

        [JsonPropertyName("predicted_volunteers_available")]
        public int PredictedVolunteersAvailable { get; set; }

        [JsonPropertyName("shortfall_risk")]
        public decimal ShortfallRisk { get; set; }

        [JsonPropertyName("factors")]
        public string? Factors { get; set; }
    }

    public class AvailableVolunteerResponse
    {
        [JsonPropertyName("user_id")]
        public int UserId { get; set; }

        [JsonPropertyName("first_name")]
        public string FirstName { get; set; } = string.Empty;

        [JsonPropertyName("last_name")]
        public string LastName { get; set; } = string.Empty;

        [JsonPropertyName("email")]
        public string Email { get; set; } = string.Empty;

        [JsonPropertyName("available_from")]
        public string AvailableFrom { get; set; } = string.Empty;

        [JsonPropertyName("available_to")]
        public string AvailableTo { get; set; } = string.Empty;

        [JsonPropertyName("is_recurring")]
        public bool IsRecurring { get; set; }
    }

    public class StaffingDashboardResponse
    {
        [JsonPropertyName("upcoming_shifts")]
        public List<ShiftResponse> UpcomingShifts { get; set; } = new();

        [JsonPropertyName("shortfall_predictions")]
        public List<PredictionResponse> ShortfallPredictions { get; set; } = new();

        [JsonPropertyName("available_volunteers_today")]
        public int AvailableVolunteersToday { get; set; }

        [JsonPropertyName("total_upcoming_shifts")]
        public int TotalUpcomingShifts { get; set; }

        [JsonPropertyName("shifts_needing_volunteers")]
        public int ShiftsNeedingVolunteers { get; set; }
    }

    public class ShiftResponse
    {
        [JsonPropertyName("shift_id")]
        public int ShiftId { get; set; }

        [JsonPropertyName("opportunity_id")]
        public int OpportunityId { get; set; }

        [JsonPropertyName("title")]
        public string Title { get; set; } = string.Empty;

        [JsonPropertyName("starts_at")]
        public DateTime StartsAt { get; set; }

        [JsonPropertyName("ends_at")]
        public DateTime EndsAt { get; set; }

        [JsonPropertyName("max_volunteers")]
        public int MaxVolunteers { get; set; }

        [JsonPropertyName("current_volunteers")]
        public int CurrentVolunteers { get; set; }
    }

    public class PatternsResponse
    {
        [JsonPropertyName("period_months")]
        public int PeriodMonths { get; set; }

        [JsonPropertyName("total_check_ins")]
        public int TotalCheckIns { get; set; }

        [JsonPropertyName("total_hours_logged")]
        public double TotalHoursLogged { get; set; }

        [JsonPropertyName("completion_rate")]
        public double CompletionRate { get; set; }

        [JsonPropertyName("no_show_rate")]
        public double NoShowRate { get; set; }

        [JsonPropertyName("by_day_of_week")]
        public List<DayPatternResponse> ByDayOfWeek { get; set; } = new();

        [JsonPropertyName("by_month")]
        public List<MonthPatternResponse> ByMonth { get; set; } = new();
    }

    public class DayPatternResponse
    {
        [JsonPropertyName("day_of_week")]
        public int DayOfWeek { get; set; }

        [JsonPropertyName("day_name")]
        public string DayName { get; set; } = string.Empty;

        [JsonPropertyName("average_check_ins")]
        public int AverageCheckIns { get; set; }

        [JsonPropertyName("average_hours_logged")]
        public double AverageHoursLogged { get; set; }
    }

    public class MonthPatternResponse
    {
        [JsonPropertyName("year")]
        public int Year { get; set; }

        [JsonPropertyName("month")]
        public int Month { get; set; }

        [JsonPropertyName("total_check_ins")]
        public int TotalCheckIns { get; set; }

        [JsonPropertyName("total_hours_logged")]
        public double TotalHoursLogged { get; set; }

        [JsonPropertyName("unique_volunteers")]
        public int UniqueVolunteers { get; set; }
    }

    #endregion
}
