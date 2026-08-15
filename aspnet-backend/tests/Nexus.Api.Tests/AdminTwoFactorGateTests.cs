// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Mandatory two-factor for administrators.
///
/// 🔴 Laravel refuses to complete an admin sign-in when the account has no
/// second factor and hands back a setup challenge (AUTH_2FA_SETUP_REQUIRED).
/// This backend had no such gate — the code returned zero hits anywhere — so an
/// administrator with two-factor switched off was let straight in.
///
/// The gate is off unless BOTH the platform switch (Auth:ForceAdminTwoFactor)
/// and the tenant feature are on, so these tests set them explicitly rather
/// than assuming an environment.
/// </summary>
[Collection("Integration")]
public sealed class AdminTwoFactorGateTests : IntegrationTestBase
{
    public AdminTwoFactorGateTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task SetTenantFeatureAsync(bool enabled)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        const string key = "features.two_factor_authentication";
        var row = await db.TenantConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == key);
        if (row is null)
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = key,
                Value = enabled ? "true" : "false",
            });
        }
        else
        {
            row.Value = enabled ? "true" : "false";
        }
        await db.SaveChangesAsync();
    }

    private HttpClient ClientWithGate(bool forceAdmin2Fa)
        => Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Auth:ForceAdminTwoFactor"] = forceAdmin2Fa ? "true" : "false",
                });
            });
        }).CreateClient();

    private static async Task<HttpResponseMessage> SignInAsync(HttpClient client, string email)
        => await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant",
        });

    [Fact]
    public async Task AnAdminWithoutTwoFactor_IsSentToSetup_RatherThanStraightIn()
    {
        await SetTenantFeatureAsync(true);
        var client = ClientWithGate(forceAdmin2Fa: true);

        var response = await SignInAsync(client, "admin@test.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK, "Laravel answers 200 with success:false here");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("success").GetBoolean().Should().BeFalse();
        body.GetProperty("requires_2fa_setup").GetBoolean().Should().BeTrue();
        body.GetProperty("code").GetString().Should().Be("AUTH_2FA_SETUP_REQUIRED");
        body.GetProperty("two_factor_token").GetString().Should().NotBeNullOrEmpty();
        body.TryGetProperty("access_token", out _).Should().BeFalse(
            "the whole point is that the admin is NOT signed in yet");
        body.GetProperty("user").GetProperty("email_masked").GetString()
            .Should().Contain("***");
    }

    [Fact]
    public async Task AnOrdinaryMemberWithoutTwoFactor_IsUnaffected()
    {
        await SetTenantFeatureAsync(true);
        var client = ClientWithGate(forceAdmin2Fa: true);

        var response = await SignInAsync(client, "member@test.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty(
            "the gate is for administrators, not everyone");
    }

    [Fact]
    public async Task WithThePlatformSwitchOff_AnAdminSignsInNormally()
    {
        await SetTenantFeatureAsync(true);
        var client = ClientWithGate(forceAdmin2Fa: false);

        var response = await SignInAsync(client, "admin@test.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task WithTheTenantFeatureOff_AnAdminSignsInNormally()
    {
        await SetTenantFeatureAsync(false);
        var client = ClientWithGate(forceAdmin2Fa: true);

        var response = await SignInAsync(client, "admin@test.com");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("access_token").GetString().Should().NotBeNullOrEmpty(
            "a community that has not enabled two-factor must not be locked out by it");
    }
}
