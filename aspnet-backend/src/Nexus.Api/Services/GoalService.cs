// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing personal and community goals.
/// </summary>
public class GoalService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<GoalService> _logger;

    public GoalService(NexusDbContext db, TenantContext tenantContext, GamificationService gamification, ILogger<GoalService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
    }

    public async Task<(Goal? Goal, string? Error)> CreateGoalAsync(
        int userId, string title, string? description, string goalType,
        decimal? targetValue, string? category, DateTime? targetDate,
        List<string>? milestones = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var goal = new Goal
        {
            TenantId = tenantId,
            UserId = userId,
            Title = title.Trim(),
            Description = description?.Trim(),
            GoalType = goalType,
            TargetValue = targetValue,
            Category = category?.Trim(),
            TargetDate = targetDate,
            Status = "active"
        };

        _db.Set<Goal>().Add(goal);
        await _db.SaveChangesAsync();

        if (milestones != null)
        {
            for (int i = 0; i < milestones.Count; i++)
            {
                _db.Set<GoalMilestone>().Add(new GoalMilestone
                {
                    TenantId = tenantId,
                    GoalId = goal.Id,
                    Title = milestones[i].Trim(),
                    SortOrder = i
                });
            }
            await _db.SaveChangesAsync();
        }

        return (goal, null);
    }

    public async Task<(List<Goal> Data, int Total)> ListGoalsAsync(int userId, int page, int limit, string? status = null)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Set<Goal>().Where(g => g.UserId == userId);

        if (!string.IsNullOrEmpty(status))
            query = query.Where(g => g.Status == status);

        var total = await query.CountAsync();
        var data = await query
            .Include(g => g.Milestones.OrderBy(m => m.SortOrder))
            .OrderByDescending(g => g.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (data, total);
    }

    public async Task<Goal?> GetGoalAsync(int goalId, int userId)
    {
        return await _db.Set<Goal>()
            .Include(g => g.Milestones.OrderBy(m => m.SortOrder))
            .FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);
    }

    public async Task<(Goal? Goal, string? Error)> UpdateProgressAsync(int goalId, int userId, decimal progressValue)
    {
        var goal = await _db.Set<Goal>()
            .FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);

        if (goal == null)
            return (null, "Goal not found");

        if (goal.Status != "active")
            return (null, "Goal is not active");

        goal.CurrentValue = progressValue;
        goal.UpdatedAt = DateTime.UtcNow;

        // Auto-complete if target reached
        if (goal.TargetValue.HasValue && goal.CurrentValue >= goal.TargetValue.Value)
        {
            goal.Status = "completed";
            goal.CompletedAt = DateTime.UtcNow;

            try
            {
                await _gamification.AwardXpAsync(userId, XpLog.Amounts.GoalCompleted, XpLog.Sources.GoalCompleted, goalId, $"Completed goal: {goal.Title}");
            }
            catch (DbUpdateException ex) { _logger.LogWarning(ex, "Failed to award XP for goal {GoalId}", goalId); }
            catch (InvalidOperationException ex) { _logger.LogWarning(ex, "Failed to award XP for goal {GoalId}", goalId); }
        }

        await _db.SaveChangesAsync();
        return (goal, null);
    }

    public async Task<(bool Success, string? Error)> CompleteMilestoneAsync(int goalId, int milestoneId, int userId)
    {
        var goal = await _db.Set<Goal>()
            .Include(g => g.Milestones)
            .FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);

        if (goal == null) return (false, "Goal not found");

        var milestone = goal.Milestones.FirstOrDefault(m => m.Id == milestoneId);
        if (milestone == null) return (false, "Milestone not found");

        milestone.IsCompleted = true;
        milestone.CompletedAt = DateTime.UtcNow;

        // Check if all milestones are complete
        if (goal.Milestones.All(m => m.IsCompleted))
        {
            goal.Status = "completed";
            goal.CompletedAt = DateTime.UtcNow;

            try
            {
                await _gamification.AwardXpAsync(userId, XpLog.Amounts.GoalCompleted, XpLog.Sources.GoalCompleted, goalId, $"Completed goal: {goal.Title}");
            }
            catch (Exception ex) when (ex is InvalidOperationException or Microsoft.EntityFrameworkCore.DbUpdateException) { _logger.LogWarning(ex, "Failed to award XP for goal {GoalId}", goalId); }
        }

        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> AbandonGoalAsync(int goalId, int userId)
    {
        var goal = await _db.Set<Goal>().FirstOrDefaultAsync(g => g.Id == goalId && g.UserId == userId);
        if (goal == null) return (false, "Goal not found");
        if (goal.Status != "active") return (false, "Goal is not active");

        goal.Status = "abandoned";
        goal.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return (true, null);
    }
}
