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
public sealed class LaravelReactUtilityCompatibilityTests : IntegrationTestBase
{
    public LaravelReactUtilityCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SsoAndOauthRoutes_ReturnLaravelReactPublicShapes()
    {
        await SeedEnabledSsoProviderAsync();

        var providersJson = await ReadJsonAsync(await Client.GetAsync($"/api/v2/auth/sso/providers?tenant_id={TestData.Tenant1.Id}"), HttpStatusCode.OK);
        providersJson.GetProperty("success").GetBoolean().Should().BeTrue();
        providersJson.GetProperty("providers").EnumerateArray().Should().Contain(p =>
            p.GetProperty("provider_key").GetString() == "azure-entra" &&
            p.GetProperty("display_name").GetString() == "Azure Entra");

        // The canonical flow now requires the browser-held PKCE binding before
        // any discovery or upstream redirect is attempted.
        var redirectJson = await ReadJsonAsync(
            await Client.GetAsync($"/api/v2/auth/sso/azure-entra/redirect?tenant_id={TestData.Tenant1.Id}"),
            HttpStatusCode.BadRequest);
        redirectJson.GetProperty("success").GetBoolean().Should().BeFalse();
        redirectJson.GetProperty("error").GetString().Should().Be("sso_redirect_failed");

        var exchangeJson = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/auth/oauth/exchange", new { code = "bad-code" }), HttpStatusCode.BadRequest);
        exchangeJson.GetProperty("success").GetBoolean().Should().BeFalse();
        exchangeJson.GetProperty("error").GetString().Should().Be("invalid_oauth_code");
    }

