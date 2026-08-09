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
public class SecretsControllerTests : IntegrationTestBase
{
    public SecretsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task AllEndpoints_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r1 = await Client.GetAsync("/api/admin/secrets");
        var r2 = await Client.GetAsync("/api/admin/secrets/my-key");
        var r3 = await Client.PutAsJsonAsync("/api/admin/secrets/my-key", new { value = "v" });
        var r4 = await Client.DeleteAsync("/api/admin/secrets/my-key");
        var r5 = await Client.PostAsJsonAsync("/api/admin/secrets/my-key/rotate", new { });
        r1.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        r2.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        r3.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        r4.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        r5.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task AllEndpoints_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r1 = await Client.GetAsync("/api/admin/secrets");
        var r2 = await Client.GetAsync("/api/admin/secrets/my-key");
        var r3 = await Client.PutAsJsonAsync("/api/admin/secrets/my-key", new { value = "v" });
        var r4 = await Client.DeleteAsync("/api/admin/secrets/my-key");
        r1.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        r2.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        r3.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        r4.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ListSecrets_AsAdmin_ReturnsOkWithKeysArray()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/secrets");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        body.GetProperty("count").GetInt32().Should().BeGreaterThanOrEqualTo(0);
        body.GetProperty("keys").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task SetAndGetSecret_RoundTrips()
    {
        await AuthenticateAsAdminAsync();
        var key = "test-key-" + Guid.NewGuid().ToString("N");
        var putResponse = await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "super-secret-value", description = "Test secret" });
        putResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var getResponse = await Client.GetAsync("/api/admin/secrets/" + key);
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var getBody = await getResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        getBody.GetProperty("value").GetString().Should().Be("super-secret-value");
    }

    [Fact]
    public async Task GetSecret_NotFound_Returns404()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/admin/secrets/definitely-does-not-exist-xyz");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task SetSecret_MissingValue_ReturnsBadRequest()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync("/api/admin/secrets/my-key", new { description = "no value" });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task SetSecret_Upserts_ExistingKey()
    {
        await AuthenticateAsAdminAsync();
        var key = "upsert-key-" + Guid.NewGuid().ToString("N");
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "v1" });
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "v2" });
        var body = await (await Client.GetAsync("/api/admin/secrets/" + key)).Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        body.GetProperty("value").GetString().Should().Be("v2");
    }

    [Fact]
    public async Task ListSecrets_AfterSet_IncludesKey()
    {
        await AuthenticateAsAdminAsync();
        var key = "list-key-" + Guid.NewGuid().ToString("N");
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "val" });
        var body = await (await Client.GetAsync("/api/admin/secrets")).Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        var keys = body.GetProperty("keys").EnumerateArray().Select(k => k.GetString()).ToList();
        keys.Should().Contain(key);
    }

    [Fact]
    public async Task DeleteSecret_Returns204_AndKeyIsGone()
    {
        await AuthenticateAsAdminAsync();
        var key = "del-key-" + Guid.NewGuid().ToString("N");
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "to-delete" });
        (await Client.DeleteAsync("/api/admin/secrets/" + key)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await Client.GetAsync("/api/admin/secrets/" + key)).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteSecret_NotFound_Returns404()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.DeleteAsync("/api/admin/secrets/non-existent-xyz-123");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RotateSecret_ReturnsNewValue_DifferentFromOriginal()
    {
        await AuthenticateAsAdminAsync();
        var key = "rotate-key-" + Guid.NewGuid().ToString("N");
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "original-value" });
        var rotateResponse = await Client.PostAsJsonAsync("/api/admin/secrets/" + key + "/rotate", new { });
        rotateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await rotateResponse.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        body.GetProperty("key").GetString().Should().Be(key);
        var newValue = body.GetProperty("newValue").GetString();
        newValue.Should().NotBeNullOrEmpty();
        newValue.Should().NotBe("original-value");
    }

    [Fact]
    public async Task RotateSecret_NotFound_Returns404()
    {
        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync("/api/admin/secrets/no-such-key-xyz/rotate", new { });
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetSecret_OtherTenantMember_CannotAccess()
    {
        await AuthenticateAsAdminAsync();
        var key = "isolated-" + Guid.NewGuid().ToString("N");
        await Client.PutAsJsonAsync("/api/admin/secrets/" + key, new { value = "tenant-a-secret" });
        var otherToken = await GetAccessTokenAsync("other@test.com", "other-tenant");
        SetAuthToken(otherToken);
        (await Client.GetAsync("/api/admin/secrets/" + key)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}