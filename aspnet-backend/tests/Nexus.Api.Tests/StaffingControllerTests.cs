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
/// Integration tests for Predictive Staffing endpoints.
/// </summary>
[Collection("Integration")]
public class StaffingControllerTests : IntegrationTestBase
{
    public StaffingControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetMyAvailability_Authenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/volunteering/availability/my");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UpdateAvailability_ValidData_Succeeds()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PutAsJsonAsync("/api/volunteering/availability", new
        {
            day_of_week = 1, // Monday
            start_time = "09:00",
            end_time = "17:00",
            is_available = true
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetPredictions_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/staffing/predictions");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetAvailableVolunteers_ReturnsOkOrEmpty()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/staffing/available?date=2026-06-15T00:00:00Z");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetDashboard_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/staffing/dashboard");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetPatterns_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/staffing/patterns");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetDashboard_Unauthenticated_Returns401()
    {
        ClearAuthToken();

        var response = await Client.GetAsync("/api/admin/staffing/dashboard");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
