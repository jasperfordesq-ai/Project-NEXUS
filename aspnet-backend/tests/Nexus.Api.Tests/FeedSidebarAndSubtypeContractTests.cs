// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for two feed-adjacent contracts fixed on 2026-08-20.
///
/// 🔴 SIDEBAR. `/api/v2/feed/sidebar` used to emit `trending_hashtags` as the RAW EF
/// `Hashtag` entities — camelCase keys plus the `Tenant` and `Usages` navigation
/// properties, null/empty only because nothing eager-loaded them: one future
/// `.Include()` away from serialising a tenant row into a member-facing response. It
/// and `suggested_groups` are keys Laravel never emits from this endpoint and no
/// frontend reads from it (React's FeedSidebar interface: friends, community_stats,
/// suggested_listings, top_categories, upcoming_events, popular_groups, profile_stats).
/// Both removed with that per-endpoint evidence.
///
/// 🔴 SUBTYPE. `?subtype=` narrows the feed on `metadata.listing_type`
/// (`FeedService.php:299-303`). Implemented via jsonb CONTAINMENT because Npgsql 10.0.3
/// has no JsonExtractPathText translator — this test runs against REAL Postgres, so it
/// is also the proof that the containment predicate actually translates.
/// </summary>
[Collection("Integration")]
public sealed class FeedSidebarAndSubtypeContractTests : IntegrationTestBase
{
    public FeedSidebarAndSubtypeContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Sidebar_emits_only_the_keys_laravel_emits_and_never_a_raw_entity()
    {
        await AuthenticateAsMemberAsync();

        using var response = await Client.GetAsync("/api/v2/feed/sidebar");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = document.RootElement.GetProperty("data");

        var keys = data.EnumerateObject().Select(p => p.Name).ToList();
        keys.Should().Contain(new[]
        {
            "community_stats", "top_categories", "upcoming_events", "popular_groups",
            "suggested_listings", "friends", "profile_stats",
        });
        // The two removed keys. Reintroducing either without a consumer AND an explicit
        // projection re-opens the raw-entity leak.
        keys.Should().NotContain("trending_hashtags");
        keys.Should().NotContain("suggested_groups");

        // No camelCase EF property names or navigation properties anywhere in the
        // payload — the signature of a raw entity reaching the serializer.
        var body = data.GetRawText();
        body.Should().NotContain("\"tenantId\"");
        body.Should().NotContain("\"usageCount\"");
        body.Should().NotContain("\"usages\"");
    }

    [Fact]
    public async Task Subtype_narrows_the_feed_to_matching_listing_types_only()
    {
        await AuthenticateAsMemberAsync();

        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            if (!db.FeedActivities.Any(a => a.SourceId == 940001))
            {
                db.FeedActivities.AddRange(
                    new FeedActivity
                    {
                        TenantId = TestData.Tenant1.Id,
                        UserId = TestData.MemberUser.Id,
                        SourceType = FeedActivitySourceTypes.Listing,
                        SourceId = 940001,
                        Title = "Subtype probe offer",
                        Metadata = """{"listing_type":"offer"}""",
                        IsVisible = true,
                        CreatedAt = DateTime.UtcNow,
                    },
                    new FeedActivity
                    {
                        TenantId = TestData.Tenant1.Id,
                        UserId = TestData.MemberUser.Id,
                        SourceType = FeedActivitySourceTypes.Listing,
                        SourceId = 940002,
                        Title = "Subtype probe request",
                        Metadata = """{"listing_type":"request"}""",
                        IsVisible = true,
                        CreatedAt = DateTime.UtcNow,
                    });
                await db.SaveChangesAsync();
            }
        }

