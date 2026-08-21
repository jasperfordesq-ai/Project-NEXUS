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
/// Regression tests for `GET /api/v2/volunteering/opportunities`.
///
/// 🔴 WHY THIS EXISTS. The browser smoke's module tier found `/volunteering`
/// rendering an error state against this backend while every API call returned
/// 200. The console carried
/// `TypeError: Cannot read properties of undefined (reading 'id')` from
/// `OpportunityCard` (`VolunteeringPage.tsx:1176-1215`), which dereferences
/// `opportunity.organization.id`, `.name` and `.logo_url` with no null branch.
/// The payload had no `organization` key at all, and named the dates
/// `starts_at`/`ends_at` where the card reads `start_date`/`end_date` — the exact
/// rename class that previously broke the dashboard. It also ignored `per_page`
/// (returning 20 rows for a request of 2), `cursor`, `is_remote` and the
/// proximity filter, so the page's Remote and Near-me tabs silently returned
/// everything.
///
/// The expectations below are Laravel's, read live from the disposable
/// environment (`VolunteerController::opportunities` +
/// `VolunteerService::getOpportunities`):
/// * the item carries `organization` / `creator` objects, `start_date`/`end_date`,
///   `skills_needed`, `credits_offered`, `is_active`, `is_remote`, `has_applied`;
/// * `per_page` is the page size (1-50) and `limit` is NOT read by Laravel;
/// * `meta.cursor` appears only while another page exists;
/// * a browse row ALWAYS has an approved/active organisation
///   (`VolunteerService::PUBLIC_ORGANIZATION_STATUSES`), which is what lets the
///   card dereference it unconditionally;
/// * `category` is null when unset — not an object with empty fields.
///
/// One recorded difference, deliberately not faked: Laravel's `category` object
/// carries `color`, and this backend's `categories` table has no colour column.
/// The React page never reads it (`grep category.color` → no hits).
/// </summary>
[Collection("Integration")]
public sealed class VolunteeringOpportunitiesContractTests : IntegrationTestBase
{
    public VolunteeringOpportunitiesContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const int ApprovedOrgId = 940101;
    private const int PendingOrgId = 940102;
    private const int OnsiteOpportunityId = 940201;
    private const int RemoteOpportunityId = 940202;
    private const int OrphanOpportunityId = 940203;
    private const int PendingOrgOpportunityId = 940204;

    private async Task SeedAsync()
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;

        if (!db.VolunteerOrganisations.Any(o => o.Id == ApprovedOrgId))
        {
            db.VolunteerOrganisations.AddRange(
                new VolunteerOrganisation
                {
                    Id = ApprovedOrgId,
                    TenantId = TestData.Tenant1.Id,
                    OwnerUserId = TestData.AdminUser.Id,
                    Name = "Contract probe: approved trust",
                    Slug = "contract-probe-approved-trust",
                    LogoUrl = "/probe/logo.png",
                    Status = "approved",
                    CreatedAt = now,
                },
                new VolunteerOrganisation
                {
                    Id = PendingOrgId,
                    TenantId = TestData.Tenant1.Id,
                    OwnerUserId = TestData.AdminUser.Id,
                    Name = "Contract probe: pending trust",
                    Slug = "contract-probe-pending-trust",
                    Status = "pending",
                    CreatedAt = now,
                });
            await db.SaveChangesAsync();
        }

