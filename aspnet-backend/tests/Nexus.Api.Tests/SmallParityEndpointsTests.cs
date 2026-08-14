// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins three small parity surfaces: admin challenge CRUD (Laravel
/// AdminChallengesTest), admin badge counts, and anonymous public events
/// (Laravel PublicEventsTest) — including the allowlist projection that must
/// never leak links, RSVP state, or the organiser's surname, and the double
/// feature gate with public_events OFF by default.
/// </summary>
[Collection("Integration")]
public class SmallParityEndpointsTests : IntegrationTestBase
{
    public SmallParityEndpointsTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    // ─── Admin challenges ───────────────────────────────────────────

    [Fact]
    public async Task Challenges_CrudRoundTrip_WithLaravelShapes()
    {
        await AuthenticateAsAdminAsync();

        var invalid = await Client.PostAsJsonAsync("/api/v2/admin/gamification/challenges", new
        {
            title = "Bad action",
            action_type = "made_up_action",
            start_date = "2026-08-01",
            end_date = "2026-08-31"
        });
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(invalid)).GetProperty("errors")[0].GetProperty("field")
            .GetString().Should().Be("action_type");

        var created = await Client.PostAsJsonAsync("/api/v2/admin/gamification/challenges", new
        {
            title = "Visit three venues",
            action_type = "venue_visit",
            challenge_type = "weekly",
            target_count = 3,
            xp_reward = 100,
            start_date = "2026-08-01",
            end_date = "2026-08-31"
        });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var row = (await ReadJsonAsync(created)).GetProperty("data");
        var challengeId = row.GetProperty("id").GetInt32();
        row.GetProperty("action_type").GetString().Should().Be("venue_visit");
        row.GetProperty("challenge_type").GetString().Should().Be("weekly");
        row.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var list = await Client.GetAsync("/api/v2/admin/gamification/challenges?limit=100");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listData = (await ReadJsonAsync(list)).GetProperty("data");
        listData.GetProperty("total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        listData.GetProperty("supported_action_types").EnumerateArray()
            .Select(v => v.GetString()).Should().Contain("venue_visit");
        listData.GetProperty("challenge_types").EnumerateArray()
            .Select(v => v.GetString()).Should().Equal("daily", "weekly", "monthly", "special");

        var updated = await Client.PutAsJsonAsync(
            $"/api/v2/admin/gamification/challenges/{challengeId}", new { xp_reward = 250 });
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(updated)).GetProperty("data").GetProperty("xp_reward")
            .GetInt32().Should().Be(250);

