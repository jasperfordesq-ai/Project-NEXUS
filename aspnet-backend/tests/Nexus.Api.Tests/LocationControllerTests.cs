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

/// <summary>
/// Integration tests for Location/Geo endpoints.
/// </summary>
[Collection("Integration")]
public class LocationControllerTests : IntegrationTestBase
{
    public LocationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task UpdateMyLocation_ValidCoordinates_Succeeds()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.8969,
            longitude = -8.4863,
            city = "Cork",
            region = "Munster",
            country = "Ireland",
            postal_code = "T12",
            is_public = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("city").GetString().Should().Be("Cork");
        content.GetProperty("country").GetString().Should().Be("Ireland");
        content.GetProperty("is_public").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task GetMyLocation_AfterSetting_ReturnsLocation()
    {
        await AuthenticateAsMemberAsync();

        // Set location first
        await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.8969,
            longitude = -8.4863,
            city = "Cork",
            country = "Ireland"
        });

        // Get it
        var response = await Client.GetAsync("/api/location/me");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("city").GetString().Should().Be("Cork");
    }

    [Fact]
    public async Task GetMyLocation_BeforeSetting_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync(); // Admin hasn't set location

        var response = await Client.GetAsync("/api/location/me");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetNearbyUsers_WithLocation_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        // Set location first
        await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.8969,
            longitude = -8.4863,
            city = "Cork",
            country = "Ireland",
            is_public = true
        });

        var response = await Client.GetAsync("/api/location/nearby/users?latitude=51.89&longitude=-8.48&radius_km=50");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task GetNearbyListings_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/location/nearby/listings?latitude=51.89&longitude=-8.48&radius_km=100");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetDistance_BetweenTwoUsers_ReturnsDistance()
    {
        // Set location for member user
        await AuthenticateAsMemberAsync();
        await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.8969,
            longitude = -8.4863,
            city = "Cork",
            country = "Ireland"
        });

        // Set location for admin user
        await AuthenticateAsAdminAsync();
        await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 53.3498,
            longitude = -6.2603,
            city = "Dublin",
            country = "Ireland"
        });

        // Calculate distance from admin to member
        var response = await Client.GetAsync($"/api/location/distance/{TestData.MemberUser.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("distance_km").GetDouble().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task Geocode_KnownTenantLocation_ReturnsCoordinates()
    {
        await AuthenticateAsMemberAsync();
        await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.8969,
            longitude = -8.4863,
            city = "Cork",
            region = "Munster",
            country = "Ireland",
            is_public = true
        });

        var response = await Client.GetAsync("/api/location/geocode?address=Cork");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("latitude").GetDouble().Should().BeApproximately(51.8969, 0.0001);
        content.GetProperty("source").GetString().Should().Be("tenant_locations");
    }

    [Fact]
    public async Task UpdateLocation_Unauthenticated_Returns401()
    {
        ClearAuthToken();

        var response = await Client.PutAsJsonAsync("/api/location/me", new
        {
            latitude = 51.0,
            longitude = -8.0
        });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
