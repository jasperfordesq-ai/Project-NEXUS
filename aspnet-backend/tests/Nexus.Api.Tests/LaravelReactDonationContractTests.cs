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

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class LaravelReactDonationContractTests : IntegrationTestBase
{
    public LaravelReactDonationContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task PaymentIntentV2_MatchesLaravelReactCheckoutContract()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/donations/payment-intent", new
        {
            amount = 12.34m,
            currency = "gbp",
            fund_code = "community",
            giving_day_id = (int?)null,
            opportunity_id = (int?)null,
            message = "For local projects",
            is_anonymous = false,
            gift_aid_enabled = true,
            gift_aid = new
            {
                declaration_name = "Member User",
                address_line1 = "1 High Street",
                address_line2 = (string?)null,
                town = "Basel",
                postcode = "SW1A 1AA",
                country = "GB"
            }
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("client_secret").GetString().Should().NotBeNullOrWhiteSpace();
        var donationId = data.GetProperty("donation_id").GetInt32();
        donationId.Should().BeGreaterThan(0);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var donation = await db.MoneyDonations.SingleAsync(d => d.Id == donationId);
        donation.TenantId.Should().Be(TestData.Tenant1.Id);
        donation.DonorUserId.Should().Be(TestData.MemberUser.Id);
        donation.AmountMinorUnits.Should().Be(1234);
        donation.Currency.Should().Be("GBP");
        donation.Message.Should().Be("For local projects");
        donation.Status.Should().Be(MoneyDonationStatus.Pending);
    }

    [Fact]
    public async Task ReceiptV2_MatchesLaravelReactReceiptContract()
    {
        await AuthenticateAsMemberAsync();
        var completedAt = DateTime.UtcNow.AddDays(-1);
        int donationId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var donation = new MoneyDonation
            {
                TenantId = TestData.Tenant1.Id,
                DonorUserId = TestData.MemberUser.Id,
                DonorDisplayName = "Member User",
                DonorEmail = TestData.MemberUser.Email,
                AmountMinorUnits = 2500,
                Currency = "EUR",
                Message = "Receipt note",
                Status = MoneyDonationStatus.Succeeded,
                StripePaymentIntentId = "pi_test_receipt",
                CompletedAt = completedAt,
                CreatedAt = completedAt,
                UpdatedAt = completedAt
            };
            db.MoneyDonations.Add(donation);
            await db.SaveChangesAsync();
            donationId = donation.Id;
        }

        var response = await Client.GetAsync($"/api/v2/donations/{donationId}/receipt");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/json");
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().Be(donationId);
        data.GetProperty("donor_name").GetString().Should().Be("Member User");
        data.GetProperty("amount").GetDecimal().Should().Be(25.00m);
        data.GetProperty("currency").GetString().Should().Be("EUR");
        data.GetProperty("community_name").GetString().Should().Be("Test Tenant");
        data.GetProperty("message").GetString().Should().Be("Receipt note");
        data.GetProperty("status").GetString().Should().Be("completed");
        data.GetProperty("payment_method").GetString().Should().Be("stripe");
        data.GetProperty("reference").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("date").GetString().Should().NotBeNullOrWhiteSpace();
    }
}
