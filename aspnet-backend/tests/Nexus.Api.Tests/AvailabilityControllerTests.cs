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
public class AvailabilityControllerTests : IntegrationTestBase
{
    public AvailabilityControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetSchedule_AsAuthenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/availability");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task AddSlot_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/availability", new
        {
            day_of_week = 1,  // Monday
            start_time = "09:00",
            end_time = "17:00",
            note = "Available all day"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task BulkSetSchedule_ReplacesExisting()
    {
        await AuthenticateAsMemberAsync();
        // Add initial slot
        await Client.PostAsJsonAsync("/api/availability", new { day_of_week = 0, start_time = "10:00", end_time = "12:00" });

        // Bulk replace
        var response = await Client.PutAsJsonAsync("/api/availability/bulk", new
        {
            slots = new[]
            {
                new { day_of_week = 1, start_time = "09:00", end_time = "12:00", note = "Morning" },
                new { day_of_week = 3, start_time = "14:00", end_time = "18:00", note = "Afternoon" }
            }
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task LaravelReactV2AvailabilityGrid_ReturnsWeeklyEnvelopeAndPersistsBulkSlots()
    {
        await AuthenticateAsMemberAsync();

        var update = await Client.PutAsJsonAsync("/api/v2/users/me/availability", new
        {
            slots = new[]
            {
                new { day_of_week = 1, start_time = "09:00", end_time = "12:00", note = (string?)null },
                new { day_of_week = 3, start_time = "14:00", end_time = "18:00", note = (string?)"Afternoons" }
            }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var updateWeekly = updateJson.GetProperty("data").GetProperty("weekly").EnumerateArray().ToArray();
        updateWeekly.Should().HaveCount(2);
        updateWeekly.Should().Contain(slot =>
            slot.GetProperty("day_of_week").GetInt32() == 1 &&
            slot.GetProperty("start_time").GetString() == "09:00" &&
            slot.GetProperty("end_time").GetString() == "12:00");

        var mine = await Client.GetAsync("/api/v2/users/me/availability");

        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        var mineJson = await mine.Content.ReadFromJsonAsync<JsonElement>();
        mineJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var mineWeekly = mineJson.GetProperty("data").GetProperty("weekly").EnumerateArray().ToArray();
        mineWeekly.Should().HaveCount(2);
        mineJson.GetProperty("data").GetProperty("timezone").GetString().Should().NotBeNullOrWhiteSpace();

        var publicView = await Client.GetAsync($"/api/v2/users/{TestData.MemberUser.Id}/availability");

        publicView.StatusCode.Should().Be(HttpStatusCode.OK);
        var publicJson = await publicView.Content.ReadFromJsonAsync<JsonElement>();
        publicJson.GetProperty("success").GetBoolean().Should().BeTrue();
        publicJson.GetProperty("data").GetProperty("weekly").EnumerateArray().Should().HaveCount(2);
    }

    [Fact]
    public async Task AddException_ReturnsCreated()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/availability/exceptions", new
        {
            date = DateTime.UtcNow.AddDays(7).ToString("o"),
            type = "unavailable",
            reason = "Holiday"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task GetExceptions_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/availability/exceptions");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task InvalidDayOfWeek_ReturnsBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/availability", new
        {
            day_of_week = 7,  // Invalid
            start_time = "09:00",
            end_time = "17:00"
        });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
