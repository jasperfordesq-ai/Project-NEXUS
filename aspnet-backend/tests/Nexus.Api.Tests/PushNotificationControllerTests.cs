// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class PushNotificationControllerTests : IntegrationTestBase
{
    public PushNotificationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task RegisterDevice_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.PostAsJsonAsync("/api/notifications/push/register", new
        {
            device_token = "test-token",
            platform = "ios"
        });
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetDevices_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/notifications/push/devices");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetPreferences_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/notifications/preferences");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task RegisterDevice_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/notifications/push/register", new
        {
            device_token = "test-device-token-123",
            platform = "android"
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task RegisterDevice_LegacyAlias_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var r = await Client.PostAsJsonAsync("/api/push/register-device", new
        {
            device_token = "legacy-device-token-123",
            platform = "web",
            device_name = "Test Browser"
        });

        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
