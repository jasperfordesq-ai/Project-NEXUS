// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class TenantHierarchyControllerTests : IntegrationTestBase
{
    public TenantHierarchyControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetHierarchy_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/system/tenant-hierarchy");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetHierarchy_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/system/tenant-hierarchy");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetHierarchy_AsAdmin_ReturnsForbidden()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/system/tenant-hierarchy");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetHierarchy_AsPlatformSuperAdmin_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var r = await Client.GetAsync("/api/system/tenant-hierarchy");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetChildren_AsPlatformSuperAdmin_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var r = await Client.GetAsync($"/api/system/tenant-hierarchy/{TestData.Tenant1.Id}/children");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetParent_AsPlatformSuperAdmin_ReturnsOkOrNotFound()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var r = await Client.GetAsync($"/api/system/tenant-hierarchy/{TestData.Tenant1.Id}/parent");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteHierarchy_AsPlatformSuperAdmin_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var r = await Client.DeleteAsync("/api/system/tenant-hierarchy/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
