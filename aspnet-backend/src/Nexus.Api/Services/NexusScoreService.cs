// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for NexusScore reputation computation and management.
/// Composite score (0-1000) from 5 dimensions, each 0-200.
/// </summary>
public class NexusScoreService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<NexusScoreService> _logger;

    public NexusScoreService(NexusDbContext db, TenantContext tenantContext, ILogger<NexusScoreService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    public async Task<NexusScore?> GetScoreAsync(int userId)
    {
        return await _db.Set<NexusScore>()
            .FirstOrDefaultAsync(s => s.UserId == userId);
    }

    public async Task<List<NexusScore>> GetLeaderboardAsync(int page = 1, int limit = 20)
    {
        return await _db.Set<NexusScore>()
            .Include(s => s.User)
            .OrderByDescending(s => s.Score)
            .Skip((Math.Max(1, page) - 1) * Math.Clamp(limit, 1, 100))
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    public async Task<List<NexusScoreHistory>> GetHistoryAsync(int userId, int limit = 20)
    {
        return await _db.Set<NexusScoreHistory>()
            .Where(h => h.UserId == userId)
            .OrderByDescending(h => h.CreatedAt)
            .Take(Math.Clamp(limit, 1, 100))
            .ToListAsync();
    }

    /// <summary>
    /// Recalculate NexusScore for a user from all signals.
    /// </summary>
    public async Task<(NexusScore? Score, string? Error)> RecalculateAsync(int userId, string? reason = null)
    {
        var score = await _db.Set<NexusScore>()
            .FirstOrDefaultAsync(s => s.UserId == userId);

        var previousScore = score?.Score ?? 0;
        var previousTier = score?.Tier ?? "newcomer";

        if (score == null)
        {
            // Resolve TenantId from the user record so NexusScore is tenant-scoped correctly
            var tenantUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
            if (tenantUser == null)
                return (null, "User not found");


            score = new NexusScore { UserId = userId, TenantId = tenantUser.TenantId };
            _db.Set<NexusScore>().Add(score);
        }

        // 1. Exchange Score (0-200): based on completed exchanges
        var completedExchanges = await _db.Set<Exchange>()
            .CountAsync(e => (e.InitiatorId == userId || e.ListingOwnerId == userId) && e.Status == ExchangeStatus.Completed);
        score.ExchangeScore = Math.Min(200, completedExchanges * 10);

        // 2. Review Score (0-200): based on average rating received
        var reviews = await _db.Reviews
            .Where(r => r.TargetUserId == userId)
            .ToListAsync();
        if (reviews.Count > 0)
        {
            var avgRating = reviews.Average(r => r.Rating);
            score.ReviewScore = Math.Min(200, (int)(avgRating * 40)); // 5.0 * 40 = 200
        }
        else
        {
            score.ReviewScore = 0;
        }

        // 3. Engagement Score (0-200): posts, comments, likes given
        var postCount = await _db.FeedPosts.CountAsync(p => p.UserId == userId);
        var commentCount = await _db.PostComments.CountAsync(c => c.UserId == userId);
        var likeCount = await _db.PostLikes.CountAsync(l => l.UserId == userId);
        score.EngagementScore = Math.Min(200, (postCount * 5) + (commentCount * 3) + (likeCount * 1));

        // 4. Reliability Score (0-200): exchange completion rate
        var totalExchanges = await _db.Set<Exchange>()
            .CountAsync(e => e.InitiatorId == userId || e.ListingOwnerId == userId);
        if (totalExchanges > 0)
        {
            var completionRate = (double)completedExchanges / totalExchanges;
            score.ReliabilityScore = Math.Min(200, (int)(completionRate * 200));
        }
        else
        {
            score.ReliabilityScore = 100; // Neutral for new users
        }

        // 5. Tenure Score (0-200): based on account age
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user != null)
        {
            var daysSinceJoined = (DateTime.UtcNow - user.CreatedAt).TotalDays;
            score.TenureScore = Math.Min(200, (int)(daysSinceJoined / 1.825)); // ~365 days = 200
        }

        // Composite score
        score.Score = score.ExchangeScore + score.ReviewScore + score.EngagementScore
            + score.ReliabilityScore + score.TenureScore;

        // Tier assignment
        score.Tier = score.Score switch
        {
            >= 800 => "exemplary",
            >= 600 => "trusted",
            >= 400 => "established",
            >= 200 => "emerging",
            _ => "newcomer"
        };

        score.LastCalculatedAt = DateTime.UtcNow;

        // Record history if score changed
        if (previousScore != score.Score)
        {
            _db.Set<NexusScoreHistory>().Add(new NexusScoreHistory
            {
                TenantId = score.TenantId,
                UserId = userId,
                PreviousScore = previousScore,
                NewScore = score.Score,
                PreviousTier = previousTier,
                NewTier = score.Tier,
                Reason = reason ?? "recalculation"
            });
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("NexusScore recalculated for user {UserId}: {Score} ({Tier})",
            userId, score.Score, score.Tier);

        return (score, null);
    }

    /// <summary>
    /// Get tier distribution stats for the tenant.
    /// </summary>
    public async Task<object> GetTierDistributionAsync()
    {
        var query = _db.Set<NexusScore>().AsQueryable();

        var total = await query.CountAsync();
        var averageScore = total > 0 ? await query.AverageAsync(s => (double)s.Score) : 0;

        var distribution = await query
            .GroupBy(s => s.Score < 200 ? "newcomer" :
                          s.Score < 400 ? "emerging" :
                          s.Score < 600 ? "established" :
                          s.Score < 800 ? "trusted" : "exemplary")
            .Select(g => new { Tier = g.Key, Count = g.Count() })
            .ToListAsync();

        var tierCounts = distribution.ToDictionary(d => d.Tier, d => d.Count);

        return new
        {
            total,
            newcomer = tierCounts.GetValueOrDefault("newcomer", 0),
            emerging = tierCounts.GetValueOrDefault("emerging", 0),
            established = tierCounts.GetValueOrDefault("established", 0),
            trusted = tierCounts.GetValueOrDefault("trusted", 0),
            exemplary = tierCounts.GetValueOrDefault("exemplary", 0),
            average_score = averageScore
        };
    }
}
