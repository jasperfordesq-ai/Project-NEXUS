// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a message within a conversation.
/// Implements tenant isolation via ITenantEntity.
/// </summary>
public class Message : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ConversationId { get; set; }
    public int SenderId { get; set; }
    public string Content { get; set; } = string.Empty;
    public bool IsRead { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }

    /// <summary>
    /// Laravel-compatible edit metadata. The original creation timestamp remains
    /// unchanged so the 24-hour edit window and message history stay auditable.
    /// </summary>
    public bool IsEdited { get; set; }
    public DateTime? EditedAt { get; set; }

    /// <summary>
    /// Global soft deletion shown to both participants. Per-user deletion uses
    /// the sender/receiver flags below and never removes the persisted message.
    /// </summary>
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// .NET audit extension recording the participant who performed the most
    /// recent delete mutation. Laravel records the timestamp and visibility
    /// scope but does not retain the actor as a foreign key.
    /// </summary>
    public int? DeletedByUserId { get; set; }

    /// <summary>
    /// Laravel-compatible per-participant visibility flags. The sender and
    /// receiver roles are relative to each persisted message, not conversation
    /// participant ordering.
    /// </summary>
    public bool IsDeletedSender { get; set; }
    public bool IsDeletedReceiver { get; set; }

    /// <summary>
    /// Laravel-compatible per-user conversation archive timestamps. Clearing
    /// only the current participant's timestamp restores their view without
    /// changing the other participant's archive state.
    /// </summary>
    public DateTime? ArchivedBySender { get; set; }
    public DateTime? ArchivedByReceiver { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Conversation? Conversation { get; set; }
    public User? Sender { get; set; }
    public User? DeletedByUser { get; set; }
    public ICollection<MessageReaction> Reactions { get; set; } = new List<MessageReaction>();
}
