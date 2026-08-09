// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminOrganisationsControllerTests : IntegrationTestBase
{
    public AdminOrganisationsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetOrganisations_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/organisations");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetOrganisations_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/organisations");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetOrganisations_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/organisations");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task VerifyOrganisation_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsync("/api/admin/organisations/99999/verify", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task SuspendOrganisation_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsync("/api/admin/organisations/99999/suspend", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
