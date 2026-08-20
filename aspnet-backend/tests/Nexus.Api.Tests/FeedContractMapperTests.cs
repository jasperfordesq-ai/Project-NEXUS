// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Nexus.Api.Support.Feed;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for the feed projection ported from Laravel's
/// `app/Services/FeedService.php`.
///
/// 🔴 These deliberately assert BEHAVIOUR, not key presence. A test that only checks a key
/// exists passes against a mapper that emits the wrong value everywhere — the fault class
/// this workstream has hit repeatedly. Each test below fails if the specific Laravel
/// behaviour it names is broken.
/// </summary>
public class FeedContractMapperTests
{
    private static FeedContractMapper.Source PostRow(
        string? metadata = null,
        string type = "post",
        string? content = "hello",
        string? avatar = "/u/1.png") => new()
        {
            Id = 7,
            Type = type,
            IsFeedPost = type == "post",
            Title = "A title",
            Content = content,
            UserId = 42,
            AuthorId = 42,
            AuthorName = "Ada Lovelace",
            AuthorAvatarUrl = avatar,
            Metadata = metadata,
            CreatedAt = new DateTime(2026, 8, 20, 9, 30, 0, DateTimeKind.Utc),
        };

    // ---------------------------------------------------------------------
    // Truncation — the field most visible to a member, and the one where a
    // naive C# port silently diverges from PHP.
    // ---------------------------------------------------------------------

    [Fact]
    public void Content_shorter_than_the_limit_is_untouched_and_not_flagged()
    {
        var item = FeedContractMapper.Item(PostRow(content: "short"));

        item["content"].Should().Be("short");
        item["content_truncated"].Should().Be(false);
    }

    [Fact]
    public void Content_at_exactly_the_limit_is_not_truncated()
    {
        // Laravel's guard is `<= $maxLength`, so 500 must pass through whole.
        var text = new string('a', FeedContractMapper.ContentMaxLength);

        var item = FeedContractMapper.Item(PostRow(content: text));

        item["content"].Should().Be(text);
        item["content_truncated"].Should().Be(false);
    }

    [Fact]
    public void Content_over_the_limit_is_cut_at_the_limit_and_flagged()
    {
        var text = new string('a', FeedContractMapper.ContentMaxLength + 1);

        var item = FeedContractMapper.Item(PostRow(content: text));

        item["content"].Should().Be(new string('a', FeedContractMapper.ContentMaxLength) + "...");
        item["content_truncated"].Should().Be(true);
    }

    [Fact]
    public void Emoji_content_is_measured_in_code_points_not_utf16_units()
    {
        // 🔴 THE REGRESSION THIS FILE EXISTS FOR. Every one of these emoji is a surrogate
        // pair, so `string.Length` reports 600 for 300 characters. A `string.Length`-based
        // port truncates this post that PHP's mb_strlen leaves whole — visibly cutting a
        // member's post in half on one backend and not the other.
        var text = string.Concat(Enumerable.Repeat("😀", 300));
        text.Length.Should().Be(600, "each emoji is a surrogate pair — this is the trap");

        var item = FeedContractMapper.Item(PostRow(content: text));

        item["content"].Should().Be(text);
        item["content_truncated"].Should().Be(false);
    }

    [Fact]
    public void Truncating_emoji_content_never_splits_a_surrogate_pair()
    {
        // 501 code points of emoji: must cut after exactly 500 whole emoji, leaving no
        // lone surrogate (which would serialize as invalid UTF-8 / U+FFFD).
        var text = string.Concat(Enumerable.Repeat("😀", FeedContractMapper.ContentMaxLength + 1));

        var (result, truncated) = FeedContractMapper.TruncateWithFlag(
            text, FeedContractMapper.ContentMaxLength);

        truncated.Should().BeTrue();
        result.Should().Be(
            string.Concat(Enumerable.Repeat("😀", FeedContractMapper.ContentMaxLength)) + "...");
        // A lone surrogate is not encodable: it round-trips through UTF-8 as U+FFFD. This
        // is the assertion that actually proves the cut landed on a code-point boundary —
        // checking the final char is NOT a surrogate would be wrong, because the last char
        // of an intact emoji is legitimately a low surrogate.
        var roundTripped = System.Text.Encoding.UTF8.GetString(
            System.Text.Encoding.UTF8.GetBytes(result));
        roundTripped.Should().Be(result, "a split surrogate pair would corrupt on encode");
        result.Should().NotContain("�");
    }

    // ---------------------------------------------------------------------
    // The load-bearing structural finding: Laravel does NOT gate the
    // type-specific metadata fields by item type.
    // ---------------------------------------------------------------------

