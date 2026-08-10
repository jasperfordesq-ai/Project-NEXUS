// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for broker assignments and notes management.
/// </summary>
public class BrokerService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<BrokerService> _logger;

    public BrokerService(NexusDbContext db, ILogger<BrokerService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<BrokerAssignment>> GetAssignmentsAsync(int? brokerId = null, string? status = null)
    {
        var query = _db.Set<BrokerAssignment>()
            .Include(a => a.Broker)
            .Include(a => a.Member)
            .AsQueryable();

        if (brokerId.HasValue)
            query = query.Where(a => a.BrokerId == brokerId.Value);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(a => a.Status == status);

        return await query.OrderByDescending(a => a.CreatedAt).ToListAsync();
    }

    public async Task<BrokerAssignment?> GetAssignmentAsync(int id)
    {
        return await _db.Set<BrokerAssignment>()
            .Include(a => a.Broker)
            .Include(a => a.Member)
            .FirstOrDefaultAsync(a => a.Id == id);
    }

    public async Task<(BrokerAssignment? Assignment, string? Error)> CreateAssignmentAsync(
        int tenantId, int brokerId, int memberId, string? notes)
    {
        var broker = await _db.Users.FirstOrDefaultAsync(x => x.Id == brokerId);
        if (broker == null) return (null, "Broker not found");

        var member = await _db.Users.FirstOrDefaultAsync(x => x.Id == memberId);
        if (member == null) return (null, "Member not found");

        var existing = await _db.Set<BrokerAssignment>()
            .AnyAsync(a => a.BrokerId == brokerId && a.MemberId == memberId && a.Status == "active");
        if (existing) return (null, "Active assignment already exists for this broker/member pair");

        var assignment = new BrokerAssignment
        {
            TenantId = tenantId,
            BrokerId = brokerId,
            MemberId = memberId,
            Notes = notes,
            Status = "active"
        };

        _db.Set<BrokerAssignment>().Add(assignment);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Broker assignment {Id} created: broker {BrokerId} -> member {MemberId}", assignment.Id, brokerId, memberId);
        return (assignment, null);
    }

    public async Task<(BrokerAssignment? Assignment, string? Error)> UpdateAssignmentAsync(
        int id, string status, string? notes)
    {
        var assignment = await _db.Set<BrokerAssignment>().FirstOrDefaultAsync(x => x.Id == id);
        if (assignment == null) return (null, "Assignment not found");

        assignment.Status = status;
        if (notes != null) assignment.Notes = notes;
        assignment.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return (assignment, null);
    }

    public async Task<(BrokerAssignment? Assignment, string? Error)> CompleteAssignmentAsync(int id)
    {
        var assignment = await _db.Set<BrokerAssignment>().FirstOrDefaultAsync(x => x.Id == id);
        if (assignment == null) return (null, "Assignment not found");
        if (assignment.Status == "completed") return (null, "Assignment is already completed");

        assignment.Status = "completed";
        assignment.CompletedAt = DateTime.UtcNow;
        assignment.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Broker assignment {Id} completed", id);
        return (assignment, null);
    }

    public async Task<(BrokerAssignment? Assignment, string? Error)> ReassignAsync(int id, int newBrokerId)
    {
        var assignment = await _db.Set<BrokerAssignment>().FirstOrDefaultAsync(x => x.Id == id);
        if (assignment == null) return (null, "Assignment not found");

        var broker = await _db.Users.FirstOrDefaultAsync(x => x.Id == newBrokerId);
        if (broker == null) return (null, "New broker not found");

        var oldBrokerId = assignment.BrokerId;
        assignment.BrokerId = newBrokerId;
        assignment.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        _logger.LogInformation("Broker assignment {Id} reassigned from {OldBrokerId} to {NewBrokerId}", id, oldBrokerId, newBrokerId);
        return (assignment, null);
    }

    public async Task<string?> DeleteAssignmentAsync(int id)
    {
        var assignment = await _db.Set<BrokerAssignment>().FirstOrDefaultAsync(x => x.Id == id);
        if (assignment == null) return "Assignment not found";

        _db.Set<BrokerAssignment>().Remove(assignment);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<List<BrokerNote>> GetNotesAsync(int? memberId = null, int? exchangeId = null)
    {
        var query = _db.Set<BrokerNote>()
            .Include(n => n.Broker)
            .Include(n => n.Member)
            .AsQueryable();

        if (memberId.HasValue)
            query = query.Where(n => n.MemberId == memberId.Value);

        if (exchangeId.HasValue)
            query = query.Where(n => n.ExchangeId == exchangeId.Value);

        return await query.OrderByDescending(n => n.CreatedAt).ToListAsync();
    }

    public async Task<(BrokerNote? Note, string? Error)> CreateNoteAsync(
        int tenantId, int brokerId, int? memberId, int? exchangeId, string content, bool isPrivate)
    {
        if (string.IsNullOrWhiteSpace(content)) return (null, "Content is required");
        if (!memberId.HasValue && !exchangeId.HasValue) return (null, "Either memberId or exchangeId is required");

        var note = new BrokerNote
        {
            TenantId = tenantId,
            BrokerId = brokerId,
            MemberId = memberId,
            ExchangeId = exchangeId,
            Content = content,
            IsPrivate = isPrivate
        };

        _db.Set<BrokerNote>().Add(note);
        await _db.SaveChangesAsync();
        return (note, null);
    }

    public async Task<object> GetBrokerStatsAsync(int brokerId)
    {
        var activeAssignments = await _db.Set<BrokerAssignment>()
            .CountAsync(a => a.BrokerId == brokerId && a.Status == "active");
        var completedAssignments = await _db.Set<BrokerAssignment>()
            .CountAsync(a => a.BrokerId == brokerId && a.Status == "completed");
        var totalAssignments = await _db.Set<BrokerAssignment>()
            .CountAsync(a => a.BrokerId == brokerId);
        var notesCount = await _db.Set<BrokerNote>()
            .CountAsync(n => n.BrokerId == brokerId);

        return new
        {
            broker_id = brokerId,
            active_assignments = activeAssignments,
            completed_assignments = completedAssignments,
            total_assignments = totalAssignments,
            notes_count = notesCount
        };
    }

    public async Task<object> GetOverallStatsAsync()
    {
        var totalAssignments = await _db.Set<BrokerAssignment>().CountAsync();
        var activeAssignments = await _db.Set<BrokerAssignment>().CountAsync(a => a.Status == "active");
        var completedAssignments = await _db.Set<BrokerAssignment>().CountAsync(a => a.Status == "completed");
        var totalNotes = await _db.Set<BrokerNote>().CountAsync();
        var activeBrokers = await _db.Set<BrokerAssignment>()
            .Where(a => a.Status == "active")
            .Select(a => a.BrokerId)
            .Distinct()
            .CountAsync();

        return new
        {
            total_assignments = totalAssignments,
            active_assignments = activeAssignments,
            completed_assignments = completedAssignments,
            total_notes = totalNotes,
            active_brokers = activeBrokers
        };
    }
}
