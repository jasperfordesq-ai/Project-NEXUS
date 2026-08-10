// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for predictive staffing analysis. Analyzes historical volunteer
/// check-in patterns to forecast staffing needs and identify shortfall risks.
/// </summary>
public class PredictiveStaffingService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<PredictiveStaffingService> _logger;

    public PredictiveStaffingService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<PredictiveStaffingService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Predict staffing needs for upcoming days based on historical patterns.
    /// Analyzes check-in rates by day of week, seasonal trends, and no-show rates.
    /// </summary>
    public async Task<List<StaffingPredictionResult>> PredictStaffingNeedsAsync(int? opportunityId, int daysAhead = 14)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var today = DateTime.UtcNow.Date;
        var predictions = new List<StaffingPredictionResult>();

        // Get historical check-in data (last 6 months)
        var sixMonthsAgo = today.AddMonths(-6);
        var checkInsQuery = _db.VolunteerCheckIns
            .AsNoTracking()
            .Where(c => c.CheckedInAt.HasValue && c.CheckedInAt.Value >= sixMonthsAgo);

        if (opportunityId.HasValue)
        {
            checkInsQuery = checkInsQuery
                .Where(c => c.Shift != null && c.Shift.OpportunityId == opportunityId.Value);
        }

        var checkIns = await checkInsQuery
            .Select(c => new
            {
                CheckedInAt = c.CheckedInAt!.Value,
                c.CheckedOutAt,
                DayOfWeek = c.CheckedInAt.Value.DayOfWeek,
                Month = c.CheckedInAt.Value.Month
            })
            .ToListAsync();

        // Calculate average check-ins per day of week
        var checkInsByDay = checkIns
            .GroupBy(c => c.DayOfWeek)
            .ToDictionary(
                g => g.Key,
                g => (double)g.Count());

        // Total weeks in the data window for averaging
        var totalWeeks = Math.Max(1, (today - sixMonthsAgo).Days / 7.0);
        var avgByDay = checkInsByDay.ToDictionary(
            kvp => kvp.Key,
            kvp => kvp.Value / totalWeeks);

        // Calculate no-show rate (checked in but never checked out)
        var totalCheckIns = checkIns.Count;
        var noShows = checkIns.Count(c => c.CheckedOutAt == null && c.CheckedInAt < today.AddDays(-1));
        var noShowRate = totalCheckIns > 0 ? (double)noShows / totalCheckIns : 0.1;

        // Monthly trend factor
        var checkInsByMonth = checkIns
            .GroupBy(c => c.Month)
            .ToDictionary(g => g.Key, g => g.Count());
        var avgMonthly = checkInsByMonth.Values.DefaultIfEmpty(0).Average();

        // Get upcoming shifts that need staffing
        var upcomingShifts = await _db.VolunteerShifts
            .AsNoTracking()
            .Where(s => s.StartsAt >= today && s.StartsAt < today.AddDays(daysAhead))
            .Where(s => s.Status == ShiftStatus.Scheduled || s.Status == ShiftStatus.InProgress)
            .Where(s => !opportunityId.HasValue || s.OpportunityId == opportunityId.Value)
            .Select(s => new
            {
                s.Id,
                s.OpportunityId,
                s.StartsAt,
                s.MaxVolunteers,
                s.Title,
                CurrentCheckIns = s.CheckIns.Count
            })
            .ToListAsync();

        // Get available volunteers count by day
        var availabilities = await _db.Set<VolunteerAvailability>()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Where(a => a.EffectiveUntil == null || a.EffectiveUntil >= today)
            .Where(a => a.EffectiveFrom == null || a.EffectiveFrom <= today.AddDays(daysAhead))
            .ToListAsync();

        for (int day = 0; day < daysAhead; day++)
        {
            var targetDate = today.AddDays(day);
            var dayOfWeek = targetDate.DayOfWeek;

            // Predicted volunteers needed from shifts on this day
            var shiftsOnDay = upcomingShifts
                .Where(s => s.StartsAt.Date == targetDate)
                .ToList();

            var volunteersNeeded = shiftsOnDay.Sum(s => s.MaxVolunteers);
            if (volunteersNeeded == 0 && !shiftsOnDay.Any())
            {
                // Estimate from historical average
                volunteersNeeded = (int)Math.Ceiling(avgByDay.GetValueOrDefault(dayOfWeek, 0));
            }

            // Available volunteers on this day
            var availableCount = availabilities
                .Count(a => a.DayOfWeek == (int)dayOfWeek
                    && (a.IsRecurring || (a.EffectiveFrom <= targetDate && (a.EffectiveUntil == null || a.EffectiveUntil >= targetDate))));

            // Adjust for no-show rate
            var effectiveAvailable = (int)Math.Floor(availableCount * (1.0 - noShowRate));

            // Monthly trend factor
            var monthFactor = avgMonthly > 0
                ? checkInsByMonth.GetValueOrDefault(targetDate.Month, (int)avgMonthly) / avgMonthly
                : 1.0;

            // Shortfall risk calculation
            var shortfallRisk = 0.0m;
            if (volunteersNeeded > 0)
            {
                var ratio = effectiveAvailable / (double)volunteersNeeded;
                shortfallRisk = ratio >= 1.5 ? 0.0m
                    : ratio >= 1.0 ? 0.2m
                    : ratio >= 0.75 ? 0.5m
                    : ratio >= 0.5 ? 0.75m
                    : 0.95m;

                // Adjust for monthly trend
                if (monthFactor < 0.8)
                    shortfallRisk = Math.Min(1.0m, shortfallRisk + 0.1m);
            }

            var factors = new
            {
                historical_avg_day = avgByDay.GetValueOrDefault(dayOfWeek, 0),
                no_show_rate = noShowRate,
                monthly_trend_factor = monthFactor,
                shifts_on_day = shiftsOnDay.Count,
                raw_available = availableCount,
                effective_available = effectiveAvailable
            };

            predictions.Add(new StaffingPredictionResult
            {
                PredictedDate = targetDate,
                OpportunityId = opportunityId,
                PredictedVolunteersNeeded = volunteersNeeded,
                PredictedVolunteersAvailable = effectiveAvailable,
                ShortfallRisk = shortfallRisk,
                Factors = JsonSerializer.Serialize(factors)
            });
        }

        _logger.LogInformation(
            "Generated {Count} staffing predictions for tenant {TenantId}, opportunity {OpportunityId}",
            predictions.Count, tenantId, opportunityId?.ToString() ?? "all");

        return predictions;
    }

    /// <summary>
    /// Get volunteers available on a specific date, optionally filtered by time window.
    /// </summary>
    public async Task<List<AvailableVolunteerResult>> GetAvailableVolunteersAsync(
        DateTime date, TimeOnly? startTime = null, TimeOnly? endTime = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var dayOfWeek = (int)date.DayOfWeek;

        var query = _db.Set<VolunteerAvailability>()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Where(a => a.DayOfWeek == dayOfWeek)
            .Where(a => a.EffectiveFrom == null || a.EffectiveFrom <= date)
            .Where(a => a.EffectiveUntil == null || a.EffectiveUntil >= date);

        if (startTime.HasValue)
            query = query.Where(a => a.EndTime >= startTime.Value);

        if (endTime.HasValue)
            query = query.Where(a => a.StartTime <= endTime.Value);

        var results = await query
            .Include(a => a.User)
            .Select(a => new AvailableVolunteerResult
            {
                UserId = a.UserId,
                FirstName = a.User != null ? a.User.FirstName : "",
                LastName = a.User != null ? a.User.LastName : "",
                Email = a.User != null ? a.User.Email : "",
                AvailableFrom = a.StartTime,
                AvailableTo = a.EndTime,
                IsRecurring = a.IsRecurring
            })
            .ToListAsync();

        return results;
    }

    /// <summary>
    /// Set availability for a volunteer user.
    /// Upserts based on userId + dayOfWeek + time window.
    /// </summary>
    public async Task<VolunteerAvailability> SetAvailabilityAsync(
        int userId, int dayOfWeek, TimeOnly startTime, TimeOnly endTime,
        bool isRecurring = true, DateTime? effectiveFrom = null, DateTime? effectiveUntil = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Find existing availability for this user/day/time
        var existing = await _db.Set<VolunteerAvailability>()
            .FirstOrDefaultAsync(a =>
                a.TenantId == tenantId
                && a.UserId == userId
                && a.DayOfWeek == dayOfWeek
                && a.StartTime == startTime
                && a.EndTime == endTime);

        if (existing != null)
        {
            existing.IsRecurring = isRecurring;
            existing.EffectiveFrom = effectiveFrom;
            existing.EffectiveUntil = effectiveUntil;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new VolunteerAvailability
            {
                TenantId = tenantId,
                UserId = userId,
                DayOfWeek = dayOfWeek,
                StartTime = startTime,
                EndTime = endTime,
                IsRecurring = isRecurring,
                EffectiveFrom = effectiveFrom,
                EffectiveUntil = effectiveUntil
            };
            _db.Set<VolunteerAvailability>().Add(existing);
        }

        await _db.SaveChangesAsync();
        return existing;
    }

    /// <summary>
    /// Get all availability records for a user.
    /// </summary>
    public async Task<List<VolunteerAvailability>> GetMyAvailabilityAsync(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        return await _db.Set<VolunteerAvailability>()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.UserId == userId)
            .OrderBy(a => a.DayOfWeek)
            .ThenBy(a => a.StartTime)
            .ToListAsync();
    }

    /// <summary>
    /// Get staffing dashboard overview: upcoming shifts, predicted shortfalls, available count.
    /// </summary>
    public async Task<StaffingDashboardResult> GetStaffingDashboardAsync()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var today = DateTime.UtcNow.Date;
        var nextWeek = today.AddDays(7);

        // Upcoming shifts in next 7 days
        var upcomingShifts = await _db.VolunteerShifts
            .AsNoTracking()
            .Where(s => s.StartsAt >= today && s.StartsAt < nextWeek)
            .Where(s => s.Status == ShiftStatus.Scheduled)
            .Select(s => new ShiftSummary
            {
                ShiftId = s.Id,
                OpportunityId = s.OpportunityId,
                Title = s.Title ?? (s.Opportunity != null ? s.Opportunity.Title : "Untitled"),
                StartsAt = s.StartsAt,
                EndsAt = s.EndsAt,
                MaxVolunteers = s.MaxVolunteers,
                CurrentVolunteers = s.CheckIns.Count
            })
            .OrderBy(s => s.StartsAt)
            .ToListAsync();

        // Run predictions for next 7 days
        var predictions = await PredictStaffingNeedsAsync(null, 7);
        var shortfallDays = predictions
            .Where(p => p.ShortfallRisk >= 0.5m)
            .ToList();

        // Total available volunteers today
        var todayDow = (int)today.DayOfWeek;
        var availableToday = await _db.Set<VolunteerAvailability>()
            .AsNoTracking()
            .Where(a => a.TenantId == tenantId)
            .Where(a => a.DayOfWeek == todayDow)
            .Where(a => a.EffectiveFrom == null || a.EffectiveFrom <= today)
            .Where(a => a.EffectiveUntil == null || a.EffectiveUntil >= today)
            .Select(a => a.UserId)
            .Distinct()
            .CountAsync();

        return new StaffingDashboardResult
        {
            UpcomingShifts = upcomingShifts,
            ShortfallPredictions = shortfallDays,
            AvailableVolunteersToday = availableToday,
            TotalUpcomingShifts = upcomingShifts.Count,
            ShiftsNeedingVolunteers = upcomingShifts.Count(s => s.CurrentVolunteers < s.MaxVolunteers)
        };
    }

    /// <summary>
    /// Get historical volunteer patterns for analysis.
    /// </summary>
    public async Task<HistoricalPatternsResult> GetHistoricalPatternsAsync(int months = 6)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var since = DateTime.UtcNow.Date.AddMonths(-months);

        var checkIns = await _db.VolunteerCheckIns
            .AsNoTracking()
            .Where(c => c.CheckedInAt.HasValue && c.CheckedInAt.Value >= since)
            .Select(c => new
            {
                c.UserId,
                CheckedInAt = c.CheckedInAt!.Value,
                c.CheckedOutAt,
                c.HoursLogged,
                DayOfWeek = c.CheckedInAt.Value.DayOfWeek,
                Month = c.CheckedInAt.Value.Month,
                Year = c.CheckedInAt.Value.Year
            })
            .ToListAsync();

        // By day of week
        var byDayOfWeek = checkIns
            .GroupBy(c => c.DayOfWeek)
            .OrderBy(g => g.Key)
            .Select(g => new DayOfWeekPattern
            {
                DayOfWeek = (int)g.Key,
                DayName = g.Key.ToString(),
                AverageCheckIns = g.Count(),
                AverageHoursLogged = g.Where(c => c.HoursLogged.HasValue).Average(c => (double?)c.HoursLogged) ?? 0
            })
            .ToList();

        // By month
        var byMonth = checkIns
            .GroupBy(c => new { c.Year, c.Month })
            .OrderBy(g => g.Key.Year).ThenBy(g => g.Key.Month)
            .Select(g => new MonthlyPattern
            {
                Year = g.Key.Year,
                Month = g.Key.Month,
                TotalCheckIns = g.Count(),
                TotalHoursLogged = g.Where(c => c.HoursLogged.HasValue).Sum(c => (double?)c.HoursLogged) ?? 0,
                UniqueVolunteers = g.Select(c => c.UserId).Distinct().Count()
            })
            .ToList();

        // No-show analysis
        var totalCompleted = checkIns.Count(c => c.CheckedOutAt != null);
        var totalNoShows = checkIns.Count(c => c.CheckedOutAt == null && c.CheckedInAt < DateTime.UtcNow.AddDays(-1));

        return new HistoricalPatternsResult
        {
            PeriodMonths = months,
            TotalCheckIns = checkIns.Count,
            TotalHoursLogged = checkIns.Where(c => c.HoursLogged.HasValue).Sum(c => (double)c.HoursLogged!.Value),
            CompletionRate = checkIns.Count > 0 ? (double)totalCompleted / checkIns.Count : 0,
            NoShowRate = checkIns.Count > 0 ? (double)totalNoShows / checkIns.Count : 0,
            ByDayOfWeek = byDayOfWeek,
            ByMonth = byMonth
        };
    }
}

