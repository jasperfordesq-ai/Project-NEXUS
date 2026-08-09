// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactExportCompatibilityTests : IntegrationTestBase
{
    public LaravelReactExportCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Theory]
    [InlineData("/api/v2/admin/reports/municipal_impact/export?format=csv")]
    [InlineData("/api/v2/admin/reports/hours_category/export?format=csv")]
    [InlineData("/api/v2/admin/reports/inactive/export?format=csv")]
    [InlineData("/api/v2/admin/reports/members/export?format=csv")]
    [InlineData("/api/v2/admin/reports/social_value/export?format=csv")]
    public async Task AdminReportExportAliases_ReturnDownloadableCsv(string path)
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
        response.Content.Headers.ContentDisposition?.FileName.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task PollExportV2Alias_ReturnsDownloadableCsv()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/polls", new
        {
            title = "Export compatibility poll",
            poll_type = "single",
            options = new[] { "Yes", "No" }
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var poll = await create.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var pollId = poll.GetProperty("id").GetInt32();

        var response = await Client.GetAsync($"/api/v2/polls/{pollId}/export");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
    }

    [Fact]
    public async Task MemberDataExportV2Alias_ReturnsLaravelReactDownloadAndHistoryShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/me/data-export", new { format = "json" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/json");
        response.Content.Headers.ContentDisposition?.DispositionType.Should().Be("attachment");
        response.Content.Headers.ContentDisposition?.FileName.Should().Be("personal-data.json");
        response.Headers.TryGetValues("X-Export-Id", out var exportIds).Should().BeTrue();
        var exportId = exportIds!.Single();
        exportId.Should().NotBeNullOrWhiteSpace();

        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain(TestData.MemberUser.Email);

        var history = await Client.GetAsync("/api/v2/me/data-export/history");

        history.StatusCode.Should().Be(HttpStatusCode.OK);
        var historyJson = await history.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var exports = historyJson.GetProperty("data").GetProperty("exports");
        exports.ValueKind.Should().Be(System.Text.Json.JsonValueKind.Array);
        exports.GetArrayLength().Should().BeGreaterThanOrEqualTo(1);
        exports.EnumerateArray().Should().Contain(item =>
            item.GetProperty("id").GetInt32().ToString() == exportId &&
            item.GetProperty("format").GetString() == "json" &&
            item.GetProperty("status").GetString() == "ready");
    }
}
