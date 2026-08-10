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

[Collection("Integration")]
public sealed class MarketplaceDisputeSettlementParityTests : IntegrationTestBase
{
    public MarketplaceDisputeSettlementParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task FreeBuyerResolution_RestoresInventoryAndNotifiesParticipantsOnce()
    {
        var (listingId, orderId) = await SeedOrderAsync("delivered", total: 0, credits: 0, quantity: 0);
        await AuthenticateAsMemberAsync();
        var opened = await Client.PostAsJsonAsync($"/api/v2/marketplace/orders/{orderId}/dispute", new { reason = "not_as_described", description = "The delivered item materially differs from the listing.", evidence_urls = new[] { "https://evidence.example.test/dispute" } });
        opened.StatusCode.Should().Be(HttpStatusCode.Created);
        var disputeId = (await opened.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt64();

        await AuthenticateAsAdminAsync();
        var queue = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/marketplace/disputes?page=1&per_page=1");
        var page = queue.GetProperty("data");
        page.GetProperty("total").GetInt32().Should().Be(1);
        var item = page.GetProperty("items")[0];
        item.GetProperty("opened_by").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        item.GetProperty("order").GetProperty("buyer").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        item.GetProperty("evidence_urls")[0].GetString().Should().StartWith("https://");

        var resolved = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/disputes/{disputeId}/resolve", new { resolution = "buyer", resolution_notes = "The free item was unavailable as described." });
        resolved.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.MarketplaceOrders.IgnoreQueryFilters().SingleAsync(x => x.Id == orderId)).Status.Should().Be("refunded");
            var listing = await db.MarketplaceListings.IgnoreQueryFilters().SingleAsync(x => x.Id == listingId);
            listing.Quantity.Should().Be(1); listing.Status.Should().Be("active"); listing.MarketplaceStatus.Should().Be("available");
            var dispute = await db.MarketplaceDisputes.IgnoreQueryFilters().SingleAsync(x => x.Id == disputeId);
            dispute.Status.Should().Be("resolved_buyer"); dispute.RefundAmount.Should().Be(0);
            (await db.Notifications.IgnoreQueryFilters().CountAsync(x => x.Type == "marketplace_dispute_resolved")).Should().Be(2);
        }
        (await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/disputes/{disputeId}/resolve", new { resolution = "buyer", resolution_notes = "Replay" })).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task TimeCreditAndSellerResolutions_PreserveConservationAndPriorState()
    {
        int listingId; int orderId; int originalId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listing = Listing(0); db.MarketplaceListings.Add(listing);
            var original = new Transaction { TenantId = TestData.Tenant1.Id, SenderId = TestData.MemberUser.Id, ReceiverId = TestData.AdminUser.Id, Amount = 10m, TransactionType = "marketplace_purchase", Status = TransactionStatus.Completed };
            db.Transactions.Add(original); await db.SaveChangesAsync();
            var order = Order(listing.Id, "shipped", 0, 10, 1); order.WalletTransactionId = original.Id; db.MarketplaceOrders.Add(order); await db.SaveChangesAsync();
            listingId = listing.Id; orderId = order.Id; originalId = original.Id;
        }
        await AuthenticateAsMemberAsync();
        var disputeId = await Open(orderId, "not_received");
        await AuthenticateAsAdminAsync();
        var resolved = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/disputes/{disputeId}/resolve", new { resolution = "buyer", resolution_notes = "The service was never provided.", refund_amount = 10m });
        resolved.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var order = await db.MarketplaceOrders.IgnoreQueryFilters().SingleAsync(x => x.Id == orderId);
            order.WalletRefundTransactionId.Should().NotBeNull(); order.Status.Should().Be("refunded");
            var reversal = await db.Transactions.IgnoreQueryFilters().SingleAsync(x => x.Id == order.WalletRefundTransactionId);
            (reversal.SenderId, reversal.ReceiverId, reversal.Amount, reversal.TransactionType).Should().Be((TestData.AdminUser.Id, TestData.MemberUser.Id, 10m, "marketplace_refund"));
            (await db.Transactions.IgnoreQueryFilters().CountAsync(x => x.Id == originalId || x.Id == order.WalletRefundTransactionId)).Should().Be(2);
            (await db.MarketplaceListings.IgnoreQueryFilters().SingleAsync(x => x.Id == listingId)).Quantity.Should().Be(1);
        }

        var (_, sellerOrderId) = await SeedOrderAsync("shipped", total: 0, credits: 0, quantity: 1);
        await AuthenticateAsMemberAsync(); var sellerDispute = await Open(sellerOrderId, "not_received");
        await AuthenticateAsAdminAsync();
        (await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/disputes/{sellerDispute}/resolve", new { resolution = "seller", resolution_notes = "Tracking confirms the shipment remains in progress." })).StatusCode.Should().Be(HttpStatusCode.OK);
        using var finalScope = Factory.Services.CreateScope();
        (await finalScope.ServiceProvider.GetRequiredService<NexusDbContext>().MarketplaceOrders.IgnoreQueryFilters().SingleAsync(x => x.Id == sellerOrderId)).Status.Should().Be("shipped");
    }

    [Fact]
    public async Task FiatResolution_FailsClosedWithoutMutatingDisputeOrOrder()
    {
        var (_, orderId) = await SeedOrderAsync("delivered", total: 25m, credits: 0, quantity: 0);
        await AuthenticateAsMemberAsync(); var disputeId = await Open(orderId, "damaged");
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/disputes/{disputeId}/resolve", new { resolution = "buyer", resolution_notes = "A provider refund would be required.", refund_amount = 25m });
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).Should().Contain("RESOLUTION_FAILED");
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.MarketplaceDisputes.IgnoreQueryFilters().SingleAsync(x => x.Id == disputeId)).Status.Should().Be("open");
        (await db.MarketplaceOrders.IgnoreQueryFilters().SingleAsync(x => x.Id == orderId)).Status.Should().Be("disputed");
        (await db.Transactions.IgnoreQueryFilters().CountAsync(x => x.TransactionType == "marketplace_refund")).Should().Be(0);
    }

    private async Task<long> Open(int orderId, string reason)
    {
        var response = await Client.PostAsJsonAsync($"/api/v2/marketplace/orders/{orderId}/dispute", new { reason, description = "The order requires administrator review." });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt64();
    }

    private async Task<(int ListingId, int OrderId)> SeedOrderAsync(string status, decimal total, decimal credits, int quantity)
    {
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = Listing(quantity); db.MarketplaceListings.Add(listing); await db.SaveChangesAsync();
        var order = Order(listing.Id, status, total, credits, 1); db.MarketplaceOrders.Add(order); await db.SaveChangesAsync();
        return (listing.Id, order.Id);
    }

    private MarketplaceListing Listing(int quantity) => new() { TenantId = TestData.Tenant1.Id, UserId = TestData.AdminUser.Id, Title = $"Dispute listing {Guid.NewGuid():N}", Description = "Dispute test", Quantity = quantity, Status = quantity > 0 ? "active" : "removed", MarketplaceStatus = quantity > 0 ? "available" : "sold", ModerationStatus = "approved" };
    private MarketplaceOrder Order(int listingId, string status, decimal total, decimal credits, int quantity) => new() { TenantId = TestData.Tenant1.Id, MarketplaceListingId = listingId, BuyerUserId = TestData.MemberUser.Id, SellerUserId = TestData.AdminUser.Id, Quantity = quantity, TotalAmount = total, TimeCreditTotal = credits, Currency = "EUR", Status = status };
}
