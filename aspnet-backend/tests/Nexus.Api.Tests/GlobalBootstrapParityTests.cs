// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class GlobalBootstrapParityTests : IntegrationTestBase
{
    public GlobalBootstrapParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Menus_ReturnsPersistedPublishedItemsForRequestedLocation()
    {
        var slug = $"bootstrap-menu-{Guid.NewGuid():N}";
        int pageId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var page = new Page
            {
                TenantId = TestData.Tenant1.Id,
                Title = "Bootstrap help",
                Slug = slug,
                Content = "Help content",
                IsPublished = true,
                ShowInMenu = true,
                MenuLocation = "header-main",
                SortOrder = 7,
                CreatedById = TestData.AdminUser.Id
            };
            db.Pages.Add(page);
            await db.SaveChangesAsync();
            pageId = page.Id;
        }

        try
        {
            ClearAuthToken();
            var response = await Client.GetAsync("/api/menus?location=header-main");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var menu = json.GetProperty("data").EnumerateArray().Single();
            var item = menu.GetProperty("items").EnumerateArray()
                .Single(candidate => candidate.GetProperty("id").GetInt32() == pageId);
            item.GetProperty("label").GetString().Should().Be("Bootstrap help");
            item.GetProperty("url").GetString().Should().Be($"/{slug}");
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var page = await db.Pages.IgnoreQueryFilters().SingleAsync(candidate => candidate.Id == pageId);
            db.Pages.Remove(page);
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task AlgorithmConfig_ReturnsConsumedAreasAndPersistedFeedChoice()
    {
        TenantConfig? existing;
        string? originalValue;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            existing = await db.TenantConfigs.IgnoreQueryFilters().FirstOrDefaultAsync(config =>
                config.TenantId == TestData.Tenant1.Id && config.Key == "config.feed_algorithm");
            originalValue = existing?.Value;
            if (existing is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "config.feed_algorithm",
                    Value = "{\"algorithm\":\"ranked\"}"
                });
            }
            else
            {
                existing.Value = "{\"algorithm\":\"ranked\"}";
            }
            await db.SaveChangesAsync();
        }

        try
        {
            await AuthenticateAsMemberAsync();
            var response = await Client.GetAsync("/api/v2/config/algorithms");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var data = json.GetProperty("data");
            data.EnumerateObject().Select(property => property.Name)
                .Should().BeEquivalentTo(["feed", "listings", "members", "matching"]);
            data.GetProperty("feed").GetProperty("key").GetString().Should().Be("edgerank");
            data.GetProperty("feed").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
            data.GetProperty("feed").GetProperty("description").GetString().Should().NotBeNullOrWhiteSpace();
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.TenantConfigs.IgnoreQueryFilters().SingleAsync(config =>
                config.TenantId == TestData.Tenant1.Id && config.Key == "config.feed_algorithm");
            if (existing is null)
                db.TenantConfigs.Remove(row);
            else
                row.Value = originalValue!;
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task IdentityStatus_ReflectsLatestPersistedVerificationSession()
    {
        int sessionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var session = new IdentityVerificationSession
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Provider = VerificationProvider.StripeIdentity,
                Level = VerificationLevel.DocumentAndSelfie,
                Status = VerificationSessionStatus.Failed,
                DecisionReason = "Document could not be verified",
                ExpiresAt = DateTime.UtcNow.AddHours(1),
                CreatedAt = DateTime.UtcNow
            };
            db.IdentityVerificationSessions.Add(session);
            await db.SaveChangesAsync();
            sessionId = session.Id;
        }

        try
        {
            await AuthenticateAsMemberAsync();
            var response = await Client.GetAsync("/api/v2/identity/status");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            var data = json.GetProperty("data");
            data.GetProperty("verification_status").GetString().Should().Be("failed");
            var latest = data.GetProperty("latest_session");
            latest.GetProperty("id").GetInt32().Should().Be(sessionId);
            latest.GetProperty("provider").GetString().Should().Be("stripe_identity");
            latest.GetProperty("failure_reason").GetString().Should().Be("Document could not be verified");
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var session = await db.IdentityVerificationSessions.IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == sessionId);
            db.IdentityVerificationSessions.Remove(session);
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task CsrfToken_ReturnsFreshCryptographicValuePerRequest()
    {
        ClearAuthToken();

        using var firstRequest = new HttpRequestMessage(HttpMethod.Get, "/api/csrf-token");
        firstRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        using var secondRequest = new HttpRequestMessage(HttpMethod.Get, "/api/csrf-token");
        secondRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var firstResponse = await Client.SendAsync(firstRequest);
        var secondResponse = await Client.SendAsync(secondRequest);
        firstResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        secondResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var first = await firstResponse.Content.ReadFromJsonAsync<JsonElement>();
        var second = await secondResponse.Content.ReadFromJsonAsync<JsonElement>();

        first.TryGetProperty("csrf_token", out var firstTokenElement).Should().BeTrue($"response was {first}");
        second.TryGetProperty("csrf_token", out var secondTokenElement).Should().BeTrue($"response was {second}");
        var firstToken = firstTokenElement.GetString();
        var secondToken = secondTokenElement.GetString();
        firstToken.Should().MatchRegex("^[0-9a-f]{32}$");
        secondToken.Should().MatchRegex("^[0-9a-f]{32}$");
        secondToken.Should().NotBe(firstToken);
    }

    [Fact]
    public async Task EnabledOAuthProviders_RequiresGlobalAndTenantOptIn()
    {
        TenantConfig? existing;
        string? originalValue;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            existing = await db.TenantConfigs.IgnoreQueryFilters().FirstOrDefaultAsync(config =>
                config.TenantId == TestData.Tenant1.Id && config.Key == "auth.oauth.enabled_providers");
            originalValue = existing?.Value;
            if (existing is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "auth.oauth.enabled_providers",
                    Value = "[\"google\",\"apple\",\"unsupported\"]"
                });
            }
            else
            {
                existing.Value = "[\"google\",\"apple\",\"unsupported\"]";
            }
            await db.SaveChangesAsync();
        }

        try
        {
            using var enabledFactory = Factory.WithWebHostBuilder(builder =>
                builder.ConfigureAppConfiguration((_, configuration) =>
                    configuration.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["OAuth:Enabled"] = "true"
                    })));
            using var enabledClient = enabledFactory.CreateClient(new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false
            });

            var response = await enabledClient.GetAsync(
                $"/api/v2/auth/oauth/enabled-providers?tenant_id={TestData.Tenant1.Id}");

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            json.GetProperty("providers").EnumerateArray().Select(provider => provider.GetString())
                .Should().Equal("google");
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.TenantConfigs.IgnoreQueryFilters().SingleAsync(config =>
                config.TenantId == TestData.Tenant1.Id && config.Key == "auth.oauth.enabled_providers");
            if (existing is null)
                db.TenantConfigs.Remove(row);
            else
                row.Value = originalValue!;
            await db.SaveChangesAsync();
        }
    }
}
