// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class PartnerApiSecurityTests : IntegrationTestBase
{
    public PartnerApiSecurityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SandboxPartner_CannotWriteWalletCredits()
    {
        var credentials = await RegisterPartnerAsync(isSandbox: true, rateLimit: 60);
        var token = await IssueTokenAsync(credentials);
        SetPartnerToken(token);

        var response = await Client.PostAsJsonAsync("/api/partner/v1/wallet/credit", new
        {
            user_id = TestData.MemberUser.Id,
            hours = 1m,
            reference = $"sandbox-{Guid.NewGuid():N}"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorCodeAsync(response)).Should().Be("sandbox_write_disabled");
    }

    [Fact]
    public async Task PartnerOutsideIpAllowlist_IsRejected()
    {
        var credentials = await RegisterPartnerAsync(
            isSandbox: false,
            rateLimit: 60,
            allowedIpCidrs: ["203.0.113.0/24"]);
        SetPartnerToken(await IssueTokenAsync(credentials));

        var response = await Client.GetAsync($"/api/partner/v1/wallet/balance/{TestData.MemberUser.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorCodeAsync(response)).Should().Be("ip_not_allowed");
    }

    [Fact]
    public async Task PartnerRateLimit_UsesConfiguredPartnerBudgetAndHeaders()
    {
        var credentials = await RegisterPartnerAsync(isSandbox: false, rateLimit: 2);
        SetPartnerToken(await IssueTokenAsync(credentials));
        var path = $"/api/partner/v1/wallet/balance/{TestData.MemberUser.Id}";

        using var first = await Client.GetAsync(path);
        using var second = await Client.GetAsync(path);
        using var blocked = await Client.GetAsync(path);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        blocked.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        first.Headers.GetValues("X-RateLimit-Limit").Should().ContainSingle().Which.Should().Be("2");
        blocked.Headers.GetValues("X-RateLimit-Remaining").Should().ContainSingle().Which.Should().Be("0");
        blocked.Headers.RetryAfter.Should().NotBeNull();
        (await ErrorCodeAsync(blocked)).Should().Be("rate_limited");
    }

    [Fact]
    public async Task RevokedPartnerToken_CannotReadOrWriteAfterRevocation()
    {
        var credentials = await RegisterPartnerAsync(isSandbox: false, rateLimit: 60);
        var token = await IssueTokenAsync(credentials);
        SetPartnerToken(token);
        var path = $"/api/partner/v1/wallet/balance/{TestData.MemberUser.Id}";
        (await Client.GetAsync(path)).StatusCode.Should().Be(HttpStatusCode.OK);

        var revoke = await Client.PostAsJsonAsync("/api/partner/v1/oauth/revoke", new
        {
            client_id = credentials.ClientId,
            client_secret = credentials.ClientSecret,
            token
        });
        revoke.StatusCode.Should().Be(HttpStatusCode.OK);

        var rejected = await Client.GetAsync(path);
        rejected.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await ErrorCodeAsync(rejected)).Should().Be("invalid_token");
    }

    [Fact]
    public async Task PartnerToken_CannotAccessOrdinaryAuthenticatedRoutes()
    {
        var credentials = await RegisterPartnerAsync(isSandbox: false, rateLimit: 60);
        SetPartnerToken(await IssueTokenAsync(credentials));

        var response = await Client.PostAsJsonAsync("/api/v2/wallet/categories", new
        {
            name = $"Partner bypass {Guid.NewGuid():N}"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ErrorCodeAsync(response)).Should().Be("partner_token_route_forbidden");
    }

    [Fact]
    public async Task PartnerWebhookSubscriptionAliases_Return503InsteadOfFabricatedPersistence()
    {
        var credentials = await RegisterPartnerAsync(
            isSandbox: false,
            rateLimit: 60,
            scopes: "webhooks.manage");
        SetPartnerToken(await IssueTokenAsync(credentials));

        using var list = await Client.GetAsync("/api/partner/v1/webhooks/subscriptions");
        using var create = await Client.PostAsJsonAsync("/api/partner/v1/webhooks/subscriptions", new
        {
            event_types = new[] { "wallet.credited" },
            target_url = "https://partner.example.test/hooks/nexus"
        });

        list.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        create.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await ErrorCodeAsync(list)).Should().Be("webhook_subscriptions_unavailable");
        (await ErrorCodeAsync(create)).Should().Be("webhook_subscriptions_unavailable");
    }

    [Theory]
    [InlineData("/api/v2/federation/ingest/events")]
    [InlineData("/api/v2/federation/ingest/listings")]
    public async Task FederationIngestCompatibilityAliases_Return503InsteadOfFabricatedSuccess(string path)
    {
        await AuthenticateAsAdminAsync();

        using var response = await Client.PostAsJsonAsync(path, new { id = Guid.NewGuid() });

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeFalse();
        json.GetProperty("code").GetString().Should().Be("FEDERATION_WORKFLOW_UNAVAILABLE");
    }

    private async Task<PartnerCredentials> RegisterPartnerAsync(
        bool isSandbox,
        int rateLimit,
        string[]? allowedIpCidrs = null,
        string scopes = "wallet.read wallet.write")
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/api-partners", new
        {
            name = $"Security Partner {Guid.NewGuid():N}",
            contact_email = "security-partner@example.test",
            scopes,
            is_sandbox = isSandbox,
            allowed_ip_cidrs = allowedIpCidrs,
            rate_limit_per_minute = rateLimit
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("partner").GetProperty("status").GetString().Should().Be("pending");
        var partnerId = json.GetProperty("id").GetGuid();
        var activate = await Client.PostAsync($"/api/admin/api-partners/{partnerId}/activate", null);
        activate.StatusCode.Should().Be(HttpStatusCode.OK);
        return new PartnerCredentials(
            partnerId.ToString(),
            json.GetProperty("api_key").GetString()!,
            scopes);
    }

    private async Task<string> IssueTokenAsync(PartnerCredentials credentials)
    {
        ClearAuthToken();
        var response = await Client.PostAsJsonAsync("/api/partner/v1/oauth/token", new
        {
            grant_type = "client_credentials",
            client_id = credentials.ClientId,
            client_secret = credentials.ClientSecret,
            scope = credentials.Scopes
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("access_token")
            .GetString()!;
    }

    private void SetPartnerToken(string token) =>
        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

    private static async Task<string?> ErrorCodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>())
        .GetProperty("errors")[0]
        .GetProperty("code")
        .GetString();

    private sealed record PartnerCredentials(string ClientId, string ClientSecret, string Scopes);
}
