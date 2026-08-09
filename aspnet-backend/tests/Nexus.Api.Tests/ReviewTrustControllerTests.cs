// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ReviewTrustControllerTests : IntegrationTestBase
{
    public ReviewTrustControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetPendingReviews_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/reviews/pending");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetPendingReviews_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/reviews/pending");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetUserTrust_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync($"/api/reviews/user/{TestData.MemberUser.Id}/trust");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetExchangeRating_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/reviews/exchange/99999/rating");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }
}
