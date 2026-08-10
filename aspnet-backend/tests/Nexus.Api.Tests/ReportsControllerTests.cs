// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Integration tests for Content Reporting and Moderation endpoints.
/// </summary>
[Collection("Integration")]
public class ReportsControllerTests : IntegrationTestBase
{
    public ReportsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task FileReport_ValidContent_Succeeds()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/reports", new
        {
            content_type = "listing",
            content_id = TestData.Listing1.Id,
            reason = 2, // ReportReason.Inappropriate
            description = "This listing contains inappropriate content"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetMyReports_Authenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/reports/my");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetMyWarnings_Authenticated_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/reports/warnings");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminListReports_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/reports");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task AdminListReports_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/admin/reports");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminGetReportStats_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/admin/reports/stats");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task FileReport_Unauthenticated_Returns401()
    {
        ClearAuthToken();

        var response = await Client.PostAsJsonAsync("/api/reports", new
        {
            content_type = "listing",
            content_id = 1,
            reason = "test"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
