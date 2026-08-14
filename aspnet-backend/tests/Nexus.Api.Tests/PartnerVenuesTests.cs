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
/// Pins the Laravel partner-venues contract (routes/api.php 3665-3686,
/// PartnerVenueController / AdminPartnerVenueController): feature gate body,
/// 64-hex member pass with in-place rotation, the recordVisit rule ladder
/// (invalid pass 404, forbidden 403, needs_venue, database-enforced one visit
/// per member/venue/day, self-scan block), and the admin CRUD, staff roster,
/// summary, and CSV export shapes.
/// </summary>
[Collection("Integration")]
public class PartnerVenuesTests : IntegrationTestBase
{
    public PartnerVenuesTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task EnableFeatureAsync(int? tenantId = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId ?? TestData.Tenant1.Id,
            Key = "features.partner_venues",
            Value = "true",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task<int> SeedVenueAsync(string name = "The Corner Cafe",
        string status = "active", int? tenantId = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var venue = new PartnerVenue
        {
            TenantId = tenantId ?? TestData.Tenant1.Id,
            Name = name,
            Slug = PartnerVenueService_SlugFor(name),
            Status = status,
            CreatedAt = DateTime.UtcNow
        };
        db.PartnerVenues.Add(venue);
        await db.SaveChangesAsync();
        return venue.Id;
    }

    private static string PartnerVenueService_SlugFor(string name) =>
        Nexus.Api.Services.PartnerVenueService.Slugify(name) + "-" + Guid.NewGuid().ToString("N")[..6];

    private async Task SeedStaffAsync(int venueId, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.PartnerVenueStaff.Add(new PartnerVenueStaffMember
        {
            TenantId = TestData.Tenant1.Id,
            VenueId = venueId,
            UserId = userId,
            Role = "member",
            Status = "active",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    /// <summary>A second ordinary tenant-1 member who can log in.</summary>
    private async Task<(int Id, string Email)> CreateExtraMemberAsync()
    {
        var email = $"venue-staff-{Guid.NewGuid():N}@test.com";
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Venue",
            LastName = "Staffer",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (user.Id, email);
    }

    private async Task<string> MemberPassTokenAsync()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/partner-venues/pass");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await ReadJsonAsync(response)).GetProperty("data").GetProperty("token").GetString()!;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(body);
    }

    // ─── Feature gate ───────────────────────────────────────────────

    [Fact]
    public async Task FeatureDisabled_Returns403WithTheMiddlewareBody()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/partner-venues");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var json = await ReadJsonAsync(response);
        json.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
        json.GetProperty("success").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Directory_ShowsOnlyActiveVenues()
    {
        await EnableFeatureAsync();
        await SeedVenueAsync("Active Cafe");
        await SeedVenueAsync("Paused Shop", status: "paused");
        await SeedVenueAsync("Archived Hall", status: "archived");
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/partner-venues");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var venues = (await ReadJsonAsync(response)).GetProperty("data").GetProperty("venues");
        venues.GetArrayLength().Should().Be(1);
        venues[0].GetProperty("name").GetString().Should().Be("Active Cafe");
        venues[0].TryGetProperty("status", out _).Should().BeFalse(
            "the public venue shape deliberately omits status");
    }

    // ─── Member pass ────────────────────────────────────────────────

    [Fact]
    public async Task Pass_IsCreatedOnceAndReused()
    {
        await EnableFeatureAsync();
        await AuthenticateAsMemberAsync();

        var first = await ReadJsonAsync(await Client.GetAsync("/api/v2/partner-venues/pass"));
        var second = await ReadJsonAsync(await Client.GetAsync("/api/v2/partner-venues/pass"));

        var token = first.GetProperty("data").GetProperty("token").GetString()!;
        token.Length.Should().Be(64);
        token.Should().MatchRegex("^[0-9a-f]{64}$");
        second.GetProperty("data").GetProperty("token").GetString().Should().Be(token,
            "the pass is one row per member, reused across calls");
        first.GetProperty("data").GetProperty("qr_url").GetString()
            .Should().Contain($"/venues/checkin/{token}");
        first.GetProperty("data").GetProperty("status").GetString().Should().Be("active");
    }

    [Fact]
    public async Task RotatePass_InvalidatesThePreviousToken()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync();
        var oldToken = await MemberPassTokenAsync();

        var rotate = await Client.PostAsJsonAsync("/api/v2/partner-venues/pass/rotate", new { });
        rotate.StatusCode.Should().Be(HttpStatusCode.OK);
        var newToken = (await ReadJsonAsync(rotate)).GetProperty("data").GetProperty("token").GetString()!;
        newToken.Should().NotBe(oldToken);

        await AuthenticateAsAdminAsync();
        var oldScan = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{oldToken}", new { venue_id = venueId });
        oldScan.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "a rotated-away token must stop resolving immediately");
        (await ReadJsonAsync(oldScan)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("NOT_FOUND");

        var newScan = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{newToken}", new { venue_id = venueId });
        newScan.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(newScan)).GetProperty("data").GetProperty("status")
            .GetString().Should().Be("recorded");
    }

    // ─── Recording visits ───────────────────────────────────────────

    [Fact]
    public async Task RecordVisit_RecordsThenDeduplicatesSameDay_AndAwardsXpOnce()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync();
        var token = await MemberPassTokenAsync();

        await AuthenticateAsAdminAsync();
        var first = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueId });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstData = (await ReadJsonAsync(first)).GetProperty("data");
        firstData.GetProperty("status").GetString().Should().Be("recorded");
        firstData.GetProperty("member").GetProperty("name").GetString().Should().NotBeNullOrEmpty();
        firstData.GetProperty("venue").GetProperty("id").GetInt32().Should().Be(venueId);
        firstData.GetProperty("visits_this_month").GetInt32().Should().Be(1);
        firstData.GetProperty("xp_awarded").GetInt32().Should().Be(10);

        var second = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueId });
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondData = (await ReadJsonAsync(second)).GetProperty("data");
        secondData.GetProperty("status").GetString().Should().Be("already_recorded_today");
        secondData.GetProperty("xp_awarded").GetInt32().Should().Be(0,
            "a same-day rescan must not award XP again");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.PartnerVenueVisits.IgnoreQueryFilters()
            .CountAsync(v => v.VenueId == venueId)).Should().Be(1,
            "the daily unique key must keep the ledger at one row");
    }

    [Fact]
    public async Task RecordVisit_NonStaffMemberIsForbidden()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync();
        var (_, staffEmail) = await CreateExtraMemberAsync();
        var token = await MemberPassTokenAsync();

        SetAuthToken(await GetAccessTokenAsync(staffEmail, "test-tenant"));
        var response = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueId });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("FORBIDDEN");
    }

    [Fact]
    public async Task RecordVisit_StaffCanRecord_ButNeverTheirOwnPass()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync();
        var (staffId, staffEmail) = await CreateExtraMemberAsync();
        await SeedStaffAsync(venueId, staffId);
        var memberToken = await MemberPassTokenAsync();

        SetAuthToken(await GetAccessTokenAsync(staffEmail, "test-tenant"));

        // Staff can fetch their own pass, then must be refused scanning it.
        var ownPass = await Client.GetAsync("/api/v2/partner-venues/pass");
        var ownToken = (await ReadJsonAsync(ownPass)).GetProperty("data").GetProperty("token").GetString();
        var selfScan = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{ownToken}", new { venue_id = venueId });
        selfScan.StatusCode.Should().Be(HttpStatusCode.Forbidden,
            "a self-recorded visit would make the ledger self-attested");

        var memberScan = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{memberToken}", new { });
        memberScan.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(memberScan)).GetProperty("data").GetProperty("status")
            .GetString().Should().Be("recorded",
            "staff of exactly one venue need not name it");
    }

    [Fact]
    public async Task RecordVisit_PausedVenueIsForbidden()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync(status: "paused");
        var token = await MemberPassTokenAsync();

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueId });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task RecordVisit_SeveralEligibleVenues_NeedsAChoice()
    {
        await EnableFeatureAsync();
        var venueA = await SeedVenueAsync("Alpha Hall");
        await SeedVenueAsync("Beta Rooms");
        var token = await MemberPassTokenAsync();

        await AuthenticateAsAdminAsync();
        var undecided = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { });
        undecided.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(undecided)).GetProperty("data");
        data.GetProperty("status").GetString().Should().Be("needs_venue");
        data.GetProperty("venues").GetArrayLength().Should().Be(2);

        var chosen = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueA });
        (await ReadJsonAsync(chosen)).GetProperty("data").GetProperty("status")
            .GetString().Should().Be("recorded");
    }

    [Fact]
    public async Task RecordVisit_UnknownToken_Is404()
    {
        await EnableFeatureAsync();
        await SeedVenueAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{new string('0', 64)}", new { });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("NOT_FOUND");
    }

    // ─── Admin ──────────────────────────────────────────────────────

    [Fact]
    public async Task AdminEndpoints_RejectAPlainMember()
    {
        await EnableFeatureAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/admin/partner-venues");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var json = await ReadJsonAsync(response);
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        json.GetProperty("code").GetString().Should().Be("AUTH_INSUFFICIENT_PERMISSIONS");
    }

    [Fact]
    public async Task AdminCreate_ValidatesThenPersists201()
    {
        await EnableFeatureAsync();
        await AuthenticateAsAdminAsync();

        var invalid = await Client.PostAsJsonAsync("/api/v2/admin/partner-venues",
            new { name = "Bad Category", category = "nightclub" });
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(invalid)).GetProperty("errors").TryGetProperty("category", out _)
            .Should().BeTrue();

        var valid = await Client.PostAsJsonAsync("/api/v2/admin/partner-venues",
            new { name = "The Makers Space", category = "community", website = "https://example.org" });
        valid.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await ReadJsonAsync(valid)).GetProperty("data");
        data.GetProperty("name").GetString().Should().Be("The Makers Space");
        data.GetProperty("slug").GetString().Should().Be("the-makers-space");
        data.TryGetProperty("status", out _).Should().BeFalse(
            "store returns the bare thirteen-key public shape");
    }

    [Fact]
    public async Task AdminUpdateAndArchive_RoundTrip_AndCrossTenantIs404()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync("Round Trip");
        var foreignVenueId = await SeedVenueAsync("Foreign", tenantId: TestData.Tenant2.Id);
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync(
            $"/api/v2/admin/partner-venues/{venueId}", new { status = "paused" });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var archive = await Client.PostAsJsonAsync(
            $"/api/v2/admin/partner-venues/{venueId}/archive", new { });
        archive.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(archive)).GetProperty("data").GetProperty("message")
            .GetString().Should().Be("Partner venue archived");

        var archivedList = await Client.GetAsync("/api/v2/admin/partner-venues?status=archived");
        var archivedVenues = (await ReadJsonAsync(archivedList)).GetProperty("data").GetProperty("venues");
        archivedVenues.EnumerateArray().Select(v => v.GetProperty("id").GetInt32())
            .Should().Contain(venueId);

        var crossTenant = await Client.PutAsJsonAsync(
            $"/api/v2/admin/partner-venues/{foreignVenueId}", new { name = "Hijack" });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "cross-tenant venues are invisible — 404, never 403");
    }

    [Fact]
    public async Task AdminStaffLifecycle_UnknownUser404_AddThenRemove()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync();
        var (staffId, _) = await CreateExtraMemberAsync();
        await AuthenticateAsAdminAsync();

        var unknown = await Client.PostAsJsonAsync(
            $"/api/v2/admin/partner-venues/{venueId}/staff", new { user_id = 999999999 });
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var unknownError = (await ReadJsonAsync(unknown)).GetProperty("errors")[0];
        unknownError.GetProperty("field").GetString().Should().Be("user_id");

        var add = await Client.PostAsJsonAsync(
            $"/api/v2/admin/partner-venues/{venueId}/staff", new { user_id = staffId, role = "admin" });
        add.StatusCode.Should().Be(HttpStatusCode.OK);
        var roster = (await ReadJsonAsync(add)).GetProperty("data").GetProperty("staff");
        roster.EnumerateArray().Select(s => s.GetProperty("user_id").GetInt32())
            .Should().Contain(staffId);

        var remove = await Client.DeleteAsync(
            $"/api/v2/admin/partner-venues/{venueId}/staff/{staffId}");
        remove.StatusCode.Should().Be(HttpStatusCode.OK);
        var afterRemove = (await ReadJsonAsync(remove)).GetProperty("data").GetProperty("staff");
        afterRemove.EnumerateArray().Select(s => s.GetProperty("user_id").GetInt32())
            .Should().NotContain(staffId);
    }

    [Fact]
    public async Task AdminSummaryAndCsv_ReflectARecordedVisit()
    {
        await EnableFeatureAsync();
        var venueId = await SeedVenueAsync("Summary Venue");
        var token = await MemberPassTokenAsync();
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync(
            $"/api/v2/partner-venues/visits/verify/{token}", new { venue_id = venueId }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var summary = await Client.GetAsync("/api/v2/admin/partner-venues/reports/summary");
        summary.StatusCode.Should().Be(HttpStatusCode.OK);
        var summaryData = (await ReadJsonAsync(summary)).GetProperty("data");
        summaryData.GetProperty("window_days").GetInt32().Should().Be(30);
        summaryData.GetProperty("total_visits").GetInt32().Should().Be(1);
        var venueRow = summaryData.GetProperty("venues")[0];
        venueRow.GetProperty("venue_name").GetString().Should().Be("Summary Venue");
        venueRow.GetProperty("unique_members").GetInt32().Should().Be(1);
        venueRow.GetProperty("recent_visits").GetInt32().Should().Be(1);

        var csv = await Client.GetAsync("/api/v2/admin/partner-venues/visits/export.csv");
        csv.StatusCode.Should().Be(HttpStatusCode.OK);
        csv.Content.Headers.ContentType!.MediaType.Should().Be("text/csv");
        var body = await csv.Content.ReadAsStringAsync();
        body.Should().StartWith("Date,Time,Venue,Member ID,Member,Recorded by,Source");
        body.Should().Contain("Summary Venue");
        body.Should().Contain("member_pass");

        var filtered = await Client.GetAsync(
            "/api/v2/admin/partner-venues/visits/export.csv?from=2020-01-01&to=2020-01-02");
        (await filtered.Content.ReadAsStringAsync()).Should().NotContain("Summary Venue",
            "date filters must exclude visits outside the window");
    }
}
