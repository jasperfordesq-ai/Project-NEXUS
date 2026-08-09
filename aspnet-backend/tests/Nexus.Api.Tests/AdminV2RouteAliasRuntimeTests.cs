// Copyright 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminV2RouteAliasRuntimeTests : IntegrationTestBase
{
    public AdminV2RouteAliasRuntimeTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task BillingPlansPublicV2_ReturnsLaravelReactPlanShapeFromSubscriptionPlans()
    {
        var uniqueName = "Laravel React Billing Plan " + Guid.NewGuid().ToString("N");
        int planId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var plan = new SubscriptionPlan
            {
                TenantId = TestData.Tenant1.Id,
                Name = uniqueName,
                Description = "Public pricing plan for Laravel React billing contract",
                Price = 19.99m,
                Currency = "EUR",
                Features = """{"analytics":true,"legacy_disabled":false,"api_access":true}""",
                IsActive = true,
                IsPublic = true
            };
            db.SubscriptionPlans.Add(plan);
            await db.SaveChangesAsync();
            planId = plan.Id;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v2/billing/plans");
        request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Array);

        var planJson = data.EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == planId);
        planJson.GetProperty("name").GetString().Should().Be(uniqueName);
        planJson.GetProperty("slug").GetString().Should().Be(uniqueName.ToLowerInvariant().Replace(' ', '-'));
        planJson.GetProperty("description").GetString().Should().Be("Public pricing plan for Laravel React billing contract");
        planJson.GetProperty("tier_level").GetInt32().Should().BeGreaterThan(0);
        planJson.GetProperty("price_monthly").GetDecimal().Should().Be(19.99m);
        planJson.GetProperty("price_yearly").GetDecimal().Should().Be(239.88m);
        planJson.GetProperty("is_active").GetBoolean().Should().BeTrue();
        planJson.GetProperty("features").EnumerateArray()
            .Select(item => item.GetString())
            .Should().BeEquivalentTo(new[] { "analytics", "api_access" });
    }

    [Fact]
    public async Task LaravelReactLinkPreviewV2_GetAndPost_ReturnSuccessDataEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var getResponse = await Client.GetAsync("/api/v2/link-preview?url=https%3A%2F%2Fexample.com%2Fwelcome");
        var postResponse = await Client.PostAsJsonAsync("/api/v2/link-preview", new { url = "https://example.com/welcome" });

        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        postResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        using var getJson = JsonDocument.Parse(await getResponse.Content.ReadAsStringAsync());
        using var postJson = JsonDocument.Parse(await postResponse.Content.ReadAsStringAsync());

        foreach (var json in new[] { getJson.RootElement, postJson.RootElement })
        {
            json.GetProperty("success").GetBoolean().Should().BeTrue();
            var data = json.GetProperty("data");
            data.GetProperty("url").GetString().Should().Be("https://example.com/welcome");
            data.GetProperty("title").GetString().Should().NotBeNullOrWhiteSpace();
            data.GetProperty("description").GetString().Should().NotBeNull();
            data.GetProperty("site_name").GetString().Should().Be("example.com");
            data.TryGetProperty("image", out _).Should().BeTrue();
        }
    }

    [Fact]
    public async Task LaravelReactLinkPreviewV2_PostRejectsNonHttpUrlWithLaravelErrorEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/link-preview", new { url = "ftp://example.com/file.txt" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.GetProperty("success").GetBoolean().Should().BeFalse();
        json.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
    }

    [Fact]
    public async Task LaravelReactReactionsV2ReadAlias_ReturnsReactionSummaryForExistingPost()
    {
        await AuthenticateAsMemberAsync();
        int postId;
        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var post = new FeedPost
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                Content = "Runtime smoke post for Laravel React reaction summary",
                CreatedAt = DateTime.UtcNow
            };
            db.FeedPosts.Add(post);
            await db.SaveChangesAsync();
            postId = post.Id;
            db.ContentReactions.Add(new ContentReaction
            {
                TenantId = TestData.Tenant1.Id,
                TargetType = "post",
                TargetId = postId,
                UserId = TestData.MemberUser.Id,
                ReactionType = "celebrate",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var response = await Client.GetAsync($"/api/v2/reactions/post/{postId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var data = json.RootElement.GetProperty("data");
        data.GetProperty("counts").GetProperty("celebrate").GetInt32().Should().Be(1);
        data.GetProperty("user_reaction").GetString().Should().Be("celebrate");
        data.GetProperty("total").GetInt32().Should().Be(1);
    }

    [Theory]
    [InlineData("/api/v2/admin/categories")]
    [InlineData("/api/v2/admin/attributes")]
    [InlineData("/api/v2/admin/gamification/campaigns")]
    [InlineData("/api/v2/admin/blog")]
    [InlineData("/api/v2/admin/broker/dashboard")]
    [InlineData("/api/v2/admin/broker/risk-tags")]
    [InlineData("/api/v2/admin/broker/messages/unreviewed-count")]
    public async Task LaravelReactAdminV2ReadAliases_AsAdmin_ReturnOk(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("/api/v2/admin/caring-community/regional-points/config")]
    [InlineData("/api/v2/admin/caring-community/municipal-roi")]
    [InlineData("/api/v2/admin/caring-community/pilot-scoreboard")]
    [InlineData("/api/v2/admin/caring-community/sub-regions")]
    [InlineData("/api/v2/admin/caring-community/providers")]
    public async Task LaravelReactAdminCaringCommunityV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/users/me/activity/dashboard")]
    [InlineData("/api/v2/users/me/availability")]
    [InlineData("/api/v2/users/me/preferences")]
    [InlineData("/api/v2/users/me/sessions")]
    [InlineData("/api/v2/users/me/skills")]
    [InlineData("/api/v2/users/me/insurance")]
    [InlineData("/api/v2/users/me/sub-accounts")]
    public async Task LaravelReactUsersMeV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/groups")]
    [InlineData("/api/v2/groups/recommendations")]
    [InlineData("/api/v2/groups/1/discussions")]
    [InlineData("/api/v2/groups/1/files")]
    [InlineData("/api/v2/groups/1/chatrooms")]
    [InlineData("/api/v2/groups/1/tasks")]
    [InlineData("/api/v2/groups/1/wiki")]
    public async Task LaravelReactGroupsV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/jobs")]
    [InlineData("/api/v2/jobs/saved")]
    [InlineData("/api/v2/jobs/my-applications")]
    [InlineData("/api/v2/jobs/my-interviews")]
    [InlineData("/api/v2/jobs/my-offers")]
    [InlineData("/api/v2/jobs/recommended")]
    [InlineData("/api/v2/jobs/saved-profile")]
    [InlineData("/api/v2/jobs/templates")]
    [InlineData("/api/v2/jobs/alerts")]
    public async Task LaravelReactJobsV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/federation/status")]
    [InlineData("/api/v2/federation/settings")]
    [InlineData("/api/v2/federation/activity")]
    [InlineData("/api/v2/federation/members")]
    [InlineData("/api/v2/federation/messages")]
    [InlineData("/api/v2/federation/connections")]
    [InlineData("/api/v2/federation/groups")]
    public async Task LaravelReactFederationV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/goals")]
    [InlineData("/api/v2/goals/discover")]
    [InlineData("/api/v2/goals/mentoring")]
    [InlineData("/api/v2/goals/templates")]
    [InlineData("/api/v2/goals/templates/categories")]
    public async Task LaravelReactGoalsV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ideation-challenges")]
    [InlineData("/api/v2/ideation-ideas")]
    public async Task LaravelReactIdeationV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/caring-community/providers")]
    [InlineData("/api/v2/caring-community/sub-regions")]
    [InlineData("/api/v2/caring-community/hour-gifts/inbox")]
    [InlineData("/api/v2/caring-community/hour-transfer/my-history")]
    [InlineData("/api/v2/caring-community/federation-directory")]
    public async Task LaravelReactCaringCommunityV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/volunteering/opportunities")]
    [InlineData("/api/v2/volunteering/organisations")]
    [InlineData("/api/v2/volunteering/my-organisations")]
    [InlineData("/api/v2/volunteering/hours/summary")]
    [InlineData("/api/v2/volunteering/guardian-consents")]
    [InlineData("/api/v2/volunteering/wellbeing")]
    public async Task LaravelReactVolunteeringV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/stories")]
    [InlineData("/api/v2/stories/archive")]
    [InlineData("/api/v2/exchanges")]
    [InlineData("/api/v2/exchanges/config")]
    [InlineData("/api/v2/group-exchanges")]
    public async Task LaravelReactStoriesAndExchangesV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/messages/unread-count")]
    [InlineData("/api/v2/messages/restriction-status")]
    [InlineData("/api/v2/messages/reactions/batch")]
    [InlineData("/api/v2/polls")]
    [InlineData("/api/v2/polls/categories")]
    [InlineData("/api/v2/members/nearby")]
    [InlineData("/api/v2/members/top-endorsed")]
    [InlineData("/api/v2/members/availability/available")]
    [InlineData("/api/v2/members/availability/compatible")]
    public async Task LaravelReactMessagesPollsMembersV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/auth/oauth/enabled-providers")]
    [InlineData("/api/v2/auth/oauth/google/redirect")]
    public async Task LaravelReactOAuthV2AnonymousReadAliases_AreRouted(string path)
    {
        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/auth/oauth/me/identities")]
    public async Task LaravelReactOAuthV2MemberReadAliases_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/kb")]
    [InlineData("/api/v2/kb/search?q=care")]
    [InlineData("/api/v2/kb/slug/getting-started")]
    public async Task LaravelReactKnowledgeBaseV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/me/collections")]
    [InlineData("/api/v2/me/saved-items/check")]
    [InlineData("/api/v2/resources/categories")]
    [InlineData("/api/v2/resources/categories/tree")]
    [InlineData("/api/v2/search/saved")]
    [InlineData("/api/v2/skills/categories")]
    public async Task LaravelReactMemberResourceUtilityV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/auth/2fa/status")]
    public async Task LaravelReactTwoFactorV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/admin/reports")]
    [InlineData("/api/v2/admin/reports/stats")]
    [InlineData("/api/v2/admin/crm/tasks")]
    [InlineData("/api/v2/admin/pages")]
    [InlineData("/api/v2/admin/feed/posts")]
    [InlineData("/api/v2/admin/feed/stats")]
    [InlineData("/api/v2/admin/federation/api-keys")]
    [InlineData("/api/v2/admin/federation/partners")]
    public async Task LaravelReactAdminUtilityV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/me/push-campaigns")]
    [InlineData("/api/v2/me/ad-campaigns")]
    [InlineData("/api/v2/ideation-campaigns")]
    [InlineData("/api/v2/ideation-templates")]
    public async Task LaravelReactAdvertisingAndIdeationV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/admin/sso/providers")]
    [InlineData("/api/v2/admin/gamification/stats")]
    [InlineData("/api/v2/admin/gamification/badges")]
    public async Task LaravelReactAdminSsoAndGamificationV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/comments/1/reactions")]
    [InlineData("/api/v2/resources")]
    public async Task LaravelReactCommunityResourceTaskV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/admin/identity/audit-log")]
    [InlineData("/api/v2/admin/identity/provider-health")]
    [InlineData("/api/v2/admin/identity/sessions")]
    [InlineData("/api/v2/admin/enterprise/dashboard")]
    [InlineData("/api/v2/admin/enterprise/config")]
    [InlineData("/api/v2/admin/moderation/queue")]
    [InlineData("/api/v2/admin/moderation/stats")]
    [InlineData("/api/v2/admin/tools/redirects")]
    [InlineData("/api/v2/admin/tools/404-errors")]
    [InlineData("/api/v2/admin/polls")]
    [InlineData("/api/v2/admin/resources")]
    [InlineData("/api/v2/admin/goals")]
    [InlineData("/api/v2/admin/ideation")]
    public async Task LaravelReactAdminOperationsV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/connections")]
    [InlineData("/api/v2/connections/pending")]
    [InlineData("/api/v2/connections/suggestions")]
    [InlineData("/api/v2/connections/status/me")]
    [InlineData("/api/v2/bookmarks")]
    [InlineData("/api/v2/bookmarks/status")]
    [InlineData("/api/v2/gamification/daily-reward")]
    [InlineData("/api/v2/gamification/seasons")]
    [InlineData("/api/v2/me/verein-dues")]
    public async Task LaravelReactSocialGamificationVereinV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ads/impression")]
    [InlineData("/api/v2/bookmarks")]
    [InlineData("/api/v2/connections/request")]
    [InlineData("/api/v2/gamification/daily-reward")]
    public async Task LaravelReactSocialGamificationV2PostAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/admin/events")]
    [InlineData("/api/v2/admin/members/inactive")]
    public async Task LaravelReactAdminEventsMembersV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ideation-categories")]
    [InlineData("/api/v2/ideation-tags")]
    [InlineData("/api/v2/ideation-tags/popular")]
    [InlineData("/api/v2/bookmark-collections")]
    [InlineData("/api/v2/link-preview?url=https%3A%2F%2Fexample.com")]
    [InlineData("/api/v2/reactions/listing/1")]
    [InlineData("/api/v2/reviews/pending")]
    [InlineData("/api/v2/reviews/user/1")]
    [InlineData("/api/v2/me/fadp/consent-history")]
    [InlineData("/api/v2/me/residency-verification")]
    [InlineData("/api/v2/me/verein-invitations")]
    public async Task LaravelReactMemberUtilityV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/newsletter/unsubscribe")]
    [InlineData("/api/v2/legal/acceptance/status")]
    public async Task LaravelReactPublicUtilityV2ReadAliases_AreRouted(string path)
    {
        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ideation-categories")]
    [InlineData("/api/v2/ideation-tags")]
    [InlineData("/api/v2/bookmark-collections")]
    [InlineData("/api/v2/link-preview")]
    [InlineData("/api/v2/reactions")]
    [InlineData("/api/v2/reviews")]
    [InlineData("/api/v2/shares")]
    [InlineData("/api/v2/me/fadp/consent")]
    [InlineData("/api/v2/me/residency-verification")]
    public async Task LaravelReactMemberUtilityV2PostAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/newsletter/unsubscribe")]
    [InlineData("/api/v2/legal/acceptance/accept-all")]
    public async Task LaravelReactPublicUtilityV2PostAliases_AreRouted(string path)
    {
        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ads/active")]
    [InlineData("/api/v2/appreciations/most-appreciated")]
    [InlineData("/api/v2/billing/plans")]
    [InlineData("/api/v2/blog")]
    [InlineData("/api/v2/blog/categories")]
    [InlineData("/api/v2/categories")]
    [InlineData("/api/v2/clubs")]
    [InlineData("/api/v2/config/algorithms")]
    [InlineData("/api/v2/config/google-maps")]
    [InlineData("/api/v2/group-collections")]
    [InlineData("/api/v2/group-tags")]
    [InlineData("/api/v2/group-tags/popular")]
    [InlineData("/api/v2/group-tags/suggest?q=care")]
    [InlineData("/api/v2/group-templates")]
    [InlineData("/api/v2/help/faqs")]
    [InlineData("/api/v2/municipality/events-calendar")]
    [InlineData("/api/v2/onboarding/config")]
    [InlineData("/api/v2/onboarding/safeguarding-options")]
    [InlineData("/api/v2/pages/menu")]
    [InlineData("/api/v2/platform/stats")]
    [InlineData("/api/v2/pusher/config")]
    [InlineData("/api/v2/search?q=care")]
    [InlineData("/api/v2/search/suggestions?q=care")]
    [InlineData("/api/v2/search/trending")]
    [InlineData("/api/v2/seo/redirects")]
    [InlineData("/api/v2/skills/search?q=care")]
    [InlineData("/api/v2/tenant/bootstrap")]
    public async Task LaravelReactPublicContentDiscoveryV2ReadAliases_AreRouted(string path)
    {
        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/identity/status")]
    [InlineData("/api/v2/matches/all")]
    [InlineData("/api/v2/member-premium/me")]
    [InlineData("/api/v2/member-premium/tiers")]
    [InlineData("/api/v2/mentions/me")]
    [InlineData("/api/v2/mentions/search?q=care")]
    [InlineData("/api/v2/merchant-onboarding/status")]
    [InlineData("/api/v2/onboarding/status")]
    [InlineData("/api/v2/realtime/config")]
    [InlineData("/api/v2/safeguarding/my-preferences")]
    [InlineData("/api/v2/skills/members?skill=care")]
    public async Task LaravelReactMemberContentDiscoveryV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/appreciations")]
    [InlineData("/api/v2/identity/start")]
    [InlineData("/api/v2/identity/save-dob")]
    [InlineData("/api/v2/identity/create-payment")]
    [InlineData("/api/v2/matches/1/dismiss")]
    [InlineData("/api/v2/member-premium/billing-portal")]
    [InlineData("/api/v2/member-premium/cancel")]
    [InlineData("/api/v2/member-premium/checkout")]
    [InlineData("/api/v2/merchant-onboarding/step-1")]
    [InlineData("/api/v2/merchant-onboarding/step-2")]
    [InlineData("/api/v2/merchant-onboarding/step-3")]
    [InlineData("/api/v2/merchant-onboarding/complete")]
    [InlineData("/api/v2/onboarding/safeguarding")]
    public async Task LaravelReactMemberWorkflowV2PostAliases_AsMember_AreRouted(string path)
    {
        if (path == "/api/v2/member-premium/cancel")
        {
            await SeedActiveMemberPremiumSubscriptionAsync();
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("GET", "api/v2/comments")]
    [InlineData("GET", "api/v2/resources/{id:int}/download")]
    [InlineData("GET", "api/v2/group-chatrooms/{chatroomId:int}/messages")]
    [InlineData("GET", "api/v2/team-tasks/{id:int}")]
    [InlineData("DELETE", "api/v2/group-chatroom-messages/{messageId:int}")]
    [InlineData("POST", "api/v2/onboarding/complete")]
    public void LaravelReactV2Aliases_HaveSingleControllerOwner(string method, string route)
    {
        var matches = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint =>
                string.Equals(
                    endpoint.RoutePattern.RawText?.Trim().TrimStart('/'),
                    route,
                    StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    .Contains(method, StringComparer.OrdinalIgnoreCase) ?? false))
            .ToArray();

        matches.Should().ContainSingle();
    }

    [Theory]
    [InlineData("/api/v2/admin/audit-log/export.csv")]
    [InlineData("/api/v2/admin/groups")]
    [InlineData("/api/v2/admin/matching/stats")]
    [InlineData("/api/v2/admin/subscriptions")]
    [InlineData("/api/v2/admin/vetting/stats")]
    public async Task LaravelReactFinalAdminV2ReadAliases_AsAdmin_AreRouted(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/community/stats")]
    [InlineData("/api/v2/csrf-token")]
    public async Task LaravelReactFinalPublicV2ReadAliases_AreRouted(string path)
    {
        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/ideation-outcomes/dashboard")]
    [InlineData("/api/v2/me/appreciations")]
    [InlineData("/api/v2/me/stats")]
    public async Task LaravelReactFinalMemberV2ReadAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/contact")]
    [InlineData("/api/v2/donations/payment-intent")]
    [InlineData("/api/v2/pilot-inquiry")]
    [InlineData("/api/v2/ugc-translate")]
    [InlineData("/api/v2/webhooks/identity/test-provider")]
    [InlineData("/api/v2/webhooks/stripe")]
    public async Task LaravelReactFinalPublicV2PostAliases_AreRouted(string path)
    {
        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    [Theory]
    [InlineData("/api/v2/safeguarding/revoke")]
    public async Task LaravelReactFinalMemberV2PostAliases_AsMember_AreRouted(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(path, new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.MethodNotAllowed);
    }

    private async Task SeedActiveMemberPremiumSubscriptionAsync()
    {
        var now = DateTime.UtcNow;
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var plan = new SubscriptionPlan
        {
            TenantId = TestData.Tenant1.Id,
            Name = $"Route probe premium {Guid.NewGuid():N}",
            Description = "Active subscription for the member-premium cancel route probe",
            Price = 1m,
            Currency = "EUR",
            Features = "[]",
            IsActive = true,
            IsPublic = true,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.SubscriptionPlans.Add(plan);
        await db.SaveChangesAsync();

        db.UserSubscriptions.Add(new UserSubscription
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            PlanId = plan.Id,
            Status = SubscriptionStatus.Active,
            StartedAt = now,
            NextBillingDate = now.AddMonths(1),
            CreatedAt = now,
            UpdatedAt = now
        });
        await db.SaveChangesAsync();
    }
}
