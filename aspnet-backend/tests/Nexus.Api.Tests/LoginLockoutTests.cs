// Copyright © 2024–2026 Jasper Ford
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
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Per-account sign-in lockout.
///
/// 🔴 This backend had only a per-IP request limiter, so credential stuffing
/// spread across many addresses could grind at one account without ever
/// tripping a limit. Laravel counts failures per EMAIL as well
/// (App\Core\RateLimiter: 10 failures in a 300s window, 300s lockout, checked
/// before the password is verified).
/// </summary>
[Collection("Integration")]
public sealed class LoginLockoutTests : IntegrationTestBase
{
    public LoginLockoutTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task ClearAttemptsAsync(string email)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var key = email.ToLowerInvariant();
        await db.Set<LoginAttempt>().Where(a => a.Identifier == key).ExecuteDeleteAsync();
    }

    private async Task<HttpResponseMessage> AttemptAsync(HttpClient client, string email, string password)
        => await client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password,
            tenant_slug = TestData.Tenant1.Slug,
        });

    [Fact]
    public async Task RepeatedWrongPasswords_LockTheAccount_AndTheCorrectPasswordIsThenAlsoRefused()
    {
        var email = "admin@test.com";
        await ClearAttemptsAsync(email);
        var client = Factory.CreateClient();

        // Laravel's threshold is 10 failures inside the window.
        for (var i = 0; i < LoginThrottleService.MaxAttempts; i++)
        {
            var attempt = await AttemptAsync(client, email, "definitely-not-the-password");
            attempt.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
                "each wrong password is a normal rejection until the limit is reached");
        }

        var locked = await AttemptAsync(client, email, TestDataSeeder.TestPassword);

        locked.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the account must lock even for the CORRECT password once the limit is hit — "
            + "otherwise the lockout protects nothing");
        var body = await locked.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
        body.GetProperty("retry_after").GetInt32().Should().BeGreaterThan(0);
        locked.Headers.Contains("Retry-After").Should().BeTrue();

        await ClearAttemptsAsync(email);
    }

    [Fact]
    public async Task ASuccessfulSignIn_ClearsTheFailureHistory()
    {
        var email = "admin@test.com";
        await ClearAttemptsAsync(email);
        var client = Factory.CreateClient();

        // A few fat-finger attempts, then the real password.
        for (var i = 0; i < 3; i++)
        {
            await AttemptAsync(client, email, "wrong-password");
        }
        var success = await AttemptAsync(client, email, TestDataSeeder.TestPassword);
        success.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var remaining = await db.Set<LoginAttempt>().AsNoTracking()
            .CountAsync(a => a.Identifier == email.ToLowerInvariant());

        remaining.Should().Be(0,
            "a member who mistypes and then gets in must not be left near a lockout");
    }

    [Fact]
    public async Task AWrongPasswordIsRecorded_SoTheCounterIsRealAndNotAdvisory()
    {
        var email = "admin@test.com";
        await ClearAttemptsAsync(email);
        var client = Factory.CreateClient();

        await AttemptAsync(client, email, "wrong-password");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var recorded = await db.Set<LoginAttempt>().AsNoTracking()
            .CountAsync(a => a.Identifier == email.ToLowerInvariant() && !a.Succeeded);

        recorded.Should().BeGreaterThan(0);
        await ClearAttemptsAsync(email);
    }
}
