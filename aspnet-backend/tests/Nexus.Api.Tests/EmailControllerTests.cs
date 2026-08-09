// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class EmailControllerTests : IntegrationTestBase
{
    public EmailControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetDigest_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/email/digest");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetDigest_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/email/digest");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task UpdateDigest_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PutAsJsonAsync("/api/email/digest", new
        {
            frequency = "weekly",
            include_new_listings = true,
            include_exchange_updates = true
        });
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetAdminEmailTemplates_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/admin/email/templates");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetAdminEmailLogs_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/admin/email/logs");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
