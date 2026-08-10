// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// NexusScore - composite reputation score for a user. Tenant-scoped.
/// Computed from multiple signals: exchanges, reviews, badges, activity, reliability.
/// Score range: 0-1000.
/// </summary>
public class NexusScore : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Overall composite score (0-1000).
    /// </summary>
    public int Score { get; set; } = 0;

    /// <summary>
    /// Exchange completion rate component (0-200).
    /// </summary>
    public int ExchangeScore { get; set; } = 0;

    /// <summary>
    /// Average review rating component (0-200).
    /// </summary>
    public int ReviewScore { get; set; } = 0;

    /// <summary>
    /// Community engagement score (0-200): posts, comments, likes.
    /// </summary>
    public int EngagementScore { get; set; } = 0;

    /// <summary>
    /// Reliability score (0-200): response time, completion rate.
    /// </summary>
    public int ReliabilityScore { get; set; } = 0;

    /// <summary>
    /// Tenure / activity longevity (0-200).
    /// </summary>
    public int TenureScore { get; set; } = 0;

    /// <summary>
    /// tier: newcomer (0-199), emerging (200-399), established (400-599),
    /// trusted (600-799), exemplary (800-1000)
    /// </summary>
    public string Tier { get; set; } = "newcomer";

    public DateTime LastCalculatedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// Historical record of NexusScore changes. Tenant-scoped.
/// </summary>
public class NexusScoreHistory : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public int PreviousScore { get; set; }
    public int NewScore { get; set; }
    public string? PreviousTier { get; set; }
    public string? NewTier { get; set; }

    /// <summary>
    /// What triggered the recalculation.
    /// </summary>
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
