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
public sealed class LaravelReactMemberPremiumCompatibilityTests : IntegrationTestBase
{
    public LaravelReactMemberPremiumCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MemberPremiumTiers_ReturnsLaravelReactPublicTierEnvelope()
    {
        var now = DateTime.UtcNow;
        int publicPlanId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stalePlans = await db.SubscriptionPlans
                .Where(p => p.TenantId == TestData.Tenant1.Id
                    && (p.Name == "Public Member Premium Tier" || p.Name == "Hidden Member Premium Tier"))
                .ToListAsync();
            db.SubscriptionPlans.RemoveRange(stalePlans);

            var publicPlan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Public Member Premium Tier",
                Description = "Visible member premium tier for Laravel React pricing",
                Price = 7.25m,
                Currency = "EUR",
                Features = """["priority_support","premium_badge"]""",
                IsActive = true,
                IsPublic = true,
                CreatedAt = now.AddDays(-4),
                UpdatedAt = now.AddDays(-1)
            };
            var hiddenPlan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Hidden Member Premium Tier",
                Description = "Internal tier that must not appear publicly",
                Price = 99m,
                Currency = "EUR",
                Features = """["internal_only"]""",
                IsActive = false,
                IsPublic = false,
                CreatedAt = now.AddDays(-4),
                UpdatedAt = now.AddDays(-1)
            };
            db.SubscriptionPlans.AddRange(publicPlan, hiddenPlan);
            await db.SaveChangesAsync();
            publicPlanId = publicPlan.Id;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v2/member-premium/tiers");
        request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var tiers = json.GetProperty("data").GetProperty("tiers").EnumerateArray().ToList();
        var tier = tiers.Single(t => t.GetProperty("id").GetInt32() == publicPlanId);
        tier.GetProperty("slug").GetString().Should().Be("public-member-premium-tier");
        tier.GetProperty("name").GetString().Should().Be("Public Member Premium Tier");
        tier.GetProperty("description").GetString().Should().Be("Visible member premium tier for Laravel React pricing");
        tier.GetProperty("monthly_price_cents").GetInt32().Should().Be(725);
        tier.GetProperty("yearly_price_cents").GetInt32().Should().Be(8700);
        tier.GetProperty("features").EnumerateArray().Select(v => v.GetString()).Should().Equal("priority_support", "premium_badge");
        tier.GetProperty("sort_order").ValueKind.Should().Be(JsonValueKind.Number);
        tier.GetProperty("is_active").GetBoolean().Should().BeTrue();
        tier.TryGetProperty("stripe_price_id_monthly", out _).Should().BeFalse();
        tiers.Should().NotContain(t => t.GetProperty("name").GetString() == "Hidden Member Premium Tier");
    }

    [Fact]
    public async Task MemberPremiumMe_ReturnsLaravelReactSubscriptionEnvelope()
    {
        var now = DateTime.UtcNow;
        int planId;
        int subscriptionId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var existing = await db.UserSubscriptions
                .Where(s => s.TenantId == TestData.Tenant1.Id && s.UserId == TestData.MemberUser.Id)
                .ToListAsync();
            db.UserSubscriptions.RemoveRange(existing);

            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Community Patron",
                Description = "Member premium Laravel React test plan",
                Price = 12.50m,
                Currency = "EUR",
                Features = """["priority_support","premium_badge"]""",
                IsActive = true,
                IsPublic = true,
                CreatedAt = now.AddDays(-30),
                UpdatedAt = now.AddDays(-2)
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;

            var subscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = now.AddDays(-10),
                NextBillingDate = now.AddDays(20),
                StripeSubscriptionId = "sub_member_premium_me_contract",
                CreatedAt = now.AddDays(-10),
                UpdatedAt = now.AddDays(-1)
            };
            db.UserSubscriptions.Add(subscription);
            await db.SaveChangesAsync();
            subscriptionId = subscription.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/member-premium/me");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.TryGetProperty("user_id", out _).Should().BeFalse();

        var subscriptionJson = data.GetProperty("subscription");
        subscriptionJson.GetProperty("id").GetInt32().Should().Be(subscriptionId);
        subscriptionJson.GetProperty("tier_id").GetInt32().Should().Be(planId);
        subscriptionJson.GetProperty("tier_name").GetString().Should().Be("Community Patron");
        subscriptionJson.GetProperty("tier_slug").GetString().Should().Be("community-patron");
        subscriptionJson.GetProperty("status").GetString().Should().Be("active");
        subscriptionJson.GetProperty("billing_interval").GetString().Should().Be("monthly");
        subscriptionJson.GetProperty("current_period_start").ValueKind.Should().NotBe(JsonValueKind.Null);
        subscriptionJson.GetProperty("current_period_end").ValueKind.Should().NotBe(JsonValueKind.Null);
        subscriptionJson.GetProperty("canceled_at").ValueKind.Should().Be(JsonValueKind.Null);
        subscriptionJson.GetProperty("grace_period_ends_at").ValueKind.Should().Be(JsonValueKind.Null);
        subscriptionJson.GetProperty("is_active").GetBoolean().Should().BeTrue();

        var entitledTier = data.GetProperty("entitled_tier");
        entitledTier.GetProperty("tier_id").GetInt32().Should().Be(planId);
        entitledTier.GetProperty("tier_name").GetString().Should().Be("Community Patron");
        entitledTier.GetProperty("features").EnumerateArray().Select(v => v.GetString()).Should().Equal("priority_support", "premium_badge");
        data.GetProperty("unlocked_features").EnumerateArray().Select(v => v.GetString()).Should().Equal("priority_support", "premium_badge");
    }

    [Fact]
    public async Task MemberPremiumCheckoutAndPortal_ReturnLaravelReactRedirectEnvelopes()
    {
        await AuthenticateAsMemberAsync();

        var checkout = await Client.PostAsJsonAsync("/api/v2/member-premium/checkout", new
        {
            tier_id = 7,
            interval = "monthly",
            return_url = "https://app.example.test/test-tenant/premium/return"
        });

        checkout.StatusCode.Should().Be(HttpStatusCode.OK);
        var checkoutJson = await checkout.Content.ReadFromJsonAsync<JsonElement>();
        checkoutJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var checkoutData = checkoutJson.GetProperty("data");
        checkoutData.GetProperty("checkout_url").GetString().Should().Contain("/premium/return?session_id=");
        checkoutData.GetProperty("session_id").GetString().Should().StartWith("cs_member_local_");
        checkoutData.TryGetProperty("tier", out _).Should().BeFalse();

        var portal = await Client.PostAsJsonAsync("/api/v2/member-premium/billing-portal", new
        {
            return_url = "https://app.example.test/test-tenant/premium/manage"
        });

        portal.StatusCode.Should().Be(HttpStatusCode.OK);
        var portalJson = await portal.Content.ReadFromJsonAsync<JsonElement>();
        portalJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var portalData = portalJson.GetProperty("data");
        portalData.GetProperty("portal_url").GetString().Should().Contain("/premium/manage?portal_session=");
        portalData.TryGetProperty("url", out _).Should().BeFalse();
    }

    [Fact]
    public async Task MemberPremiumCancel_ReturnsLaravelReactCancelledEnvelopeAndMarksSubscription()
    {
        var now = DateTime.UtcNow;
        int subscriptionId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var existing = await db.UserSubscriptions
                .Where(s => s.TenantId == TestData.Tenant1.Id && s.UserId == TestData.MemberUser.Id)
                .ToListAsync();
            db.UserSubscriptions.RemoveRange(existing);

            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Cancel Contract Tier",
                Description = "Member premium cancel contract plan",
                Price = 9m,
                Currency = "EUR",
                Features = "[]",
                IsActive = true,
                IsPublic = true,
                CreatedAt = now.AddDays(-20),
                UpdatedAt = now.AddDays(-1)
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();

            var subscription = new UserSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                PlanId = plan.Id,
                Status = SubscriptionStatus.Active,
                StartedAt = now.AddDays(-5),
                NextBillingDate = now.AddDays(25),
                StripeSubscriptionId = "sub_member_premium_cancel_contract",
                CreatedAt = now.AddDays(-5),
                UpdatedAt = now.AddDays(-1)
            };
            db.UserSubscriptions.Add(subscription);
            await db.SaveChangesAsync();
            subscriptionId = subscription.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/member-premium/cancel", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = json.GetProperty("data");
        data.GetProperty("cancelled").GetBoolean().Should().BeTrue();
        data.TryGetProperty("status", out _).Should().BeFalse();

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await verifyDb.UserSubscriptions.SingleAsync(s => s.Id == subscriptionId);
        refreshed.Status.Should().Be(SubscriptionStatus.Cancelled);
        refreshed.CancelledAt.Should().NotBeNull();
    }
}
