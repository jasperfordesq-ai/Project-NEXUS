// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Rating left by a participant after an exchange is completed.
/// Each participant can rate the other once per exchange.
/// </summary>
public class ExchangeRating : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ExchangeId { get; set; }

    /// <summary>
    /// The user leaving the rating.
    /// </summary>
    public int RaterId { get; set; }

    /// <summary>
    /// The user being rated.
    /// </summary>
    public int RatedUserId { get; set; }

    /// <summary>
    /// Rating score from 1 to 5.
    /// </summary>
    public int Rating { get; set; }

    /// <summary>
    /// Optional comment with the rating.
    /// </summary>
    public string? Comment { get; set; }

    /// <summary>
    /// Whether the rater would work with this person again.
    /// </summary>
    public bool? WouldWorkAgain { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Exchange? Exchange { get; set; }
    public User? Rater { get; set; }
    public User? RatedUser { get; set; }
}
