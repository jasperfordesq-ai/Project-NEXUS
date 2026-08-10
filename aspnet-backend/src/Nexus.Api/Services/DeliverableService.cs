// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Manages deliverables — work items assigned to members, tracked by admin teams.
/// </summary>
public class DeliverableService
{
    private readonly NexusDbContext _db;

    public DeliverableService(NexusDbContext db) => _db = db;

    public async Task<(List<Deliverable>, int)> ListDeliverablesAsync(
        int tenantId, string? status, string? priority, int? assignedToUserId, int page, int limit)
    {
        var q = _db.Deliverables
            .Include(d => d.AssignedTo)
            .Include(d => d.CreatedBy)
            .Where(d => d.TenantId == tenantId);

        if (status != null && Enum.TryParse<DeliverableStatus>(status, true, out var s))
            q = q.Where(d => d.Status == s);
        if (priority != null && Enum.TryParse<DeliverablePriority>(priority, true, out var p))
            q = q.Where(d => d.Priority == p);
        if (assignedToUserId.HasValue)
            q = q.Where(d => d.AssignedToUserId == assignedToUserId.Value);

        q = q.OrderByDescending(d => d.CreatedAt);
        var total = await q.CountAsync();
        var items = await q.Skip((page - 1) * limit).Take(limit).ToListAsync();
        return (items, total);
    }

    public async Task<Deliverable?> GetDeliverableAsync(int tenantId, int id)
        => await _db.Deliverables
            .Include(d => d.AssignedTo)
            .Include(d => d.CreatedBy)
            .Include(d => d.Comments).ThenInclude(c => c.User)
            .FirstOrDefaultAsync(d => d.TenantId == tenantId && d.Id == id);

    public async Task<(Deliverable?, string?)> CreateDeliverableAsync(
        int tenantId, int createdByUserId, string title, string? description,
        int? assignedToUserId, string? priority, DateTime? dueDate, string? tags)
    {
        var d = new Deliverable
        {
            TenantId = tenantId,
            CreatedByUserId = createdByUserId,
            Title = title,
            Description = description,
            AssignedToUserId = assignedToUserId,
            DueDate = dueDate,
            Tags = tags
        };
        if (priority != null && Enum.TryParse<DeliverablePriority>(priority, true, out var p))
            d.Priority = p;
        _db.Deliverables.Add(d);
        await _db.SaveChangesAsync();
        return (d, null);
    }

    public async Task<(Deliverable?, string?)> UpdateDeliverableAsync(
        int tenantId, int id, string? title, string? description,
        int? assignedToUserId, string? status, string? priority, DateTime? dueDate, string? tags)
    {
        var d = await GetDeliverableAsync(tenantId, id);
        if (d == null) return (null, "Deliverable not found");
        if (title != null) d.Title = title;
        if (description != null) d.Description = description;
        if (assignedToUserId.HasValue) d.AssignedToUserId = assignedToUserId;
        if (dueDate.HasValue) d.DueDate = dueDate;
        if (tags != null) d.Tags = tags;
        if (status != null && Enum.TryParse<DeliverableStatus>(status, true, out var s))
        {
            d.Status = s;
            if (s == DeliverableStatus.Completed && d.CompletedAt == null)
                d.CompletedAt = DateTime.UtcNow;
        }
        if (priority != null && Enum.TryParse<DeliverablePriority>(priority, true, out var p))
            d.Priority = p;
        d.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (d, null);
    }

    public async Task<(bool, string?)> DeleteDeliverableAsync(int tenantId, int id)
    {
        var d = await _db.Deliverables.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id);
        if (d == null) return (false, "Deliverable not found");
        _db.Deliverables.Remove(d);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(DeliverableComment?, string?)> AddCommentAsync(int tenantId, int deliverableId, int userId, string content)
    {
        var exists = await _db.Deliverables.AnyAsync(d => d.TenantId == tenantId && d.Id == deliverableId);
        if (!exists) return (null, "Deliverable not found");
        var comment = new DeliverableComment
        {
            TenantId = tenantId,
            DeliverableId = deliverableId,
            UserId = userId,
            Content = content
        };
        _db.DeliverableComments.Add(comment);
        await _db.SaveChangesAsync();
        return (comment, null);
    }

    public async Task<object> GetDashboardAsync(int tenantId)
    {
        var all = await _db.Deliverables.Where(d => d.TenantId == tenantId).ToListAsync();
        var now = DateTime.UtcNow;
        return new
        {
            total = all.Count,
            by_status = all.GroupBy(d => d.Status.ToString()).ToDictionary(g => g.Key, g => g.Count()),
            by_priority = all.GroupBy(d => d.Priority.ToString()).ToDictionary(g => g.Key, g => g.Count()),
            overdue_count = all.Count(d => d.DueDate < now && d.Status != DeliverableStatus.Completed && d.Status != DeliverableStatus.Cancelled),
            due_soon_count = all.Count(d => d.DueDate >= now && d.DueDate <= now.AddDays(7) && (d.Status == DeliverableStatus.Pending || d.Status == DeliverableStatus.InProgress))
        };
    }

    public async Task<object> GetAnalyticsAsync(int tenantId)
    {
        var completed = await _db.Deliverables
            .Where(d => d.TenantId == tenantId && d.Status == DeliverableStatus.Completed && d.CompletedAt.HasValue)
            .ToListAsync();
        var total = await _db.Deliverables.CountAsync(d => d.TenantId == tenantId);
        var avgDays = completed.Any()
            ? completed.Average(d => (d.CompletedAt!.Value - d.CreatedAt).TotalDays)
            : 0;
        var byAssignee = completed
            .GroupBy(d => d.AssignedToUserId ?? 0)
            .Select(g => new { user_id = g.Key, completed = g.Count() })
            .ToList();
        return new
        {
            completion_rate = total > 0 ? Math.Round((double)completed.Count / total * 100, 1) : 0,
            avg_completion_days = Math.Round(avgDays, 1),
            total_completed = completed.Count,
            by_assignee = byAssignee
        };
    }
}
