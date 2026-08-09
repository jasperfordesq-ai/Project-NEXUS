// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminCompatibilityControllerTests : IntegrationTestBase
{
    public AdminCompatibilityControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task UpdateFeatureFlag_PersistsInSettings()
    {
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync("/api/admin/config/features", new
        {
            feature = "ai_enabled",
            enabled = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var settings = await Client.GetAsync("/api/admin/settings");
        settings.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await settings.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("features").GetProperty("ai_enabled").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task PlanCrud_UsesSubscriptionPlanStorage()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/admin/plans", new
        {
            name = "Community Plus",
            description = "Test plan",
            price = 9.99m,
            currency = "eur",
            features = new[] { "analytics", "priority_support" },
            is_public = true
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var planId = created.GetProperty("id").GetInt32();
        planId.Should().BeGreaterThan(0);
        created.GetProperty("data").GetProperty("features").EnumerateArray()
            .Select(f => f.GetString())
            .Should().Contain("analytics");

        var get = await Client.GetAsync($"/api/admin/plans/{planId}");
        get.StatusCode.Should().Be(HttpStatusCode.OK);

        var delete = await Client.DeleteAsync($"/api/admin/plans/{planId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ImpactReportV2_ReturnsLaravelReactDataEnvelopeAndPersistsConfig()
    {
        await AuthenticateAsAdminAsync();

        var initial = await Client.GetAsync("/api/v2/admin/impact-report?months=6");
        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();

        var data = initialJson.GetProperty("data");
        var sroi = data.GetProperty("sroi");
        sroi.GetProperty("period_months").GetInt32().Should().Be(6);
        sroi.GetProperty("total_hours").GetDecimal().Should().BeGreaterThanOrEqualTo(0);
        sroi.GetProperty("total_transactions").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        sroi.GetProperty("unique_givers").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        sroi.GetProperty("unique_receivers").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        sroi.GetProperty("hourly_value").GetDecimal().Should().BeGreaterThan(0);
        sroi.GetProperty("social_multiplier").GetDecimal().Should().BeGreaterThan(0);
        data.GetProperty("health").ValueKind.Should().Be(JsonValueKind.Object);
        data.GetProperty("timeline").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("config").GetProperty("tenant_slug").GetString().Should().NotBeNullOrWhiteSpace();

        var update = await Client.PutAsJsonAsync("/api/v2/admin/impact-report/config", new
        {
            hourly_value = 25.5m,
            social_multiplier = 4.25m
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var refreshed = await Client.GetAsync("/api/v2/admin/impact-report?months=3");
        refreshed.StatusCode.Should().Be(HttpStatusCode.OK);
        var refreshedData = (await refreshed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        refreshedData.GetProperty("sroi").GetProperty("period_months").GetInt32().Should().Be(3);
        refreshedData.GetProperty("config").GetProperty("hourly_value").GetDecimal().Should().Be(25.5m);
        refreshedData.GetProperty("config").GetProperty("social_multiplier").GetDecimal().Should().Be(4.25m);
    }

    [Fact]
    public async Task ListingFeatureEndpoints_PersistFeaturedFlag()
    {
        await AuthenticateAsAdminAsync();

        var feature = await Client.PostAsync($"/api/admin/listings/{TestData.Listing1.Id}/feature", null);
        feature.StatusCode.Should().Be(HttpStatusCode.OK);

        var featured = await Client.GetAsync("/api/admin/listings/featured");
        featured.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await featured.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt32())
            .Should().Contain(TestData.Listing1.Id);

        var unfeature = await Client.DeleteAsync($"/api/admin/listings/{TestData.Listing1.Id}/feature");
        unfeature.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var listing = await db.Listings.IgnoreQueryFilters().FirstAsync(l => l.Id == TestData.Listing1.Id);
        listing.IsFeatured.Should().BeFalse();
    }

    [Fact]
    public async Task UserBadgeEndpoints_AwardRecheckAndRemoveBadges()
    {
        await AuthenticateAsAdminAsync();

        int badgeId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            badgeId = await db.Badges.IgnoreQueryFilters()
                .Where(b => b.TenantId == TestData.Tenant1.Id && b.Slug == Badge.Slugs.FirstListing)
                .Select(b => b.Id)
                .FirstAsync();
        }

        var add = await Client.PostAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}/badges", new { badge_id = badgeId });
        add.StatusCode.Should().Be(HttpStatusCode.OK);

        var recheck = await Client.PostAsync($"/api/admin/users/{TestData.MemberUser.Id}/badges/recheck", null);
        recheck.StatusCode.Should().Be(HttpStatusCode.OK);

        var remove = await Client.DeleteAsync($"/api/admin/users/{TestData.MemberUser.Id}/badges/{badgeId}");
        remove.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stillAwarded = await verifyDb.UserBadges.IgnoreQueryFilters()
            .AnyAsync(ub => ub.UserId == TestData.MemberUser.Id && ub.BadgeId == badgeId);
        stillAwarded.Should().BeFalse();
    }

    [Fact]
    public async Task UserPasswordEndpoints_UpdatePasswordAndGenerateResetToken()
    {
        await AuthenticateAsAdminAsync();

        var reset = await Client.PostAsync($"/api/admin/users/{TestData.MemberUser.Id}/send-password-reset", null);
        reset.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var hasResetToken = await db.PasswordResetTokens.IgnoreQueryFilters()
                .AnyAsync(t => t.UserId == TestData.MemberUser.Id && t.UsedAt == null);
            hasResetToken.Should().BeTrue();
        }

        var newPassword = "Changed123!";
        var set = await Client.PostAsJsonAsync($"/api/admin/users/{TestData.MemberUser.Id}/password", new { password = newPassword });
        set.StatusCode.Should().Be(HttpStatusCode.OK);

        ClearAuthToken();
        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = TestData.MemberUser.Email,
            password = newPassword,
            tenant_slug = TestData.Tenant1.Slug
        });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UserImpersonationAndSuperAdminEndpoints_PersistAuditableState()
    {
        int userId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"impersonate-{Guid.NewGuid():N}@acme.test",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Temp123!"),
                FirstName = "Impersonate",
                LastName = "Target",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        await AuthenticateAsPlatformSuperAdminAsync();

        var impersonate = await Client.PostAsync($"/api/admin/users/{userId}/impersonate", null);
        impersonate.StatusCode.Should().Be(HttpStatusCode.OK);
        var impersonation = await impersonate.Content.ReadFromJsonAsync<JsonElement>();
        impersonation.GetProperty("access_token").GetString().Should().NotBeNullOrWhiteSpace();
        impersonation.GetProperty("refresh_token").ValueKind.Should().Be(JsonValueKind.Null);

        var superAdmin = await Client.PutAsync($"/api/admin/users/{userId}/super-admin", null);
        superAdmin.StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsGodAsync();

        var globalSuperAdmin = await Client.PutAsync($"/api/admin/users/{userId}/global-super-admin", null);
        globalSuperAdmin.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var updated = await verifyDb.Users.IgnoreQueryFilters().FirstAsync(u => u.Id == userId);
        updated.Role.Should().Be("admin");
        updated.IsSuperAdmin.Should().BeTrue();
    }

    [Fact]
    public async Task MenuItemEndpoints_MutateCmsPages()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/admin/menus/1/items", new
        {
            title = "Admin Compatibility",
            slug = "admin-compatibility",
            sort_order = 5,
            is_published = true
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var itemId = created.GetProperty("id").GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/admin/menu-items/{itemId}", new
        {
            label = "Compatibility Updated",
            sort_order = 1
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var reorder = await Client.PostAsJsonAsync("/api/admin/menus/1/items/reorder", new
        {
            ids = new[] { itemId }
        });
        reorder.StatusCode.Should().Be(HttpStatusCode.OK);

        var delete = await Client.DeleteAsync($"/api/admin/menu-items/{itemId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var page = await db.Pages.IgnoreQueryFilters().FirstAsync(p => p.Id == itemId);
        page.ShowInMenu.Should().BeFalse();
        page.MenuLocation.Should().BeNull();
    }

    [Fact]
    public async Task MenuCrud_PersistsCompatibilityMenus()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/admin/menus", new
        {
            name = "Utility Links",
            location = "utility"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var menuId = created.GetProperty("id").GetInt32();
        menuId.Should().BeGreaterThan(3);

        var update = await Client.PutAsJsonAsync($"/api/admin/menus/{menuId}", new
        {
            name = "Utility Links Updated",
            location = "utility-updated"
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var item = await Client.PostAsJsonAsync($"/api/admin/menus/{menuId}/items", new
        {
            title = "Utility Page",
            slug = $"utility-page-{Guid.NewGuid():N}",
            is_published = true
        });
        item.StatusCode.Should().Be(HttpStatusCode.Created);
        var itemContent = await item.Content.ReadFromJsonAsync<JsonElement>();
        var pageId = itemContent.GetProperty("id").GetInt32();

        var list = await Client.GetAsync("/api/admin/menus");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listed = await list.Content.ReadFromJsonAsync<JsonElement>();
        var listedRaw = listed.GetRawText();
        listed.GetProperty("data").EnumerateArray()
            .Any(menu => menu.GetProperty("id").GetInt32() == menuId &&
                         menu.GetProperty("location").GetString() == "utility_updated")
            .Should().BeTrue($"menu list should include the updated custom menu, but was {listedRaw}");

        var delete = await Client.DeleteAsync($"/api/admin/menus/{menuId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var config = await db.TenantConfigs.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Key == "menus.definitions");
        config.Should().NotBeNull();
        config!.Value.Should().Contain("Utility Links Updated");

        var page = await db.Pages.IgnoreQueryFilters().FirstAsync(p => p.Id == pageId);
        page.ShowInMenu.Should().BeFalse();
        page.MenuLocation.Should().BeNull();
    }

    [Fact]
    public async Task MatchingApprovalEndpoints_MutateMatchResults()
    {
        int matchId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var match = new MatchResult
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                MatchedUserId = TestData.MemberUser.Id,
                MatchedListingId = TestData.Listing2.Id,
                Score = 0.82m,
                Reasons = JsonSerializer.Serialize(new[] { "test_match" }),
                Status = MatchStatus.Pending,
                CreatedAt = DateTime.UtcNow
            };
            db.MatchResults.Add(match);
            await db.SaveChangesAsync();
            matchId = match.Id;
        }

        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/admin/matching/approvals");
        list.StatusCode.Should().Be(HttpStatusCode.OK);

        var approve = await Client.PostAsync($"/api/admin/matching/approvals/{matchId}/approve", null);
        approve.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var updated = await verifyDb.MatchResults.IgnoreQueryFilters().FirstAsync(m => m.Id == matchId);
        updated.Status.Should().Be(MatchStatus.Accepted);
        updated.RespondedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task ImportUsers_CreatesTenantUsers()
    {
        await AuthenticateAsAdminAsync();
        var email = $"import-{Guid.NewGuid():N}@acme.test";

        var response = await Client.PostAsJsonAsync("/api/admin/users/import", new
        {
            users = new[]
            {
                new { email, first_name = "Import", last_name = "User", role = "member", email_verified = true }
            }
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Email == email);
        user.Should().NotBeNull();
        user!.TenantId.Should().Be(TestData.Tenant1.Id);
        user.EmailVerified.Should().BeTrue();
    }

    [Fact]
    public async Task LanguageConfig_PersistsSupportedLocalesAndDefault()
    {
        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync("/api/admin/config/languages", new
        {
            default_language = "ga",
            available_languages = new[] { "en", "ga", "fr" },
            auto_detect = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var get = await Client.GetAsync("/api/admin/config/languages");
        get.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await get.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("default_language").GetString().Should().Be("ga");
        content.GetProperty("auto_detect").GetBoolean().Should().BeFalse();
        content.GetProperty("available_languages").EnumerateArray().Select(x => x.GetString()).Should().Contain("fr");
    }

    [Fact]
    public async Task ScheduledTaskCompatibility_ListsAndRecordsManualRun()
    {
        int taskId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var task = new ScheduledTask
            {
                TenantId = TestData.Tenant1.Id,
                TaskName = $"compat-task-{Guid.NewGuid():N}",
                CronExpression = "0 3 * * *",
                Status = ScheduledTaskStatus.Pending
            };
            db.ScheduledTasks.Add(task);
            await db.SaveChangesAsync();
            taskId = task.Id;
        }

        await AuthenticateAsAdminAsync();

        var list = await Client.GetAsync("/api/admin/background-jobs");
        list.StatusCode.Should().Be(HttpStatusCode.OK);

        var run = await Client.PostAsync($"/api/admin/system/cron-jobs/{taskId}/run", null);
        run.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var updated = await verifyDb.ScheduledTasks.IgnoreQueryFilters().FirstAsync(t => t.Id == taskId);
        updated.Status.Should().Be(ScheduledTaskStatus.Completed);
        updated.RunCount.Should().Be(1);
        updated.LastRunAt.Should().NotBeNull();
    }

    [Fact]
    public async Task ConfigCompatibility_PersistsFeedNativeAndImpactSettings()
    {
        await AuthenticateAsAdminAsync();

        (await Client.PutAsJsonAsync("/api/admin/config/feed-algorithm", new { algorithm = "ranked", decay_hours = 24 }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PutAsJsonAsync("/api/admin/config/native-app", new { push_enabled = true, min_version = "2.0.0" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PutAsJsonAsync("/api/admin/impact-report/config", new { hourly_social_value = 33, currency = "EUR" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var feed = await (await Client.GetAsync("/api/admin/config/feed-algorithm")).Content.ReadFromJsonAsync<JsonElement>();
        feed.GetProperty("algorithm").GetString().Should().Be("ranked");

        var native = await (await Client.GetAsync("/api/admin/config/native-app")).Content.ReadFromJsonAsync<JsonElement>();
        native.GetProperty("push_enabled").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var impactConfig = await db.TenantConfigs.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "impact_report.config");
        impactConfig.Should().NotBeNull();
    }

    [Fact]
    public async Task AttributesCompatibility_PersistsCatalogInTenantConfig()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/admin/attributes", new
        {
            name = "Neighbourhood",
            key = "neighbourhood",
            type = "text",
            required = true
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/admin/attributes/{id}", new { name = "Local Area", active = false });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync("/api/admin/attributes");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await list.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").EnumerateArray().Should().Contain(x => x.GetProperty("id").GetInt32() == id);

        var delete = await Client.DeleteAsync($"/api/admin/attributes/{id}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TimebankingAlertUpdate_MutatesBalanceAlert()
    {
        int alertId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var alert = new BalanceAlert
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                ThresholdAmount = 5,
                IsActive = true
            };
            db.BalanceAlerts.Add(alert);
            await db.SaveChangesAsync();
            alertId = alert.Id;
        }

        await AuthenticateAsAdminAsync();

        var update = await Client.PutAsJsonAsync($"/api/admin/timebanking/alerts/{alertId}", new { status = "resolved" });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var updated = await verifyDb.BalanceAlerts.IgnoreQueryFilters().FirstAsync(a => a.Id == alertId);
        updated.IsActive.Should().BeFalse();
    }

    [Fact]
    public async Task GamificationCampaignAndBulkAward_UsePersistedEntitiesAndXpService()
    {
        await AuthenticateAsAdminAsync();

        var create = await Client.PostAsJsonAsync("/api/admin/gamification/campaigns", new
        {
            title = "Spring Help Drive",
            action_type = "exchange",
            target_count = 3,
            xp_reward = 50
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var campaignId = created.GetProperty("id").GetInt32();

        var update = await Client.PutAsJsonAsync($"/api/admin/gamification/campaigns/{campaignId}", new { title = "Updated Drive", is_active = false });
        update.StatusCode.Should().Be(HttpStatusCode.OK);

        var bulk = await Client.PostAsJsonAsync("/api/admin/gamification/bulk-award", new
        {
            user_ids = new[] { TestData.MemberUser.Id },
            xp = 7,
            reason = "Compatibility test"
        });
        bulk.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var xpLog = await db.XpLogs.IgnoreQueryFilters()
                .AnyAsync(x => x.UserId == TestData.MemberUser.Id && x.Source == "admin_bulk_award" && x.Amount == 7);
            xpLog.Should().BeTrue();
        }

        var delete = await Client.DeleteAsync($"/api/admin/gamification/campaigns/{campaignId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task EmailProviderTest_SendsWhenProviderIsHealthy()
    {
        var token = await GetAccessTokenAsync("admin@test.com", "test-tenant");
        using var healthyFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailService>();
                services.AddSingleton<IEmailService, HealthyEmailService>();
            });
        });
        using var healthyClient = healthyFactory.CreateClient();
        healthyClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await healthyClient.PostAsJsonAsync("/api/admin/email/test-provider", new { to = "admin@test.com" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("delivered").GetBoolean().Should().BeTrue();
        content.GetProperty("email_log_id").GetInt32().Should().BeGreaterThan(0);
    }

    private sealed class HealthyEmailService : IEmailService
    {
        public Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default)
            => Task.FromResult(true);
    }

    [Fact]
    public async Task RedirectAnd404Deletes_RemoveStoredCompatibilityItems()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.SystemSettings.Add(new SystemSetting
            {
                Key = $"url_redirects_{TestData.Tenant1.Id}",
                Value = JsonSerializer.Serialize(new[]
                {
                    new { id = 42, from = "/old", to = "/new", isPermanent = true, createdAt = DateTime.UtcNow },
                    new { id = 43, from = "/keep", to = "/kept", isPermanent = false, createdAt = DateTime.UtcNow }
                }),
                Category = "tools"
            });
            await db.SaveChangesAsync();
        }

        var cache = Factory.Services.GetRequiredService<IMemoryCache>();
        cache.Set("404_errors", new List<NotFoundEntry>
        {
            new() { Path = "/missing", Count = 3, LastSeen = DateTime.UtcNow },
            new() { Path = "/keep-missing", Count = 1, LastSeen = DateTime.UtcNow.AddMinutes(-5) }
        });

        await AuthenticateAsAdminAsync();

        var redirect = await Client.DeleteAsync("/api/admin/tools/redirects/42");
        redirect.StatusCode.Should().Be(HttpStatusCode.OK);

        var notFound = await Client.DeleteAsync("/api/admin/tools/404-errors/1");
        notFound.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var setting = await verifyDb.SystemSettings.FirstAsync(s => s.Key == $"url_redirects_{TestData.Tenant1.Id}");
        setting.Value.Should().NotContain("/old");
        setting.Value.Should().Contain("/keep");

        cache.TryGetValue("404_errors", out List<NotFoundEntry>? remaining).Should().BeTrue();
        remaining.Should().NotBeNull();
        var remainingPaths = remaining!.Select(e => e.Path).ToList();
        remainingPaths.Should().NotContain("/missing");
        remainingPaths.Should().Contain("/keep-missing");
    }

    [Fact]
    public async Task ToolActions_RecordCompatibilityRuns()
    {
        await AuthenticateAsAdminAsync();

        var webp = await Client.PostAsync("/api/admin/tools/webp-convert", null);
        var seed = await Client.PostAsync("/api/admin/tools/seed", null);
        var restore = await Client.PostAsync("/api/admin/tools/blog-backups/test-backup/restore", null);

        webp.StatusCode.Should().Be(HttpStatusCode.Accepted);
        seed.StatusCode.Should().Be(HttpStatusCode.Accepted);
        restore.StatusCode.Should().Be(HttpStatusCode.Accepted);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var keys = await db.TenantConfigs.IgnoreQueryFilters()
            .Where(c => c.Key.StartsWith("tools."))
            .Select(c => c.Key)
            .ToListAsync();

        keys.Should().Contain("tools.webp_conversion.last");
        keys.Should().Contain("tools.seed.last");
        keys.Should().Contain("tools.blog_backup_restore.test_backup");
    }

    [Fact]
    public async Task SeoAudit_InspectsCmsContentAndPersistsLatestResult()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Pages.Add(new Page
            {
                TenantId = TestData.Tenant1.Id,
                Title = "Published Missing Meta",
                Slug = $"published-missing-meta-{Guid.NewGuid():N}",
                Content = "Body",
                IsPublished = true,
                CreatedById = TestData.AdminUser.Id
            });
            db.BlogPosts.Add(new BlogPost
            {
                TenantId = TestData.Tenant1.Id,
                Title = "Published Blog Missing Meta",
                Slug = $"published-blog-missing-meta-{Guid.NewGuid():N}",
                Content = "Body",
                Status = "published",
                AuthorId = TestData.AdminUser.Id,
                PublishedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsync("/api/admin/tools/seo-audit", null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("success").GetBoolean().Should().BeTrue();
        content.GetProperty("queued").GetBoolean().Should().BeFalse();
        content.GetProperty("totals").GetProperty("audited").GetInt32().Should().BeGreaterThan(0);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var config = await verifyDb.TenantConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "tools.seo_audit.latest");
        config.Should().NotBeNull();
        config!.Value.Should().Contain("score");
    }
}
