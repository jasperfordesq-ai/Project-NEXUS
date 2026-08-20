// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;

namespace Nexus.Api.Support.Feed;

/// <summary>
/// The feed-item projection the canonical React frontend consumes.
///
/// 🔴 SOURCE OF TRUTH. Ported field-for-field from Laravel's
/// `app/Services/FeedService.php` primary builder (:489-542) plus the batch-loaded
/// block (:572-640), read from the running disposable Laravel — never from memory.
/// The executable spec for what the client READS is
/// `react-frontend/src/components/feed/types.ts` (`interface FeedItem`), which is why
/// this emits `content_truncated`, `views_count`, `share_count`, `is_shared`,
/// `is_bookmarked` and `is_official` that the previous inline projection omitted.
///
/// 🔴 LARAVEL DOES NOT GATE THE TYPE-SPECIFIC FIELDS BY TYPE. This was the load-bearing
/// discovery: `start_date`, `rating`, `job_type`, `badge_key`, `hours` and the rest are
/// emitted on EVERY item, null when the metadata blob lacks them. A per-type branch here
/// would be a divergence, not a tidy-up. All of them come from the single `metadata` JSON
/// column — not from joins to the source tables — so no extra queries are needed.
///
/// 🔴 HONEST NULLS, NOT INVENTED VALUES. `views_count` and `is_official` have no column on
/// this backend's `FeedPost` entity (Laravel itself guards them with
/// `Schema::hasColumn`, defaulting `views_count` to 0). `media` and `link_previews` have no
/// store here at all and are therefore OMITTED rather than emitted as a lying empty array:
/// the React type marks both optional, and `[]` would assert "this post has no images"
/// when the truth is "this backend cannot know".
///
/// 🔴 `share_count` / `is_shared` / `is_bookmarked` / `reactions` ARE REAL. `PostShares`
/// (polymorphic via `OriginalType`/`OriginalPostId`), `Bookmarks` and `PostReactions` all
/// exist on this backend, so these are measured, not defaulted. The caller supplies them
/// through <see cref="Facts"/> after a batch lookup — mirroring Laravel, which also loads
/// them per page rather than per row.
/// </summary>
public static class FeedContractMapper
{
    /// <summary>Laravel's fallback avatar (`FeedService.php:500`). Matched deliberately:
    /// the client renders this path, so substituting null changes the rendered avatar.</summary>
    public const string DefaultAvatarPath = "/assets/img/defaults/default_avatar.png";

    /// <summary>Laravel truncates feed content at 500 characters (`FeedService.php:487`).</summary>
    public const int ContentMaxLength = 500;

