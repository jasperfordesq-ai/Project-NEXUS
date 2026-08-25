// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Runtime continuity at the exact refresh boundary used by the unchanged
/// React client. This deliberately waits for a genuinely expired JWT; deleting
/// an access token or manufacturing a 401 is not evidence of expiry recovery.
/// </summary>
[Collection("Integration")]
public sealed class AuthRefreshContinuityTests : IntegrationTestBase
{
    private readonly HttpClient _shortLivedClient;

    public AuthRefreshContinuityTests(NexusWebApplicationFactory factory) : base(factory)
    {
        _shortLivedClient = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["Jwt:TestAccessTokenExpirySeconds"] = "1",
                    ["Jwt:TestClockSkewSeconds"] = "0",
                }));
        }).CreateClient();
    }

    [Fact]
    public async Task ExpiredAccessToken_IsRejected_AndExactReactRefreshPathRotatesBothCredentials()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
                .Get(JwtBearerDefaults.AuthenticationScheme)
                .TokenValidationParameters.ClockSkew.Should().Be(TimeSpan.Zero);
        }
        var initial = await LoginAsync(_shortLivedClient);
        var initialClaims = ReadClaims(initial.Access);
        initial.ExpiresIn.Should().Be(1);

        var validTo = new JwtSecurityTokenHandler().ReadJwtToken(initial.Access).ValidTo;
        var waitForExpiry = validTo - DateTime.UtcNow + TimeSpan.FromSeconds(2);
        if (waitForExpiry > TimeSpan.Zero)
            await Task.Delay(waitForExpiry);
        (await GetMeAsync(_shortLivedClient, initial.Access)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var refreshed = await RefreshAsync(_shortLivedClient, initial.Refresh, TestData.Tenant1.Id);
        refreshed.Response.StatusCode.Should().Be(HttpStatusCode.OK);
        refreshed.Access.Should().NotBe(initial.Access);
        refreshed.Refresh.Should().NotBe(initial.Refresh);
        var successorClaims = ReadClaims(refreshed.Access!);
        successorClaims.Subject.Should().Be(initialClaims.Subject);
        successorClaims.TenantId.Should().Be(initialClaims.TenantId);
        (await GetMeAsync(_shortLivedClient, refreshed.Access!)).StatusCode.Should().Be(HttpStatusCode.OK);

        var superseded = await RefreshAsync(_shortLivedClient, initial.Refresh, TestData.Tenant1.Id);
        superseded.Response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await superseded.Response.Content.ReadAsStringAsync()).Should().Contain("AUTH_REFRESH_SUPERSEDED");
    }

    [Fact]
    public async Task RefreshToken_CannotCrossTenant_AndFailedAttemptDoesNotConsumeIt()
    {
        var initial = await LoginAsync(_shortLivedClient);

        var foreign = await RefreshAsync(_shortLivedClient, initial.Refresh, TestData.Tenant2.Id);
        foreign.Response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized);

        var correct = await RefreshAsync(_shortLivedClient, initial.Refresh, TestData.Tenant1.Id);
        correct.Response.StatusCode.Should().Be(HttpStatusCode.OK,
            "a foreign-tenant presentation must not mutate the valid tenant-bound credential");
    }

    [Fact]
    public async Task ConcurrentRefresh_AllowsExactlyOneRotation_AndPreservesTheWinner()
    {
        var initial = await LoginAsync(_shortLivedClient);
        using var contender = Factory.CreateClient();

        var attempts = await Task.WhenAll(
            RefreshAsync(_shortLivedClient, initial.Refresh, TestData.Tenant1.Id),
            RefreshAsync(contender, initial.Refresh, TestData.Tenant1.Id));

        attempts.Count(x => x.Response.StatusCode == HttpStatusCode.OK).Should().Be(1);
        attempts.Count(x => x.Response.StatusCode == HttpStatusCode.Conflict).Should().Be(1);
        var winner = attempts.Single(x => x.Response.StatusCode == HttpStatusCode.OK);

        var successor = await RefreshAsync(_shortLivedClient, winner.Refresh!, TestData.Tenant1.Id);
        successor.Response.StatusCode.Should().Be(HttpStatusCode.OK,
            "the losing concurrent request must not revoke or overwrite the winner's successor");
    }

    [Fact]
    public async Task Logout_RevokesCurrentDeviceCredential_ButLeavesAnotherDeviceUsable()
    {
        var first = await LoginAsync(_shortLivedClient);
        var second = await LoginAsync(_shortLivedClient);
        using var logout = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout")
        {
            Content = JsonContent.Create(new { refresh_token = first.Refresh }),
        };
        logout.Headers.Authorization = new AuthenticationHeaderValue("Bearer", first.Access);
        logout.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        (await _shortLivedClient.SendAsync(logout)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await RefreshAsync(_shortLivedClient, second.Refresh, TestData.Tenant1.Id)).Response.StatusCode
            .Should().Be(HttpStatusCode.OK);
        (await RefreshAsync(_shortLivedClient, first.Refresh, TestData.Tenant1.Id)).Response.StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
    }

    private static async Task<SessionEnvelope> LoginAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "member@test.com",
            password = TestDataSeeder.TestPassword,
            tenant_slug = "test-tenant",
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new SessionEnvelope(
            body.GetProperty("access_token").GetString()!,
            body.GetProperty("refresh_token").GetString()!,
            body.GetProperty("expires_in").GetInt32());
    }

    private static async Task<RefreshResult> RefreshAsync(HttpClient client, string refreshToken, int tenantId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh-token")
        {
            Content = JsonContent.Create(new { refresh_token = refreshToken }),
        };
        request.Headers.Add("X-Tenant-ID", tenantId.ToString());
        var response = await client.SendAsync(request);
        if (response.StatusCode != HttpStatusCode.OK)
            return new RefreshResult(response, null, null);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return new RefreshResult(
            response,
            body.GetProperty("access_token").GetString(),
            body.GetProperty("refresh_token").GetString());
    }

    private static Task<HttpResponseMessage> GetMeAsync(HttpClient client, string accessToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v2/users/me");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.Add("X-Tenant-ID", "1");
        return client.SendAsync(request);
    }

    private static (string Subject, string TenantId) ReadClaims(string token)
    {
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);
        return (
            jwt.Claims.Single(x => x.Type == JwtRegisteredClaimNames.Sub).Value,
            jwt.Claims.Single(x => x.Type == "tenant_id").Value);
    }

    private sealed record SessionEnvelope(string Access, string Refresh, int ExpiresIn);
    private sealed record RefreshResult(HttpResponseMessage Response, string? Access, string? Refresh);
}
