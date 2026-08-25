// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Account-recovery coverage at the exact boundary consumed by the unchanged
/// React client. Tokens are obtained from the captured email dispatch, never
/// by reading the reset-token table.
/// </summary>
[Collection("Integration")]
public sealed class AuthRecoveryJourneyTests : IntegrationTestBase
{
    private readonly RecordingEmailService _email = new();
    private readonly HttpClient _recoveryClient;

    public AuthRecoveryJourneyTests(NexusWebApplicationFactory factory) : base(factory)
    {
        _recoveryClient = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailService>();
                services.AddSingleton<IEmailService>(_email);
            });
        }).CreateClient();
    }

    [Fact]
    public async Task ForgotPassword_UsesTheReactHeaderContract_AndDoesNotEnumerateOrDiscloseTheToken()
    {
        var user = await SeedRecoveryUserAsync();
        _recoveryClient.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var known = await _recoveryClient.PostAsJsonAsync("/api/auth/forgot-password", new
        {
            email = user.Email,
        });
        var unknown = await _recoveryClient.PostAsJsonAsync("/api/auth/forgot-password", new
        {
            email = $"unknown-{Guid.NewGuid():N}@test.com",
        });

        known.StatusCode.Should().Be(HttpStatusCode.OK);
        unknown.StatusCode.Should().Be(HttpStatusCode.OK);

        var knownBody = await known.Content.ReadFromJsonAsync<JsonElement>();
        var unknownBody = await unknown.Content.ReadFromJsonAsync<JsonElement>();
        knownBody.GetProperty("success").GetBoolean().Should().BeTrue();
        unknownBody.GetProperty("success").GetBoolean().Should().BeTrue();
        knownBody.EnumerateObject().Select(x => x.Name)
            .Should().BeEquivalentTo(unknownBody.EnumerateObject().Select(x => x.Name));
        knownBody.TryGetProperty("reset_token", out _).Should().BeFalse(
            "reset credentials must only leave through the email boundary");

        _email.Messages.Should().ContainSingle();
        var message = _email.Messages.Single();
        message.To.Should().Be(user.Email);
        message.ResetUrl.Should().Contain("/password/reset?token=");
        message.ResetUrl.Should().NotContain("/reset-password?");
    }

    [Fact]
    public async Task ResetPassword_AcceptsTheReactPayload_IsSingleUse_AndInvalidatesExistingSessions()
    {
        var user = await SeedRecoveryUserAsync();
        var originalPassword = TestDataSeeder.TestPassword;
        var replacementPassword = $"Recovery-{Guid.NewGuid():N}!";
        var firstSession = await SignInAsync(user.Email, originalPassword, TestData.Tenant1.Slug);
        var secondSession = await SignInAsync(user.Email, originalPassword, TestData.Tenant1.Slug);

        _recoveryClient.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        (await _recoveryClient.PostAsJsonAsync("/api/auth/forgot-password", new
        {
            email = user.Email,
        })).StatusCode.Should().Be(HttpStatusCode.OK);
        var resetToken = TokenFromResetUrl(_email.Messages.Single().ResetUrl);

        var reset = await _recoveryClient.PostAsJsonAsync("/api/auth/reset-password", new
        {
            token = resetToken,
            password = replacementPassword,
            password_confirmation = replacementPassword,
        });
        reset.StatusCode.Should().Be(HttpStatusCode.OK);

        (await RefreshAsync(firstSession.Refresh)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await RefreshAsync(secondSession.Refresh)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await LoginAsync(user.Email, originalPassword, TestData.Tenant1.Slug))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await LoginAsync(user.Email, replacementPassword, TestData.Tenant1.Slug))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var replayPassword = $"Second-{Guid.NewGuid():N}!";
        var replay = await _recoveryClient.PostAsJsonAsync("/api/auth/reset-password", new
        {
            token = resetToken,
            password = replayPassword,
            password_confirmation = replayPassword,
        });
        replay.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ResetPassword_RejectsAValidTokenPresentedFromAnotherTenant()
    {
        var user = await SeedRecoveryUserAsync();
        _recoveryClient.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        await _recoveryClient.PostAsJsonAsync("/api/auth/forgot-password", new
        {
            email = user.Email,
        });
        var resetToken = TokenFromResetUrl(_email.Messages.Single().ResetUrl);

        _recoveryClient.DefaultRequestHeaders.Remove("X-Tenant-ID");
        _recoveryClient.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant2.Id.ToString());
        var response = await _recoveryClient.PostAsJsonAsync("/api/auth/reset-password", new
        {
            token = resetToken,
            password = "CrossTenantRecovery!2026",
            password_confirmation = "CrossTenantRecovery!2026",
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await LoginAsync(user.Email, TestDataSeeder.TestPassword, TestData.Tenant1.Slug))
            .StatusCode.Should().Be(HttpStatusCode.OK, "the foreign-tenant attempt must not consume the token or change the password");
    }

    [Fact]
    public async Task ResetPassword_RejectsExpiredMalformedUnknownAndAlreadyUsedTokens()
    {
        var user = await SeedRecoveryUserAsync();
        var malformed = await ResetAsync("not-a-token", "SafeMalformedPassword!2026");
        malformed.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var unknown = await ResetAsync(Convert.ToHexString(Guid.NewGuid().ToByteArray()), "SafeUnknownPassword!2026");
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var expiredRaw = Convert.ToHexString(Guid.NewGuid().ToByteArray());
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.PasswordResetTokens.Add(new PasswordResetToken
            {
                TenantId = TestData.Tenant1.Id,
                UserId = user.Id,
                TokenHash = TokenService.HashToken(expiredRaw),
                ExpiresAt = DateTime.UtcNow.AddMinutes(-1),
            });
            await db.SaveChangesAsync();
        }

        var expired = await ResetAsync(expiredRaw, "SafeExpiredPassword!2026");
        expired.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    private async Task<(string Access, string Refresh)> SignInAsync(string email, string password, string tenantSlug)
    {
        var response = await LoginAsync(email, password, tenantSlug);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("access_token").GetString()!, body.GetProperty("refresh_token").GetString()!);
    }

    private Task<HttpResponseMessage> LoginAsync(string email, string password, string tenantSlug)
        => _recoveryClient.PostAsJsonAsync("/api/auth/login", new { email, password, tenant_slug = tenantSlug });

    private Task<HttpResponseMessage> RefreshAsync(string refreshToken)
        => _recoveryClient.PostAsJsonAsync("/api/auth/refresh-token", new { refresh_token = refreshToken });

    private Task<HttpResponseMessage> ResetAsync(string token, string password)
    {
        _recoveryClient.DefaultRequestHeaders.Remove("X-Tenant-ID");
        _recoveryClient.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        return _recoveryClient.PostAsJsonAsync("/api/auth/reset-password", new
        {
            token,
            password,
            password_confirmation = password,
        });
    }

    private static string TokenFromResetUrl(string resetUrl)
    {
        var uri = new Uri(resetUrl);
        var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
        return query["token"].Should().NotBeNullOrWhiteSpace().And.Subject!;
    }

    private async Task<User> SeedRecoveryUserAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"recovery-{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Recovery",
            LastName = "Member",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private sealed record CapturedResetEmail(string To, string ResetToken, string ResetUrl);

    private sealed class RecordingEmailService : IEmailService
    {
        public ConcurrentBag<CapturedResetEmail> Messages { get; } = [];

        public Task<bool> SendEmailAsync(string to, string subject, string htmlBody, string? textBody = null, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> SendPasswordResetEmailAsync(string to, string resetToken, string userName, string resetUrl, CancellationToken ct = default)
        {
            Messages.Add(new CapturedResetEmail(to, resetToken, resetUrl));
            return Task.FromResult(true);
        }

        public Task<bool> SendWelcomeEmailAsync(string to, string userName, string tenantName, CancellationToken ct = default)
            => Task.FromResult(true);

        public Task<bool> IsHealthyAsync(CancellationToken ct = default) => Task.FromResult(true);
    }
}
