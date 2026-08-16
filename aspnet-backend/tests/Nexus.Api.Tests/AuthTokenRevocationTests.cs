// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Signing a device out, and signing out everywhere.
///
/// 🔴 Both endpoints answered unconditionally — <c>{revoked:true}</c> and
/// <c>{revoked:"all"}</c> — while revoking nothing. "Sign out everywhere" is
/// what a member reaches for when they believe someone else has their account,
/// so reporting success while every session stays live is the worst available
/// answer to the question being asked.
///
/// The assertions deliberately go through the refresh endpoint rather than
/// reading <c>RevokedAt</c>. A revoked row that still buys a new access token
/// is not revoked in any sense the member cares about, and only the round trip
/// proves otherwise.
/// </summary>
[Collection("Integration")]
public sealed class AuthTokenRevocationTests : IntegrationTestBase
{
    public AuthTokenRevocationTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<(string Access, string Refresh)> SignInAsync(string email)
    {
        var response = await Client.PostAsJsonAsync("/api/auth/login", new
        {
            email,
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant",
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK, "the fixture credentials must work");

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (body.GetProperty("access_token").GetString()!,
                body.GetProperty("refresh_token").GetString()!);
    }

    private async Task<string> SeedMemberAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var email = $"revoke-{Guid.NewGuid():N}@test.com";
        db.Users.Add(new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Revoke",
            LastName = "Subject",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return email;
    }

    private void Authenticate(string accessToken)
        => Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

    /// <summary>
    /// The only question that matters: does the token still work?
    ///
    /// 🔴 This CONSUMES the token when it works — /api/auth/refresh rotates,
    /// revoking the presented token and issuing a replacement. So it can be
    /// asked of any one token exactly once, and a "control" check must use a
    /// separate session rather than the one under test.
    /// </summary>
    private async Task<bool> StillUsableAsync(string refreshToken)
    {
        var previous = Client.DefaultRequestHeaders.Authorization;
        Client.DefaultRequestHeaders.Authorization = null;
        var response = await Client.PostAsJsonAsync("/api/auth/refresh", new { refresh_token = refreshToken });
        Client.DefaultRequestHeaders.Authorization = previous;
        return response.StatusCode == HttpStatusCode.OK;
    }

    [Fact]
    public async Task RevokingASession_ActuallyEndsIt()
    {
        var email = await SeedMemberAsync();

        // Control on a SEPARATE session: asking whether a token works spends it.
        var control = await SignInAsync(email);
        (await StillUsableAsync(control.Refresh)).Should().BeTrue(
            "control: a fresh session for this member works, so a later 'false' means the revoke did it");

        var session = await SignInAsync(email);
        Authenticate(session.Access);
        var revoke = await Client.PostAsJsonAsync("/api/auth/revoke", new { refresh_token = session.Refresh });
        revoke.StatusCode.Should().Be(HttpStatusCode.OK);

        (await StillUsableAsync(session.Refresh)).Should().BeFalse(
            "the endpoint said the device was signed out; it must actually be");
    }

    [Fact]
    public async Task RevokingWithoutSayingWhichSession_IsRefused()
    {
        var email = await SeedMemberAsync();
        var session = await SignInAsync(email);
        Authenticate(session.Access);

        (await Client.PostAsJsonAsync("/api/auth/revoke", new { }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await StillUsableAsync(session.Refresh)).Should().BeTrue(
            "a malformed request must not sign anyone out either");
    }

    [Fact]
    public async Task OneMember_CannotRevokeAnothersSession()
    {
        var victimSession = await SignInAsync(await SeedMemberAsync());
        var attackerSession = await SignInAsync(await SeedMemberAsync());

        Authenticate(attackerSession.Access);
        var attempt = await Client.PostAsJsonAsync("/api/auth/revoke",
            new { refresh_token = victimSession.Refresh });

        attempt.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "the revoke is scoped to the caller, and the answer must not reveal that the token is real");
        (await StillUsableAsync(victimSession.Refresh)).Should().BeTrue(
            "signing another member out of their own account is the whole risk here");
    }

    [Fact]
    public async Task SigningOutEverywhere_EndsEverySessionOfMine_AndNobodyElses()
    {
        var email = await SeedMemberAsync();
        var first = await SignInAsync(email);
        var second = await SignInAsync(email);
        var bystander = await SignInAsync(await SeedMemberAsync());

        Authenticate(first.Access);
        var response = await Client.PostAsync("/api/auth/revoke-all", null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        (await StillUsableAsync(first.Refresh)).Should().BeFalse();
        (await StillUsableAsync(second.Refresh)).Should().BeFalse(
            "'everywhere' has to mean the other devices too — that is the entire point");
        (await StillUsableAsync(bystander.Refresh)).Should().BeTrue(
            "and it must stop at this member's own sessions");
    }

    [Fact]
    public async Task SigningOutEverywhereTwice_IsNotAnError()
    {
        var session = await SignInAsync(await SeedMemberAsync());
        Authenticate(session.Access);

        (await Client.PostAsync("/api/auth/revoke-all", null)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsync("/api/auth/revoke-all", null)).StatusCode.Should().Be(HttpStatusCode.OK,
            "a member with nothing left to revoke is already signed out everywhere, which is success");
    }

    [Fact]
    public async Task RevocationIsRecorded_SoWhoSignedOutWhenStaysAnswerable()
    {
        var email = await SeedMemberAsync();
        var session = await SignInAsync(email);
        Authenticate(session.Access);

        await Client.PostAsync("/api/auth/revoke-all", null);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleAsync(u => u.Email == email);
        var tokens = await db.RefreshTokens.IgnoreQueryFilters().AsNoTracking()
            .Where(t => t.UserId == user.Id).ToListAsync();

        tokens.Should().NotBeEmpty();
        tokens.Should().OnlyContain(t => t.RevokedAt != null);
        tokens.Should().OnlyContain(t => t.RevokedReason == "revoke_all",
            "the reason separates a deliberate sign-out from ordinary token rotation");
    }
}
