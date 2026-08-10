// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Records that a user has hidden a specific feed post from their feed.
/// </summary>
public class HiddenPost : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PostId { get; set; }
    public int UserId { get; set; }
    public DateTime HiddenAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public FeedPost? Post { get; set; }
    public User? User { get; set; }
}
