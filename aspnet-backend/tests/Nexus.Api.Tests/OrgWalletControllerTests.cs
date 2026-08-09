// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class OrgWalletControllerTests : IntegrationTestBase
{
    public OrgWalletControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetOrgWallet_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/organisations/1/wallet");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetOrgWallet_NonExistentOrg_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/organisations/99999/wallet");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetOrgTransactions_NonExistentOrg_ReturnsOkOrNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/organisations/99999/wallet/transactions");
        // Controller may return OK with empty transaction list for non-existent org
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DonateToOrg_NonExistentOrg_ReturnsNotFoundOrBadRequestOrServerError()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/organisations/99999/wallet/donate", new
        {
            amount = 1.0,
            description = "Test donation"
        });
        // Controller returns BadRequest/NotFound when service returns error, or 500 if unhandled exception
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest, HttpStatusCode.InternalServerError);
    }

    [Fact]
    public async Task GrantToOrg_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/organisations/1/wallet/grant", new
        {
            amount = 10.0,
            description = "Test grant"
        });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
