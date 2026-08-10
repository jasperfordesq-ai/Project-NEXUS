// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks user interactions for collaborative filtering recommendations.
/// Records views, clicks, exchanges, and ratings to build user preference profiles.
/// </summary>
public class UserInteraction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string InteractionType { get; set; } = string.Empty; // view, click, exchange, rating, save, share
    public string TargetType { get; set; } = string.Empty; // listing, user, event, group
    public int TargetId { get; set; }
    public decimal? Score { get; set; } // e.g., rating value 1-5
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Stores computed similarity scores between users based on interaction patterns.
/// Periodically recalculated by the matching engine.
/// </summary>
public class UserSimilarity : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserAId { get; set; }
    public int UserBId { get; set; }
    public decimal SimilarityScore { get; set; } // 0.0 to 1.0
    public string Algorithm { get; set; } = "cosine"; // cosine, pearson, jaccard
    public int CommonInteractions { get; set; }
    public DateTime CalculatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public User? UserA { get; set; }
    public User? UserB { get; set; }
}

/// <summary>
/// Stores match feedback to train the matching engine (reinforcement learning loop).
/// </summary>
public class MatchFeedback : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int MatchResultId { get; set; }
    public int UserId { get; set; }
    public string FeedbackType { get; set; } = string.Empty; // helpful, not_helpful, too_far, wrong_category, perfect
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public MatchResult? MatchResult { get; set; }
    public User? User { get; set; }
}
