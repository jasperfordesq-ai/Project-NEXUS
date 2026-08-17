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
/// A member's volunteering donations (R-27).
///
/// 🔴 Three ends, no two connected: the member POST wrote an opaque blob into
/// tenant config, the member's list returned a hardcoded empty array, and the
/// ADMIN donations screen read <c>money_donations</c>. So a member recorded a
/// donation, was told it worked, never saw it again, and staff never saw it at
/// all.
///
/// The most important assertion here is that a recorded donation is
/// <b>pending</b>. Nothing in this path takes a payment, and marking money as
/// received when it has not been is the money-shaped version of the fake-success
/// problem.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerDonationsTests : IntegrationTestBase
{
    public VolunteerDonationsTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// The member's own donations, as a list.
    ///
    /// 🔴 Laravel wraps these in <c>data.items</c> with <c>next_cursor</c> beside
    /// them — verified live: <c>{"data":{"items":[…],"next_cursor":null}}</c> — not
    /// a bare list under <c>data</c>. This backend returned the bare list until
    /// 2026-08-17, so a client looping over <c>data</c> got nothing from the
    /// production backend.
    ///
    /// The envelope is asserted here, once, so the five behavioural tests below
    /// can keep reading a plain list and stay about donations rather than JSON.
    /// </summary>
    private async Task<JsonElement> MineAsync()
    {
        var response = await Client.GetAsync("/api/v2/volunteering/donations");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Object, "Laravel wraps these in data.items, not a bare list");
        data.TryGetProperty("next_cursor", out _).Should().BeTrue("Laravel sends next_cursor beside items here");

        return data.GetProperty("items");
    }

    [Fact]
    public async Task ARecordedDonation_IsVisibleToTheMemberAndToStaff()
    {
        await AuthenticateAsMemberAsync();

        var post = await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new
        {
            amount = 12.50m,
            payment_method = "card",
            message = "For the garden project",
            is_anonymous = false,
        });
        post.StatusCode.Should().Be(HttpStatusCode.OK);
        var id = (await post.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        var mine = await MineAsync();
        var donation = mine.EnumerateArray().Single(d => d.GetProperty("id").GetInt32() == id);
        donation.GetProperty("amount").GetDecimal().Should().Be(12.50m,
            "the member's own list returned an empty array before");
        donation.GetProperty("payment_method").GetString().Should().Be("card");
        donation.GetProperty("message").GetString().Should().Be("For the garden project");

        // The end that was missing entirely: staff reading the same record.
        await AuthenticateAsAdminAsync();
        var adminList = await Client.GetAsync("/api/v2/admin/volunteering/donations");
        adminList.StatusCode.Should().Be(HttpStatusCode.OK);
        (await adminList.Content.ReadAsStringAsync()).Should().Contain("For the garden project",
            "the member POST wrote to a config blob while this screen read money_donations");
    }

    [Fact]
    public async Task ARecordedDonation_IsPendingUntilAPaymentActuallyHappens()
    {
        await AuthenticateAsMemberAsync();

        var post = await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new
        {
            amount = 5m,
            payment_method = "bank_transfer",
        });
        var id = (await post.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        var mine = await MineAsync();
        mine.EnumerateArray().Single(d => d.GetProperty("id").GetInt32() == id)
            .GetProperty("status").GetString().Should().Be("pending",
                "nothing in this path takes a payment; marking money as received "
                + "when it has not been is the money-shaped fake success");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<MoneyDonation>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(d => d.Id == id);
        stored.Status.Should().Be(MoneyDonationStatus.Pending);
        stored.CompletedAt.Should().BeNull();
        stored.StripePaymentIntentId.Should().BeNull("no provider was involved");
    }

    [Fact]
    public async Task TheAmountIsStoredExactly()
    {
        await AuthenticateAsMemberAsync();

        var post = await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new { amount = 10.05m });
        var id = (await post.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<MoneyDonation>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(d => d.Id == id);

        stored.AmountMinorUnits.Should().Be(1005,
            "a fraction of a cent stored loosely is a reconciliation problem later");

        var mine = await MineAsync();
        mine.EnumerateArray().Single(d => d.GetProperty("id").GetInt32() == id)
            .GetProperty("amount").GetDecimal().Should().Be(10.05m, "and it must read back the same");
    }

    [Fact]
    public async Task AnImpossibleAmount_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        foreach (var amount in new[] { 0m, -5m, 0.001m, 250_000m })
        {
            var response = await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new { amount });
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
                $"{amount} would land in a financial record that staff then have to reconcile");
        }

        (await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new { payment_method = "card" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest, "a donation with no amount is not a donation");
    }

    [Fact]
    public async Task OneMembersDonations_AreNotListedForAnother()
    {
        await AuthenticateAsMemberAsync();
        await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new
        {
            amount = 20m,
            message = "Only mine to see",
        });

        await AuthenticateAsOtherTenantUserAsync();
        var theirs = await MineAsync();

        theirs.EnumerateArray().Select(d => d.GetProperty("message").GetString())
            .Should().NotContain("Only mine to see");
    }

    [Fact]
    public async Task AnAnonymousDonation_RecordsThatChoice()
    {
        await AuthenticateAsMemberAsync();

        var post = await Client.PostAsJsonAsync("/api/v2/volunteering/donations", new
        {
            amount = 7m,
            is_anonymous = true,
        });
        var id = (await post.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        var mine = await MineAsync();
        var donation = mine.EnumerateArray().Single(d => d.GetProperty("id").GetInt32() == id);
        donation.GetProperty("is_anonymous").GetBoolean().Should().BeTrue(
            "the choice not to be named publicly has to survive the save");
    }
}
