// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a connection (friendship) between two users.
///
/// Design:
/// - RequesterId is always the user who initiated the request
/// - AddresseeId is the user who receives the request
/// - Status tracks the connection state (pending, accepted, declined, blocked)
/// - Both users must be in the same tenant
/// </summary>
public class Connection : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user who sent the connection request
    /// </summary>
    public int RequesterId { get; set; }

    /// <summary>
    /// The user who received the connection request
    /// </summary>
    public int AddresseeId { get; set; }

    /// <summary>
    /// Current status: pending, accepted, declined, blocked
    /// </summary>
    public string Status { get; set; } = "pending";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant Tenant { get; set; } = null!;
    public User Requester { get; set; } = null!;
    public User Addressee { get; set; } = null!;

    // Valid status values
    public static class Statuses
    {
        public const string Pending = "pending";
        public const string Accepted = "accepted";
        public const string Declined = "declined";
        public const string Blocked = "blocked";
    }
}
