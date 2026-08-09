// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminEmailControllerTests : IntegrationTestBase
{
    public AdminEmailControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetTemplates_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/admin/emails/templates");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetTemplates_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/emails/templates");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetTemplates_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/emails/templates");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetTemplate_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/emails/templates/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetEmailLogs_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/emails/logs");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEmailStats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/emails/stats");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateTemplate_AsAdmin_ReturnsOkOrCreated()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/admin/emails/templates", new
        {
            name = "Test Template",
            subject = "Test Subject",
            body_html = "<p>Test body</p>",
            key = "test_template"
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task DeleteTemplate_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/admin/emails/templates/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
