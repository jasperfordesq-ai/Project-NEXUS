// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminApiPartnersTests : IntegrationTestBase
{
    public AdminApiPartnersTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string Path = "/api/admin/api-partners";

    private static object SampleRegister(string name = "Acme Partner") => new
    {
        name,
        contact_email = "ops@acmepartner.test",
        description = "Test partner",
        scopes = "read,write",
        is_sandbox = true,
        rate_limit_per_minute = 120
    };

    [Theory]
    [InlineData("anonymous", (int)HttpStatusCode.Unauthorized)]
    [InlineData("member", (int)HttpStatusCode.Forbidden)]
    [InlineData("admin", 200)]
    public async Task AdminListAuthGate(string role, int expectedStatus)
    {
        if (role == "anonymous") ClearAuthToken();
        else
        {
            var email = role == "admin" ? "admin@test.com" : "member@test.com";
            SetAuthToken(await GetAccessTokenAsync(email, "test-tenant"));
        }
        var resp = await Client.GetAsync(Path);
        ((int)resp.StatusCode).Should().Be(expectedStatus);
    }

    [Fact]
    public async Task AdminListEmpty_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var resp = await Client.GetAsync(Path);
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("data").EnumerateArray().Count().Should().Be(0);
    }

    [Fact]
    public async Task Register_ReturnsPlaintextKeyOnlyOnce()
    {
        await AuthenticateAsAdminAsync();
        var resp = await Client.PostAsJsonAsync(Path, SampleRegister());
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var plaintext = body.GetProperty("api_key").GetString();
        plaintext.Should().NotBeNullOrEmpty();
        plaintext!.Should().StartWith("nxp_");
        var id = body.GetProperty("id").GetGuid();
        body.GetProperty("partner").GetProperty("status").GetString().Should().Be("pending");

        // Subsequent GET should not include api_key
        var getResp = await Client.GetAsync($"{Path}/{id}");
        getResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var getBody = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        getBody.TryGetProperty("api_key", out _).Should().BeFalse();
        // Prefix should be present for display
        getBody.GetProperty("api_key_prefix").GetString().Should().NotBeNullOrEmpty();
        getBody.GetProperty("status").GetString().Should().Be("pending");
    }

    [Fact]
    public async Task PendingPartner_CannotIssueToken_UntilAdminActivates()
    {
        await AuthenticateAsAdminAsync();
        var registration = await Client.PostAsJsonAsync(Path, SampleRegister("PendingActivationTest"));
        registration.StatusCode.Should().Be(HttpStatusCode.Created);
        var registered = await registration.Content.ReadFromJsonAsync<JsonElement>();
        var id = registered.GetProperty("id").GetGuid();
        var secret = registered.GetProperty("api_key").GetString()!;

        ClearAuthToken();
        var denied = await Client.PostAsJsonAsync("/api/partner/v1/oauth/token", new
        {
            grant_type = "client_credentials",
            client_id = id,
            client_secret = secret,
            scope = "read"
        });
        denied.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await denied.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")[0]
            .GetProperty("code")
            .GetString()
            .Should().Be("invalid_client");

        await AuthenticateAsAdminAsync();
        var activate = await Client.PostAsync($"{Path}/{id}/activate", null);
        activate.StatusCode.Should().Be(HttpStatusCode.OK);
        (await activate.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("status")
            .GetString()
            .Should().Be("active");

        ClearAuthToken();
        var issued = await Client.PostAsJsonAsync("/api/partner/v1/oauth/token", new
        {
            grant_type = "client_credentials",
            client_id = id,
            client_secret = secret,
            scope = "read"
        });
        issued.StatusCode.Should().Be(HttpStatusCode.OK);
        (await issued.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("access_token")
            .GetString()
            .Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task RotateKey_InvalidatesOldKeyByHashCompare()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync(Path, SampleRegister("RotateTest"));
        var bodyA = await r.Content.ReadFromJsonAsync<JsonElement>();
        var id = bodyA.GetProperty("id").GetGuid();
        var oldKey = bodyA.GetProperty("api_key").GetString()!;
        var oldPrefix = bodyA.GetProperty("partner").GetProperty("api_key_prefix").GetString();

        var rot = await Client.PostAsync($"{Path}/{id}/rotate-key", null);
        rot.StatusCode.Should().Be(HttpStatusCode.OK);
        var bodyB = await rot.Content.ReadFromJsonAsync<JsonElement>();
        var newKey = bodyB.GetProperty("api_key").GetString()!;
        var newPrefix = bodyB.GetProperty("partner").GetProperty("api_key_prefix").GetString();

        newKey.Should().NotBe(oldKey);
        newPrefix.Should().NotBe(oldPrefix);
    }

    [Fact]
    public async Task SuspendReactivate_StateTransitions()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync(Path, SampleRegister("SuspendTest"));
        var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var susp = await Client.PostAsync($"{Path}/{id}/suspend", null);
        susp.StatusCode.Should().Be(HttpStatusCode.OK);
        (await susp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString().Should().Be("suspended");

        var reac = await Client.PostAsync($"{Path}/{id}/reactivate", null);
        reac.StatusCode.Should().Be(HttpStatusCode.OK);
        (await reac.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString().Should().Be("active");
    }

    [Fact]
    public async Task Revoke_IsTerminal()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync(Path, SampleRegister("RevokeTest"));
        var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var rev = await Client.PostAsJsonAsync($"{Path}/{id}/revoke", new { reason = "no longer needed" });
        rev.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await rev.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("status").GetString().Should().Be("revoked");
        body.GetProperty("revoked_reason").GetString().Should().Be("no longer needed");

        // Cannot reactivate revoked
        var reac = await Client.PostAsync($"{Path}/{id}/reactivate", null);
        reac.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        // Cannot suspend revoked
        var susp = await Client.PostAsync($"{Path}/{id}/suspend", null);
        susp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Update_EditableFields()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync(Path, SampleRegister("UpdateTest"));
        var id = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        var upd = await Client.PutAsJsonAsync($"{Path}/{id}",
            new { name = "Renamed Partner", rate_limit_per_minute = 300, scopes = "read" });
        upd.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await upd.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("name").GetString().Should().Be("Renamed Partner");
        body.GetProperty("rate_limit_per_minute").GetInt32().Should().Be(300);
        body.GetProperty("scopes").GetString().Should().Be("read");
    }
}