        if (!db.VolunteerOpportunities.Any(o => o.Id == OnsiteOpportunityId))
        {
            db.VolunteerOpportunities.AddRange(
                new VolunteerOpportunity
                {
                    Id = OnsiteOpportunityId,
                    TenantId = TestData.Tenant1.Id,
                    OrganizerId = TestData.AdminUser.Id,
                    VolunteerOrganisationId = ApprovedOrgId,
                    Title = "Contract probe: on-site repair cafe",
                    Description = "Mend small appliances with visitors.",
                    Location = "Riverside Hall",
                    Status = OpportunityStatus.Published,
                    SkillsRequired = "Basic tools, patience",
                    CreditReward = 2m,
                    IsRemote = false,
                    Latitude = 53.3498,
                    Longitude = -6.2603,
                    StartsAt = now.AddDays(7),
                    EndsAt = now.AddDays(7).AddHours(4),
                    CreatedAt = now,
                },
                new VolunteerOpportunity
                {
                    Id = RemoteOpportunityId,
                    TenantId = TestData.Tenant1.Id,
                    OrganizerId = TestData.AdminUser.Id,
                    VolunteerOrganisationId = ApprovedOrgId,
                    Title = "Contract probe: remote phone befriending",
                    Status = OpportunityStatus.Published,
                    IsRemote = true,
                    CreatedAt = now,
                },
                // No organisation: Laravel's browse listing structurally cannot
                // return this row, and the React card cannot render it.
                new VolunteerOpportunity
                {
                    Id = OrphanOpportunityId,
                    TenantId = TestData.Tenant1.Id,
                    OrganizerId = TestData.AdminUser.Id,
                    Title = "Contract probe: unattached to any organisation",
                    Status = OpportunityStatus.Published,
                    CreatedAt = now,
                },
                // Organisation exists but is not yet approved — also invisible.
                new VolunteerOpportunity
                {
                    Id = PendingOrgOpportunityId,
                    TenantId = TestData.Tenant1.Id,
                    OrganizerId = TestData.AdminUser.Id,
                    VolunteerOrganisationId = PendingOrgId,
                    Title = "Contract probe: unapproved organisation",
                    Status = OpportunityStatus.Published,
                    CreatedAt = now,
                });
            await db.SaveChangesAsync();
        }
    }

    private async Task<JsonDocument> GetAsync(string queryString)
    {
        using var response = await Client.GetAsync($"/api/v2/volunteering/opportunities?{queryString}");
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"?{queryString} should be a valid browse request");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    private static List<int> Ids(JsonDocument document) =>
        document.RootElement.GetProperty("data").EnumerateArray()
            .Select(e => e.GetProperty("id").GetInt32())
            .ToList();

    private static JsonElement Row(JsonDocument document, int id) =>
        document.RootElement.GetProperty("data").EnumerateArray()
            .First(e => e.GetProperty("id").GetInt32() == id);

    [Fact]
    public async Task Every_browse_row_carries_the_organization_object_the_card_dereferences()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var document = await GetAsync("per_page=50");

        foreach (var row in document.RootElement.GetProperty("data").EnumerateArray())
        {
            row.TryGetProperty("organization", out var organization).Should().BeTrue(
                "OpportunityCard reads opportunity.organization.id with no null branch");
            organization.ValueKind.Should().Be(JsonValueKind.Object,
                "a null organisation is what crashed the volunteering page");
            organization.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
            organization.TryGetProperty("name", out _).Should().BeTrue();
            organization.TryGetProperty("logo_url", out _).Should().BeTrue();
        }

        var probe = Row(document, OnsiteOpportunityId);
        probe.GetProperty("organization").GetProperty("name").GetString()
            .Should().Be("Contract probe: approved trust");
        probe.GetProperty("organization").GetProperty("logo_url").GetString()
            .Should().Be("/probe/logo.png");
    }

    [Fact]
    public async Task An_opportunity_with_no_approved_organization_is_not_browsable()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var document = await GetAsync("per_page=50");
        var ids = Ids(document);

        ids.Should().Contain(OnsiteOpportunityId);
        ids.Should().NotContain(OrphanOpportunityId,
            "Laravel requires an organisation on the browse listing, so an unattached row is invisible");
        ids.Should().NotContain(PendingOrgOpportunityId,
            "only approved/active organisations are public (PUBLIC_ORGANIZATION_STATUSES)");
    }

    [Fact]
    public async Task The_item_uses_Laravels_field_names_not_the_entity_property_names()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var document = await GetAsync("per_page=50");
        var row = Row(document, OnsiteOpportunityId);

        // The renames that broke the page.
        row.TryGetProperty("start_date", out var startDate).Should().BeTrue();
        startDate.GetString().Should().NotBeNullOrWhiteSpace();
        row.TryGetProperty("end_date", out _).Should().BeTrue();
        row.TryGetProperty("starts_at", out _).Should().BeFalse("Laravel names this start_date");
        row.TryGetProperty("ends_at", out _).Should().BeFalse("Laravel names this end_date");

        row.GetProperty("skills_needed").GetString().Should().Be("Basic tools, patience");
        row.TryGetProperty("skills_required", out _).Should().BeFalse("Laravel names this skills_needed");

        row.GetProperty("credits_offered").GetDecimal().Should().Be(2m);
        row.TryGetProperty("credit_reward", out _).Should().BeFalse("Laravel names this credits_offered");

        // The rest of Laravel's browse item, so a future edit cannot quietly drop one.
        foreach (var key in new[]
                 {
                     "id", "tenant_id", "organization_id", "title", "description", "location",
                     "is_remote", "is_active", "created_at", "updated_at", "category_id",
                     "status", "created_by", "latitude", "longitude", "creator", "category",
                     "has_applied", "is_federated", "federated_visibility",
                     "external_partner_id", "external_id", "source_tenant_id",
                 })
        {
            row.TryGetProperty(key, out _).Should().BeTrue($"Laravel's browse item carries `{key}`");
        }

        row.GetProperty("status").GetString().Should().Be("open",
            "Laravel's public statuses are open|active; a published row reads as open");
        row.GetProperty("is_active").GetBoolean().Should().BeTrue();

        // Laravel strips the creator's internal id from this public listing.
        var creator = row.GetProperty("creator");
        creator.ValueKind.Should().Be(JsonValueKind.Object);
        creator.TryGetProperty("id", out _).Should().BeFalse(
            "the browse listing does not expose the creator's internal user id");
        creator.TryGetProperty("first_name", out _).Should().BeTrue();
        creator.TryGetProperty("avatar_url", out _).Should().BeTrue();
    }

    [Fact]
    public async Task An_unset_category_is_null_rather_than_an_object_with_empty_fields()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var document = await GetAsync("per_page=50");
        Row(document, RemoteOpportunityId).GetProperty("category").ValueKind
            .Should().Be(JsonValueKind.Null,
                "an absent Eloquent relation serialises as null; an empty object would render as a blank chip");
    }

    [Fact]
    public async Task Per_page_is_the_page_size_and_the_cursor_only_appears_while_more_rows_exist()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var firstPage = await GetAsync("per_page=1");
        firstPage.RootElement.GetProperty("data").GetArrayLength().Should().Be(1,
            "the React page sends per_page and nothing else; ignoring it returned 20 rows");
        var meta = firstPage.RootElement.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("has_more").GetBoolean().Should().BeTrue();
        meta.TryGetProperty("cursor", out var cursor).Should().BeTrue();

        // The cursor must actually advance — an always-first-page cursor is how an
        // infinite scroll re-serves page one for ever.
        using var secondPage = await GetAsync($"per_page=1&cursor={Uri.EscapeDataString(cursor.GetString()!)}");
        Ids(secondPage).Should().NotIntersectWith(Ids(firstPage));

        using var wholeList = await GetAsync("per_page=50");
        wholeList.RootElement.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
        wholeList.RootElement.GetProperty("meta").TryGetProperty("cursor", out _).Should().BeFalse(
            "Laravel omits the cursor on the last page");
    }

    [Fact]
    public async Task The_remote_filter_narrows_the_list_rather_than_being_ignored()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var remote = await GetAsync("is_remote=1&per_page=50");
        var remoteIds = Ids(remote);
        remoteIds.Should().Contain(RemoteOpportunityId);
        remoteIds.Should().NotContain(OnsiteOpportunityId,
            "the Remote tab silently returned every row before the filter existed");

        // Proof the assertion above can go red: without the filter both appear.
        using var unfiltered = await GetAsync("per_page=50");
        Ids(unfiltered).Should().Contain(RemoteOpportunityId).And.Contain(OnsiteOpportunityId);
    }

    [Fact]
    public async Task The_proximity_filter_excludes_rows_outside_the_radius_and_those_with_no_coordinates()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        // Dublin, 25km: the on-site probe sits on those exact coordinates.
        using var near = await GetAsync("near_lat=53.3498&near_lng=-6.2603&radius_km=25&per_page=50");
        var nearIds = Ids(near);
        nearIds.Should().Contain(OnsiteOpportunityId);
        nearIds.Should().NotContain(RemoteOpportunityId,
            "a row with no coordinates cannot satisfy a radius, so it is excluded rather than returned");
        Row(near, OnsiteOpportunityId).TryGetProperty("distance_km", out var distance).Should().BeTrue(
            "Laravel adds distance_km on a proximity query");
        distance.GetDouble().Should().BeLessThan(1);

        // Far away: the same row must drop out, which proves the radius is real.
        using var far = await GetAsync("near_lat=-33.8688&near_lng=151.2093&radius_km=25&per_page=50");
        Ids(far).Should().NotContain(OnsiteOpportunityId);
    }

    [Fact]
    public async Task Search_matches_the_organisation_name_as_well_as_the_title()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var byTitle = await GetAsync("search=repair%20cafe&per_page=50");
        Ids(byTitle).Should().Contain(OnsiteOpportunityId);

        using var byOrganisation = await GetAsync("search=approved%20trust&per_page=50");
        Ids(byOrganisation).Should().Contain(OnsiteOpportunityId,
            "Laravel's search reaches the organisation name, so searching a trust finds its opportunities");

        using var noMatch = await GetAsync("search=nothingmatchesthisstring&per_page=50");
        Ids(noMatch).Should().NotContain(OnsiteOpportunityId,
            "and the search must be able to exclude — otherwise it is not filtering at all");
    }

    [Fact]
    public async Task Has_applied_reflects_the_viewers_own_pending_application()
    {
        await AuthenticateAsMemberAsync();
        await SeedAsync();

        using var before = await GetAsync("per_page=50");
        Row(before, OnsiteOpportunityId).GetProperty("has_applied").GetBoolean().Should().BeFalse();

        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            if (!db.VolunteerApplications.Any(a => a.OpportunityId == OnsiteOpportunityId && a.UserId == TestData.MemberUser.Id))
            {
                db.VolunteerApplications.Add(new VolunteerApplication
                {
                    TenantId = TestData.Tenant1.Id,
                    OpportunityId = OnsiteOpportunityId,
                    UserId = TestData.MemberUser.Id,
                    Status = ApplicationStatus.Pending,
                    CreatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync();
            }
        }

        using var after = await GetAsync("per_page=50");
        Row(after, OnsiteOpportunityId).GetProperty("has_applied").GetBoolean().Should().BeTrue(
            "a pending application counts, exactly as Laravel counts pending|approved");
        Row(after, RemoteOpportunityId).GetProperty("has_applied").GetBoolean().Should().BeFalse(
            "and it is per row, not a blanket flag");
    }
}
