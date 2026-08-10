// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Npgsql;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventTemplateWorkflowParityTests : IntegrationTestBase
{
    public EventTemplateWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CapturePreviewAndCapture_AreSafeVersionedAndIdempotent()
    {
        var eventId = await SourceEventAsync(); await AuthenticateAsMemberAsync();
        var preview = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/template-preview", new { });
        preview.StatusCode.Should().Be(HttpStatusCode.OK); preview.Headers.CacheControl!.NoStore.Should().BeTrue();
        var previewJson = await preview.Content.ReadFromJsonAsync<JsonElement>();
        previewJson.GetProperty("data").GetProperty("kind").GetString().Should().Be("capture");
        previewJson.GetProperty("data").GetProperty("configuration").TryGetProperty("image_url", out _).Should().BeFalse();
        previewJson.GetProperty("data").GetProperty("snapshot_hash").GetString().Should().HaveLength(64);

        const string key = "capture-safe-template-0001";
        var first = await PostWithKey($"/api/v2/events/{eventId}/templates", new { }, key);
        first.StatusCode.Should().Be(HttpStatusCode.Created);
        var firstJson = await first.Content.ReadFromJsonAsync<JsonElement>();
        var templateId = firstJson.GetProperty("data").GetProperty("template").GetProperty("id").GetInt64();
        firstJson.GetProperty("data").GetProperty("template").GetProperty("version").GetProperty("snapshot").GetProperty("immutable").GetBoolean().Should().BeTrue();
        var replay = await PostWithKey($"/api/v2/events/{eventId}/templates", new { }, key);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventTemplates.IgnoreQueryFilters().CountAsync()).Should().Be(1);
        (await db.EventTemplateVersions.IgnoreQueryFilters().CountAsync(x => x.TemplateId == templateId)).Should().Be(1);
        var payload = (await db.EventTemplateVersions.IgnoreQueryFilters().SingleAsync()).Payload;
        payload.Should().NotContain("image_url").And.NotContain("start_time").And.NotContain("rsvp");
    }

    [Fact]
    public async Task RevisionArchiveListAndHistory_EnforceVersionAndEvidence()
    {
        var eventId = await SourceEventAsync(); await AuthenticateAsMemberAsync(); var templateId = await CaptureAsync(eventId, "capture-revise-0001");
        var stale = await PostWithKey($"/api/v2/event-templates/{templateId}/revisions", new { expected_version = 2 }, "revise-stale-0001"); stale.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var revised = await PostWithKey($"/api/v2/event-templates/{templateId}/revisions", new { expected_version = 1 }, "revise-valid-0001"); revised.StatusCode.Should().Be(HttpStatusCode.OK);
        var revisedJson = await revised.Content.ReadFromJsonAsync<JsonElement>(); revisedJson.GetProperty("data").GetProperty("template").GetProperty("current_version").GetInt32().Should().Be(2);
        var invalidArchive = await PostWithKey($"/api/v2/event-templates/{templateId}/archive", new { expected_version = 2, reason = "" }, "archive-invalid-0001"); invalidArchive.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var archived = await PostWithKey($"/api/v2/event-templates/{templateId}/archive", new { expected_version = 2, reason = "Superseded programme" }, "archive-valid-0001"); archived.StatusCode.Should().Be(HttpStatusCode.OK);
        var list = await Client.GetAsync("/api/v2/event-templates?status=archived&per_page=20"); list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>(); listJson.GetProperty("data").GetArrayLength().Should().Be(1); listJson.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
        var history = await Client.GetAsync($"/api/v2/event-templates/{templateId}/history");
        var historyJson = await history.Content.ReadFromJsonAsync<JsonElement>(); historyJson.GetProperty("data").GetArrayLength().Should().Be(3);
        historyJson.GetProperty("data").EnumerateArray().Should().OnlyContain(x => x.GetProperty("immutable").GetBoolean());
    }

    [Fact]
    public async Task MaterializationPreviewAndCreate_ProduceFreshPrivateDraftOnly()
    {
        var eventId = await SourceEventAsync(); await AuthenticateAsMemberAsync(); var templateId = await CaptureAsync(eventId, "capture-materialize-0001");
        var start = DateTimeOffset.UtcNow.AddDays(10); var end = start.AddHours(2);
        var input = new { template_version = 1, start_time = start, end_time = end, overrides = new { title = "Safe copied workshop", location = "New hall" } };
        var preview = await Client.PostAsJsonAsync($"/api/v2/event-templates/{templateId}/materialization-preview", input); preview.StatusCode.Should().Be(HttpStatusCode.OK);
        var previewJson = await preview.Content.ReadFromJsonAsync<JsonElement>(); previewJson.GetProperty("data").GetProperty("will_create").GetProperty("publish").GetBoolean().Should().BeFalse();
        var created = await PostWithKey($"/api/v2/event-templates/{templateId}/materializations", input, "materialize-valid-0001"); created.StatusCode.Should().Be(HttpStatusCode.Created);
        var json = await created.Content.ReadFromJsonAsync<JsonElement>(); var createdEventId = json.GetProperty("data").GetProperty("created_event").GetProperty("id").GetInt32();
        json.GetProperty("data").GetProperty("workflow").GetProperty("registrations_copied").GetBoolean().Should().BeFalse();
        var replay = await PostWithKey($"/api/v2/event-templates/{templateId}/materializations", input, "materialize-valid-0001"); replay.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evt = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == createdEventId); evt.Status.Should().Be("draft"); evt.PublicationStatus.Should().Be("draft"); evt.OperationalStatus.Should().Be("scheduled"); evt.FederatedVisibility.Should().Be("none");
        (await db.EventRsvps.IgnoreQueryFilters().CountAsync(x => x.EventId == createdEventId)).Should().Be(0);
        (await db.Notifications.IgnoreQueryFilters().CountAsync(x => x.Data != null && x.Data.Contains(createdEventId.ToString()))).Should().Be(0);
    }

    [Fact]
    public async Task TenantAuthorizationIdempotencyConflictAndImmutabilityFailClosed()
    {
        var eventId = await SourceEventAsync(); await AuthenticateAsMemberAsync(); var templateId = await CaptureAsync(eventId, "capture-security-0001");
        var conflict = await PostWithKey($"/api/v2/event-templates/{templateId}/archive", new { expected_version = 1, reason = "Conflict" }, "capture-security-0001"); conflict.StatusCode.Should().Be(HttpStatusCode.Conflict);
        await AuthenticateAsOtherTenantUserAsync(); (await Client.GetAsync($"/api/v2/event-templates/{templateId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var version = await db.EventTemplateVersions.IgnoreQueryFilters().SingleAsync(x => x.TemplateId == templateId);
        var mutate = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_template_versions SET \"PayloadHash\" = {'x'} WHERE \"Id\" = {version.Id}");
        await mutate.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    private async Task<int> SourceEventAsync()
    {
        using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.MemberUser.Id, Title = "Original private workshop", Description = "Safe description", Location = "Old hall", ImageUrl = "https://private.example/image.jpg", CategoryId = TestData.Listing1.CategoryId, Latitude = 53.3, Longitude = -6.2, MaxAttendees = 20, IsOnline = false, AllowRemoteAttendance = false, Timezone = "Europe/Dublin", AllDay = false, FederatedVisibility = "joinable", StartsAt = DateTime.UtcNow.AddDays(3), EndsAt = DateTime.UtcNow.AddDays(3).AddHours(2), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled", LifecycleVersion = 3, CalendarSequence = 2 };
        db.Events.Add(evt); await db.SaveChangesAsync(); return evt.Id;
    }
    private async Task<long> CaptureAsync(int eventId, string key) { var response = await PostWithKey($"/api/v2/events/{eventId}/templates", new { }, key); response.StatusCode.Should().Be(HttpStatusCode.Created); return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("template").GetProperty("id").GetInt64(); }
    private Task<HttpResponseMessage> PostWithKey(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
