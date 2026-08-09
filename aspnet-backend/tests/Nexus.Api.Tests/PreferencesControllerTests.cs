// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class PreferencesControllerTests : IntegrationTestBase
{
    public PreferencesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetPreferences_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/preferences");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("theme").GetString().Should().NotBeNullOrEmpty();
        content.GetProperty("language").GetString().Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task UpdatePreferences_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync("/api/preferences", new
        {
            theme = "dark",
            language = "fr",
            timezone = "Europe/Paris",
            email_digest_frequency = "daily",
            profile_visibility = "connections"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        var prefs = content.GetProperty("preferences");
        prefs.GetProperty("theme").GetString().Should().Be("dark");
        prefs.GetProperty("language").GetString().Should().Be("fr");
    }

    [Fact]
    public async Task GetPreferences_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/preferences");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
