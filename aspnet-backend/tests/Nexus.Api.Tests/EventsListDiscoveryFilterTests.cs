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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Regression tests for `GET /api/v2/events` discovery filtering.
///
/// 🔴 WHY THIS EXISTS. The action accepted only `page`/`limit`/`search`, so every
/// parameter the React clients send was silently ignored: the dashboard asks
/// `when=upcoming&amp;per_page=3` (`DashboardPage.tsx:286`) and received five events
/// including a FINISHED one (proven live with a temporary past-event row before the fix);
/// the group page asks `group_id`/`when=all`/`per_page`/`cursor` (`groupDetail.ts:375-380`)
/// and received every group's events with no way to paginate. Every response was a 200
/// with well-formed rows throughout — the same "the list loads" illusion as the feed.
///
/// The expectations below are Laravel's, probed live on the disposable environment:
/// `when` defaults to `upcoming` and an unrecognised value is a 422 VALIDATION_ERROR on
/// field `when` (message "The selected when is invalid."); a non-positive-integer
/// `group_id` is a 422 on `group_id` ("The group_id field must be an integer." — the
/// message Laravel emits even for a negative); `meta.cursor` appears only while more rows
/// exist; upcoming is ordered soonest-first, past/all newest-first.
/// </summary>
[Collection("Integration")]
public sealed class EventsListDiscoveryFilterTests : IntegrationTestBase
{
    public EventsListDiscoveryFilterTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const int PastEventId = 930001;
    private const int SoonEventId = 930002;
    private const int LaterEventId = 930003;
    private const int GroupedEventId = 930004;

    private async Task<int?> SeedDiscoveryEventsAsync()
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        if (!db.Events.Any(e => e.Id == PastEventId))
        {
            db.Events.AddRange(
                new Event
                {
                    Id = PastEventId,
                    TenantId = TestData.Tenant1.Id,
                    CreatedById = TestData.AdminUser.Id,
                    Title = "Discovery probe: finished last month",
                    StartsAt = now.AddDays(-30),
                    CreatedAt = now.AddDays(-31),
                },
                new Event
                {
                    Id = SoonEventId,
                    TenantId = TestData.Tenant1.Id,
                    CreatedById = TestData.AdminUser.Id,
                    Title = "Discovery probe: soonest upcoming",
                    StartsAt = now.AddDays(365),
                    CreatedAt = now,
                },
                new Event
                {
                    Id = LaterEventId,
                    TenantId = TestData.Tenant1.Id,
                    CreatedById = TestData.AdminUser.Id,
                    Title = "Discovery probe: later upcoming",
                    StartsAt = now.AddDays(400),
                    CreatedAt = now,
                });
            await db.SaveChangesAsync();
        }

        // A grouped event needs a real group; reuse any seeded one rather than invent.
        var groupId = db.Groups.Select(g => (int?)g.Id).FirstOrDefault();
        if (groupId is int gid && !db.Events.Any(e => e.Id == GroupedEventId))
        {
            db.Events.Add(new Event
            {
                Id = GroupedEventId,
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                GroupId = gid,
                Title = "Discovery probe: grouped",
                StartsAt = now.AddDays(380),
                CreatedAt = now,
            });
            await db.SaveChangesAsync();
        }