#region Result DTOs

public class StaffingPredictionResult
{
    public DateTime PredictedDate { get; set; }
    public int? OpportunityId { get; set; }
    public int PredictedVolunteersNeeded { get; set; }
    public int PredictedVolunteersAvailable { get; set; }
    public decimal ShortfallRisk { get; set; }
    public string? Factors { get; set; }
}

public class AvailableVolunteerResult
{
    public int UserId { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public TimeOnly AvailableFrom { get; set; }
    public TimeOnly AvailableTo { get; set; }
    public bool IsRecurring { get; set; }
}

public class StaffingDashboardResult
{
    public List<ShiftSummary> UpcomingShifts { get; set; } = new();
    public List<StaffingPredictionResult> ShortfallPredictions { get; set; } = new();
    public int AvailableVolunteersToday { get; set; }
    public int TotalUpcomingShifts { get; set; }
    public int ShiftsNeedingVolunteers { get; set; }
}

public class ShiftSummary
{
    public int ShiftId { get; set; }
    public int OpportunityId { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime StartsAt { get; set; }
    public DateTime EndsAt { get; set; }
    public int MaxVolunteers { get; set; }
    public int CurrentVolunteers { get; set; }
}

public class HistoricalPatternsResult
{
    public int PeriodMonths { get; set; }
    public int TotalCheckIns { get; set; }
    public double TotalHoursLogged { get; set; }
    public double CompletionRate { get; set; }
    public double NoShowRate { get; set; }
    public List<DayOfWeekPattern> ByDayOfWeek { get; set; } = new();
    public List<MonthlyPattern> ByMonth { get; set; } = new();
}

public class DayOfWeekPattern
{
    public int DayOfWeek { get; set; }
    public string DayName { get; set; } = string.Empty;
    public int AverageCheckIns { get; set; }
    public double AverageHoursLogged { get; set; }
}

public class MonthlyPattern
{
    public int Year { get; set; }
    public int Month { get; set; }
    public int TotalCheckIns { get; set; }
    public double TotalHoursLogged { get; set; }
    public int UniqueVolunteers { get; set; }
}

#endregion
