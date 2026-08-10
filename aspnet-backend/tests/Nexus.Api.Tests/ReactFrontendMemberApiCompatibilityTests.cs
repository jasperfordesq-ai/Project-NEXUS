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
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class ReactFrontendMemberApiCompatibilityTests : IntegrationTestBase
{
    public ReactFrontendMemberApiCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task WalletConfig_ReturnsLaravelReactMaxTransferEnvelope()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "wallet.max_transfer",
                Value = "75"
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/wallet/config");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("success").GetBoolean().Should().BeTrue();
        json.GetProperty("data").GetProperty("max_transfer").GetInt32().Should().Be(75);
    }

    [Fact]
    public async Task NotificationSettings_GlobalDigestUsesLaravelReactContract()
    {
        await AuthenticateAsMemberAsync();

        var initial = await Client.GetAsync("/api/v2/notifications/settings");
        initial.StatusCode.Should().Be(HttpStatusCode.OK);
        var initialJson = await initial.Content.ReadFromJsonAsync<JsonElement>();
        initialJson.GetProperty("data").GetProperty("global_frequency").GetString().Should().Be("off");

        var update = await Client.PostAsJsonAsync("/api/v2/notifications/settings", new
        {
            context_type = "global",
            frequency = "weekly"
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var updateJson = await update.Content.ReadFromJsonAsync<JsonElement>();
        updateJson.GetProperty("success").GetBoolean().Should().BeTrue();

        var reloaded = await Client.GetAsync("/api/v2/notifications/settings");
        var reloadedJson = await reloaded.Content.ReadFromJsonAsync<JsonElement>();
        reloadedJson.GetProperty("data").GetProperty("global_frequency").GetString().Should().Be("monthly");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == TestData.Tenant1.Id
                && c.Key == $"notification_settings.{TestData.MemberUser.Id}.global.0");
        stored.Value.Should().Be("monthly");
    }

    [Fact]
    public async Task SupportReports_CreateReportVisibleToAdminQueue()
    {
        await AuthenticateAsMemberAsync();

        var create = await Client.PostAsJsonAsync("/api/v2/support/reports", new
        {
            summary = "Transfer modal blocks send",
            description = "The Send credits button never returns after submitting a valid transfer.",
            impact = "major",
            route = "/wallet",
            page_url = "https://app.example.test/wallet",
            sentry_event_id = "evt_member_123",
            include_diagnostics = true,
            diagnostics = new
            {
                browser = "chromium",
                authorization = "Bearer secret-token"
            }
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var createJson = await create.Content.ReadFromJsonAsync<JsonElement>();
        var report = createJson.GetProperty("data").GetProperty("report");
        report.GetProperty("reference").GetString().Should().StartWith("NXR-");
        report.GetProperty("status").GetString().Should().Be("open");
        report.GetProperty("impact").GetString().Should().Be("major");
        report.GetProperty("summary").GetString().Should().Be("Transfer modal blocks send");

        await AuthenticateAsAdminAsync();
        var list = await Client.GetAsync("/api/v2/admin/support-reports?search=Transfer%20modal");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        var queued = listJson.GetProperty("data").EnumerateArray().Single();
        queued.GetProperty("reference").GetString().Should().Be(report.GetProperty("reference").GetString());
        queued.GetProperty("reporter").GetProperty("email").GetString().Should().Be("member@test.com");
        queued.TryGetProperty("diagnostics", out _).Should().BeFalse();

        var detail = await Client.GetAsync($"/api/v2/admin/support-reports/{queued.GetProperty("id").GetInt32()}");
        var detailJson = await detail.Content.ReadFromJsonAsync<JsonElement>();
        var diagnostics = detailJson.GetProperty("data").GetProperty("diagnostics");
        diagnostics.GetProperty("payload").GetProperty("browser").GetString().Should().Be("chromium");
        diagnostics.GetProperty("payload").GetProperty("[filtered]").GetString().Should().Be("[filtered]");
    }

    [Fact]
    public async Task SupportReports_RejectInvalidLaravelReactPayload()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync("/api/v2/support/reports", new
        {
            summary = "No",
            description = "short",
            impact = "urgent"
        });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("errors").EnumerateArray()
            .Should().Contain(item => item.GetProperty("field").GetString() == "summary");
        json.GetProperty("errors").EnumerateArray()
            .Should().Contain(item => item.GetProperty("field").GetString() == "description");
        json.GetProperty("errors").EnumerateArray()
            .Should().Contain(item => item.GetProperty("field").GetString() == "impact");
    }
}