    [Theory]
    [InlineData("post")]
    [InlineData("listing")]
    [InlineData("badge_earned")]
    [InlineData("volunteer_hours")]
    public void Every_type_specific_key_is_present_on_every_item_type(string type)
    {
        var item = FeedContractMapper.Item(PostRow(type: type));

        // Laravel emits all of these unconditionally, null when the metadata blob lacks
        // them. A per-type branch here would be a contract divergence.
        var alwaysPresent = new[]
        {
            "start_date", "location", "rating", "receiver", "job_type", "commitment",
            "submission_deadline", "ideas_count", "listing_type", "badge_key", "badge_name",
            "badge_icon", "new_level", "credits_offered", "organization", "slug",
            "show_slug", "detail_path", "hours",
        };

        foreach (var key in alwaysPresent)
        {
            item.Should().ContainKey(key, $"Laravel emits {key} on every feed item type");
            item[key].Should().BeNull("absent metadata reads as null, not a missing key");
        }
    }

    [Fact]
    public void Metadata_values_are_projected_onto_the_matching_keys()
    {
        var item = FeedContractMapper.Item(PostRow(metadata: """
        {
          "start_date": "2026-09-01T10:00:00+00:00",
          "location": "Cork",
          "rating": 4,
          "receiver_id": 99,
          "job_type": "timebank",
          "commitment": "weekly",
          "submission_deadline": "2026-10-01",
          "ideas_count": 12,
          "listing_type": "offer",
          "badge_key": "first_exchange",
          "badge_name": "First Exchange",
          "badge_icon": "🎉",
          "new_level": 3,
          "credits_offered": 5,
          "organization": "hOUR Timebank",
          "slug": "an-episode",
          "show_slug": "a-show",
          "detail_path": "/podcasts/a-show/an-episode",
          "hours": 2.5
        }
        """));

        item["start_date"].Should().Be("2026-09-01T10:00:00+00:00");
        item["location"].Should().Be("Cork");
        item["rating"].Should().Be(4);
        item["job_type"].Should().Be("timebank");
        item["commitment"].Should().Be("weekly");
        item["submission_deadline"].Should().Be("2026-10-01");
        item["ideas_count"].Should().Be(12);
        item["listing_type"].Should().Be("offer");
        item["badge_key"].Should().Be("first_exchange");
        item["badge_name"].Should().Be("First Exchange");
        item["badge_icon"].Should().Be("🎉");
        item["new_level"].Should().Be(3);
        item["credits_offered"].Should().Be(5);
        item["organization"].Should().Be("hOUR Timebank");
        item["slug"].Should().Be("an-episode");
        item["show_slug"].Should().Be("a-show");
        item["detail_path"].Should().Be("/podcasts/a-show/an-episode");
        item["hours"].Should().Be(2.5m);
    }

    [Fact]
    public void Receiver_is_built_from_receiver_id_with_the_empty_name_laravel_sends()
    {
        var item = FeedContractMapper.Item(PostRow(metadata: """{"receiver_id": 99}"""));

        var receiver = item["receiver"].Should().BeAssignableTo<Dictionary<string, object?>>()
            .Subject;
        receiver["id"].Should().Be(99);
        // Laravel sends `'name' => ''` (FeedService.php:511). The feed row carries no
        // receiver name; inventing one would be fabricated data.
        receiver["name"].Should().Be(string.Empty);
    }

    [Fact]
    public void Numeric_strings_in_metadata_are_coerced_the_way_phps_int_cast_does()
    {
        var item = FeedContractMapper.Item(PostRow(metadata: """
        {"rating": "5", "new_level": "2", "hours": "1.75"}
        """));

        item["rating"].Should().Be(5);
        item["new_level"].Should().Be(2);
        item["hours"].Should().Be(1.75m);
    }

    [Fact]
    public void Malformed_metadata_degrades_to_nulls_rather_than_failing_the_page()
    {
        var item = FeedContractMapper.Item(PostRow(metadata: "{not json"));

        item["badge_key"].Should().BeNull();
        item["hours"].Should().BeNull();
        // The rest of the item must still be intact.
        item["id"].Should().Be(7);
        item["content"].Should().Be("hello");
    }

    // ---------------------------------------------------------------------
    // Author, engagement, and the conditional keys.
    // ---------------------------------------------------------------------

    [Fact]
    public void Missing_avatar_falls_back_to_laravels_default_avatar_path()
    {
        var item = FeedContractMapper.Item(PostRow(avatar: null));

        var author = item["author"].Should().BeAssignableTo<Dictionary<string, object?>>().Subject;
        author["avatar_url"].Should().Be(FeedContractMapper.DefaultAvatarPath);
    }

