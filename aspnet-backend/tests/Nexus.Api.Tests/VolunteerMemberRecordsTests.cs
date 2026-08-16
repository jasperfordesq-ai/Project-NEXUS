// Copyright © 2024–2026 Jasper Ford
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
/// Accessibility needs and organisation reviews (R-27).
///
/// 🔴 Neither had a table. Reviews returned a hardcoded empty array, so every
/// organisation looked unreviewed. Accessibility needs were worse than empty:
/// the save wrote the request body as an opaque blob into TENANT CONFIG and
/// nothing ever read it back, so a member recorded the support they need to
/// take part, was told it was saved, and it went somewhere no screen could
/// display.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerMemberRecordsTests : IntegrationTestBase
{
    public VolunteerMemberRecordsTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<JsonElement> GetNeedsAsync()
    {
        var response = await Client.GetAsync("/api/v2/volunteering/accessibility-needs");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }

    [Fact]
    public async Task SavedAccessibilityNeeds_ComeBackWhenTheMemberReturns()
    {
        await AuthenticateAsMemberAsync();

        var save = await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[]
            {
                new
                {
                    need_type = "mobility",
                    description = "Uses a wheelchair",
                    accommodations_required = "Step-free access and a nearby accessible toilet",
                    emergency_contact_name = "Pat Carer",
                    emergency_contact_phone = "+353 1 555 0100",
                },
            },
        });
        save.StatusCode.Should().Be(HttpStatusCode.OK);

        var needs = await GetNeedsAsync();
        var mobility = needs.EnumerateArray()
            .Single(n => n.GetProperty("need_type").GetString() == "mobility");

        mobility.GetProperty("accommodations_required").GetString()
            .Should().Be("Step-free access and a nearby accessible toilet",
                "the old save wrote to a store nothing could read, so it came back empty every time");
        mobility.GetProperty("emergency_contact_name").GetString().Should().Be("Pat Carer");
    }

    [Fact]
    public async Task RemovingANeed_ActuallyWithdrawsIt()
    {
        await AuthenticateAsMemberAsync();

        await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[]
            {
                new { need_type = "dietary", description = "Coeliac" },
                new { need_type = "hearing", description = "Hearing loop needed" },
            },
        });
        (await GetNeedsAsync()).GetArrayLength().Should().Be(2);

        // The screen edits the whole set, so saving without one removes it.
        await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[] { new { need_type = "dietary", description = "Coeliac" } },
        });

        var after = await GetNeedsAsync();
        after.EnumerateArray().Select(n => n.GetProperty("need_type").GetString())
            .Should().BeEquivalentTo(["dietary"],
                "a member must be able to withdraw a need, not only add one");
    }

    [Fact]
    public async Task AnUnknownOrRepeatedNeedType_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        var unknown = await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[] { new { need_type = "telepathy", description = "x" } },
        });
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var repeated = await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[]
            {
                new { need_type = "visual", description = "first" },
                new { need_type = "visual", description = "second" },
            },
        });
        repeated.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "one row per need type — otherwise the organiser reads contradictory copies of the same requirement");
    }

    [Fact]
    public async Task OneMembersNeeds_AreNotVisibleToAnother()
    {
        await AuthenticateAsMemberAsync();
        await Client.PutAsJsonAsync("/api/v2/volunteering/accessibility-needs", new
        {
            needs = new[] { new { need_type = "cognitive", description = "Private detail" } },
        });

        await AuthenticateAsAdminAsync();
        var theirs = await GetNeedsAsync();

        theirs.EnumerateArray().Select(n => n.GetProperty("description").GetString())
            .Should().NotContain("Private detail",
                "this is health-adjacent information about a named member");
    }

    [Fact]
    public async Task AReviewAppearsOnTheOrganisation_AndASecondOneReplacesTheFirst()
    {
        await AuthenticateAsMemberAsync();
        const int organisationId = 4242;

        (await Client.PostAsJsonAsync("/api/v2/volunteering/reviews", new
        {
            target_type = "organization",
            target_id = organisationId,
            rating = 5,
            comment = "Warmly welcomed",
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        var listed = await Client.GetAsync($"/api/v2/volunteering/reviews/organization/{organisationId}");
        var reviews = (await listed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reviews");
        reviews.GetArrayLength().Should().Be(1, "the list was a hardcoded empty array before");
        reviews[0].GetProperty("rating").GetInt32().Should().Be(5);
        reviews[0].GetProperty("comment").GetString().Should().Be("Warmly welcomed");

        // Reviewing again updates rather than stacking.
        await Client.PostAsJsonAsync("/api/v2/volunteering/reviews", new
        {
            target_type = "organization",
            target_id = organisationId,
            rating = 3,
            comment = "On reflection, mixed",
        });

        var second = await Client.GetAsync($"/api/v2/volunteering/reviews/organization/{organisationId}");
        var after = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reviews");
        after.GetArrayLength().Should().Be(1,
            "one reviewer able to post ten five-star reviews makes the average worthless");
        after[0].GetProperty("rating").GetInt32().Should().Be(3);
    }

    [Fact]
    public async Task AnImpossibleRating_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        foreach (var rating in new[] { 0, 6, -1, 99 })
        {
            var response = await Client.PostAsJsonAsync("/api/v2/volunteering/reviews", new
            {
                target_type = "organization",
                target_id = 99,
                rating,
            });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
                $"a rating of {rating} makes every average that includes it meaningless");
        }
    }

    [Fact]
    public async Task ReviewingYourself_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/volunteering/reviews", new
        {
            target_type = "user",
            target_id = TestData.MemberUser.Id,
            rating = 5,
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    /// <summary>
    /// The rating bound is also a database check constraint, because the API is
    /// not the only thing that will ever write to this table.
    /// </summary>
    [Fact]
    public async Task TheDatabaseItselfRefusesAnImpossibleRating()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        db.Set<VolunteerReview>().Add(new VolunteerReview
        {
            TenantId = TestData.Tenant1.Id,
            ReviewerId = TestData.MemberUser.Id,
            TargetType = VolunteerReview.TargetTypes.Organization,
            TargetId = 7777,
            Rating = 9,
            CreatedAt = DateTime.UtcNow,
        });

        var write = async () => await db.SaveChangesAsync();
        await write.Should().ThrowAsync<DbUpdateException>(
            "chk_vol_review_rating must hold regardless of which code path writes");
    }
}