    [Fact]
    public async Task LocationExchangeAndGivenReviewsRoutes_ReturnLaravelReactShapes()
    {
        await SeedGivenReviewAsync();
        await AuthenticateAsMemberAsync();

        var places = await ReadDataAsync(await Client.GetAsync("/api/v2/geo/os-places/search?q=York"));
        places.GetProperty("enabled").GetBoolean().Should().BeFalse();
        places.GetProperty("results").ValueKind.Should().Be(JsonValueKind.Array);

        var attention = await ReadDataAsync(await Client.GetAsync("/api/v2/exchanges/needs-attention-count"));
        attention.GetProperty("count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        attention.GetProperty("items").ValueKind.Should().Be(JsonValueKind.Array);

        var reviews = await ReadJsonAsync(await Client.GetAsync("/api/v2/reviews/given?per_page=10"), HttpStatusCode.OK);
        reviews.GetProperty("success").GetBoolean().Should().BeTrue();
        reviews.GetProperty("data").EnumerateArray().Should().Contain(r =>
            r.GetProperty("reviewer_id").GetInt32() == TestData.MemberUser.Id &&
            r.GetProperty("rating").GetInt32() == 5);
        reviews.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task GoalMatchAndMessageActionRoutes_ReturnLaravelReactShapes()
    {
        var goalId = await SeedMemberGoalAsync();
        await AuthenticateAsMemberAsync();

        var insights = await ReadDataAsync(await Client.GetAsync($"/api/v2/goals/{goalId}/insights"));
        insights.GetProperty("goal_id").GetInt32().Should().Be(goalId);
        insights.GetProperty("progress_percent").GetDecimal().Should().BeGreaterThan(0);
        insights.GetProperty("milestones").ValueKind.Should().Be(JsonValueKind.Array);

        var nudgeResponse = await Client.PostAsJsonAsync($"/api/v2/goals/{goalId}/buddy/nudge", new { type = "nudge" });
        var nudgeJson = await ReadJsonAsync(nudgeResponse, HttpStatusCode.Created);
        nudgeJson.GetProperty("success").GetBoolean().Should().BeTrue();
        nudgeJson.GetProperty("data").GetProperty("type").GetString().Should().Be("nudge");

        var dismiss = await ReadDataAsync(await Client.PostAsJsonAsync($"/api/v2/matches/listing/{TestData.Listing1.Id}/dismiss", new { reason = "not_relevant" }));
        dismiss.GetProperty("dismissed").GetBoolean().Should().BeTrue();
        dismiss.GetProperty("source_type").GetString().Should().Be("listing");
        dismiss.GetProperty("source_id").GetInt32().Should().Be(TestData.Listing1.Id);

        var coordinator = await ReadJsonAsync(
            await Client.PostAsJsonAsync($"/api/v2/messages/{TestData.AdminUser.Id}/request-coordinator", new { }),
            HttpStatusCode.UnprocessableEntity);
        coordinator.GetProperty("success").GetBoolean().Should().BeFalse();
        coordinator.GetProperty("errors").EnumerateArray().Single()
            .GetProperty("code").GetString().Should().Be("SAFEGUARDING_NOT_RESTRICTED");
    }

    [Fact]
    public async Task PublicUtilityRoutes_ReturnLaravelReactShapes()
    {
        var health = await ReadJsonAsync(await Client.GetAsync("/api/health"), HttpStatusCode.OK);
        health.GetProperty("status").GetString().Should().Be("ok");

        var changelog = await ReadDataAsync(await Client.GetAsync("/api/v2/public-changelog"));
        changelog.GetProperty("items").ValueKind.Should().Be(JsonValueKind.Array);

        var page = await ReadDataAsync(await Client.GetAsync("/api/v2/public-page-content/about"));
        page.GetProperty("page_key").GetString().Should().Be("about");
        page.GetProperty("title").GetString().Should().NotBeNullOrWhiteSpace();

        var staticRoute = await ReadDataAsync(await Client.GetAsync("/api/v2/public-static-route-content/contact"));
        staticRoute.GetProperty("page_key").GetString().Should().Be("contact");
        staticRoute.GetProperty("content").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task NotificationUnsubscribeRoutes_ReturnLaravelReactShapes()
    {
        var invalidPage = await Client.GetAsync("/api/v2/notifications/unsubscribe?token=bad");
        invalidPage.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await invalidPage.Content.ReadAsStringAsync()).Should().Contain("Unsubscribe link invalid");
        invalidPage.Content.Headers.ContentType?.MediaType.Should().Be("text/html");

        var invalidPost = await ReadJsonAsync(await Client.PostAsJsonAsync("/api/v2/notifications/unsubscribe", new { token = "bad" }), HttpStatusCode.BadRequest);
        invalidPost.GetProperty("success").GetBoolean().Should().BeFalse();
        invalidPost.GetProperty("error").GetString().Should().Be("INVALID_TOKEN");
    }

    [Fact]
    public async Task AuthenticatedAiChatUtilityRoutes_ReturnLaravelReactShapes()
    {
        await AuthenticateAsMemberAsync();

        var starters = await ReadDataAsync(await Client.GetAsync("/api/v2/ai/chat/starters"));
        starters.GetProperty("starters").EnumerateArray().Should().HaveCountGreaterThan(0);

        var missingTrace = await ReadJsonAsync(
            await Client.PostAsJsonAsync("/api/v2/ai/chat/feedback", new { feedback = "up" }),
            HttpStatusCode.UnprocessableEntity);
        missingTrace.GetProperty("success").GetBoolean().Should().BeFalse();
        missingTrace.GetProperty("error").GetString().Should().Be("VALIDATION");
    }

    [Fact]
    public async Task AdminVolunteeringDonationRoutes_ReturnLaravelReactShapes()
    {
        var donationId = await SeedPendingMoneyDonationAsync();
        await AuthenticateAsAdminAsync();

        var list = await ReadDataAsync(await Client.GetAsync("/api/v2/admin/volunteering/donations"));
        list.GetProperty("items").EnumerateArray().Should().Contain(d =>
            d.GetProperty("id").GetInt32() == donationId &&
            d.GetProperty("status").GetString() == "pending");

        var complete = await ReadDataAsync(await Client.PostAsJsonAsync($"/api/v2/admin/volunteering/donations/{donationId}/complete", new { }));
        complete.GetProperty("id").GetInt32().Should().Be(donationId);
        complete.GetProperty("status").GetString().Should().Be("completed");
        complete.GetProperty("already_completed").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task PostmarkWebhookRoute_ReturnsLaravelReactShape()
    {
        var response = await Client.PostAsJsonAsync("/api/v2/webhooks/postmark", new
        {
            RecordType = "Delivery",
            Email = "member@example.test",
            MessageID = "pm-test-1",
            Metadata = new { tenant_id = TestData.Tenant1.Id }
        });

        var json = await ReadJsonAsync(response, HttpStatusCode.OK);
        json.GetProperty("received").GetInt32().Should().Be(1);
        json.GetProperty("processed").GetInt32().Should().Be(1);
    }

    private async Task SeedEnabledSsoProviderAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantSsoProviders.Add(new TenantSsoProvider
        {
            TenantId = TestData.Tenant1.Id,
            ProviderKey = "azure-entra",
            DisplayName = "Azure Entra",
            Preset = "azure-entra",
            IssuerUrl = "https://login.microsoftonline.com/common/v2.0",
            ClientId = "client-id",
            Scopes = "openid profile email",
            IsEnabled = true
        });
        await db.SaveChangesAsync();
    }

    private async Task SeedGivenReviewAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.Reviews.Add(new Review
        {
            TenantId = TestData.Tenant1.Id,
            ReviewerId = TestData.MemberUser.Id,
            TargetUserId = TestData.AdminUser.Id,
            Rating = 5,
            Comment = "Great exchange",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task<int> SeedMemberGoalAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var goal = new Goal
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Title = "Help neighbours",
            Description = "Complete community help",
            GoalType = "count",
            TargetValue = 10,
            CurrentValue = 4,
            Status = "active",
            CreatedAt = DateTime.UtcNow.AddDays(-5)
        };
        goal.Milestones.Add(new GoalMilestone
        {
            TenantId = TestData.Tenant1.Id,
            Title = "First four",
            IsCompleted = true,
            CompletedAt = DateTime.UtcNow.AddDays(-1),
            SortOrder = 1,
            CreatedAt = DateTime.UtcNow.AddDays(-3)
        });
        db.Goals.Add(goal);
        await db.SaveChangesAsync();
        return goal.Id;
    }

    private async Task<int> SeedPendingMoneyDonationAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var donation = new MoneyDonation
        {
            TenantId = TestData.Tenant1.Id,
            DonorUserId = TestData.MemberUser.Id,
            DonorDisplayName = "Volunteer donor",
            DonorEmail = "volunteer-donor@example.test",
            AmountMinorUnits = 1800,
            Currency = "GBP",
            Status = MoneyDonationStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };
        db.MoneyDonations.Add(donation);
        await db.SaveChangesAsync();
        return donation.Id;
    }

    private static async Task<JsonElement> ReadDataAsync(HttpResponseMessage response)
    {
        var json = await ReadJsonAsync(response, HttpStatusCode.OK);
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        return json.GetProperty("data");
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, HttpStatusCode expectedStatus)
    {
        response.StatusCode.Should().Be(expectedStatus);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
