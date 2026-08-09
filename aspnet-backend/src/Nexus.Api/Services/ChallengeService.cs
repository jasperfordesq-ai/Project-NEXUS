// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing challenges - creation, participation, and progress tracking.
/// </summary>
public class ChallengeService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamificationService;
    private readonly ILogger<ChallengeService> _logger;

    public ChallengeService(
        NexusDbContext db,
        TenantContext tenantContext,
        GamificationService gamificationService,
        ILogger<ChallengeService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamificationService = gamificationService;
        _logger = logger;
    }

    /// <summary>
    /// List active challenges with pagination.
    /// </summary>
    public async Task<(List<object> Data, int Total)> GetActiveChallengesAsync(int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var now = DateTime.UtcNow;

        var query = _db.Set<Challenge>()
            .Where(c => c.IsActive && c.StartsAt <= now && c.EndsAt > now);

        var total = await query.CountAsync();

        var challenges = await query
            .OrderBy(c => c.EndsAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(c => new
            {
                c.Id,
                c.Title,
                c.Description,
                challenge_type = c.ChallengeType.ToString().ToLower(),
                c.TargetAction,
                c.TargetCount,
                c.XpReward,
                c.BadgeId,
                starts_at = c.StartsAt,
                ends_at = c.EndsAt,
                difficulty = c.Difficulty.ToString().ToLower(),
                c.MaxParticipants,
                participant_count = c.Participants.Count,
                c.CreatedAt
            })
            .ToListAsync();

        return (challenges.Cast<object>().ToList(), total);
    }

    /// <summary>
    /// Get challenge detail with participant count and optional user progress.
    /// </summary>
    public async Task<object?> GetChallengeAsync(int challengeId, int? currentUserId)
    {
        var challenge = await _db.Set<Challenge>()
            .Where(c => c.Id == challengeId)
            .Select(c => new
            {
                c.Id,
                c.Title,
                c.Description,
                challenge_type = c.ChallengeType.ToString().ToLower(),
                c.TargetAction,
                c.TargetCount,
                c.XpReward,
                c.BadgeId,
                badge_name = c.Badge != null ? c.Badge.Name : null,
                starts_at = c.StartsAt,
                ends_at = c.EndsAt,
                c.IsActive,
                difficulty = c.Difficulty.ToString().ToLower(),
                c.MaxParticipants,
                participant_count = c.Participants.Count,
                c.CreatedAt,
                c.UpdatedAt
            })
            .FirstOrDefaultAsync();

        if (challenge == null) return null;

        // Get current user's participation if logged in
        object? userProgress = null;
        if (currentUserId.HasValue)
        {
            userProgress = await _db.Set<ChallengeParticipant>()
                .Where(cp => cp.ChallengeId == challengeId && cp.UserId == currentUserId.Value)
                .Select(cp => new
                {
                    cp.CurrentProgress,
                    cp.IsCompleted,
                    cp.CompletedAt,
                    cp.JoinedAt
                })
                .FirstOrDefaultAsync();
        }

        return new
        {
            challenge,
            user_progress = userProgress
        };
    }

    /// <summary>
    /// Join a challenge. Returns error message on failure, null on success.
    /// </summary>
    public async Task<string?> JoinChallengeAsync(int challengeId, int userId)
    {
        var now = DateTime.UtcNow;

        var challenge = await _db.Set<Challenge>()
            .Include(c => c.Participants)
            .FirstOrDefaultAsync(c => c.Id == challengeId);

        if (challenge == null)
            return "Challenge not found";

        if (!challenge.IsActive || challenge.StartsAt > now || challenge.EndsAt <= now)
            return "Challenge is not currently active";

        // Check if already joined
        var existing = challenge.Participants.FirstOrDefault(p => p.UserId == userId);
        if (existing != null)
            return "Already joined this challenge";

        // Check max participants
        if (challenge.MaxParticipants.HasValue && challenge.Participants.Count >= challenge.MaxParticipants.Value)
            return "Challenge is full";

        var participant = new ChallengeParticipant
        {
            ChallengeId = challengeId,
            UserId = userId,
            TenantId = _tenantContext.GetTenantIdOrThrow()
        };

        _db.Set<ChallengeParticipant>().Add(participant);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return "Already joined this challenge";
        }

        _logger.LogInformation("User {UserId} joined challenge {ChallengeId}", userId, challengeId);
        return null;
    }

    /// <summary>
    /// Called when a user performs an action. Auto-increments progress on matching challenges.
    /// </summary>
    public async Task UpdateProgressAsync(int userId, string actionType)
    {
        var now = DateTime.UtcNow;

        // Find all active challenge participations for this user with matching action type
        var participations = await _db.Set<ChallengeParticipant>()
            .Include(cp => cp.Challenge)
            .Where(cp => cp.UserId == userId
                && !cp.IsCompleted
                && cp.Challenge != null
                && cp.Challenge.TargetAction == actionType
                && cp.Challenge.IsActive
                && cp.Challenge.StartsAt <= now
                && cp.Challenge.EndsAt > now)
            .ToListAsync();

        foreach (var participation in participations)
        {
            participation.CurrentProgress++;
            participation.Challenge!.UpdatedAt = now;

            if (participation.CurrentProgress >= participation.Challenge.TargetCount)
            {
                participation.IsCompleted = true;
                participation.CompletedAt = now;

                _logger.LogInformation(
                    "User {UserId} completed challenge {ChallengeId} '{Title}'",
                    userId, participation.ChallengeId, participation.Challenge.Title);

                // Award XP
                if (participation.Challenge.XpReward > 0)
                {
                    await _gamificationService.AwardXpAsync(
                        userId,
                        participation.Challenge.XpReward,
                        "challenge_completed",
                        participation.ChallengeId,
                        $"Completed challenge: {participation.Challenge.Title}");
                }

                // Award badge if configured
                if (participation.Challenge.BadgeId.HasValue)
                {
                    var badge = await _db.Badges.FirstOrDefaultAsync(x => x.Id == participation.Challenge.BadgeId.Value);
                    if (badge != null)
                    {
                        await _gamificationService.AwardBadgeAsync(userId, badge.Slug);
                    }
                }
            }
        }

        if (participations.Count > 0)
        {
            await _db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Get a user's active and completed challenges.
    /// </summary>
    public async Task<List<object>> GetUserChallengesAsync(int userId)
    {
        var challenges = await _db.Set<ChallengeParticipant>()
            .Where(cp => cp.UserId == userId)
            .OrderByDescending(cp => cp.JoinedAt)
            .Select(cp => new
            {
                challenge = new
                {
                    cp.Challenge!.Id,
                    cp.Challenge.Title,
                    cp.Challenge.Description,
                    challenge_type = cp.Challenge.ChallengeType.ToString().ToLower(),
                    cp.Challenge.TargetAction,
                    cp.Challenge.TargetCount,
                    cp.Challenge.XpReward,
                    difficulty = cp.Challenge.Difficulty.ToString().ToLower(),
                    starts_at = cp.Challenge.StartsAt,
                    ends_at = cp.Challenge.EndsAt,
                    cp.Challenge.IsActive
                },
                progress = new
                {
                    cp.CurrentProgress,
                    cp.IsCompleted,
                    cp.CompletedAt,
                    cp.JoinedAt,
                    percent = cp.Challenge.TargetCount > 0
                        ? Math.Round((double)cp.CurrentProgress / cp.Challenge.TargetCount * 100, 1)
                        : 0
                }
            })
            .ToListAsync();

        return challenges.Cast<object>().ToList();
    }

    /// <summary>
    /// Admin: create a new challenge.
    /// </summary>
    public async Task<Challenge> CreateChallengeAsync(
        string title,
        string? description,
        ChallengeType challengeType,
        string targetAction,
        int targetCount,
        int xpReward,
        int? badgeId,
        DateTime startsAt,
        DateTime endsAt,
        int? maxParticipants,
        ChallengeDifficulty difficulty)
    {
        var challenge = new Challenge
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Title = title,
            Description = description,
            ChallengeType = challengeType,
            TargetAction = targetAction,
            TargetCount = targetCount,
            XpReward = xpReward,
            BadgeId = badgeId,
            StartsAt = startsAt,
            EndsAt = endsAt,
            MaxParticipants = maxParticipants,
            Difficulty = difficulty
        };

        _db.Set<Challenge>().Add(challenge);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Challenge '{Title}' created (ID: {Id})", challenge.Title, challenge.Id);
        return challenge;
    }
}
