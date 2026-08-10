// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for onboarding wizard step management and progress tracking.
/// </summary>
public class OnboardingService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<OnboardingService> _logger;

    public OnboardingService(NexusDbContext db, ILogger<OnboardingService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<List<OnboardingStep>> GetStepsAsync()
    {
        return await _db.Set<OnboardingStep>()
            .OrderBy(s => s.SortOrder)
            .ToListAsync();
    }

    public async Task<object> GetProgressAsync(int userId)
    {
        var steps = await _db.Set<OnboardingStep>()
            .OrderBy(s => s.SortOrder)
            .ToListAsync();

        var progress = await _db.Set<OnboardingProgress>()
            .Where(p => p.UserId == userId)
            .ToListAsync();

        var completed = progress.Count(p => p.IsCompleted);
        var total = steps.Count;

        return new
        {
            total_steps = total,
            completed_steps = completed,
            completion_percent = total > 0 ? (int)((double)completed / total * 100) : 0,
            is_complete = completed >= steps.Count(s => s.IsRequired),
            steps = steps.Select(s =>
            {
                var p = progress.FirstOrDefault(pr => pr.StepId == s.Id);
                return new
                {
                    s.Id, s.Key, s.Title, s.Description, s.SortOrder,
                    is_required = s.IsRequired, xp_reward = s.XpReward,
                    is_completed = p?.IsCompleted ?? false,
                    completed_at = p?.CompletedAt
                };
            })
        };
    }

    public async Task<(bool Success, string? Error)> CompleteStepAsync(int userId, string stepKey)
    {
        var step = await _db.Set<OnboardingStep>()
            .FirstOrDefaultAsync(s => s.Key == stepKey);
        if (step == null) return (false, "Step not found");

        var existing = await _db.Set<OnboardingProgress>()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.StepId == step.Id);

        if (existing != null && existing.IsCompleted)
            return (true, null); // Already completed

        if (existing == null)
        {
            existing = new OnboardingProgress
            {
                UserId = userId,
                StepId = step.Id,
                IsCompleted = true,
                CompletedAt = DateTime.UtcNow
            };
            _db.Set<OnboardingProgress>().Add(existing);
        }
        else
        {
            existing.IsCompleted = true;
            existing.CompletedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(bool Success, string? Error)> ResetProgressAsync(int userId)
    {
        var progress = await _db.Set<OnboardingProgress>()
            .Where(p => p.UserId == userId)
            .ToListAsync();

        _db.Set<OnboardingProgress>().RemoveRange(progress);
        await _db.SaveChangesAsync();
        return (true, null);
    }

    // Admin: manage steps
    public async Task<(OnboardingStep? Step, string? Error)> CreateStepAsync(
        string key, string title, string? description, int sortOrder, bool isRequired, int xpReward)
    {
        var existing = await _db.Set<OnboardingStep>().AnyAsync(s => s.Key == key);
        if (existing) return (null, "Step with this key already exists");

        var step = new OnboardingStep
        {
            Key = key, Title = title, Description = description,
            SortOrder = sortOrder, IsRequired = isRequired, XpReward = xpReward
        };
        _db.Set<OnboardingStep>().Add(step);
        await _db.SaveChangesAsync();
        return (step, null);
    }

    public async Task<(OnboardingStep? Step, string? Error)> UpdateStepAsync(
        int id, string? title, string? description, int? sortOrder, bool? isRequired, int? xpReward)
    {
        var step = await _db.Set<OnboardingStep>().FirstOrDefaultAsync(x => x.Id == id);
        if (step == null) return (null, "Step not found");

        if (title != null) step.Title = title;
        if (description != null) step.Description = description;
        if (sortOrder.HasValue) step.SortOrder = sortOrder.Value;
        if (isRequired.HasValue) step.IsRequired = isRequired.Value;
        if (xpReward.HasValue) step.XpReward = xpReward.Value;

        await _db.SaveChangesAsync();
        return (step, null);
    }

    public async Task<string?> DeleteStepAsync(int id)
    {
        var step = await _db.Set<OnboardingStep>().FirstOrDefaultAsync(x => x.Id == id);
        if (step == null) return "Step not found";

        var progress = await _db.Set<OnboardingProgress>()
            .Where(p => p.StepId == id).ToListAsync();
        _db.Set<OnboardingProgress>().RemoveRange(progress);
        _db.Set<OnboardingStep>().Remove(step);
        await _db.SaveChangesAsync();
        return null;
    }
}
