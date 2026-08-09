// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing member availability schedules.
/// </summary>
public class AvailabilityService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AvailabilityService> _logger;

    public AvailabilityService(NexusDbContext db, TenantContext tenantContext, ILogger<AvailabilityService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<List<MemberAvailability>> GetScheduleAsync(int userId)
    {
        return await _db.Set<MemberAvailability>()
            .Where(a => a.UserId == userId && a.IsActive)
            .OrderBy(a => a.DayOfWeek).ThenBy(a => a.StartTime)
            .ToListAsync();
    }

    public async Task<(MemberAvailability? Slot, string? Error)> SetSlotAsync(int userId, int dayOfWeek, string startTime, string endTime, string? note)
    {
        // Validate dayOfWeek
        if (dayOfWeek < 0 || dayOfWeek > 6)
            return (null, "dayOfWeek must be between 0 (Sunday) and 6 (Saturday).");

        // Validate time format and ordering
        if (!TimeSpan.TryParseExact(startTime, @"hh\:mm", null, out var startTs) &&
            !TimeSpan.TryParseExact(startTime, @"h\:mm", null, out startTs))
            return (null, "startTime must be in HH:mm format.");

        if (!TimeSpan.TryParseExact(endTime, @"hh\:mm", null, out var endTs) &&
            !TimeSpan.TryParseExact(endTime, @"h\:mm", null, out endTs))
            return (null, "endTime must be in HH:mm format.");

        if (endTs <= startTs)
            return (null, "endTime must be after startTime.");

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var existing = await _db.Set<MemberAvailability>()
            .FirstOrDefaultAsync(a => a.UserId == userId && a.DayOfWeek == dayOfWeek && a.StartTime == startTime);

        if (existing != null)
        {
            existing.EndTime = endTime;
            existing.Note = note;
            existing.IsActive = true;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            existing = new MemberAvailability
            {
                TenantId = tenantId,
                UserId = userId,
                DayOfWeek = dayOfWeek,
                StartTime = startTime,
                EndTime = endTime,
                Note = note
            };
            _db.Set<MemberAvailability>().Add(existing);
        }

        await _db.SaveChangesAsync();
        return (existing, null);
    }

    public async Task<(bool Success, string? Error)> RemoveSlotAsync(int slotId, int userId)
    {
        var slot = await _db.Set<MemberAvailability>()
            .FirstOrDefaultAsync(a => a.Id == slotId && a.UserId == userId);
        if (slot == null) return (false, "Slot not found");

        _db.Set<MemberAvailability>().Remove(slot);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<List<MemberAvailability>> BulkSetScheduleAsync(int userId, List<(int Day, string Start, string End, string? Note)> slots)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Remove all existing
        var existing = await _db.Set<MemberAvailability>()
            .Where(a => a.UserId == userId)
            .ToListAsync();
        _db.Set<MemberAvailability>().RemoveRange(existing);

        // Add new
        var newSlots = slots.Select(s => new MemberAvailability
        {
            TenantId = tenantId,
            UserId = userId,
            DayOfWeek = s.Day,
            StartTime = s.Start,
            EndTime = s.End,
            Note = s.Note
        }).ToList();

        _db.Set<MemberAvailability>().AddRange(newSlots);
        await _db.SaveChangesAsync();

        return newSlots;
    }

    public async Task<List<AvailabilityException>> GetExceptionsAsync(int userId, DateTime? from = null, DateTime? to = null)
    {
        var query = _db.Set<AvailabilityException>()
            .Where(e => e.UserId == userId);

        if (from.HasValue) query = query.Where(e => e.Date >= from.Value);
        if (to.HasValue) query = query.Where(e => e.Date <= to.Value);

        return await query.OrderBy(e => e.Date).ToListAsync();
    }

    public async Task<AvailabilityException> AddExceptionAsync(int userId, DateTime date, string type, string? startTime, string? endTime, string? reason)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var exception = new AvailabilityException
        {
            TenantId = tenantId,
            UserId = userId,
            Date = date.Date,
            Type = type,
            StartTime = startTime,
            EndTime = endTime,
            Reason = reason
        };

        _db.Set<AvailabilityException>().Add(exception);
        await _db.SaveChangesAsync();
        return exception;
    }

    public async Task<(bool Success, string? Error)> RemoveExceptionAsync(int exceptionId, int userId)
    {
        var exception = await _db.Set<AvailabilityException>()
            .FirstOrDefaultAsync(e => e.Id == exceptionId && e.UserId == userId);
        if (exception == null) return (false, "Exception not found");

        _db.Set<AvailabilityException>().Remove(exception);
        await _db.SaveChangesAsync();
        return (true, null);
    }
}