        async Task<List<int>> IdsAsync(string query)
        {
            using var response = await Client.GetAsync($"/api/v2/feed?{query}");
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"?{query} must not 500 — this is the jsonb translation proof");
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return document.RootElement.GetProperty("data").EnumerateArray()
                .Select(e => e.GetProperty("id").GetInt32()).ToList();
        }

        var offers = await IdsAsync("type=listings&subtype=offer&per_page=100");
        offers.Should().Contain(940001);
        offers.Should().NotContain(940002, "a request must not appear under subtype=offer");

        var requests = await IdsAsync("type=listings&subtype=request&per_page=100");
        requests.Should().Contain(940002);
        requests.Should().NotContain(940001);

        // A set subtype excludes POSTS entirely: their metadata has no listing_type, and
        // in Laravel the jsonb predicate filters every post row out.
        var unfiltered = await IdsAsync("per_page=100");
        var withSubtype = await IdsAsync("subtype=offer&per_page=100");
        withSubtype.Should().OnlyContain(id => id == 940001,
            "subtype=offer keeps only rows whose metadata.listing_type is offer");
        unfiltered.Count.Should().BeGreaterThan(withSubtype.Count);
    }

    [Fact]
    public async Task Poll_rows_carry_poll_data_and_open_polls_hide_counts_from_non_creators()
    {
        // 🔴 poll_data was silently ABSENT from every poll feed row: the mapper accepted
        // it but nothing loaded it — invisible until the write harness put a poll into
        // both fixtures and the field diff flagged 12 missing keys. Ported from Laravel's
        // batchLoadPollData (FeedService.php:1123-1238) including the visibility rule:
        // open polls hide per-option counts and total_votes from everyone but the
        // creator, so live results cannot influence remaining voters.
        await AuthenticateAsMemberAsync();

        const int pollId = 941001;
        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            if (!db.Polls.Any(p => p.Id == pollId))
            {
                db.Polls.Add(new Poll
                {
                    Id = pollId,
                    TenantId = TestData.Tenant1.Id,
                    // 🔴 Created by the ADMIN: the signed-in member must be a NON-creator,
                    // or the hide-counts branch is never exercised.
                    CreatedById = TestData.AdminUser.Id,
                    Title = "Poll-data probe question",
                    Status = "active",
                    ClosesAt = DateTime.UtcNow.AddDays(7),
                });
                db.PollOptions.AddRange(
                    new PollOption { Id = 941101, TenantId = TestData.Tenant1.Id, PollId = pollId, Text = "Option A", SortOrder = 1 },
                    new PollOption { Id = 941102, TenantId = TestData.Tenant1.Id, PollId = pollId, Text = "Option B", SortOrder = 2 });
                db.PollVotes.Add(new PollVote
                {
                    TenantId = TestData.Tenant1.Id,
                    PollId = pollId,
                    OptionId = 941101,
                    UserId = TestData.AdminUser.Id,
                });
                db.FeedActivities.Add(new FeedActivity
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = TestData.AdminUser.Id,
                    SourceType = FeedActivitySourceTypes.Poll,
                    SourceId = pollId,
                    Title = "Poll-data probe question",
                    IsVisible = true,
                    CreatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync();
            }
        }

        using var response = await Client.GetAsync("/api/v2/feed?type=polls&per_page=100");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var row = document.RootElement.GetProperty("data").EnumerateArray()
            .Single(e => e.GetProperty("id").GetInt32() == pollId);

        var pollData = row.GetProperty("poll_data");
        pollData.GetProperty("id").GetInt32().Should().Be(pollId);
        pollData.GetProperty("question").GetString().Should().Be("Poll-data probe question");
        pollData.GetProperty("is_active").GetBoolean().Should().BeTrue();
        pollData.GetProperty("expires_at").GetString().Should().NotBeNullOrEmpty();
        pollData.GetProperty("user_vote_option_id").ValueKind.Should().Be(JsonValueKind.Null,
            "the signed-in member has not voted");

        // The open-poll visibility rule, viewed as a NON-creator.
        pollData.GetProperty("total_votes").ValueKind.Should().Be(JsonValueKind.Null,
            "an open poll hides totals from non-creators (FeedService.php:1204-1219)");
        var options = pollData.GetProperty("options").EnumerateArray().ToList();
        options.Should().HaveCount(2);
        foreach (var option in options)
        {
            option.EnumerateObject().Select(p => p.Name)
                .Should().BeEquivalentTo(new[] { "id", "text", "vote_count", "percentage" });
            option.GetProperty("vote_count").ValueKind.Should().Be(JsonValueKind.Null);
            option.GetProperty("percentage").ValueKind.Should().Be(JsonValueKind.Null);
        }
    }
}
