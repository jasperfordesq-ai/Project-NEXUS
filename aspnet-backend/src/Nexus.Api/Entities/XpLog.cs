// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Log entry for XP gains/losses.
/// Tracks the source and amount of each XP change for audit and history.
/// </summary>
public class XpLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Amount of XP gained (positive) or lost (negative).
    /// </summary>
    public int Amount { get; set; }

    /// <summary>
    /// Source/reason for the XP change (e.g., "earn_badge", "listing_created", "connection_made").
    /// </summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// Optional reference ID (e.g., badge ID, listing ID) for context.
    /// </summary>
    public int? ReferenceId { get; set; }

    /// <summary>
    /// Optional description of the XP change.
    /// </summary>
    public string? Description { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }

    /// <summary>
    /// Predefined XP sources.
    /// </summary>
    public static class Sources
    {
        public const string BadgeEarned = "earn_badge";
        public const string ListingCreated = "listing_created";
        public const string ConnectionMade = "connection_made";
        public const string TransactionCompleted = "transaction_completed";
        public const string ExchangeCompleted = "exchange_completed";
        public const string PostCreated = "post_created";
        public const string EventCreated = "event_created";
        public const string EventAttended = "event_attended";
        public const string GroupCreated = "group_created";
        public const string GroupJoined = "group_joined";
        public const string CommentAdded = "comment_added";
        public const string ReviewLeft = "review_left";
        public const string MessageSent = "message_sent";
        public const string DailyLogin = "daily_login";
        public const string ProfileCompleted = "profile_completed";
        public const string VolunteerHour = "volunteer_hour";
        public const string PollVoted = "poll_voted";
        public const string GoalCompleted = "goal_completed";
        public const string CreditsSent = "credits_sent";
        public const string CreditsReceived = "credits_received";
    }

    /// <summary>
    /// V1-aligned XP amounts for various actions.
    /// </summary>
    public static class Amounts
    {
        public const int CreditsSentPerCredit = 10;
        public const int CreditsReceivedPerCredit = 5;
        public const int VolunteerHour = 20;
        public const int TransactionCompleted = 20;
        public const int ExchangeCompleted = 25;
        public const int ListingCreated = 15;
        public const int ReviewLeft = 10;
        public const int EventAttended = 15;
        public const int EventCreated = 30;
        public const int GroupJoined = 10;
        public const int GroupCreated = 50;
        public const int PostCreated = 5;
        public const int DailyLogin = 5;
        public const int ProfileCompleted = 50;
        public const int BadgeEarned = 25;
        public const int PollVoted = 2;
        public const int MessageSent = 2;
        public const int ConnectionMade = 10;
        public const int GoalCompleted = 10;
        public const int CommentAdded = 2;
    }
}
