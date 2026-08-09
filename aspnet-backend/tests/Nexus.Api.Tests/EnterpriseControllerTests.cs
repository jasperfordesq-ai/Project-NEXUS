// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class EnterpriseControllerTests : IntegrationTestBase
{
    public EnterpriseControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetConfig_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/enterprise/config");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetConfig_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/config");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetConfig_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/config");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetDashboard_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/dashboard");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetCompliance_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/compliance");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetGovernance_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/governance");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetSecurityPosture_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/enterprise/security-posture");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