    /// <summary>
    /// Laravel's `FeedService::TYPE_MAP` (`:93-99`) — the PLURAL `?type=` filter names the
    /// React feed's tabs send, mapped to singular `source_type` values.
    ///
    /// 🔴 The plural/singular split is load-bearing and cost me a wrong measurement: an
    /// unrecognised value silently falls back to the unfiltered feed, so probing
    /// `?type=event` returns EVERYTHING and reads exactly like "Laravel does not filter
    /// either". It does. The React tabs send the plural forms (`FeedFilter` in
    /// `components/feed/types.ts:6`).
    ///
    /// The route is `routes/api.php:931` -> `SocialController::feedV2`, which also accepts
    /// `subtype`, `user_id` and `group_id` — none of them implemented here. See the status
    /// doc; `user_id` in particular must not be added without Laravel's `privacy_profile`
    /// gate, or it becomes a profile-feed leak.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> TypeFilterMap =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["posts"] = "post",
            ["listings"] = "listing",
            ["events"] = "event",
            ["polls"] = "poll",
            ["goals"] = "goal",
            ["jobs"] = "job",
            ["challenges"] = "challenge",
            ["volunteering"] = "volunteer",
            ["blogs"] = "blog",
            ["discussions"] = "discussion",
            ["badge_earned"] = "badge_earned",
            ["level_up"] = "level_up",
        };

    /// <summary>
    /// Resolves a `?type=` value to the single `source_type` to filter on, or null for "no
    /// type filter" — which covers `all`, an absent value, and any unrecognised value.
    ///
    /// 🔴 The SOCIAL filters Laravel also allows — `following`, `trending`, `for_you`,
    /// `groups`, `saved` — are deliberately NOT handled here. They are not type filters;
    /// they scope by social graph or saved items and need their own queries. Returning null
    /// for them means an unfiltered feed rather than a wrong one, and they are recorded as
    /// an open gap rather than silently half-implemented.
    /// </summary>
    public static string? ResolveTypeFilter(string? requested)
    {
        var value = (requested ?? string.Empty).Trim();
        return TypeFilterMap.TryGetValue(value, out var sourceType) ? sourceType : null;
    }

    /// <summary>The row as it comes off the feed query, independent of the controller's
    /// private EF projection type so this stays unit-testable.</summary>
    public sealed class Source
    {
        public int Id { get; init; }
        public string Type { get; init; } = string.Empty;
        public bool IsFeedPost { get; init; }
        public string? Title { get; init; }
        public string? Content { get; init; }
        public string? ImageUrl { get; init; }
        public int? GroupId { get; init; }
        public int UserId { get; init; }
        public int? AuthorId { get; init; }
        public string? AuthorName { get; init; }
        public string? AuthorAvatarUrl { get; init; }
        /// <summary>Raw `metadata` JSON column; every type-specific field is read from it.</summary>
        public string? Metadata { get; init; }
        /// <summary>Laravel falls back to the author's location for `listing` rows only
        /// (`FeedService.php:508`).</summary>
        public string? UserLocation { get; init; }
        public DateTime CreatedAt { get; init; }
        public DateTime? UpdatedAt { get; init; }
    }

    /// <summary>Viewer-dependent and batch-loaded facts the row itself cannot carry.</summary>
    public sealed class Facts
    {
        public int LikesCount { get; init; }
        public int CommentsCount { get; init; }
        public bool IsLiked { get; init; }
        public int ShareCount { get; init; }
        public bool IsShared { get; init; }
        public bool IsBookmarked { get; init; }
        /// <summary>Shaped `{counts, total, user_reaction, top_reactors}`. Null omits the key,
        /// which is what Laravel does when it has no reaction data (`FeedService.php:1742`).</summary>
        public Dictionary<string, object?>? Reactions { get; init; }
        /// <summary>Poll payload for `poll` rows; null omits the key, as in Laravel (:540).</summary>
        public object? PollData { get; init; }
    }

    public static Dictionary<string, object?> Item(Source row, Facts? facts = null)
    {
        var f = facts ?? new Facts();
        var meta = ParseMetadata(row.Metadata);
        var (content, truncated) = TruncateWithFlag(row.Content ?? string.Empty, ContentMaxLength);

        var item = new Dictionary<string, object?>
        {
            ["id"] = row.Id,
            ["type"] = row.Type,
            ["user_id"] = row.UserId,
            ["title"] = row.Title,
            ["content"] = content,
            ["content_truncated"] = truncated,
            ["image_url"] = NullIfBlank(row.ImageUrl),

            ["author"] = new Dictionary<string, object?>
            {
                ["id"] = row.AuthorId ?? row.UserId,
                ["name"] = row.AuthorName,
                // Laravel's `??` fallback, matched exactly — see DefaultAvatarPath.
                ["avatar_url"] = NullIfBlank(row.AuthorAvatarUrl) ?? DefaultAvatarPath,
            },

            ["likes_count"] = f.LikesCount,
            ["comments_count"] = f.CommentsCount,
            ["is_liked"] = f.IsLiked,
            ["created_at"] = Iso(row.CreatedAt),

            // 🔴 Every field below is emitted on EVERY item type. See the class remarks:
            // Laravel does not branch on type here, and neither may this.

            // Event metadata
            ["start_date"] = MetaString(meta, "start_date"),
            // Laravel falls back to the author's location for listings only.
            ["location"] = MetaString(meta, "location")
                ?? (row.Type == "listing" ? NullIfBlank(row.UserLocation) : null),

            // Review metadata
            ["rating"] = MetaInt(meta, "rating"),
            ["receiver"] = MetaInt(meta, "receiver_id") is int receiverId
                ? new Dictionary<string, object?>
                {
                    ["id"] = receiverId,
                    // Laravel emits an EMPTY name here (`FeedService.php:511`); the feed row
                    // carries no receiver name and inventing one would be fabricated data.
                    ["name"] = string.Empty,
                }
                : null,

            // Job metadata
            ["job_type"] = MetaString(meta, "job_type"),
            ["commitment"] = MetaString(meta, "commitment"),

            // Challenge metadata
            ["submission_deadline"] = MetaString(meta, "submission_deadline"),
            ["ideas_count"] = MetaInt(meta, "ideas_count"),

            // Listing metadata
            ["listing_type"] = MetaString(meta, "listing_type"),

            // Gamification metadata
            ["badge_key"] = MetaString(meta, "badge_key"),
            ["badge_name"] = MetaString(meta, "badge_name"),
            ["badge_icon"] = MetaString(meta, "badge_icon"),
            ["new_level"] = MetaInt(meta, "new_level"),

            // Volunteer metadata
            ["credits_offered"] = MetaInt(meta, "credits_offered"),
            ["organization"] = MetaString(meta, "organization"),

            // Podcast routing metadata
            ["slug"] = MetaString(meta, "slug"),
            ["show_slug"] = MetaString(meta, "show_slug"),
            ["detail_path"] = MetaString(meta, "detail_path"),

            // Volunteer-hours metadata (approved hour logs)
            ["hours"] = MetaDecimal(meta, "hours"),

            // Batch-loaded engagement (Laravel :572-640).
            // 🔴 `views_count` and `is_official` have no column on this backend; Laravel
            // itself defaults `views_count` to 0 when the column is absent, so 0/false here
            // matches the Laravel behaviour rather than inventing a number.
            ["views_count"] = 0,
            ["is_official"] = false,
            ["share_count"] = f.ShareCount,
            ["is_shared"] = f.IsShared,
            ["is_bookmarked"] = f.IsBookmarked,
        };

        // Kept from the previous inline projection. Laravel's builder does not emit these,
        // but removing them is a SUBTRACTIVE change needing its own per-endpoint evidence —
        // and dropping keys a client may already read is exactly how the 82-red-test
        // incident happened. Additive discipline: keep both.
        item["group_id"] = row.GroupId;
        if (row.IsFeedPost)
        {
            item["updated_at"] = Iso(row.UpdatedAt);
        }

        // Conditional keys, matching Laravel's own conditionals.
        if (f.PollData is not null)
        {
            item["poll_data"] = f.PollData;
        }

        if (f.Reactions is not null)
        {
            item["reactions"] = f.Reactions;
        }

        return item;
    }

    /// <summary>
    /// The reactions payload shape Laravel emits (`ReactionService.php:349`) and React
    /// validates (`types.ts:102-107`). `topReactors` is capped at 3 by the caller, ordered
    /// newest-first, matching Laravel's `ROW_NUMBER() … rn &lt;= 3`.
    /// </summary>
    public static Dictionary<string, object?> Reactions(
        IReadOnlyDictionary<string, int> counts,
        string? userReaction,
        IEnumerable<Dictionary<string, object?>>? topReactors = null) => new()
        {
            // 🔴 An empty map serializes as `{}` here and as `[]` in PHP. `{}` is emitted
            // deliberately: it is what the React `Record<string, number>` type describes,
            // and a nested `[]` where an object is expected has already blanked a page once
            // on this platform. This is a knowing, documented divergence from PHP's quirk.
            ["counts"] = counts.ToDictionary(kv => kv.Key, kv => kv.Value),
            ["total"] = counts.Values.Sum(),
            ["user_reaction"] = userReaction,
            ["top_reactors"] = topReactors?.ToList() ?? new List<Dictionary<string, object?>>(),
        };

    /// <summary>
    /// Laravel's `truncateWithFlag` (`FeedService.php:1108`): a hard cut at
    /// <paramref name="maxLength"/> plus a literal `...`.
    ///
    /// 🔴 `mb_strlen`/`mb_substr` count UTF-8 CODE POINTS. `string.Length` counts UTF-16
    /// code units, so a post of 300 emoji would measure 600 and be truncated less than
    /// halfway through — and a naive `Substring` can split a surrogate pair and emit an
    /// invalid lone surrogate. This counts code points and only ever cuts on a code-point
    /// boundary.
    /// </summary>
    public static (string Text, bool Truncated) TruncateWithFlag(string text, int maxLength)
    {
        if (string.IsNullOrEmpty(text))
        {
            return (text ?? string.Empty, false);
        }

        var codePoints = 0;
        var i = 0;
        while (i < text.Length)
        {
            if (codePoints == maxLength)
            {
                return (string.Concat(text.AsSpan(0, i), "..."), true);
            }

            i += char.IsHighSurrogate(text[i]) && i + 1 < text.Length ? 2 : 1;
            codePoints++;
        }

        return (text, false);
    }

    private static JsonElement? ParseMetadata(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(metadata);
            return document.RootElement.ValueKind == JsonValueKind.Object
                // Clone: the JsonDocument is disposed on leaving this scope.
                ? document.RootElement.Clone()
                : null;
        }
        catch (JsonException)
        {
            // A malformed metadata blob must not fail the whole page. Laravel's
            // `json_decode(...) ?: []` degrades the same way — every metadata-derived
            // field then reads null, which is the honest answer.
            return null;
        }
    }

    private static bool TryGet(JsonElement? meta, string key, out JsonElement value)
    {
        value = default;
        return meta is { } element
            && element.TryGetProperty(key, out value)
            && value.ValueKind != JsonValueKind.Null;
    }

    private static string? MetaString(JsonElement? meta, string key)
    {
        if (!TryGet(meta, key, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => NullIfBlank(value.GetString()),
            JsonValueKind.Number => value.ToString(),
            _ => null,
        };
    }

    private static int? MetaInt(JsonElement? meta, string key)
    {
        if (!TryGet(meta, key, out var value))
        {
            return null;
        }

        // PHP's `(int)` cast accepts numeric strings, which is how these arrive when the
        // writer stored the blob with string values.
        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var number) => number,
            JsonValueKind.Number when value.TryGetDouble(out var real) => (int)real,
            JsonValueKind.String when int.TryParse(
                value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
            JsonValueKind.String when double.TryParse(
                value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var real) => (int)real,
            _ => null,
        };
    }

    private static decimal? MetaDecimal(JsonElement? meta, string key)
    {
        if (!TryGet(meta, key, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.String when decimal.TryParse(
                value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null,
        };
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? Iso(DateTime? value) => value is null
        ? null
        : new DateTimeOffset(DateTime.SpecifyKind(value.Value, DateTimeKind.Utc))
            .ToString("yyyy-MM-ddTHH:mm:sszzz");
}
