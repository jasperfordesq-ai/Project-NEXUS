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
public class IdeationControllerTests : IntegrationTestBase
{
    public IdeationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Ideas_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/ideas");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Challenges_Unauthenticated_ReturnsUnauthorized()
    {
        var response = await Client.GetAsync("/api/challenges");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListIdeas_AsAuthenticated_DoesNotReturn500()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/ideas");
        ((int)response.StatusCode).Should().BeLessThan(500, "endpoint should not return server error");
    }

    [Fact]
    public async Task ListChallenges_AsAuthenticated_DoesNotReturn500()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/challenges");
        ((int)response.StatusCode).Should().BeLessThan(500, "endpoint should not return server error");
    }
}