    [Fact]
    public void Engagement_facts_are_projected_and_default_to_the_unengaged_state()
    {
        var withFacts = FeedContractMapper.Item(PostRow(), new FeedContractMapper.Facts
        {
            LikesCount = 3,
            CommentsCount = 2,
            IsLiked = true,
            ShareCount = 4,
            IsShared = true,
            IsBookmarked = true,
        });

        withFacts["likes_count"].Should().Be(3);
        withFacts["comments_count"].Should().Be(2);
        withFacts["is_liked"].Should().Be(true);
        withFacts["share_count"].Should().Be(4);
        withFacts["is_shared"].Should().Be(true);
        withFacts["is_bookmarked"].Should().Be(true);

        var bare = FeedContractMapper.Item(PostRow());
        bare["share_count"].Should().Be(0);
        bare["is_shared"].Should().Be(false);
        bare["is_bookmarked"].Should().Be(false);
        // Keys the React FeedItem type reads that the previous projection omitted entirely.
        bare.Should().ContainKey("views_count");
        bare.Should().ContainKey("is_official");
    }

    [Fact]
    public void Reactions_and_poll_data_keys_are_omitted_when_there_is_no_data()
    {
        var item = FeedContractMapper.Item(PostRow());

        // Laravel attaches these conditionally (FeedService.php:540 and :1742). Emitting an
        // empty payload would assert "no reactions" where the truth is "none loaded".
        item.Should().NotContainKey("reactions");
        item.Should().NotContainKey("poll_data");
    }

    [Fact]
    public void Reactions_payload_matches_the_shape_react_validates()
    {
        var reactions = FeedContractMapper.Reactions(
            new Dictionary<string, int> { ["like"] = 2, ["celebrate"] = 1 },
            userReaction: "like",
            topReactors: new[]
            {
                new Dictionary<string, object?> { ["id"] = 1, ["name"] = "Ada", ["avatar_url"] = null },
            });

        reactions["total"].Should().Be(3, "total is the sum of the counts, not the key count");
        reactions["user_reaction"].Should().Be("like");
        reactions["counts"].Should().BeAssignableTo<Dictionary<string, int>>()
            .Which.Should().HaveCount(2);
        reactions["top_reactors"].Should()
            .BeAssignableTo<List<Dictionary<string, object?>>>()
            .Which.Should().HaveCount(1);
    }

    [Fact]
    public void Empty_reactions_still_carry_every_key_with_a_zero_total()
    {
        var reactions = FeedContractMapper.Reactions(
            new Dictionary<string, int>(), userReaction: null);

        reactions["total"].Should().Be(0);
        reactions["user_reaction"].Should().BeNull();
        reactions.Should().ContainKey("counts");
        reactions["top_reactors"].Should()
            .BeAssignableTo<List<Dictionary<string, object?>>>()
            .Which.Should().BeEmpty();
    }

    [Fact]
    public void Listing_location_falls_back_to_the_author_location_only_for_listings()
    {
        // Laravel: `$meta['location'] ?? ($type === 'listing' ? $row->user_location : null)`.
        var listing = FeedContractMapper.Item(new FeedContractMapper.Source
        {
            Id = 1,
            Type = "listing",
            UserId = 42,
            UserLocation = "Galway",
            CreatedAt = DateTime.UtcNow,
        });
        listing["location"].Should().Be("Galway");

        var evt = FeedContractMapper.Item(new FeedContractMapper.Source
        {
            Id = 1,
            Type = "event",
            UserId = 42,
            UserLocation = "Galway",
            CreatedAt = DateTime.UtcNow,
        });
        evt["location"].Should().BeNull("the fallback is listing-only");
    }

    [Fact]
    public void Explicit_metadata_location_wins_over_the_listing_fallback()
    {
        var item = FeedContractMapper.Item(new FeedContractMapper.Source
        {
            Id = 1,
            Type = "listing",
            UserId = 42,
            UserLocation = "Galway",
            Metadata = """{"location": "Cork"}""",
            CreatedAt = DateTime.UtcNow,
        });

        item["location"].Should().Be("Cork");
    }

    [Fact]
    public void Internal_ranking_fields_are_never_emitted()
    {
        var item = FeedContractMapper.Item(PostRow(metadata: """
        {"_edge_rank": 12.5, "detail_path": "/x"}
        """));

        // `_edge_rank` leaks algorithm signals and Laravel strips it server-side; the
        // cursor fields are internal plumbing this page-based endpoint has no use for.
        item.Should().NotContainKey("_edge_rank");
        item.Should().NotContainKey("_activity_id");
        item.Should().NotContainKey("_activity_created_at");
    }
}
