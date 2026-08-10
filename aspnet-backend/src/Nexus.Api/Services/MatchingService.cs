// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Smart matching engine that computes compatibility scores between users
/// based on skills, categories, activity, ratings, and connections.
/// Phase 17: Smart Matching.
/// </summary>
public class MatchingService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<MatchingService> _logger;
    private readonly IConfiguration _configuration;

    private int MaxMatchesPerRun => _configuration.GetValue("MatchingDefaults:MaxMatchesPerRun", 50);
    private int ActivityCutoffDays => _configuration.GetValue("MatchingDefaults:ActivityCutoffDays", 90);

    public MatchingService(NexusDbContext db, TenantContext tenantContext, ILogger<MatchingService> logger, IConfiguration configuration)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Compute and store the top matches for a user based on multiple scoring factors.
    /// Replaces any existing pending/viewed matches for this user.
    /// </summary>
    public async Task<int> ComputeMatchesForUserAsync(int userId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
        {
            _logger.LogWarning("Cannot compute matches: user {UserId} not found", userId);
            return 0;
        }

        // Load user's match preferences
        var preferences = await _db.MatchPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.IsActive);

        // Load user's listings to determine their skills/categories
        var userListings = await _db.Listings
            .Where(l => l.UserId == userId && l.Status == ListingStatus.Active)
            .Select(l => new { l.Id, l.CategoryId, l.Title, l.Description, l.Type })
            .ToListAsync();

        var userCategoryIds = userListings
            .Where(l => l.CategoryId.HasValue)
            .Select(l => l.CategoryId!.Value)
            .Distinct()
            .ToHashSet();

        // Parse skills from preferences
        var skillsOffered = ParseCommaSeparated(preferences?.SkillsOffered);
        var skillsWanted = ParseCommaSeparated(preferences?.SkillsWanted);

        // Load user's accepted connections
        var connectedUserIds = await _db.Connections
            .Where(c => (c.RequesterId == userId || c.AddresseeId == userId) && c.Status == "accepted")
            .Select(c => c.RequesterId == userId ? c.AddresseeId : c.RequesterId)
            .ToListAsync();
        var connectedSet = connectedUserIds.ToHashSet();

        // Get all other active users in the tenant (exclude self)
        var candidateUsers = await _db.Users
            .Where(u => u.Id != userId && u.IsActive)
            .Select(u => new
            {
                u.Id,
                u.TotalXp,
                u.Level
            })
            .ToListAsync();

        if (candidateUsers.Count == 0)
        {
            _logger.LogInformation("No candidate users found for matching user {UserId}", userId);
            return 0;
        }

        var candidateIds = candidateUsers.Select(u => u.Id).ToList();

        // Batch-load candidate data for scoring
        var candidateListings = await _db.Listings
            .Where(l => candidateIds.Contains(l.UserId) && l.Status == ListingStatus.Active)
            .Select(l => new { l.UserId, l.Id, l.CategoryId, l.Title, l.Description, l.Type })
            .ToListAsync();

        var candidatePreferences = await _db.MatchPreferences
            .Where(p => candidateIds.Contains(p.UserId) && p.IsActive)
            .ToListAsync();

        // Load average ratings for candidates (from exchange ratings)
        var candidateRatings = await _db.ExchangeRatings
            .Where(r => candidateIds.Contains(r.RatedUserId))
            .GroupBy(r => r.RatedUserId)
            .Select(g => new { UserId = g.Key, AvgRating = g.Average(r => r.Rating), Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId);

        // Load recent exchange activity counts (last 90 days)
        var activityCutoff = DateTime.UtcNow.AddDays(-ActivityCutoffDays);
        var candidateActivity = await _db.Exchanges
            .Where(e => candidateIds.Contains(e.InitiatorId) || candidateIds.Contains(e.ListingOwnerId))
            .Where(e => e.Status == ExchangeStatus.Completed && e.CompletedAt >= activityCutoff)
            .Select(e => new { e.InitiatorId, e.ListingOwnerId })
            .ToListAsync();

        var activityCounts = new Dictionary<int, int>();
        foreach (var activity in candidateActivity)
        {
            if (candidateIds.Contains(activity.InitiatorId))
                activityCounts[activity.InitiatorId] = activityCounts.GetValueOrDefault(activity.InitiatorId) + 1;
            if (candidateIds.Contains(activity.ListingOwnerId))
                activityCounts[activity.ListingOwnerId] = activityCounts.GetValueOrDefault(activity.ListingOwnerId) + 1;
        }

        // Score each candidate
        var scoredMatches = new List<(int CandidateId, int? ListingId, decimal Score, List<string> Reasons)>();

        foreach (var candidate in candidateUsers)
        {
            var reasons = new List<string>();
            var score = 0.0m;

            var candidateListingSet = candidateListings.Where(l => l.UserId == candidate.Id).ToList();
            var candidateCategoryIds = candidateListingSet
                .Where(l => l.CategoryId.HasValue)
                .Select(l => l.CategoryId!.Value)
                .Distinct()
                .ToHashSet();

            var candidatePref = candidatePreferences.FirstOrDefault(p => p.UserId == candidate.Id);
            var candidateSkillsOffered = ParseCommaSeparated(candidatePref?.SkillsOffered);
            var candidateSkillsWanted = ParseCommaSeparated(candidatePref?.SkillsWanted);

            // --- Factor 1: Skill overlap (weight: 0.30) ---
            // My skills offered that match their skills wanted
            var offeredMatchCount = skillsOffered.Intersect(candidateSkillsWanted, StringComparer.OrdinalIgnoreCase).Count();
            // Their skills offered that match my skills wanted
            var wantedMatchCount = candidateSkillsOffered.Intersect(skillsWanted, StringComparer.OrdinalIgnoreCase).Count();
            var totalSkillMatches = offeredMatchCount + wantedMatchCount;
            var maxPossibleSkillMatches = Math.Max(1, skillsOffered.Count + skillsWanted.Count);
            var skillScore = Math.Min(1.0m, (decimal)totalSkillMatches / maxPossibleSkillMatches);

            if (totalSkillMatches > 0)
            {
                var matchedSkills = skillsOffered.Intersect(candidateSkillsWanted, StringComparer.OrdinalIgnoreCase)
                    .Concat(candidateSkillsOffered.Intersect(skillsWanted, StringComparer.OrdinalIgnoreCase))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(3);
                reasons.Add($"skill_overlap:{string.Join(",", matchedSkills)}");
            }

            score += skillScore * 0.30m;

            // --- Factor 2: Category overlap (weight: 0.25) ---
            var categoryOverlap = userCategoryIds.Intersect(candidateCategoryIds).Count();
            var maxCategories = Math.Max(1, Math.Max(userCategoryIds.Count, candidateCategoryIds.Count));
            var categoryScore = Math.Min(1.0m, (decimal)categoryOverlap / maxCategories);

            if (categoryOverlap > 0)
            {
                reasons.Add($"category_match:{categoryOverlap}_shared");
            }

            score += categoryScore * 0.25m;

            // --- Factor 3: Activity level (weight: 0.15) ---
            var activityCount = activityCounts.GetValueOrDefault(candidate.Id);
            // Normalize: 5+ exchanges in 90 days = max activity score
            var activityScore = Math.Min(1.0m, activityCount / 5.0m);

            if (activityCount > 0)
            {
                reasons.Add($"active_user:{activityCount}_exchanges_90d");
            }

            score += activityScore * 0.15m;

            // --- Factor 4: Rating score (weight: 0.15) ---
            var ratingScore = 0.0m;
            if (candidateRatings.TryGetValue(candidate.Id, out var ratingData))
            {
                // Normalize 1-5 rating to 0-1
                ratingScore = ((decimal)ratingData.AvgRating - 1.0m) / 4.0m;
                if (ratingData.Count >= 3)
                {
                    reasons.Add($"high_rating:{ratingData.AvgRating:F1}");
                }
            }

            score += ratingScore * 0.15m;

            // --- Factor 5: Connection bonus (weight: 0.10) ---
            var connectionScore = 0.0m;
            if (connectedSet.Contains(candidate.Id))
            {
                connectionScore = 1.0m;
                reasons.Add("already_connected");
            }

            score += connectionScore * 0.10m;

            // --- Factor 6: Complementary listings (weight: 0.05) ---
            // Bonus if candidate has offers that match user's requests, or vice versa
            var userOfferCategories = userListings.Where(l => l.Type == ListingType.Offer && l.CategoryId.HasValue).Select(l => l.CategoryId!.Value).ToHashSet();
            var userRequestCategories = userListings.Where(l => l.Type == ListingType.Request && l.CategoryId.HasValue).Select(l => l.CategoryId!.Value).ToHashSet();
            var candidateOfferCategories = candidateListingSet.Where(l => l.Type == ListingType.Offer && l.CategoryId.HasValue).Select(l => l.CategoryId!.Value).ToHashSet();
            var candidateRequestCategories = candidateListingSet.Where(l => l.Type == ListingType.Request && l.CategoryId.HasValue).Select(l => l.CategoryId!.Value).ToHashSet();

            var complementaryCount = userRequestCategories.Intersect(candidateOfferCategories).Count()
                + userOfferCategories.Intersect(candidateRequestCategories).Count();
            var complementaryScore = Math.Min(1.0m, complementaryCount / 2.0m);

            if (complementaryCount > 0)
            {
                reasons.Add($"complementary_listings:{complementaryCount}");
            }

            score += complementaryScore * 0.05m;

            // Clamp final score to 0.0-1.0
            score = Math.Clamp(score, 0.0m, 1.0m);

            // Only include matches with a meaningful score
            if (score > 0.05m)
            {
                // Pick the best matching listing from this candidate, if any
                int? bestListingId = null;
                if (candidateListingSet.Count > 0)
                {
                    // Prefer complementary listings
                    var complementaryListing = candidateListingSet
                        .FirstOrDefault(l => l.Type == ListingType.Offer && l.CategoryId.HasValue && userRequestCategories.Contains(l.CategoryId.Value))
                        ?? candidateListingSet
                        .FirstOrDefault(l => l.Type == ListingType.Request && l.CategoryId.HasValue && userOfferCategories.Contains(l.CategoryId.Value))
                        ?? candidateListingSet.FirstOrDefault();

                    bestListingId = complementaryListing?.Id;
                }

                scoredMatches.Add((candidate.Id, bestListingId, score, reasons));
            }
        }

        // Sort by score descending, take top N
        var topMatches = scoredMatches
            .OrderByDescending(m => m.Score)
            .Take(MaxMatchesPerRun)
            .ToList();

        // Remove old pending/viewed matches for this user (replace with fresh results)
        var oldMatches = await _db.MatchResults
            .Where(m => m.UserId == userId && (m.Status == MatchStatus.Pending || m.Status == MatchStatus.Viewed))
            .ToListAsync();

        _db.MatchResults.RemoveRange(oldMatches);

        // Insert new matches
        foreach (var match in topMatches)
        {
            _db.MatchResults.Add(new MatchResult
            {
                TenantId = tenantId,
                UserId = userId,
                MatchedUserId = match.CandidateId,
                MatchedListingId = match.ListingId,
                Score = Math.Round(match.Score, 4),
                Reasons = System.Text.Json.JsonSerializer.Serialize(match.Reasons),
                Status = MatchStatus.Pending,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Computed {MatchCount} matches for user {UserId} (evaluated {CandidateCount} candidates)",
            topMatches.Count, userId, candidateUsers.Count);

        return topMatches.Count;
    }

    /// <summary>
    /// Get paginated matches for a user.
    /// </summary>
    public async Task<(List<MatchResult> Data, int Total)> GetMatchesForUserAsync(int userId, int page, int limit)
    {
        var query = _db.MatchResults
            .Where(m => m.UserId == userId)
            .OrderByDescending(m => m.Score)
            .ThenByDescending(m => m.CreatedAt);

        var total = await query.CountAsync();

        var data = await query
            .Include(m => m.MatchedUser)
            .Include(m => m.MatchedListing)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (data, total);
    }

    /// <summary>
    /// Get a specific match by ID, ensuring it belongs to the requesting user.
    /// Marks the match as viewed if it was pending.
    /// </summary>
    public async Task<MatchResult?> GetMatchByIdAsync(int matchId, int userId)
    {
        var match = await _db.MatchResults
            .Include(m => m.MatchedUser)
            .Include(m => m.MatchedListing)
            .FirstOrDefaultAsync(m => m.Id == matchId && m.UserId == userId);

        if (match != null && match.Status == MatchStatus.Pending)
        {
            match.Status = MatchStatus.Viewed;
            match.ViewedAt = DateTime.UtcNow;
            match.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return match;
    }

    /// <summary>
    /// Accept or decline a match.
    /// </summary>
    public async Task<(MatchResult? Match, string? Error)> RespondToMatchAsync(int matchId, int userId, MatchStatus response)
    {
        if (response != MatchStatus.Accepted && response != MatchStatus.Declined)
            return (null, "Response must be 'Accepted' or 'Declined'");

        var match = await _db.MatchResults
            .FirstOrDefaultAsync(m => m.Id == matchId && m.UserId == userId);

        if (match == null)
            return (null, "Match not found");

        if (match.Status == MatchStatus.Accepted || match.Status == MatchStatus.Declined)
            return (null, "Match has already been responded to");

        if (match.Status == MatchStatus.Expired)
            return (null, "Match has expired");

        match.Status = response;
        match.RespondedAt = DateTime.UtcNow;
        match.UpdatedAt = DateTime.UtcNow;

        // Also mark as viewed if not already
        if (match.ViewedAt == null)
        {
            match.ViewedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} {Response} match {MatchId} with user {MatchedUserId}",
            userId, response, matchId, match.MatchedUserId);

        return (match, null);
    }

    /// <summary>
    /// Get a user's match preferences, or null if none set.
    /// </summary>
    public async Task<MatchPreference?> GetMatchPreferencesAsync(int userId)
    {
        return await _db.MatchPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId);
    }

    /// <summary>
    /// Create or update match preferences for a user.
    /// </summary>
    public async Task<MatchPreference> UpdateMatchPreferencesAsync(
        int userId,
        double? maxDistanceKm,
        string? preferredCategories,
        string? availableDays,
        string? availableTimeSlots,
        string? skillsOffered,
        string? skillsWanted,
        bool? isActive)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var preferences = await _db.MatchPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId);

        if (preferences == null)
        {
            preferences = new MatchPreference
            {
                TenantId = tenantId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };
            _db.MatchPreferences.Add(preferences);
        }

        preferences.MaxDistanceKm = maxDistanceKm ?? preferences.MaxDistanceKm;
        preferences.PreferredCategories = preferredCategories ?? preferences.PreferredCategories;
        preferences.AvailableDays = availableDays ?? preferences.AvailableDays;
        preferences.AvailableTimeSlots = availableTimeSlots ?? preferences.AvailableTimeSlots;
        preferences.SkillsOffered = skillsOffered ?? preferences.SkillsOffered;
        preferences.SkillsWanted = skillsWanted ?? preferences.SkillsWanted;
        preferences.IsActive = isActive ?? preferences.IsActive;
        preferences.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Updated match preferences for user {UserId}", userId);

        return preferences;
    }

    /// <summary>
    /// Parse a comma-separated string into a list of trimmed, non-empty values.
    /// </summary>
    private static List<string> ParseCommaSeparated(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return new List<string>();

        return value
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length > 0)
            .ToList();
    }
}
