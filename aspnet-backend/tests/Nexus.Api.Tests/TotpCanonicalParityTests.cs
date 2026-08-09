// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;
using OtpNet;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class TotpCanonicalParityTests : IntegrationTestBase
{
    private readonly HashSet<int> _createdUserIds = [];

    public TotpCanonicalParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_createdUserIds.Count > 0)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.RefreshTokens.IgnoreQueryFilters()
                    .Where(token => _createdUserIds.Contains(token.UserId))
                    .ExecuteDeleteAsync();
                await db.TotpBackupCodes.IgnoreQueryFilters()
                    .Where(code => _createdUserIds.Contains(code.UserId))
                    .ExecuteDeleteAsync();
                await db.Users.IgnoreQueryFilters()
                    .Where(user => _createdUserIds.Contains(user.Id))
                    .ExecuteDeleteAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    [Fact]
    public void CanonicalV2Routes_HaveOneRealOwner()
    {
        var routes = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Select(endpoint => new
            {
                Pattern = "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/'),
                Action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>()
            })
            .ToList();

        routes.Where(route => route.Pattern.Equals("/api/v2/auth/2fa/verify", StringComparison.OrdinalIgnoreCase))
            .Should().ContainSingle()
            .Which.Action!.ActionName.Should().Be("VerifySetup");
        routes.Where(route => route.Pattern.Equals("/api/v2/auth/2fa/disable", StringComparison.OrdinalIgnoreCase))
            .Should().ContainSingle()
            .Which.Action!.ActionName.Should().Be("DisableCanonical");
    }

    [Fact]
    public async Task CanonicalSetupVerifyAndDisable_UseRealQrBackupCodesAndPassword()
    {
        var user = await CreateUserAsync("member");
        SetAuthToken(await GetAccessTokenAsync(user.Email, TestData.Tenant1.Slug));

        var setup = await Client.PostAsync("/api/v2/auth/2fa/setup", null);
        setup.StatusCode.Should().Be(HttpStatusCode.OK);
        var setupData = (await setup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var secret = setupData.GetProperty("secret").GetString()!;
        var qrDataUri = setupData.GetProperty("qr_code_url").GetString()!;
        qrDataUri.Should().StartWith("data:image/svg+xml;base64,");

        var svg = Encoding.UTF8.GetString(Convert.FromBase64String(qrDataUri.Split(',', 2)[1]));
        svg.Should().Contain("<svg");
        svg.Should().MatchRegex("<(path|rect)\\b");
        svg.Should().NotContain("<text").And.NotContain("otpauth://");

        var code = new Totp(Base32Encoding.ToBytes(secret), step: 30, totpSize: 6).ComputeTotp();
        var verify = await Client.PostAsJsonAsync("/api/v2/auth/2fa/verify", new { code });
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        var verifyData = (await verify.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        verifyData.GetProperty("backup_codes").GetArrayLength().Should().Be(10);

        var legacyStatus = await Client.GetAsync("/api/totp/status");
        legacyStatus.StatusCode.Should().Be(HttpStatusCode.OK);
        var legacyStatusPayload = await legacyStatus.Content.ReadFromJsonAsync<JsonElement>();
        legacyStatusPayload.GetProperty("enabled").GetBoolean().Should().BeTrue();
        legacyStatusPayload.GetProperty("backup_codes_remaining").GetInt32().Should().Be(10);
        legacyStatusPayload.GetProperty("trusted_devices").ValueKind.Should().Be(JsonValueKind.Array);

        var wrongPassword = await Client.PostAsJsonAsync(
            "/api/v2/auth/2fa/disable",
            new { password = "not-the-password" });
        wrongPassword.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var disable = await Client.PostAsJsonAsync(
            "/api/v2/auth/2fa/disable",
            new { password = TestDataSeeder.TestPassword });
        disable.StatusCode.Should().Be(HttpStatusCode.OK);
        var disableData = (await disable.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        disableData.GetProperty("message").GetString().Should().Be("Two-factor authentication disabled");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Users.IgnoreQueryFilters().SingleAsync(candidate => candidate.Id == user.Id);
        stored.TwoFactorEnabled.Should().BeFalse();
        stored.TotpSecretEncrypted.Should().BeNull();
        (await db.TotpBackupCodes.IgnoreQueryFilters().CountAsync(item => item.UserId == user.Id)).Should().Be(0);
    }

    [Fact]
    public void ForcedAdminGuard_AllowsUnsetOrExplicitlyDisabledSettings()
    {
        var unset = new ConfigurationBuilder().Build();
        var disabled = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ForceAdmin2Fa"] = "false",
                ["FORCE_ADMIN_2FA"] = "false"
            })
            .Build();

        var validateUnset = () => ForcedAdminTwoFactorGuard.Validate(unset);
        var validateDisabled = () => ForcedAdminTwoFactorGuard.Validate(disabled);

        validateUnset.Should().NotThrow();
        validateDisabled.Should().NotThrow();
    }

    [Theory]
    [InlineData("ForceAdmin2Fa")]
    [InlineData("FORCE_ADMIN_2FA")]
    public void ForcedAdminGuard_RejectsRetiredEnabledSetting(string key)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [key] = "true" })
            .Build();

        var validate = () => ForcedAdminTwoFactorGuard.Validate(configuration);

        var exception = validate.Should().Throw<InvalidOperationException>().Which;
        exception.Message.Should().Contain(key);
        exception.Message.Should().Contain("lockout risk");
    }

    [Fact]
    public async Task UnenrolledAdminLogin_DoesNotEmitUnusableSetupChallenge()
    {
        var user = await CreateUserAsync("admin");

        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email = user.Email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("success").GetBoolean().Should().BeTrue();
        payload.GetProperty("requires_2fa").GetBoolean().Should().BeFalse();
        payload.TryGetProperty("requires_2fa_setup", out _).Should().BeFalse();
        payload.TryGetProperty("two_factor_token", out _).Should().BeFalse();
        payload.GetProperty("access_token").GetString().Should().NotBeNullOrWhiteSpace();
    }

    private async Task<User> CreateUserAsync(string role)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"totp-canonical-{role}-{Guid.NewGuid():N}@example.test",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Canonical",
            LastName = "Totp",
            Role = role,
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        _createdUserIds.Add(user.Id);
        return user;
    }
}
