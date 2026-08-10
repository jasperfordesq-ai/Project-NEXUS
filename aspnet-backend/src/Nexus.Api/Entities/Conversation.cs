// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a conversation between two users.
/// A conversation is created implicitly when the first message is sent.
/// Implements tenant isolation via ITenantEntity.
/// </summary>
public class Conversation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int Participant1Id { get; set; }
    public int Participant2Id { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? Participant1 { get; set; }
    public User? Participant2 { get; set; }
    public ICollection<Message> Messages { get; set; } = new List<Message>();
}
