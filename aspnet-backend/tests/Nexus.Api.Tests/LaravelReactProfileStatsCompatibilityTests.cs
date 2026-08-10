// Copyright (c) 2024-2026 Jasper Ford
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
public sealed class LaravelReactProfileStatsCompatibilityTests : IntegrationTestBase
{
    public LaravelReactProfileStatsCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MeStatsV2_ReturnsLaravelReactProfileCardShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/me/stats");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");

        data.GetProperty("listings_count").GetInt32().Should().Be(1);
        data.GetProperty("offers_count").GetInt32().Should().Be(1);
        data.GetProperty("requests_count").GetInt32().Should().Be(0);
        data.GetProperty("given_count").GetDecimal().Should().Be(0m);
        data.GetProperty("received_count").GetDecimal().Should().Be(10.0m);
        data.GetProperty("wallet_balance").GetDecimal().Should().Be(10.0m);
    }
}
