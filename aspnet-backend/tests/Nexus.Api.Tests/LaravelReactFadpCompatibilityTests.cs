// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class LaravelReactFadpCompatibilityTests : IntegrationTestBase
{
    public LaravelReactFadpCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task FadpConsentV2_RecordsLaravelReactActionAndHistoryShape()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/me/fadp/consent", new
        {
            consent_type = "profiling",
            action = "withdrawn"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data");
        data.GetProperty("recorded").GetBoolean().Should().BeTrue();
        data.GetProperty("consent_type").GetString().Should().Be("profiling");
        data.GetProperty("action").GetString().Should().Be("withdrawn");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var record = await db.ConsentRecords
            .IgnoreQueryFilters()
            .SingleAsync(r =>
                r.TenantId == TestData.Tenant1.Id &&
                r.UserId == TestData.MemberUser.Id &&
                r.ConsentType == "profiling");

        record.IsGranted.Should().BeFalse();
        record.GrantedAt.Should().BeNull();
        record.RevokedAt.Should().NotBeNull();

        var historyResponse = await Client.GetAsync("/api/v2/me/fadp/consent-history");

        historyResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var historyJson = await historyResponse.Content.ReadFromJsonAsync<JsonElement>();
        var history = historyJson.GetProperty("data");
        history.ValueKind.Should().Be(JsonValueKind.Array);
        history.EnumerateArray().Should().Contain(item =>
            item.GetProperty("consent_type").GetString() == "profiling" &&
            item.GetProperty("action").GetString() == "withdrawn");
    }
}
