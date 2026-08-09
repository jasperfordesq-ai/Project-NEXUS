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
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;
using OtpNet;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class TwoFactorChallengeParityTests : IntegrationTestBase
{
    private int? _createdUserId;

    public TwoFactorChallengeParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_createdUserId.HasValue)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.RefreshTokens
                    .IgnoreQueryFilters()
                    .Where(token => token.UserId == _createdUserId.Value)
                    .ExecuteDeleteAsync();
                await db.TotpBackupCodes
                    .IgnoreQueryFilters()
                    .Where(code => code.UserId == _createdUserId.Value)
                    .ExecuteDeleteAsync();
                await db.Users
                    .IgnoreQueryFilters()
                    .Where(user => user.Id == _createdUserId.Value)
                    .ExecuteDeleteAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    [Fact]
    public async Task PasswordLogin_UsesOpaqueSingleUseChallenge_ThenReturnsFullLoginContract()
    {
        var (email, code) = await CreateTwoFactorUserAsync();

        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });

        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var loginPayload = await login.Content.ReadFromJsonAsync<JsonElement>();
        loginPayload.GetProperty("success").GetBoolean().Should().BeFalse();
        loginPayload.GetProperty("requires_2fa").GetBoolean().Should().BeTrue();
        loginPayload.GetProperty("methods").EnumerateArray().Select(item => item.GetString())
            .Should().Equal("totp", "backup_code");
        loginPayload.GetProperty("code").GetString().Should().Be("AUTH_2FA_REQUIRED");
        loginPayload.TryGetProperty("access_token", out _).Should().BeFalse();
        loginPayload.TryGetProperty("temp_token", out _).Should().BeFalse();

        var challenge = loginPayload.GetProperty("two_factor_token").GetString()!;
        challenge.Should().HaveLength(64).And.NotContain(".");

        SetAuthToken(challenge);
        var bearerAttempt = await Client.GetAsync("/api/v2/users/me");
        bearerAttempt.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        Client.DefaultRequestHeaders.Authorization = null;

        var verified = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challenge,
            code,
            use_backup_code = false,
            trust_device = false
        });

        verified.StatusCode.Should().Be(HttpStatusCode.OK);
        var verifiedPayload = await verified.Content.ReadFromJsonAsync<JsonElement>();
        verifiedPayload.GetProperty("success").GetBoolean().Should().BeTrue();
        verifiedPayload.GetProperty("token_type").GetString().Should().Be("Bearer");
        verifiedPayload.GetProperty("refresh_expires_in").GetInt32().Should().Be(604800);
        verifiedPayload.GetProperty("token").GetString()
            .Should().Be(verifiedPayload.GetProperty("access_token").GetString());
        verifiedPayload.GetProperty("sanctum_token").ValueKind.Should().Be(JsonValueKind.Null);
        var user = verifiedPayload.GetProperty("user");
        user.GetProperty("is_admin").GetBoolean().Should().BeTrue();
        user.GetProperty("is_super_admin").GetBoolean().Should().BeTrue();
        user.GetProperty("is_tenant_super_admin").GetBoolean().Should().BeFalse();
        user.GetProperty("is_god").GetBoolean().Should().BeFalse();

        var replay = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challenge,
            code
        });
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var replayPayload = await replay.Content.ReadFromJsonAsync<JsonElement>();
        replayPayload.GetProperty("code").GetString().Should().Be("AUTH_2FA_TOKEN_EXPIRED");

        SetAuthToken(verifiedPayload.GetProperty("access_token").GetString()!);
        var me = await Client.GetAsync("/api/v2/users/me");
        me.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public void ChallengeManager_InvalidatesTheFifthAttempt()
    {
        var manager = Factory.Services.GetRequiredService<TwoFactorChallengeManager>();
        var enabledAt = DateTime.UtcNow;
        var token = manager.Create(123456, TestData.Tenant1.Id, ["totp"], enabledAt);

        token.Should().HaveLength(64).And.NotContain(".");
        var challenge = manager.Get(token);
        challenge.Should().NotBeNull();
        challenge!.TenantId.Should().Be(TestData.Tenant1.Id);
        challenge.TwoFactorEnabledAt.Should().Be(enabledAt);
        manager.RecordAttempt(token).Should().Be(new TwoFactorAttemptResult(true, 4));
        manager.RecordAttempt(token).Should().Be(new TwoFactorAttemptResult(true, 3));
        manager.RecordAttempt(token).Should().Be(new TwoFactorAttemptResult(true, 2));
        manager.RecordAttempt(token).Should().Be(new TwoFactorAttemptResult(true, 1));
        manager.RecordAttempt(token).Should().Be(new TwoFactorAttemptResult(false, 0));
        manager.Get(token).Should().BeNull();
        manager.Consume(token).Should().BeFalse();
    }

    [Fact]
    public async Task ChallengeVerification_RejectsAndConsumesChallengeWhenUserChangesTenant()
    {
        var (email, code) = await CreateTwoFactorUserAsync();
        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var challengeToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("two_factor_token")
            .GetString()!;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var changed = await db.Users
                .IgnoreQueryFilters()
                .Where(candidate => candidate.Id == _createdUserId!.Value)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(candidate => candidate.TenantId, TestData.Tenant2.Id));
            changed.Should().Be(1);
        }

        var verify = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challengeToken,
            code
        });

        verify.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        verify.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        var payload = await verify.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("success").GetBoolean().Should().BeFalse();
        payload.GetProperty("code").GetString().Should().Be("AUTH_2FA_TOKEN_EXPIRED");
        payload.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("AUTH_2FA_TOKEN_EXPIRED");
        payload.TryGetProperty("access_token", out _).Should().BeFalse();

        Factory.Services.GetRequiredService<TwoFactorChallengeManager>()
            .Get(challengeToken)
            .Should().BeNull();

        using var verificationScope = Factory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verificationDb.RefreshTokens
            .IgnoreQueryFilters()
            .CountAsync(token => token.UserId == _createdUserId!.Value))
            .Should().Be(0);
    }

    [Fact]
    public async Task ChallengeVerification_RejectsAndConsumesChallengeWhenTwoFactorEnrollmentChanges()
    {
        var (email, code) = await CreateTwoFactorUserAsync();
        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var challengeToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("two_factor_token")
            .GetString()!;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users
                .IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.Id == _createdUserId!.Value);
            user.TwoFactorEnabled = false;
            user.TwoFactorEnabledAt = null;
            await db.SaveChangesAsync();
        }

        var verify = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challengeToken,
            code
        });

        verify.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var payload = await verify.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("code").GetString().Should().Be("AUTH_2FA_TOKEN_EXPIRED");
        payload.TryGetProperty("access_token", out _).Should().BeFalse();
        Factory.Services.GetRequiredService<TwoFactorChallengeManager>()
            .Get(challengeToken)
            .Should().BeNull();
    }

    [Fact]
    public async Task ChallengeVerification_RechecksAccountGatesBeforeIssuingTokens()
    {
        var (email, code) = await CreateTwoFactorUserAsync();
        var login = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug
        });
        var challenge = (await login.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("two_factor_token")
            .GetString()!;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = await db.Users.IgnoreQueryFilters().SingleAsync(candidate => candidate.Id == _createdUserId!.Value);
            user.SuspendedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var verify = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challenge,
            code
        });

        verify.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var payload = await verify.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("code").GetString().Should().Be("AUTH_ACCOUNT_SUSPENDED");
        payload.TryGetProperty("access_token", out _).Should().BeFalse();

        var replay = await Client.PostAsJsonAsync("/api/totp/verify", new
        {
            two_factor_token = challenge,
            code
        });
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    private async Task<(string Email, string Code)> CreateTwoFactorUserAsync()
    {
        var email = $"two-factor-parity-{Guid.NewGuid():N}@test.local";
        string secret;
        int userId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var user = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Two",
                LastName = "Factor",
                Role = "member",
                IsAdmin = false,
                IsSuperAdmin = true,
                IsTenantSuperAdmin = false,
                IsGod = false,
                IsActive = true,
                RegistrationStatus = RegistrationStatus.Active,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            userId = user.Id;
            _createdUserId = userId;

            var totp = scope.ServiceProvider.GetRequiredService<TotpService>();
            var setup = await totp.GenerateSetupAsync(userId);
            setup.Error.Should().BeNull();
            secret = setup.Secret;
            var initialCode = new Totp(Base32Encoding.ToBytes(secret), step: 30, totpSize: 6).ComputeTotp();
            var enabled = await totp.VerifyAndEnableAsync(userId, TestData.Tenant1.Id, initialCode);
            enabled.Success.Should().BeTrue(enabled.Error);
        }

        var code = new Totp(Base32Encoding.ToBytes(secret), step: 30, totpSize: 6).ComputeTotp();
        return (email, code);
    }
}
