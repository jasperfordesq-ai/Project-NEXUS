// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Membership of a conversation. Mirrors Laravel's
/// <c>conversation_participants</c>.
///
/// 🔴 Why this exists (R-25). This backend modelled a conversation as exactly
/// two people — <c>Participant1Id</c>/<c>Participant2Id</c> with a unique index
/// on the pair — so a group conversation could not be represented at all, while
/// the React app shipped a working group-creation screen. A member could fill in
/// the form, pick people, and receive an error.
///
/// The pair columns are deliberately KEPT during the transition: the
/// conversation list, unread counts, attachments and the voice-send path all
/// still read them. Writes go to both; reads move here first; the columns are
/// removed in a later migration once nothing reads them.
/// </summary>
public class ConversationParticipant : ITenantEntity
{
    public static class Roles
    {
        public const string Admin = "admin";
        public const string Member = "member";
    }

    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ConversationId { get; set; }
    public int UserId { get; set; }

    /// <summary>"admin" or "member" — matches Laravel's enum.</summary>
    public string Role { get; set; } = Roles.Member;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Set when someone leaves or is removed. The row is kept rather than
    /// deleted so the history of who could see what remains answerable.
    /// </summary>
    public DateTime? LeftAt { get; set; }

    public DateTime? MutedUntil { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public Conversation? Conversation { get; set; }
}
