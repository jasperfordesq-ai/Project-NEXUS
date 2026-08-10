// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class RegistrationPolicyControllerTests : IntegrationTestBase
{
    public RegistrationPolicyControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetConfig_NoAuth_ReturnsOkOrNotFoundOrBadRequest()
    {
        ClearAuthToken();
        // This is a public endpoint but TenantResolutionMiddleware may return 400
        // for anonymous requests without tenant context
        var r = await Client.GetAsync("/api/registration/config");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetAdminPolicy_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/registration/admin/policy");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetAdminPolicy_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/registration/admin/policy");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetAdminPending_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/registration/admin/pending");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetAdminOptions_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/registration/admin/options");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task VerifyStatus_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/registration/verify/status");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task V2RegistrationPolicyAndProviderCredentialRoutes_UseRealLaravelReactContracts()
    {
        await AuthenticateAsAdminAsync();

        var policy = await Client.GetAsync("/api/v2/admin/config/registration-policy");

        policy.StatusCode.Should().Be(HttpStatusCode.OK);
        var policyJson = await policy.Content.ReadFromJsonAsync<JsonElement>();
        policyJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        policyJson.GetProperty("data").GetProperty("registration_mode").GetString().Should().Be("open");

        var providers = await Client.GetAsync("/api/v2/admin/identity/providers");

        providers.StatusCode.Should().Be(HttpStatusCode.OK);
        var providersJson = await providers.Content.ReadFromJsonAsync<JsonElement>();
        providersJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        providersJson.GetProperty("data").EnumerateArray()
            .Select(provider => provider.GetProperty("slug").GetString())
            .Should().Contain(new[] { "mock", "veriff" });

        var save = await Client.PutAsJsonAsync("/api/v2/admin/identity/provider-credentials/veriff", new
        {
            api_key = "veriff-key",
            webhook_secret = "veriff-secret"
        });

        save.StatusCode.Should().Be(HttpStatusCode.OK);
        var saveJson = await save.Content.ReadFromJsonAsync<JsonElement>();
        saveJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        saveJson.GetProperty("data").GetProperty("saved").GetBoolean().Should().BeTrue();
        saveJson.GetProperty("data").GetProperty("provider_slug").GetString().Should().Be("veriff");

        var credentials = await Client.GetAsync("/api/v2/admin/identity/provider-credentials");

        credentials.StatusCode.Should().Be(HttpStatusCode.OK);
        var credentialsJson = await credentials.Content.ReadFromJsonAsync<JsonElement>();
        credentialsJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        credentialsJson.GetProperty("data").EnumerateArray()
            .Should().Contain(item =>
                item.GetProperty("provider_slug").GetString() == "veriff" &&
                item.GetProperty("has_credentials").GetBoolean());

        var delete = await Client.DeleteAsync("/api/v2/admin/identity/provider-credentials/veriff");

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        var deleteJson = await delete.Content.ReadFromJsonAsync<JsonElement>();
        deleteJson.TryGetProperty("compatibility", out _).Should().BeFalse();
        deleteJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleteJson.GetProperty("data").GetProperty("provider_slug").GetString().Should().Be("veriff");
    }
}