        return groupId;
    }

    private async Task<JsonDocument> GetAsync(string queryString)
    {
        using var response = await Client.GetAsync($"/api/v2/events?{queryString}");
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"?{queryString} should be a valid discovery request");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    private static List<int> Ids(JsonDocument document) =>
        document.RootElement.GetProperty("data").EnumerateArray()
            .Select(e => e.GetProperty("id").GetInt32())
            .ToList();

    [Fact]
    public async Task The_default_is_upcoming_and_a_finished_event_never_appears_in_it()
    {
        // THE dashboard defect: a member saw last month's event under "Upcoming events".
        await AuthenticateAsMemberAsync();
        await SeedDiscoveryEventsAsync();

        using var unfiltered = await GetAsync("per_page=100");
        Ids(unfiltered).Should().NotContain(PastEventId,
            "the DEFAULT is when=upcoming, exactly as Laravel defaults it — not 'everything'");
        Ids(unfiltered).Should().Contain(SoonEventId);

        using var past = await GetAsync("when=past&per_page=100");
        Ids(past).Should().Contain(PastEventId);
        Ids(past).Should().NotContain(SoonEventId);

        using var all = await GetAsync("when=all&per_page=100");
        Ids(all).Should().Contain(PastEventId).And.Contain(SoonEventId);
    }

    [Fact]
    public async Task Per_page_is_honoured_and_upcoming_reads_soonest_first()
    {
        await AuthenticateAsMemberAsync();
        await SeedDiscoveryEventsAsync();

        using var page = await GetAsync("when=upcoming&per_page=2");
        var ids = Ids(page);
        ids.Should().HaveCount(2, "the dashboard asks for 3 and must get 3, not everything");

        var starts = page.RootElement.GetProperty("data").EnumerateArray()
            .Select(e => e.GetProperty("start_date").GetString())
            .ToList();
        starts.Should().BeInAscendingOrder("upcoming is ordered soonest-first ('start_asc_id_asc')");
    }

    [Fact]
    public async Task The_cursor_appears_only_while_more_rows_exist_and_advances_without_repeats()
    {
        await AuthenticateAsMemberAsync();
        await SeedDiscoveryEventsAsync();

        using var first = await GetAsync("when=all&per_page=2");
        var meta = first.RootElement.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(2);

        if (!meta.GetProperty("has_more").GetBoolean())
        {
            // Fixture too small to page — the absence rule is still assertable.
            meta.TryGetProperty("cursor", out _).Should().BeFalse(
                "Laravel emits cursor only when non-null (respondWithCollection:208-210)");
            return;
        }

        meta.TryGetProperty("cursor", out var cursor).Should().BeTrue();
        using var second = await GetAsync($"when=all&per_page=2&cursor={Uri.EscapeDataString(cursor.GetString()!)}");
        Ids(second).Should().NotIntersectWith(Ids(first),
            "an echoed cursor must advance — re-serving page 1 for ever is the feed bug's twin");

        // The final page carries no cursor.
        using var big = await GetAsync("when=all&per_page=100");
        big.RootElement.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
        big.RootElement.GetProperty("meta").TryGetProperty("cursor", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Group_id_narrows_to_that_group_only()
    {
        await AuthenticateAsMemberAsync();
        var groupId = await SeedDiscoveryEventsAsync();
        if (groupId is not int gid)
        {
            return; // no seeded group in this fixture — the validation tests still cover the parameter
        }

        using var grouped = await GetAsync($"when=all&group_id={gid}&per_page=100");
        var ids = Ids(grouped);
        ids.Should().Contain(GroupedEventId);
        ids.Should().NotContain(SoonEventId, "an ungrouped event must not appear in a group's events tab");
    }

    [Theory]
    [InlineData("when=nonsense", "when", "The selected when is invalid.")]
    [InlineData("group_id=abc", "group_id", "The group_id field must be an integer.")]
    [InlineData("group_id=-5", "group_id", "The group_id field must be an integer.")]
    [InlineData("group_id=0", "group_id", "The group_id field must be an integer.")]
    public async Task Invalid_discovery_values_are_a_422_in_laravels_exact_shape(
        string queryString, string field, string message)
    {
        await AuthenticateAsMemberAsync();

        using var response = await Client.GetAsync($"/api/v2/events?{queryString}");
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "Laravel throws a ValidationException here, never a silent fallback");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var error = document.RootElement.GetProperty("errors").EnumerateArray().First();
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be(field);
        error.GetProperty("message").GetString().Should().Be(message);
    }

    [Fact]
    public async Task Mine_is_not_a_parameter_and_is_ignored_exactly_as_laravel_ignores_it()
    {
        // VereinFederationPanel.tsx:152 sends mine=1. Laravel's EventsController::index
        // never reads it, so implementing it here would be a DIVERGENCE, not a fix.
        await AuthenticateAsMemberAsync();
        await SeedDiscoveryEventsAsync();

        using var plain = await GetAsync("when=all&per_page=100");
        using var mine = await GetAsync("when=all&per_page=100&mine=1");
        Ids(mine).Should().Equal(Ids(plain));
    }
}
