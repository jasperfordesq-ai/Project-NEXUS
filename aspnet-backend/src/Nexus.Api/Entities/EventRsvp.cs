// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Junction entity for event RSVPs.
/// Tracks user responses to event invitations.
/// </summary>
public class EventRsvp : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int EventId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// RSVP status: going, maybe, not_going.
    /// </summary>
    public string Status { get; set; } = Event.RsvpStatus.Going;

    /// <summary>
    /// When the RSVP was created or last updated.
    /// </summary>
    public DateTime RespondedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Event? Event { get; set; }
    public User? User { get; set; }
}
