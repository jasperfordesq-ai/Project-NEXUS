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
/// Collaborative filtering engine for recommendations.
/// Records user interactions, computes user similarity via cosine similarity,
/// and generates content recommendations based on similar users' behaviour.
/// </summary>
public class CollaborativeFilterService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<CollaborativeFilterService> _logger;

    private static readonly HashSet<string> ValidFeedbackTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "helpful", "not_helpful", "too_far", "wrong_category", "perfect"
    };

    public CollaborativeFilterService(NexusDbContext db, ILogger<CollaborativeFilterService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // --- DTOs for controller consumption ---

    public class RecommendationItem
    {
        public int TargetId { get; set; }
        public decimal Score { get; set; }
        public string TargetType { get; set; } = string.Empty;
    }

    public class SimilarUserItem
    {
        public int UserId { get; set; }
        public decimal SimilarityScore { get; set; }
        public int CommonInteractions { get; set; }
    }

    public class RecalculationResult
    {
        public int UsersProcessed { get; set; }
        public int SimilaritiesComputed { get; set; }
    }

    /// <summary>
    /// Record a user interaction, deduplicating within 1 hour for same user+target+type.
    /// </summary>
    public async Task<(UserInteraction? Interaction, string? Error)> RecordInteractionAsync(
        int tenantId, int userId, string interactionType, string targetType, int targetId, double? score)
    {
        if (string.IsNullOrWhiteSpace(interactionType))
            return (null, "Interaction type is required.");

        if (string.IsNullOrWhiteSpace(targetType))
            return (null, "Target type is required.");

        // Dedup: skip if same user+target+type within the last hour
        var oneHourAgo = DateTime.UtcNow.AddHours(-1);
        var duplicate = await _db.Set<UserInteraction>()
            .AnyAsync(i =>
                i.UserId == userId &&
                i.TargetType == targetType &&
                i.TargetId == targetId &&
                i.InteractionType == interactionType &&
                i.CreatedAt > oneHourAgo);

        if (duplicate)
        {
            _logger.LogDebug(
                "Skipping duplicate interaction: User {UserId} {Type} on {TargetType}:{TargetId}",
                userId, interactionType, targetType, targetId);
            return (null, "Duplicate interaction within the last hour.");
        }

        var interaction = new UserInteraction
        {
            TenantId = tenantId,
            UserId = userId,
            InteractionType = interactionType.ToLowerInvariant(),
            TargetType = targetType.ToLowerInvariant(),
            TargetId = targetId,
            Score = score.HasValue ? (decimal)score.Value : null,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<UserInteraction>().Add(interaction);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Recorded interaction: User {UserId} {Type} on {TargetType}:{TargetId}",
            userId, interactionType, targetType, targetId);

        return (interaction, null);
    }

    /// <summary>
    /// Get content recommendations using collaborative filtering.
    /// Finds similar users, gets their interactions the current user has not had,
    /// and ranks by score * similarity.
    /// </summary>
    public async Task<(List<RecommendationItem>? Recommendations, string? Error)> GetRecommendationsAsync(
        int tenantId, int userId, string targetType, int limit = 10)
    {
        var similarUsers = await _db.Set<UserSimilarity>()
            .Where(s => s.UserAId == userId || s.UserBId == userId)
            .OrderByDescending(s => s.SimilarityScore)
            .Take(50)
            .ToListAsync();

        if (similarUsers.Count == 0)
            return (new List<RecommendationItem>(), null);

        var similarUserIds = similarUsers
            .Select(s => s.UserAId == userId ? s.UserBId : s.UserAId)
            .Distinct()
            .ToList();

        var similarityMap = new Dictionary<int, decimal>();
        foreach (var s in similarUsers)
        {
            var otherUserId = s.UserAId == userId ? s.UserBId : s.UserAId;
            similarityMap.TryAdd(otherUserId, s.SimilarityScore);
        }

        var userTargets = await _db.Set<UserInteraction>()
            .Where(i => i.UserId == userId && i.TargetType == targetType.ToLowerInvariant())
            .Select(i => i.TargetId)
            .Distinct()
            .ToListAsync();

        var userTargetSet = new HashSet<int>(userTargets);

        var candidateInteractions = await _db.Set<UserInteraction>()
            .Where(i =>
                similarUserIds.Contains(i.UserId) &&
                i.TargetType == targetType.ToLowerInvariant())
            .Select(i => new { i.UserId, i.TargetId, i.Score })
            .ToListAsync();

        var targetScores = new Dictionary<int, decimal>();
        foreach (var ci in candidateInteractions)
        {
            if (userTargetSet.Contains(ci.TargetId))
                continue;

            var similarity = similarityMap.GetValueOrDefault(ci.UserId, 0m);
            var interactionScore = ci.Score ?? 1.0m;
            var contribution = interactionScore * similarity;

            if (targetScores.ContainsKey(ci.TargetId))
                targetScores[ci.TargetId] += contribution;
            else
                targetScores[ci.TargetId] = contribution;
        }

        var results = targetScores
            .OrderByDescending(kv => kv.Value)
            .Take(limit)
            .Select(kv => new RecommendationItem
            {
                TargetId = kv.Key,
                Score = kv.Value,
                TargetType = targetType.ToLowerInvariant()
            })
            .ToList();

        return (results, null);
    }

    /// <summary>
    /// Return top similar users from the UserSimilarity table.
    /// </summary>
    public async Task<(List<SimilarUserItem>? Users, string? Error)> GetSimilarUsersAsync(
        int tenantId, int userId, int limit = 10)
    {
        var similarities = await _db.Set<UserSimilarity>()
            .Where(s => s.UserAId == userId || s.UserBId == userId)
            .OrderByDescending(s => s.SimilarityScore)
            .Take(limit)
            .ToListAsync();

        var results = similarities.Select(s => new SimilarUserItem
        {
            UserId = s.UserAId == userId ? s.UserBId : s.UserAId,
            SimilarityScore = s.SimilarityScore,
            CommonInteractions = s.CommonInteractions
        }).ToList();

        return (results, null);
    }

    /// <summary>
    /// Recalculate cosine similarity for all user pairs within a tenant.
    /// Processes users in batches of 100 to manage memory.
    /// </summary>
    public async Task<(RecalculationResult? Result, string? Error)> RecalculateSimilaritiesAsync(int tenantId)
    {
        _logger.LogInformation("Starting similarity recalculation for tenant {TenantId}", tenantId);

        var userIds = await _db.Set<UserInteraction>()
            .Where(i => i.TenantId == tenantId)
            .Select(i => i.UserId)
            .Distinct()
            .OrderBy(id => id)
            .ToListAsync();

        if (userIds.Count < 2)
            return (new RecalculationResult { UsersProcessed = userIds.Count, SimilaritiesComputed = 0 }, null);

        // Build interaction vectors: userId -> { "targetType:targetId" -> score }
        var userVectors = new Dictionary<int, Dictionary<string, decimal>>();

        const int batchSize = 100;
        for (var batchStart = 0; batchStart < userIds.Count; batchStart += batchSize)
        {
            var batchUserIds = userIds.Skip(batchStart).Take(batchSize).ToList();

            var interactions = await _db.Set<UserInteraction>()
                .Where(i => i.TenantId == tenantId && batchUserIds.Contains(i.UserId))
                .Select(i => new { i.UserId, i.TargetType, i.TargetId, i.Score })
                .ToListAsync();

            foreach (var interaction in interactions)
            {
                if (!userVectors.ContainsKey(interaction.UserId))
                    userVectors[interaction.UserId] = new Dictionary<string, decimal>();

                var key = $"{interaction.TargetType}:{interaction.TargetId}";
                var score = interaction.Score ?? 1.0m;

                if (userVectors[interaction.UserId].ContainsKey(key))
                    userVectors[interaction.UserId][key] = Math.Max(userVectors[interaction.UserId][key], score);
                else
                    userVectors[interaction.UserId][key] = score;
            }
        }

        // Wrap delete + rebuild in a transaction to ensure atomicity
        await using var dbTransaction = await _db.Database.BeginTransactionAsync();

        // Remove existing similarities for this tenant
        await _db.Set<UserSimilarity>()
            .Where(s => s.TenantId == tenantId)
            .ExecuteDeleteAsync();

        // Compute cosine similarity for each user pair
        var pairsUpdated = 0;
        var userIdList = userVectors.Keys.OrderBy(id => id).ToList();

        for (var i = 0; i < userIdList.Count; i++)
        {
            for (var j = i + 1; j < userIdList.Count; j++)
            {
                var userA = userIdList[i];
                var userB = userIdList[j];
                var vectorA = userVectors[userA];
                var vectorB = userVectors[userB];

                var allKeys = vectorA.Keys.Union(vectorB.Keys).ToList();
                decimal dotProduct = 0m;
                decimal magnitudeA = 0m;
                decimal magnitudeB = 0m;
                var commonCount = 0;

                foreach (var key in allKeys)
                {
                    var a = vectorA.GetValueOrDefault(key, 0m);
                    var b = vectorB.GetValueOrDefault(key, 0m);

                    dotProduct += a * b;
                    magnitudeA += a * a;
                    magnitudeB += b * b;

                    if (a > 0 && b > 0)
                        commonCount++;
                }

                if (magnitudeA == 0 || magnitudeB == 0 || commonCount == 0)
                    continue;

                var similarity = dotProduct / ((decimal)Math.Sqrt((double)(magnitudeA * magnitudeB)));

                if (similarity < 0.01m)
                    continue;

                _db.Set<UserSimilarity>().Add(new UserSimilarity
                {
                    TenantId = tenantId,
                    UserAId = userA,
                    UserBId = userB,
                    SimilarityScore = Math.Round(similarity, 4),
                    Algorithm = "cosine",
                    CommonInteractions = commonCount,
                    CalculatedAt = DateTime.UtcNow
                });

                pairsUpdated++;
            }

            // Save periodically to avoid massive change tracking
            if (pairsUpdated > 0 && pairsUpdated % 500 == 0)
                await _db.SaveChangesAsync();
        }

        await _db.SaveChangesAsync();
        await dbTransaction.CommitAsync();

        _logger.LogInformation(
            "Similarity recalculation complete for tenant {TenantId}: {PairsUpdated} pairs from {UserCount} users",
            tenantId, pairsUpdated, userIdList.Count);

        return (new RecalculationResult
        {
            UsersProcessed = userIdList.Count,
            SimilaritiesComputed = pairsUpdated
        }, null);
    }

    /// <summary>
    /// Submit feedback on a match result. Validates feedback type and prevents duplicates.
    /// </summary>
    public async Task<(MatchFeedback? Feedback, string? Error)> SubmitMatchFeedbackAsync(
        int tenantId, int userId, int matchResultId, string feedbackType, string? comment)
    {
        if (!ValidFeedbackTypes.Contains(feedbackType))
            return (null, "Invalid feedback type. Must be one of: " + string.Join(", ", ValidFeedbackTypes));

        var existing = await _db.Set<MatchFeedback>()
            .AnyAsync(f => f.MatchResultId == matchResultId && f.UserId == userId);

        if (existing)
            return (null, "You have already submitted feedback for this match.");

        var matchResult = await _db.Set<MatchResult>().FirstOrDefaultAsync(x => x.Id == matchResultId);
        if (matchResult == null)
            return (null, "Match result not found.");

        var feedback = new MatchFeedback
        {
            TenantId = tenantId,
            MatchResultId = matchResultId,
            UserId = userId,
            FeedbackType = feedbackType.ToLowerInvariant(),
            Comment = comment,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<MatchFeedback>().Add(feedback);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Match feedback submitted: User {UserId} rated match {MatchResultId} as {FeedbackType}",
            userId, matchResultId, feedbackType);

        return (feedback, null);
    }

    /// <summary>
    /// Aggregate feedback counts by type for a tenant.
    /// </summary>
    public async Task<Dictionary<string, int>> GetMatchFeedbackStatsAsync(int tenantId)
    {
        return await _db.Set<MatchFeedback>()
            .GroupBy(f => f.FeedbackType)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Type, x => x.Count);
    }

    /// <summary>
    /// Weighted scoring model with time-decay and interaction type weights.
    /// More recent interactions and higher-value actions (exchanges, ratings) weigh more.
    /// </summary>
    public async Task<List<RecommendationItem>> GetWeightedRecommendationsAsync(
        int userId, string targetType, int limit = 10)
    {
        var interactionWeights = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["exchange"] = 5.0,
            ["rating"] = 4.0,
            ["save"] = 3.0,
            ["click"] = 2.0,
            ["view"] = 1.0,
            ["share"] = 3.0
        };

        var normalizedTargetType = targetType.ToLowerInvariant();
        var now = DateTime.UtcNow;

        // Get current user's interactions to build exclusion set
        var userInteractions = await _db.Set<UserInteraction>()
            .Where(i => i.UserId == userId && i.TargetType == normalizedTargetType)
            .Select(i => new { i.TargetId, i.InteractionType, i.Score, i.CreatedAt })
            .ToListAsync();

        var userTargetSet = new HashSet<int>(userInteractions.Select(i => i.TargetId));

        // Get similar users
        var similarities = await _db.Set<UserSimilarity>()
            .Where(s => s.UserAId == userId || s.UserBId == userId)
            .OrderByDescending(s => s.SimilarityScore)
            .Take(50)
            .ToListAsync();

        if (similarities.Count == 0)
            return new List<RecommendationItem>();

        var similarityMap = new Dictionary<int, decimal>();
        var similarUserIds = new List<int>();
        foreach (var s in similarities)
        {
            var otherUserId = s.UserAId == userId ? s.UserBId : s.UserAId;
            if (similarityMap.TryAdd(otherUserId, s.SimilarityScore))
                similarUserIds.Add(otherUserId);
        }

        // Get similar users' interactions
        var candidateInteractions = await _db.Set<UserInteraction>()
            .Where(i =>
                similarUserIds.Contains(i.UserId) &&
                i.TargetType == normalizedTargetType)
            .Select(i => new { i.UserId, i.TargetId, i.InteractionType, i.Score, i.CreatedAt })
            .ToListAsync();

        // Score each candidate target
        var targetScores = new Dictionary<int, double>();
        foreach (var ci in candidateInteractions)
        {
            if (userTargetSet.Contains(ci.TargetId))
                continue;

            var similarity = (double)similarityMap.GetValueOrDefault(ci.UserId, 0m);
            var baseWeight = interactionWeights.GetValueOrDefault(ci.InteractionType, 1.0);
            var interactionScore = ci.Score.HasValue ? (double)ci.Score.Value : 1.0;

            // Time-decay: exp(-daysSince / 90) gives 90-day half-life
            var daysSince = (now - ci.CreatedAt).TotalDays;
            var timeDecay = Math.Exp(-daysSince / 90.0);

            var contribution = similarity * baseWeight * interactionScore * timeDecay;

            if (targetScores.ContainsKey(ci.TargetId))
                targetScores[ci.TargetId] += contribution;
            else
                targetScores[ci.TargetId] = contribution;
        }

        return targetScores
            .OrderByDescending(kv => kv.Value)
            .Take(limit)
            .Select(kv => new RecommendationItem
            {
                TargetId = kv.Key,
                Score = (decimal)Math.Round(kv.Value, 4),
                TargetType = normalizedTargetType
            })
            .ToList();
    }

    /// <summary>
    /// Pearson correlation coefficient between two users' interaction patterns.
    /// </summary>
    public async Task<decimal> ComputePearsonCorrelationAsync(int userAId, int userBId)
    {
        // Get both users' scored interactions keyed by "targetType:targetId"
        var interactionsA = await _db.Set<UserInteraction>()
            .Where(i => i.UserId == userAId && i.Score != null)
            .Select(i => new { Key = i.TargetType + ":" + i.TargetId, i.Score })
            .ToListAsync();

        var interactionsB = await _db.Set<UserInteraction>()
            .Where(i => i.UserId == userBId && i.Score != null)
            .Select(i => new { Key = i.TargetType + ":" + i.TargetId, i.Score })
            .ToListAsync();

        var scoresA = interactionsA
            .GroupBy(x => x.Key)
            .ToDictionary(g => g.Key, g => g.Max(x => x.Score!.Value));

        var scoresB = interactionsB
            .GroupBy(x => x.Key)
            .ToDictionary(g => g.Key, g => g.Max(x => x.Score!.Value));

        // Find common targets
        var commonKeys = scoresA.Keys.Intersect(scoresB.Keys).ToList();

        if (commonKeys.Count < 3)
            return 0m;

        var pairsA = commonKeys.Select(k => scoresA[k]).ToList();
        var pairsB = commonKeys.Select(k => scoresB[k]).ToList();

        var meanA = pairsA.Average();
        var meanB = pairsB.Average();

        decimal sumNumerator = 0m;
        decimal sumDenomA = 0m;
        decimal sumDenomB = 0m;

        for (var i = 0; i < commonKeys.Count; i++)
        {
            var diffA = pairsA[i] - meanA;
            var diffB = pairsB[i] - meanB;
            sumNumerator += diffA * diffB;
            sumDenomA += diffA * diffA;
            sumDenomB += diffB * diffB;
        }

        if (sumDenomA == 0 || sumDenomB == 0)
            return 0m;

        var pearson = sumNumerator / (decimal)Math.Sqrt((double)(sumDenomA * sumDenomB));
        return Math.Round(Math.Max(-1m, Math.Min(1m, pearson)), 4);
    }

    /// <summary>
    /// Batch recalculation using multiple algorithms (cosine + Pearson), storing best score.
    /// </summary>
    public async Task<RecalculationResult> RecalculateWithMultipleAlgorithmsAsync(int tenantId)
    {
        _logger.LogInformation("Starting multi-algorithm recalculation for tenant {TenantId}", tenantId);

        var userIds = await _db.Set<UserInteraction>()
            .Where(i => i.TenantId == tenantId)
            .Select(i => i.UserId)
            .Distinct()
            .OrderBy(id => id)
            .ToListAsync();

        if (userIds.Count < 2)
            return new RecalculationResult { UsersProcessed = userIds.Count, SimilaritiesComputed = 0 };

        // Build interaction vectors for cosine similarity
        var userVectors = new Dictionary<int, Dictionary<string, decimal>>();
        const int batchSize = 100;
        for (var batchStart = 0; batchStart < userIds.Count; batchStart += batchSize)
        {
            var batchUserIds = userIds.Skip(batchStart).Take(batchSize).ToList();
            var interactions = await _db.Set<UserInteraction>()
                .Where(i => i.TenantId == tenantId && batchUserIds.Contains(i.UserId))
                .Select(i => new { i.UserId, i.TargetType, i.TargetId, i.Score })
                .ToListAsync();

            foreach (var interaction in interactions)
            {
                if (!userVectors.ContainsKey(interaction.UserId))
                    userVectors[interaction.UserId] = new Dictionary<string, decimal>();

                var key = $"{interaction.TargetType}:{interaction.TargetId}";
                var score = interaction.Score ?? 1.0m;

                if (userVectors[interaction.UserId].ContainsKey(key))
                    userVectors[interaction.UserId][key] = Math.Max(userVectors[interaction.UserId][key], score);
                else
                    userVectors[interaction.UserId][key] = score;
            }
        }

        // Wrap delete + rebuild in a transaction to ensure atomicity
        await using var dbTransaction = await _db.Database.BeginTransactionAsync();

        // Remove existing similarities
        await _db.Set<UserSimilarity>()
            .Where(s => s.TenantId == tenantId)
            .ExecuteDeleteAsync();

        var pairsComputed = 0;
        decimal totalSimilarity = 0m;
        var userIdList = userVectors.Keys.OrderBy(id => id).ToList();

        for (var i = 0; i < userIdList.Count; i++)
        {
            for (var j = i + 1; j < userIdList.Count; j++)
            {
                var userA = userIdList[i];
                var userB = userIdList[j];

                // Compute cosine similarity
                var vectorA = userVectors[userA];
                var vectorB = userVectors[userB];
                var allKeys = vectorA.Keys.Union(vectorB.Keys).ToList();

                decimal dotProduct = 0m, magnitudeA = 0m, magnitudeB = 0m;
                var commonCount = 0;

                foreach (var key in allKeys)
                {
                    var a = vectorA.GetValueOrDefault(key, 0m);
                    var b = vectorB.GetValueOrDefault(key, 0m);
                    dotProduct += a * b;
                    magnitudeA += a * a;
                    magnitudeB += b * b;
                    if (a > 0 && b > 0) commonCount++;
                }

                var cosineSimilarity = (magnitudeA == 0 || magnitudeB == 0 || commonCount == 0)
                    ? 0m
                    : dotProduct / (decimal)Math.Sqrt((double)(magnitudeA * magnitudeB));

                // Compute Pearson correlation
                var pearsonSimilarity = await ComputePearsonCorrelationAsync(userA, userB);
                // Normalize Pearson from [-1,1] to [0,1] for comparison
                var normalizedPearson = (pearsonSimilarity + 1m) / 2m;

                // Pick the algorithm that produces higher similarity
                var bestScore = cosineSimilarity >= normalizedPearson ? cosineSimilarity : normalizedPearson;
                var bestAlgorithm = cosineSimilarity >= normalizedPearson ? "cosine" : "pearson";

                if (bestScore < 0.01m)
                    continue;

                _db.Set<UserSimilarity>().Add(new UserSimilarity
                {
                    TenantId = tenantId,
                    UserAId = userA,
                    UserBId = userB,
                    SimilarityScore = Math.Round(bestScore, 4),
                    Algorithm = bestAlgorithm,
                    CommonInteractions = commonCount,
                    CalculatedAt = DateTime.UtcNow
                });

                totalSimilarity += bestScore;
                pairsComputed++;

                if (pairsComputed % 500 == 0)
                    await _db.SaveChangesAsync();
            }
        }

        await _db.SaveChangesAsync();
        await dbTransaction.CommitAsync();

        var avgSimilarity = pairsComputed > 0 ? totalSimilarity / pairsComputed : 0m;
        _logger.LogInformation(
            "Multi-algorithm recalculation complete for tenant {TenantId}: {Pairs} pairs, avg similarity {Avg:F4}",
            tenantId, pairsComputed, avgSimilarity);

        return new RecalculationResult
        {
            UsersProcessed = userIdList.Count,
            SimilaritiesComputed = pairsComputed
        };
    }


    /// <summary>
    /// Persist the current similarity model to the database with metadata.
    /// Stores a snapshot of model state for auditing and rollback.
    /// </summary>
    public async Task<(object? Model, string? Error)> PersistModelSnapshotAsync(int tenantId)
    {
        var similarities = _db.Set<UserSimilarity>().Where(s => s.TenantId == tenantId);

        var totalPairs = await similarities.CountAsync();
        if (totalPairs == 0)
            return (null, "No similarity data found for this tenant.");

        var avgSimilarity = await similarities.AverageAsync(s => (double)s.SimilarityScore);
        var minDate = await similarities.MinAsync(s => s.CalculatedAt);
        var maxDate = await similarities.MaxAsync(s => s.CalculatedAt);

        var algorithmDistribution = await similarities
            .GroupBy(s => s.Algorithm)
            .Select(g => new { Algorithm = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Algorithm, x => x.Count);

        var snapshotAt = DateTime.UtcNow;
        var stats = new
        {
            total_pairs = totalPairs,
            avg_similarity = Math.Round(avgSimilarity, 4),
            min_date = minDate,
            max_date = maxDate,
            algorithm_distribution = algorithmDistribution,
            snapshot_at = snapshotAt
        };

        var timestamp = snapshotAt.ToString("yyyyMMddHHmmss");
        var config = new EnterpriseConfig
        {
            TenantId = tenantId,
            Key = $"ml_model_snapshot_{timestamp}",
            Category = "ml_models",
            Value = JsonSerializer.Serialize(stats),
            Description = $"Model snapshot with {totalPairs} pairs, avg similarity {avgSimilarity:F4}",
            UpdatedAt = snapshotAt
        };

        _db.Set<EnterpriseConfig>().Add(config);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Model snapshot persisted for tenant {TenantId}: {TotalPairs} pairs, avg {Avg:F4}",
            tenantId, totalPairs, avgSimilarity);

        return (stats, null);
    }

    /// <summary>
    /// Schedule a full retraining run: clear stale similarities, recalculate, persist snapshot.
    /// </summary>
    public async Task<(object? Result, string? Error)> RunRetrainingPipelineAsync(int tenantId)
    {
        _logger.LogInformation("Starting retraining pipeline for tenant {TenantId}", tenantId);

        // Delete UserSimilarity records older than 30 days
        var cutoff = DateTime.UtcNow.AddDays(-30);
        var staleRemoved = await _db.Set<UserSimilarity>()
            .Where(s => s.TenantId == tenantId && s.CalculatedAt < cutoff)
            .ExecuteDeleteAsync();

        // Recalculate similarities
        var (recalcResult, recalcError) = await RecalculateSimilaritiesAsync(tenantId);
        if (recalcError != null)
            return (null, $"Recalculation failed: {recalcError}");

        // Persist snapshot
        var (snapshot, snapshotError) = await PersistModelSnapshotAsync(tenantId);

        var result = new
        {
            stale_removed = staleRemoved,
            recalculation_result = recalcResult,
            snapshot = snapshot,
            snapshot_error = snapshotError
        };

        _logger.LogInformation(
            "Retraining pipeline complete for tenant {TenantId}: {StaleRemoved} stale removed",
            tenantId, staleRemoved);

        return (result, null);
    }

    /// <summary>
    /// Get model training history from persisted snapshots.
    /// </summary>
    public async Task<List<object>> GetModelHistoryAsync(int tenantId, int limit = 10)
    {
        var configs = await _db.Set<EnterpriseConfig>()
            .Where(c => c.TenantId == tenantId && c.Category == "ml_models" && c.Key.StartsWith("ml_model_snapshot_"))
            .OrderByDescending(c => c.Key)
            .Take(limit)
            .ToListAsync();

        var history = new List<object>();
        foreach (var config in configs)
        {
            try
            {
                var snapshot = JsonSerializer.Deserialize<JsonElement>(config.Value);
                history.Add(new
                {
                    key = config.Key,
                    description = config.Description,
                    updated_at = config.UpdatedAt,
                    data = snapshot
                });
            }
            catch (JsonException)
            {
                history.Add(new
                {
                    key = config.Key,
                    description = config.Description,
                    updated_at = config.UpdatedAt,
                    data = (object?)null
                });
            }
        }

        return history;
    }
}
