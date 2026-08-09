// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class PagesControllerTests : IntegrationTestBase
{
    public PagesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetPages_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/pages");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetPages_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/pages");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetMenu_Anonymous_ReturnsOkOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/pages/menu");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetMenu_WithLocation_ReturnsOkOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/pages/menu?location=header");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPageBySlug_Anonymous_ReturnsOkOrNotFoundOrBadRequest()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/pages/non-existent-page-xyz");
        // TenantResolutionMiddleware returns 400 for anonymous requests without tenant context
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }
}
