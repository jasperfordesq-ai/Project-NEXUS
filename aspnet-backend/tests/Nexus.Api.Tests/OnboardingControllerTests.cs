// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
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
public class OnboardingControllerTests : IntegrationTestBase
{
    public OnboardingControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetSteps_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/onboarding/steps");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetSteps_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/onboarding/steps");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetProgress_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/onboarding/progress");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CompleteStep_AsMember_ReturnsOkOrBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/onboarding/complete", new { step_key = "profile_photo" });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CompleteV2Onboarding_WithProfile_ReturnsOkAndMarksRequiredStepsDone()
    {
        await AuthenticateAsMemberAsync();

        int categoryId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.FindAsync(TestData.MemberUser.Id);
            user!.AvatarUrl = "/uploads/test/avatar.png";
            user.Bio = "I am happy to help my community.";

            var category = new Category
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Gardening",
                Slug = "gardening",
                IsActive = true,
                SortOrder = 1,
                CreatedAt = DateTime.UtcNow
            };
            db.Categories.Add(category);
            db.OnboardingSteps.Add(new OnboardingStep
            {
                TenantId = TestData.Tenant1.Id,
                Key = $"profile_complete_{Guid.NewGuid():N}",
                Title = "Profile complete",
                IsRequired = true,
                SortOrder = 1,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            categoryId = category.Id;
        }

        var response = await Client.PostAsJsonAsync("/api/v2/onboarding/complete", new
        {
            interests = new[] { categoryId },
            offers = new[] { categoryId },
            needs = Array.Empty<int>()
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("listings_created").GetInt32().Should().Be(1);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var completed = verifyDb.Set<OnboardingProgress>()
            .Count(p => p.UserId == TestData.MemberUser.Id && p.IsCompleted);
        completed.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task CompleteCanonicalOnboarding_WithWizardPayload_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.FindAsync(TestData.MemberUser.Id);
            user!.AvatarUrl = "/api/files/1/download";
            user.Bio = "Ready to participate in the community.";
            db.OnboardingSteps.Add(new OnboardingStep
            {
                TenantId = TestData.Tenant1.Id,
                Key = $"profile_complete_{Guid.NewGuid():N}",
                Title = "Profile complete",
                IsRequired = true,
                SortOrder = 1,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var response = await Client.PostAsJsonAsync("/api/onboarding/complete", new
        {
            interests = Array.Empty<int>(),
            offers = Array.Empty<int>(),
            needs = Array.Empty<int>()
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CompleteV2Onboarding_WithoutProfilePhoto_ReturnsBadRequest()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/onboarding/complete", new
        {
            interests = Array.Empty<int>(),
            offers = Array.Empty<int>(),
            needs = Array.Empty<int>()
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ResetProgress_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsync("/api/onboarding/reset", null);
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminCreateStep_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/onboarding/admin/steps", new
        {
            key = "test_step",
            title = "Test Step",
            description = "A test step",
            sort_order = 99,
            is_required = false,
            xp_reward = 10
        });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminCreateStep_AsAdmin_ReturnsOkOrCreated()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/onboarding/admin/steps", new
        {
            key = "test_step_admin",
            title = "Admin Test Step",
            description = "An admin test step",
            sort_order = 99,
            is_required = false,
            xp_reward = 10
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task AdminDeleteStep_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/onboarding/admin/steps/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
