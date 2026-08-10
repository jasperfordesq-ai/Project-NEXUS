// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Tests for AdminBillingController.ListCheckoutSessions —
 *   GET /api/admin/billing/checkout-sessions
 *
 *   Covers:
 *     - Auth gates (anonymous → 401, member → 403, admin → 200).
 *     - Empty list when no donations exist.
 *     - Seeded donations are returned, ordered by UpdatedAt desc.
 *     - status query-param filter.
 *     - is_stuck flag set for Pending rows older than 30 minutes.
 */

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminBillingCheckoutSessionsTests : IntegrationTestBase
{
    public AdminBillingCheckoutSessionsTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/billing/checkout-sessions";

    [Fact]
    public async Task Anonymous_Returns401()
    {
        ClearAuthToken();
        var resp = await Client.GetAsync(Path);
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Member_Returns403()
    {
        var token = await GetAccessTokenAsync("member@test.com", "test-tenant");
        SetAuthToken(token);
        var resp = await Client.GetAsync(Path);
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Admin_EmptyTenant_ReturnsEmptyList()
    {
        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        SetAuthToken(token);
        var resp = await Client.GetAsync(Path);
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("data").GetArrayLength().Should().Be(0);
        body.GetProperty("total").GetInt32().Should().Be(0);
        body.GetProperty("page").GetInt32().Should().Be(1);
        body.GetProperty("page_size").GetInt32().Should().Be(50);
    }

    [Fact]
    public async Task Admin_WithSeededDonations_ReturnsThemOrderedDesc()
    {
        var tenantId = TestData.Tenant1.Id;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 1000,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_test_old",
                Status = MoneyDonationStatus.Succeeded,
                DonorEmail = "donor.old@test.com",
                CreatedAt = DateTime.UtcNow.AddDays(-2),
                UpdatedAt = DateTime.UtcNow.AddDays(-2)
            });
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 2500,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_test_recent",
                StripePaymentIntentId = "pi_test_recent",
                Status = MoneyDonationStatus.Succeeded,
                DonorEmail = "donor.recent@test.com",
                CreatedAt = DateTime.UtcNow.AddHours(-1),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-5)
            });
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        SetAuthToken(token);
        var resp = await Client.GetAsync(Path);
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var data = body.GetProperty("data");
        data.GetArrayLength().Should().BeGreaterThanOrEqualTo(2);

        // First row (sorted desc by UpdatedAt) must be the recent one.
        data[0].GetProperty("stripe_checkout_session_id").GetString().Should().Be("cs_test_recent");
        data[0].GetProperty("stripe_payment_intent_id").GetString().Should().Be("pi_test_recent");
        data[0].GetProperty("amount_minor_units").GetInt64().Should().Be(2500);
        data[0].GetProperty("currency").GetString().Should().Be("EUR");
        data[0].GetProperty("status").GetString().Should().Be("Succeeded");
        data[0].GetProperty("is_stuck").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Admin_StatusFilter_LimitsResults()
    {
        var tenantId = TestData.Tenant1.Id;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 500,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_filter_failed",
                Status = MoneyDonationStatus.Failed,
                FailureReason = "card_declined",
                CreatedAt = DateTime.UtcNow.AddMinutes(-10),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-10)
            });
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 750,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_filter_succ",
                Status = MoneyDonationStatus.Succeeded,
                CreatedAt = DateTime.UtcNow.AddMinutes(-20),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-20)
            });
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        SetAuthToken(token);
        var resp = await Client.GetAsync(Path + "?status=Failed");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var data = body.GetProperty("data");

        foreach (var row in data.EnumerateArray())
        {
            row.GetProperty("status").GetString().Should().Be("Failed");
        }
        // At least our seeded Failed row must be present.
        data.EnumerateArray()
            .Any(r => r.GetProperty("stripe_checkout_session_id").GetString() == "cs_filter_failed")
            .Should().BeTrue();
    }

    [Fact]
    public async Task Admin_StuckPending_FlaggedTrue()
    {
        var tenantId = TestData.Tenant1.Id;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 1200,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_stuck_old",
                Status = MoneyDonationStatus.Pending,
                CreatedAt = DateTime.UtcNow.AddHours(-2),
                UpdatedAt = DateTime.UtcNow.AddHours(-2)
            });
            db.MoneyDonations.Add(new MoneyDonation
            {
                TenantId = tenantId,
                AmountMinorUnits = 1300,
                Currency = "EUR",
                StripeCheckoutSessionId = "cs_fresh_pending",
                Status = MoneyDonationStatus.Pending,
                CreatedAt = DateTime.UtcNow.AddMinutes(-1),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-1)
            });
            await db.SaveChangesAsync();
        }

        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        SetAuthToken(token);
        var resp = await Client.GetAsync(Path + "?status=Pending");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var data = body.GetProperty("data");

        var stuck = data.EnumerateArray()
            .FirstOrDefault(r => r.GetProperty("stripe_checkout_session_id").GetString() == "cs_stuck_old");
        stuck.ValueKind.Should().NotBe(JsonValueKind.Undefined);
        stuck.GetProperty("is_stuck").GetBoolean().Should().BeTrue();

        var fresh = data.EnumerateArray()
            .FirstOrDefault(r => r.GetProperty("stripe_checkout_session_id").GetString() == "cs_fresh_pending");
        fresh.ValueKind.Should().NotBe(JsonValueKind.Undefined);
        fresh.GetProperty("is_stuck").GetBoolean().Should().BeFalse();
    }
}
