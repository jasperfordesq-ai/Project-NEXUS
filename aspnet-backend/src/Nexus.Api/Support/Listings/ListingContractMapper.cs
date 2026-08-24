// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Support.Listings;

/// <summary>
/// The listing projection the canonical React frontend consumes.
///
/// 🔴 WHY. `/api/v2/listings` was the single worst remaining read endpoint: 50 fields
/// missing against Laravel, and 42 of those field names appear in the React source
/// (`rank-read-differences.mjs`). Verified against the listings UI specifically, it reads
/// `category`, `user`, `author_name`, `image_url`, `hours_estimate`, `is_favorited`,
/// `author_rating` and `service_type` — so those are not cosmetic.
///
/// 🔴 DEPTH IS FRONTEND-PROVEN, per the owner decision of 2026-08-19: emit every field
/// either frontend reads or validates, and do NOT chase Laravel's raw-model columns that
/// nothing reads. Laravel returns a whole Eloquent row here (including oddities like
/// `category.reset_token`); reproducing that byte-for-byte would be work with no
/// consumer.
///
/// 🔴 HONEST NULLS, NOT INVENTED VALUES. Several fields Laravel sends have no column on
/// this backend's `Listing` entity — `sdg_goals`, `price`, `availability`,
/// `renewal_count`, `save_count`, `contact_count`, `moderation_status` and the
/// author-reputation trio. The KEY is emitted (a client reading `listing.service_type`
/// must not get `undefined` where Laravel gives it a value) with an explicit null or a
/// documented zero. Deriving them from something adjacent would be fabricated data —
/// the exact fault class this workstream keeps finding, most recently a group slug
/// invented from the group name.
///
/// 🔴 `hours_estimate` vs `estimated_hours`: Laravel uses the former, this backend emitted
/// the latter, and BOTH are kept. Renaming is a subtractive change and needs its own
/// per-endpoint evidence; adding the Laravel spelling is additive and fixes the client.
/// </summary>
public static class ListingContractMapper
{
    /// <summary>Viewer-dependent facts the entity cannot know.</summary>
    public sealed class Facts
    {
        public int? ViewerId { get; init; }
        public bool IsFavorited { get; init; }
    }

    public static Dictionary<string, object?> Listing(Entities.Listing l, Facts? facts = null)
    {
        var f = facts ?? new Facts();

        var authorName = l.User is null
            ? null
            : NullIfBlank($"{l.User.FirstName} {l.User.LastName}".Trim());

        Dictionary<string, object?>? category = l.CategoryId is null && l.Category is null
            ? null
            : new Dictionary<string, object?>
            {
                ["id"] = l.CategoryId,
                ["name"] = NullIfBlank(l.Category?.Name),
                ["slug"] = NullIfBlank(l.Category?.Slug),
                // 🔴 Laravel emits `color` here (American spelling — unlike the EVENTS
                // contract's `colour`; verified against the live response, not assumed
                // from the events mapper). This backend's Category entity has NO colour
                // column at all, so the key exists with an honest null rather than a
                // value invented from the name or a palette.
                ["color"] = null,
            };

        return new Dictionary<string, object?>
        {
            ["id"] = l.Id,
            ["user_id"] = l.UserId,
            ["acting_user_id"] = l.ActingUserId,
            ["category_id"] = l.CategoryId,
            ["title"] = l.Title ?? string.Empty,
            ["description"] = NullIfBlank(l.Description),
            ["location"] = NullIfBlank(l.Location),
            ["latitude"] = l.Latitude,
            ["longitude"] = l.Longitude,
            ["type"] = l.Type.ToString().ToLowerInvariant(),
            ["status"] = l.Status.ToString().ToLowerInvariant(),
            ["created_at"] = Iso(l.CreatedAt),
            ["updated_at"] = Iso(l.UpdatedAt),
            ["image_url"] = NullIfBlank(l.ImageUrl),
            ["expires_at"] = Iso(l.ExpiresAt),
            ["deleted_at"] = Iso(l.DeletedAt),

            // Hours: both spellings, see the class remarks.
            ["hours_estimate"] = l.EstimatedHours,
            ["estimated_hours"] = l.EstimatedHours,

            ["is_featured"] = l.IsFeatured,
            ["view_count"] = l.ViewCount,

            ["category"] = category,
            ["category_name"] = category?["name"],
            ["category_slug"] = category?["slug"],
            ["category_color"] = category?["color"],

            ["user"] = l.User is null
                ? null
                : new Dictionary<string, object?>
                {
                    ["id"] = l.UserId,
                    ["name"] = authorName,
                    ["avatar"] = NullIfBlank(l.User.AvatarUrl),
                    ["avatar_url"] = NullIfBlank(l.User.AvatarUrl),
                    ["tagline"] = null,
                },
            ["author_name"] = authorName,
            ["author_avatar"] = NullIfBlank(l.User?.AvatarUrl),

            // 🔴 Reputation is NOT stored on this backend. The keys exist so a client
            // reading them gets a defined value, but they are explicit nulls rather than
            // a fabricated score. Populate them when a reputation source exists.
            ["author_verified"] = null,
            ["author_rating"] = null,

            ["is_favorited"] = f.IsFavorited,

            // 🔴 No column on the Listing entity for any of the following. Emitted as
            // explicit nulls/zeros so the shape matches and nothing is invented.
            ["sdg_goals"] = null,
            ["price"] = null,
            ["subcategory_id"] = null,
            ["service_type"] = NullIfBlank(l.ServiceType),
            ["availability"] = null,
            ["federated_visibility"] = null,
            ["direct_messaging_disabled"] = false,
            ["exchange_workflow_required"] = false,
            ["hours_available"] = l.HoursAvailable,
            ["renewed_at"] = null,
            ["renewal_count"] = 0,
            ["contact_count"] = 0,
            ["save_count"] = 0,
            ["featured_until"] = null,
            ["moderation_status"] = null,
            ["reviewed_by"] = l.ReviewedByUserId,
            ["reviewed_at"] = Iso(l.ReviewedAt),
            ["rejection_reason"] = NullIfBlank(l.RejectionReason),

            // Distance/match are computed by a search projection this endpoint does not
            // run; null rather than 0, because 0 would read as "right here".
            ["distance"] = null,
            ["cached_distance_km"] = null,
            ["match"] = null,
            ["reciprocity_match"] = null,
        };
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? Iso(DateTime? value) => value is null
        ? null
        : new DateTimeOffset(DateTime.SpecifyKind(value.Value, DateTimeKind.Utc))
            .ToString("yyyy-MM-ddTHH:mm:sszzz");
}