        var badDates = await Client.PutAsJsonAsync(
            $"/api/v2/admin/gamification/challenges/{challengeId}",
            new { start_date = "2026-09-01", end_date = "2026-08-01" });
        badDates.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(badDates)).GetProperty("errors")[0].GetProperty("field")
            .GetString().Should().Be("end_date");

        (await Client.GetAsync("/api/v2/admin/gamification/challenges?is_active=false"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var missing = await Client.PutAsJsonAsync(
            "/api/v2/admin/gamification/challenges/999999", new { title = "Ghost" });
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var deleted = await Client.DeleteAsync($"/api/v2/admin/gamification/challenges/{challengeId}");
        deleted.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(deleted)).GetProperty("data").GetProperty("deleted")
            .GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Challenges_RejectAPlainMember()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/admin/gamification/challenges");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var json = await ReadJsonAsync(response);
        json.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("forbidden");
        json.GetProperty("success").GetBoolean().Should().BeFalse();
    }

    // ─── Badge counts ───────────────────────────────────────────────

    [Fact]
    public async Task BadgeCounts_ReturnAllEightKeys_AndPendingUsersUsesApproval()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Users.Add(new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"unapproved-{Guid.NewGuid():N}@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Waiting",
                LastName = "Approval",
                Role = "member",
                IsActive = true,
                IsApproved = false,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/v2/admin/badge-counts");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        foreach (var key in new[]
                 {
                     "pending_users", "pending_listings", "pending_orgs", "fraud_alerts",
                     "gdpr_requests", "404_errors", "pending_exchanges", "unreviewed_messages"
                 })
        {
            data.TryGetProperty(key, out var value).Should().BeTrue($"{key} must be present");
            value.ValueKind.Should().Be(JsonValueKind.Number);
        }

        data.GetProperty("pending_users").GetInt32().Should().BeGreaterThanOrEqualTo(1,
            "the unapproved member counts, matching the admin list's pending filter");
    }

    // ─── Public events ──────────────────────────────────────────────

    private async Task EnablePublicEventsAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = TestData.Tenant1.Id,
            Key = "features.public_events",
            Value = "true",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task<int> SeedEventAsync(
        string title, string publicationStatus = "published", DateTime? startsAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var eventRow = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.MemberUser.Id,
            Title = title,
            Description = "A public gathering.",
            Location = "The Hall",
            StartsAt = startsAt ?? DateTime.UtcNow.AddDays(7),
            EndsAt = (startsAt ?? DateTime.UtcNow.AddDays(7)).AddHours(2),
            Status = "active",
            PublicationStatus = publicationStatus,
            OperationalStatus = "scheduled",
            CreatedAt = DateTime.UtcNow
        };
        db.Events.Add(eventRow);
        await db.SaveChangesAsync();
        return eventRow.Id;
    }

    private void UseAnonymousTenantHeader()
    {
        ClearAuthToken();
        Client.DefaultRequestHeaders.Remove("X-Tenant-ID");
        Client.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
    }

    [Fact]
    public async Task PublicEvents_AreOffByDefault()
    {
        await SeedEventAsync("Hidden without the flag");
        UseAnonymousTenantHeader();

        var response = await Client.GetAsync("/api/v2/public/events");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "public_events is opt-in per community");
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task PublicEvents_ProjectTheAllowlist_AndNeverLeak()
    {
        await EnablePublicEventsAsync();
        var eventId = await SeedEventAsync("Village Fete");
        await SeedEventAsync("Draft never shows", publicationStatus: "draft");
        UseAnonymousTenantHeader();

        var list = await Client.GetAsync("/api/v2/public/events");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var items = (await ReadJsonAsync(list)).GetProperty("data");
        items.GetArrayLength().Should().Be(1, "drafts are invisible");
        var item = items[0];
        item.GetProperty("title").GetString().Should().Be("Village Fete");
        item.GetProperty("attendance_mode").GetString().Should().Be("in_person");
        item.GetProperty("operational_status").GetString().Should().Be("scheduled");
        item.GetProperty("organizer_name").GetString().Should().NotContain(" ",
            "individuals surface first name only — never a surname");
        foreach (var forbidden in new[]
                 {
                     "online_link", "join_url", "my_rsvp", "rsvps", "attendee_count",
                     "max_attendees", "user", "description"
                 })
        {
            item.TryGetProperty(forbidden, out _).Should().BeFalse(
                $"{forbidden} must never appear on the public list");
        }

        var detail = await Client.GetAsync($"/api/v2/public/events/{eventId}");
        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        var detailData = (await ReadJsonAsync(detail)).GetProperty("data");
        detailData.GetProperty("description").GetString().Should().Be("A public gathering.");
        detailData.GetProperty("accessibility").ValueKind.Should().Be(JsonValueKind.Object);
        detailData.TryGetProperty("online_link", out _).Should().BeFalse();

        var missing = await Client.GetAsync("/api/v2/public/events/999999");
        missing.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadJsonAsync(missing)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task PublicEvents_WhenWindowFiltersUpcomingAndPast()
    {
        await EnablePublicEventsAsync();
        await SeedEventAsync("Future fair", startsAt: DateTime.UtcNow.AddDays(3));
        await SeedEventAsync("Past picnic", startsAt: DateTime.UtcNow.AddDays(-3));
        UseAnonymousTenantHeader();

        var upcoming = (await ReadJsonAsync(await Client.GetAsync("/api/v2/public/events")))
            .GetProperty("data");
        upcoming.GetArrayLength().Should().Be(1);
        upcoming[0].GetProperty("title").GetString().Should().Be("Future fair");

        var past = (await ReadJsonAsync(await Client.GetAsync("/api/v2/public/events?when=past")))
            .GetProperty("data");
        past.GetArrayLength().Should().Be(1);
        past[0].GetProperty("title").GetString().Should().Be("Past picnic");

        var all = (await ReadJsonAsync(await Client.GetAsync("/api/v2/public/events?when=all")))
            .GetProperty("data");
        all.GetArrayLength().Should().Be(2);
    }
}
