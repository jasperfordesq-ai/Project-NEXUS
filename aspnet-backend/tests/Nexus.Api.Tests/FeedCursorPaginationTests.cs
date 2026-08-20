// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using FluentAssertions;
using Nexus.Api.Controllers;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for `/api/v2/feed` cursor pagination.
///
/// 🔴 WHY THIS EXISTS. The endpoint accepted `page`/`limit` and emitted neither
/// `meta.cursor` nor honoured `per_page`. The React feed sends `per_page` and paginates
/// purely by cursor (`FeedPage.tsx:313,321,342-343`): with no cursor in the response its
/// `cursorRef` stayed undefined, so every infinite-scroll fetch re-requested the FIRST
/// page for ever. The endpoint returned 200 with well-formed rows throughout — "the list
/// loads" was true and "the feed works" was not.
///
/// The end-to-end behaviour (per_page honoured, cursor advances with no repeated ids,
/// garbage cursor falls back to page one) was verified live against the running backend;
/// these tests pin the codec so it cannot regress silently.
/// </summary>
public class FeedCursorPaginationTests
{
    private static readonly MethodInfo Encode =
        typeof(V15SocialCompatibilityController).GetMethod(
            "EncodeFeedOffsetCursor",
            BindingFlags.NonPublic | BindingFlags.Static)!;

    private static readonly MethodInfo Decode =
        typeof(V15SocialCompatibilityController).GetMethod(
            "DecodeFeedOffsetCursor",
            BindingFlags.NonPublic | BindingFlags.Static)!;

    private static readonly MethodInfo Meta =
        typeof(V15SocialCompatibilityController).GetMethod(
            "FeedPageMeta",
            BindingFlags.NonPublic | BindingFlags.Static)!;

    private static string EncodeCursor(long offset) => (string)Encode.Invoke(null, new object[] { offset })!;

    private static long? DecodeCursor(string? cursor) => (long?)Decode.Invoke(null, new object?[] { cursor });

    private static T MetaValue<T>(int perPage, long offset, int returned, int total, string property)
    {
        var meta = Meta.Invoke(null, new object[] { perPage, offset, returned, total })!;
        return (T)meta.GetType().GetProperty(property)!.GetValue(meta)!;
    }

    [Fact]
    public void The_cursor_round_trips_the_offset()
    {
        foreach (var offset in new long[] { 0, 1, 20, 999, 1_000_000 })
        {
            DecodeCursor(EncodeCursor(offset)).Should().Be(offset);
        }
    }

    [Fact]
    public void An_absent_cursor_means_use_the_page_parameter()
    {
        DecodeCursor(null).Should().BeNull();
        DecodeCursor("").Should().BeNull();
        DecodeCursor("   ").Should().BeNull();
    }

    [Theory]
    [InlineData("not-a-real-cursor")]
    [InlineData("!!!not base64!!!")]
    // A Laravel-issued keyset cursor: a client that switches backends mid-session still
    // holds one of these in memory. It must degrade to the first page, never throw.
    [InlineData("YzFhNTE5MDY4MzdkYWIyOTNlNGFkMzY5MmExNzEwMmMzZTEzZDdiNDQ2Yzk1MGZiNWNkNmNlZDhiYzZkMjcxYy57InRzIjoiMjAyNi0wOC0yMCAwOToxNzowNCIsImlkIjo5NTAwNTF9")]
    public void An_unrecognised_cursor_falls_back_rather_than_erroring(string cursor)
    {
        DecodeCursor(cursor).Should().BeNull();
    }

    [Fact]
    public void A_negative_offset_is_rejected()
    {
        // Guards against a forged cursor walking the offset backwards past zero.
        var forged = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("offset:-5"));

        DecodeCursor(forged).Should().BeNull();
    }

    [Fact]
    public void Has_more_is_true_only_while_rows_remain_beyond_what_was_served()
    {
        MetaValue<bool>(perPage: 20, offset: 0, returned: 20, total: 50, "has_more")
            .Should().BeTrue();
        MetaValue<bool>(perPage: 20, offset: 40, returned: 10, total: 50, "has_more")
            .Should().BeFalse("the last page is exhausted");
        MetaValue<bool>(perPage: 20, offset: 0, returned: 0, total: 0, "has_more")
            .Should().BeFalse("an empty feed has nothing more");
    }

    [Fact]
    public void The_emitted_cursor_points_past_the_rows_just_served()
    {
        // This is the property that makes scrolling terminate: the next request must start
        // where this one stopped. An off-by-one here either repeats or skips a row.
        var cursor = MetaValue<string>(perPage: 20, offset: 40, returned: 20, total: 100, "cursor");

        DecodeCursor(cursor).Should().Be(60);
    }

    [Fact]
    public void A_cursor_is_emitted_even_on_the_final_page()
    {
        // Verified against the live Laravel, which sends a cursor alongside
        // `has_more: false`. Omitting the key on the last page would be a shape difference.
        var cursor = MetaValue<string>(perPage: 20, offset: 40, returned: 10, total: 50, "cursor");

        cursor.Should().NotBeNullOrWhiteSpace();
        DecodeCursor(cursor).Should().Be(50);
    }

    [Fact]
    public void Per_page_is_echoed_so_the_client_can_confirm_its_page_size()
    {
        MetaValue<int>(perPage: 7, offset: 0, returned: 7, total: 30, "per_page")
            .Should().Be(7);
    }

    // -------------------------------------------------------------------------
    // `?type=` — the feed's filter tabs. These were doing nothing at all: the
    // parameter was not on the action, so every tab returned the same unfiltered
    // feed while Laravel filtered properly.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("posts", "post")]
    [InlineData("listings", "listing")]
    [InlineData("events", "event")]
    [InlineData("polls", "poll")]
    [InlineData("goals", "goal")]
    [InlineData("jobs", "job")]
    [InlineData("challenges", "challenge")]
    [InlineData("volunteering", "volunteer")]
    [InlineData("blogs", "blog")]
    [InlineData("discussions", "discussion")]
    [InlineData("badge_earned", "badge_earned")]
    [InlineData("level_up", "level_up")]
    public void Each_plural_tab_name_maps_to_its_singular_source_type(string tab, string sourceType)
    {
        // Pinned against Laravel's `FeedService::TYPE_MAP` (:93-99). All twelve, because a
        // single wrong pair silently shows an empty tab.
        Support.Feed.FeedContractMapper.ResolveTypeFilter(tab).Should().Be(sourceType);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("all")]
    // 🔴 SINGULAR forms are NOT valid filter names. Laravel's allowlist holds the plurals
    // and silently falls back to `all`, so `?type=event` returns the WHOLE feed. This cost
    // me a wrong measurement that read as "Laravel does not filter either" — it does.
    [InlineData("event")]
    [InlineData("post")]
    [InlineData("nonsense")]
    // Social scopes Laravel allows but this backend does not implement. Unfiltered is the
    // honest answer; a wrong filter would be worse than none.
    [InlineData("following")]
    [InlineData("trending")]
    [InlineData("for_you")]
    [InlineData("groups")]
    [InlineData("saved")]
    public void Anything_not_in_the_map_means_no_type_filter(string? requested)
    {
        Support.Feed.FeedContractMapper.ResolveTypeFilter(requested).Should().BeNull();
    }

    [Fact]
    public void The_filter_map_covers_exactly_laravels_twelve_entries()
    {
        // Guards against a well-meaning addition — e.g. mapping `volunteer_hours` — that
        // would make a tab behave differently from Laravel's.
        Support.Feed.FeedContractMapper.TypeFilterMap.Should().HaveCount(12);
    }
}
