// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Achievement badge that users can earn.
/// Badges are tenant-specific and can be awarded for various accomplishments.
/// </summary>
public class Badge : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// Unique identifier/slug for the badge (e.g., "first_listing", "helpful_neighbor").
    /// </summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// Display name of the badge.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Description of how to earn this badge.
    /// </summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// Icon URL or emoji for the badge.
    /// </summary>
    public string? Icon { get; set; }

    /// <summary>
    /// XP awarded when earning this badge.
    /// </summary>
    public int XpReward { get; set; } = 0;

    /// <summary>
    /// Whether this badge is currently active and can be earned.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Sort order for displaying badges.
    /// </summary>
    public int SortOrder { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public ICollection<UserBadge> UserBadges { get; set; } = new List<UserBadge>();

    /// <summary>
    /// Predefined badge slugs matching V1's badge categories.
    /// </summary>
    public static class Slugs
    {
        // First-time badges
        public const string FirstListing = "first_listing";
        public const string FirstConnection = "first_connection";
        public const string FirstTransaction = "first_transaction";
        public const string FirstPost = "first_post";
        public const string FirstEvent = "first_event";
        public const string FirstReview = "first_review";
        public const string FirstMessage = "first_message";

        // Volunteering hour milestones (Laravel parity)
        public const string Volunteer1Hour = "vol_1h";
        public const string Volunteer10Hours = "vol_10h";
        public const string Volunteer50Hours = "vol_50h";
        public const string Volunteer100Hours = "vol_100h";
        public const string Volunteer250Hours = "vol_250h";
        public const string Volunteer500Hours = "vol_500h";

        // Listing milestones
        public const string Offer5 = "offer_5";
        public const string Offer10 = "offer_10";
        public const string Offer25 = "offer_25";
        public const string Request5 = "request_5";
        public const string Request10 = "request_10";

        // Timebanking (credit-based)
        public const string Earn10 = "earn_10";
        public const string Earn50 = "earn_50";
        public const string Earn100 = "earn_100";
        public const string Earn250 = "earn_250";
        public const string Spend10 = "spend_10";
        public const string Spend50 = "spend_50";
        public const string Transaction10 = "transaction_10";
        public const string Transaction50 = "transaction_50";
        public const string Diversity3 = "diversity_3";       // Helped 3 unique people
        public const string Diversity10 = "diversity_10";
        public const string Diversity25 = "diversity_25";

        // Social
        public const string Connect10 = "connect_10";
        public const string Connect25 = "connect_25";
        public const string Connect50 = "connect_50";
        public const string Msg50 = "msg_50";
        public const string Msg200 = "msg_200";
        public const string Review10 = "review_10";
        public const string Review25 = "review_25";
        public const string FiveStar1 = "5star_1";            // Received first 5-star review
        public const string FiveStar10 = "5star_10";
        public const string FiveStar25 = "5star_25";

        // Events
        public const string EventAttend1 = "event_attend_1";
        public const string EventAttend10 = "event_attend_10";
        public const string EventAttend25 = "event_attend_25";
        public const string EventHost1 = "event_host_1";
        public const string EventHost5 = "event_host_5";

        // Groups
        public const string GroupJoin1 = "group_join_1";
        public const string GroupJoin5 = "group_join_5";
        public const string GroupCreate1 = "group_create_1";

        // Content
        public const string Posts25 = "posts_25";
        public const string Posts100 = "posts_100";
        public const string Likes50 = "likes_50";             // Received 50 likes total
        public const string Likes200 = "likes_200";

        // Loyalty/Special
        public const string Member30d = "member_30d";
        public const string Member180d = "member_180d";
        public const string Member365d = "member_365d";
        public const string Streak7d = "streak_7d";
        public const string Streak30d = "streak_30d";
        public const string Streak100d = "streak_100d";
        public const string Level5 = "level_5";
        public const string Level10 = "level_10";
        public const string EarlyAdopter = "early_adopter";
        public const string Verified = "verified";

        // Legacy aliases
        public const string HelpfulNeighbor = "helpful_neighbor";
        public const string CommunityBuilder = "community_builder";
        public const string EventOrganizer = "event_organizer";
        public const string PopularPost = "popular_post";
        public const string Veteran = "veteran";
    }

    /// <summary>
    /// Canonical Laravel volunteer-hour badge definitions. The existing
    /// tenant-scoped <c>badges</c> table stores one copy per tenant.
    /// </summary>
    public static class VolunteerHours
    {
        public const int FirstStepsThreshold = 1;
        public const int HelpingHandThreshold = 10;
        public const int ChangeMakerThreshold = 50;
        public const int TimeBankLegendThreshold = 100;
        public const int VolunteerHeroThreshold = 250;
        public const int VolunteerChampionThreshold = 500;

        public static IReadOnlyList<VolunteerHourBadgeDefinition> Definitions { get; } =
            Array.AsReadOnly(new[]
            {
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer1Hour,
                    "First Steps",
                    "Log your first volunteer hour",
                    "\U0001F463",
                    FirstStepsThreshold,
                    0),
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer10Hours,
                    "Helping Hand",
                    "Volunteer 10 hours",
                    "\U0001F932",
                    HelpingHandThreshold,
                    1),
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer50Hours,
                    "Change Maker",
                    "Volunteer 50 hours",
                    "\U0001F30D",
                    ChangeMakerThreshold,
                    2),
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer100Hours,
                    "TimeBank Legend",
                    "Volunteer 100 hours",
                    "\U0001F451",
                    TimeBankLegendThreshold,
                    3),
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer250Hours,
                    "Volunteer Hero",
                    "Volunteer 250 hours",
                    "\U0001F9B8",
                    VolunteerHeroThreshold,
                    4),
                new VolunteerHourBadgeDefinition(
                    Slugs.Volunteer500Hours,
                    "Volunteer Champion",
                    "Volunteer 500 hours",
                    "\U0001F3C5",
                    VolunteerChampionThreshold,
                    5)
            });
    }

    public sealed record VolunteerHourBadgeDefinition(
        string Slug,
        string Name,
        string Description,
        string Icon,
        int Threshold,
        int SortOrder);
}
