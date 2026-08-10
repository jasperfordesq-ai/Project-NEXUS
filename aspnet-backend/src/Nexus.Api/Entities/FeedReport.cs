// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A user-submitted report flagging a feed post for admin review.
/// Reason values: "spam", "harassment", "inappropriate", "other".
/// Status values: "pending", "reviewed", "dismissed", "action_taken".
/// </summary>
public class FeedReport : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PostId { get; set; }
    public int ReporterId { get; set; }

    /// <summary>
    /// Reason category: "spam", "harassment", "inappropriate", or "other".
    /// </summary>
    public string Reason { get; set; } = string.Empty;

    /// <summary>
    /// Optional free-text elaboration from the reporter.
    /// </summary>
    public string? Details { get; set; }

    /// <summary>
    /// Review status: "pending", "reviewed", "dismissed", or "action_taken".
    /// </summary>
    public string Status { get; set; } = "pending";

    /// <summary>
    /// Admin user ID who reviewed this report, if reviewed.
    /// </summary>
    public int? ReviewedByAdminId { get; set; }

    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public FeedPost? Post { get; set; }
    public User? Reporter { get; set; }
}
