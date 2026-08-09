// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class SemanticSearchControllerTests : IntegrationTestBase
{
    public SemanticSearchControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Search_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/search/semantic?q=test");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Search_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/search/semantic?q=test");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Search_ShortQuery_ReturnsBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/search/semantic?q=t");
        r.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetStatus_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/search/semantic/status");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
