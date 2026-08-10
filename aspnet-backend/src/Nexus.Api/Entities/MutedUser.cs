// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Records that a user has muted another user, hiding their content from the feed.
/// </summary>
public class MutedUser : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who performed the mute action.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// The user who was muted.
    /// </summary>
    public int MutedUserId { get; set; }

    public DateTime MutedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? MutedUserNav { get; set; }
}
