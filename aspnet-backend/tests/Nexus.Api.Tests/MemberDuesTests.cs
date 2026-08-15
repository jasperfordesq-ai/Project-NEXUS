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
/// Membership dues (R-1 stub removal).
///
/// 🔴 The pay endpoint was the most dangerous stub in this backend: it returned
/// 200 {"status":"paid"} without taking a payment, creating a payment intent, or
/// touching a row. A member would believe their membership was settled when
/// nothing had happened.
///
/// Laravel's payDues creates a Stripe PaymentIntent and returns client_secret /
/// payment_intent_id / public_key — it never marks the due paid; a webhook does
/// that when the money actually moves. So the correct behaviour with no payment
/// provider wired is an honest refusal, never a claim of payment.
/// </summary>
[Collection("Integration")]
public sealed class MemberDuesTests : IntegrationTestBase
{
    public MemberDuesTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Dues reference a real vol_organizations row (FK on tenant_id +
    /// organization_id), so the organisation has to exist first.
    /// </summary>
    private async Task<int> EnsureOrganisationAsync(NexusDbContext db)
    {
        var existing = await db.Set<VolunteerOrganisation>().IgnoreQueryFilters()
            .Where(o => o.TenantId == TestData.Tenant1.Id)
            .Select(o => o.Id)
            .FirstOrDefaultAsync();
        if (existing != 0) return existing;

        var org = new VolunteerOrganisation
        {
            TenantId = TestData.Tenant1.Id,
            Name = "Dues Test Association",
            Slug = $"dues-test-{Guid.NewGuid():N}"[..24],
            OwnerUserId = TestData.AdminUser.Id,
            Status = "active",
        };
        db.Set<VolunteerOrganisation>().Add(org);
        await db.SaveChangesAsync();
        return org.Id;
    }

    private async Task<long> SeedDueAsync(int userId, string status = "pending")
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisationId = await EnsureOrganisationAsync(db);

        var due = new VereinMemberDue
        {
            TenantId = TestData.Tenant1.Id,
            OrganizationId = organisationId,
            UserId = userId,
            MembershipYear = 2026,
            AmountCents = 5000,
            Currency = "CHF",
            Status = status,
            DueDate = new DateOnly(2026, 12, 31),
        };
        db.Set<VereinMemberDue>().Add(due);
        await db.SaveChangesAsync();
        return due.Id;
    }

    private async Task<string?> StatusOfAsync(long dueId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<VereinMemberDue>().IgnoreQueryFilters().AsNoTracking()
            .Where(d => d.Id == dueId).Select(d => d.Status).SingleOrDefaultAsync();
    }

    [Fact]
    public async Task MyDues_ReturnsTheMembersRealDues_NotAnEmptyArray()
    {
        await AuthenticateAsMemberAsync();
        var dueId = await SeedDueAsync(TestData.MemberUser.Id);

        var response = await Client.GetAsync("/api/v2/me/verein-dues");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt64()).ToList();
        ids.Should().Contain(dueId, "the stub returned an empty array for everyone");
    }

    [Fact]
    public async Task ADueBelongingToSomeoneElse_IsNotReadableById()
    {
        var otherDueId = await SeedDueAsync(TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync($"/api/v2/me/verein-dues/{otherDueId}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "the stub echoed back any id with a fabricated status");
    }

    /// <summary>The heart of it: never tell a member they have paid.</summary>
    [Fact]
    public async Task Pay_DoesNotReportPaid_AndDoesNotChangeTheDue()
    {
        await AuthenticateAsMemberAsync();
        var dueId = await SeedDueAsync(TestData.MemberUser.Id);

        var response = await Client.PostAsJsonAsync($"/api/v2/me/verein-dues/{dueId}/pay", new { });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "with no payment provider wired the only honest answer is a refusal");
        var raw = await response.Content.ReadAsStringAsync();
        raw.Should().Contain("VEREIN_DUES_ERROR");
        raw.Should().NotContain("\"paid\"", "the stub reported status paid without taking any money");

        (await StatusOfAsync(dueId)).Should().Be("pending",
            "and nothing about the due may change");
    }

    [Fact]
    public async Task Pay_ForAnotherMembersDue_IsRefused()
    {
        var otherDueId = await SeedDueAsync(TestData.AdminUser.Id);
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync($"/api/v2/me/verein-dues/{otherDueId}/pay", new { });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await StatusOfAsync(otherDueId)).Should().Be("pending");
    }
}
