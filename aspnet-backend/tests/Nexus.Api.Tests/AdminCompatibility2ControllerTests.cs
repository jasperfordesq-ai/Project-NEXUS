// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class AdminCompatibility2ControllerTests : IntegrationTestBase
{
    public AdminCompatibility2ControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ImportExportAndSyncSubscribers_AsAdmin_PersistSubscribers()
    {
        await AuthenticateAsAdminAsync();

        var import = await Client.PostAsJsonAsync("/api/admin/newsletters/subscribers/import", new
        {
            subscribers = new[]
            {
                new { email = "imported@example.com", source = (string?)"test" },
                new { email = "bad-email", source = (string?)null }
            }
        });

        import.StatusCode.Should().Be(HttpStatusCode.OK);
        var importJson = await import.Content.ReadFromJsonAsync<JsonElement>();
        importJson.GetProperty("imported").GetInt32().Should().Be(1);
        importJson.GetProperty("skipped").GetInt32().Should().Be(1);

        var sync = await Client.PostAsync("/api/admin/newsletters/subscribers/sync", null);
        sync.StatusCode.Should().Be(HttpStatusCode.OK);
        var syncJson = await sync.Content.ReadFromJsonAsync<JsonElement>();
        syncJson.GetProperty("synced").GetInt32().Should().BeGreaterThan(0);

        var export = await Client.GetAsync("/api/admin/newsletters/subscribers/export");
        export.StatusCode.Should().Be(HttpStatusCode.OK);
        var exportJson = await export.Content.ReadFromJsonAsync<JsonElement>();
        exportJson.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThan(1);
    }

    [Fact]
    public async Task SendStatusResendAndTestEmail_AsAdmin_UsePersistedQueueAndEmailLog()
    {
        await AuthenticateAsAdminAsync();

        await Client.PostAsJsonAsync("/api/admin/newsletters/subscribers/import", new
        {
            subscribers = new[] { new { email = "recipient@example.com" } }
        });

        var create = await Client.PostAsJsonAsync("/api/admin/newsletters", new
        {
            subject = "Dispatch test",
            content_html = "<p>Hello</p>",
            content_text = "Hello"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("data").GetProperty("id").GetInt32();

        var send = await Client.PostAsync($"/api/admin/newsletters/{id}/send", null);
        send.StatusCode.Should().Be(HttpStatusCode.OK);
        var sent = await send.Content.ReadFromJsonAsync<JsonElement>();
        sent.GetProperty("data").GetProperty("status").GetString().Should().Be("Queued");
        sent.GetProperty("data").GetProperty("recipient_count").GetInt32().Should().BeGreaterThan(0);

        var info = await Client.GetAsync($"/api/admin/newsletters/{id}/resend-info");
        info.StatusCode.Should().Be(HttpStatusCode.OK);
        var infoJson = await info.Content.ReadFromJsonAsync<JsonElement>();
        infoJson.GetProperty("data").GetProperty("can_resend").GetBoolean().Should().BeTrue();

        var resend = await Client.PostAsync($"/api/admin/newsletters/{id}/resend", null);
        resend.StatusCode.Should().Be(HttpStatusCode.OK);

        var test = await Client.PostAsJsonAsync($"/api/admin/newsletters/{id}/send-test", new
        {
            email = "admin@example.com"
        });
        test.StatusCode.Should().Be(HttpStatusCode.OK);
        var testJson = await test.Content.ReadFromJsonAsync<JsonElement>();
        testJson.GetProperty("email_log_id").GetInt32().Should().BeGreaterThan(0);
        testJson.GetProperty("provider_configured").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task GroupGeocode_AsAdmin_UsesTenantLocalLocationDataWithoutPersistingGroupCoordinates()
    {
        await AuthenticateAsAdminAsync();

        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Set<UserLocation>().Add(new UserLocation
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Latitude = 51.8985,
                Longitude = -8.4756,
                City = "Cork",
                Region = "County Cork",
                Country = "Ireland",
                FormattedAddress = "Cork, County Cork, Ireland",
                IsPublic = true
            });
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Name = "Cork",
                Description = "Local group"
            };
            db.Set<Group>().Add(group);
            await db.SaveChangesAsync();
            groupId = group.Id;
        }

        var response = await Client.PostAsJsonAsync($"/api/admin/groups/{groupId}/geocode", new
        {
            address = "Cork"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("matched").GetBoolean().Should().BeTrue();
        json.GetProperty("persisted").GetBoolean().Should().BeFalse();
        json.GetProperty("result").GetProperty("latitude").GetDouble().Should().BeApproximately(51.8985, 0.0001);
    }
}
