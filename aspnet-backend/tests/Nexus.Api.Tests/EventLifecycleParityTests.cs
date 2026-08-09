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
public sealed class EventLifecycleParityTests : IntegrationTestBase
{
    public EventLifecycleParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task MemberSubmit_IsQueueBackedIdempotentAndReturnsStrictV2Event()
    {
        await SetEventModerationAsync(true);
        var eventId = await CreateEventAsync("draft", "scheduled", "draft");
        await AuthenticateAsMemberAsync();

        var first = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/submit", new { });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await first.Content.ReadFromJsonAsync<JsonElement>();
        var data = payload.GetProperty("data");
        data.GetProperty("contract_version").GetInt32().Should().Be(2);
        data.GetProperty("schedule").GetProperty("publication_state").GetString().Should().Be("pending_review");
        data.GetProperty("permissions").GetProperty("publish").GetBoolean().Should().BeFalse();
        data.GetProperty("permissions").GetProperty("submit_for_review").GetBoolean().Should().BeFalse();
        data.GetProperty("relationship").GetProperty("capacity").GetProperty("confirmed").GetInt32().Should().Be(0);

        var replay = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/submit", new { });
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var queue = await db.ContentModerationQueue.IgnoreQueryFilters().SingleAsync(x => x.TenantId == TestData.Tenant1.Id && x.ContentType == "event" && x.ContentId == eventId);
        queue.Status.Should().Be("pending");
        queue.AuthorId.Should().Be(TestData.MemberUser.Id);
        (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1);
        (await db.EventDomainOutbox.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId && x.AggregateStream == "lifecycle")).Should().Be(1);
    }

    [Fact]
    public async Task Publish_EnforcesModerationAndAdminDecisionClosesQueue()
    {
        await SetEventModerationAsync(true);
        var eventId = await CreateEventAsync("draft", "scheduled", "draft");
        await AuthenticateAsMemberAsync();
        var blocked = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/publish", new { });
        blocked.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var blockedJson = await blocked.Content.ReadFromJsonAsync<JsonElement>();
        blockedJson.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("EVENT_REVIEW_REQUIRED");

        (await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/submit", new { })).StatusCode.Should().Be(HttpStatusCode.OK);
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/approve", new { })).StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var queue = await db.ContentModerationQueue.IgnoreQueryFilters().SingleAsync(x => x.ContentId == eventId && x.ContentType == "event");
        queue.Status.Should().Be("approved");
        queue.ReviewerId.Should().Be(TestData.AdminUser.Id);
        queue.ReviewedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task DirectPublish_WhenReviewDisabled_IsOwnerAuthorizedAndAdminIdempotent()
    {
        await SetEventModerationAsync(false);
        var eventId = await CreateEventAsync("draft", "scheduled", "draft");
        await AuthenticateAsMemberAsync();
        var submitted = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/submit", new { });
        submitted.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await submitted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0]
            .GetProperty("code").GetString().Should().Be("EVENT_REVIEW_NOT_REQUIRED");

        var published = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/publish", new { });
        published.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await published.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").GetProperty("schedule").GetProperty("publication_state").GetString().Should().Be("published");
        json.GetProperty("data").GetProperty("permissions").GetProperty("publish").GetBoolean().Should().BeFalse();
        (await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/publish", new { })).StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1);
    }

    [Fact]
    public async Task LifecycleHistory_IsPrivateManagerOnlyCursorBoundAndStrict()
    {
        var eventId = await CreateEventAsync("pending_review", "scheduled", "draft");
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/approve", new { })).EnsureSuccessStatusCode();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/postpone", new { reason = "Weather" })).EnsureSuccessStatusCode();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/restore", new { reason = "Clear" })).EnsureSuccessStatusCode();

        await AuthenticateAsMemberAsync();
        var first = await Client.GetAsync($"/api/v2/events/{eventId}/lifecycle-history?per_page=2");
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        first.Headers.CacheControl!.NoStore.Should().BeTrue();
        first.Headers.Vary.Should().Contain(new[] { "Authorization", "Cookie", "X-Tenant-ID" });
        var firstJson = await first.Content.ReadFromJsonAsync<JsonElement>();
        firstJson.GetProperty("data").GetArrayLength().Should().Be(2);
        firstJson.GetProperty("data")[0].GetProperty("immutable").GetBoolean().Should().BeTrue();
        firstJson.GetProperty("data")[0].GetProperty("evidence").GetProperty("notifications_suppressed").GetBoolean().Should().BeFalse();
        firstJson.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeTrue();
        var cursor = firstJson.GetProperty("meta").GetProperty("next_cursor").GetString();
        cursor.Should().NotBeNullOrWhiteSpace();
        var second = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/lifecycle-history?per_page=2&cursor={Uri.EscapeDataString(cursor!)}");
        second.GetProperty("data").GetArrayLength().Should().Be(1);
        second.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();

        var other = await CreateEventAsync("draft", "scheduled", "draft");
        var wrongBound = await Client.GetAsync($"/api/v2/events/{other}/lifecycle-history?cursor={Uri.EscapeDataString(cursor!)}");
        wrongBound.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await wrongBound.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0]
            .GetProperty("field").GetString().Should().Be("cursor");

        var wrongShape = await Client.GetAsync($"/api/v2/events/{eventId}/lifecycle-history?cursor=W10");
        wrongShape.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await wrongShape.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0]
            .GetProperty("field").GetString().Should().Be("cursor");

        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/lifecycle-history")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Approve_IsVersionedNotifiedAndIdempotent()
    {
        var eventId = await CreateEventAsync("pending_review", "scheduled", "draft");
        await AuthenticateAsAdminAsync();
        var first = await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/approve", new { });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstJson = await first.Content.ReadFromJsonAsync<JsonElement>();
        firstJson.GetProperty("data").GetProperty("publication_state").GetString().Should().Be("published");
        firstJson.GetProperty("data").GetProperty("status").GetString().Should().Be("active");
        firstJson.GetProperty("data").GetProperty("transition").GetProperty("changed").GetBoolean().Should().BeTrue();

        var replay = await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/approve", new { });
        var replayJson = await replay.Content.ReadFromJsonAsync<JsonElement>();
        replayJson.GetProperty("data").GetProperty("transition").GetProperty("changed").GetBoolean().Should().BeFalse();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1);
        (await db.EventDomainOutbox.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1);
        (await db.Notifications.IgnoreQueryFilters().CountAsync(x => x.UserId == TestData.MemberUser.Id && x.Type == "event_approved")).Should().Be(1);
    }

    [Fact]
    public async Task Reject_RequiresReasonAndEnforcesSourceGuard()
    {
        var eventId = await CreateEventAsync("pending_review", "scheduled", "draft");
        await AuthenticateAsAdminAsync();
        var missing = await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/reject", new { });
        missing.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var rejected = await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/reject", new { reason = "Insufficient safety details" });
        rejected.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await rejected.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("data").GetProperty("publication_state").GetString().Should().Be("draft");
        json.GetProperty("data").GetProperty("moderation").GetProperty("reason").GetString().Should().Be("Insufficient safety details");

        var publishedId = await CreateEventAsync("published", "scheduled", "active");
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{publishedId}/reject", new { reason = "Late rejection" })).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Archive_CascadesAtomicallyAndRestoreReturnsDraftScheduled()
    {
        var eventId = await CreateEventAsync("published", "scheduled", "active", withParticipantState: true);
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/archive", new { })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var concurrent = await Task.WhenAll(
            Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/archive", new { reason = "Venue unavailable" }),
            Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/archive", new { reason = "Venue unavailable" }));
        concurrent.Should().OnlyContain(x => x.StatusCode == HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId);
            evt.PublicationStatus.Should().Be("archived"); evt.OperationalStatus.Should().Be("cancelled"); evt.Status.Should().Be("cancelled");
            (await db.EventRsvps.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId)).Status.Should().Be("cancelled");
            var reminder = await db.EventReminders.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
            reminder.Status.Should().Be("cancelled"); reminder.ClosedReason.Should().Be("event_unavailable");
            (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(1);
        }

        var restored = await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/restore", new { reason = "New venue confirmed" });
        restored.StatusCode.Should().Be(HttpStatusCode.OK);
        var restoredJson = await restored.Content.ReadFromJsonAsync<JsonElement>();
        restoredJson.GetProperty("data").GetProperty("publication_state").GetString().Should().Be("draft");
        restoredJson.GetProperty("data").GetProperty("operational_state").GetString().Should().Be("scheduled");
        restoredJson.GetProperty("data").GetProperty("lifecycle_version").GetInt64().Should().Be(2);
    }

    [Fact]
    public async Task RoutesAreAdminTenantScopedAndHistoryIsDatabaseImmutable()
    {
        var eventId = await CreateEventAsync("published", "scheduled", "active");
        await AuthenticateAsMemberAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/postpone", new { reason = "Weather" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using (var promoteScope = Factory.Services.CreateScope())
        {
            var promoteDb = promoteScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var otherTenantAdmin = await promoteDb.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.OtherTenantUser.Id);
            otherTenantAdmin.IsAdmin = true;
            otherTenantAdmin.Role = "admin";
            await promoteDb.SaveChangesAsync();
        }
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/postpone", new { reason = "Weather" })).StatusCode.Should().Be(HttpStatusCode.NotFound);
        using (var restoreScope = Factory.Services.CreateScope())
        {
            var restoreDb = restoreScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var otherTenantUser = await restoreDb.Users.IgnoreQueryFilters().SingleAsync(x => x.Id == TestData.OtherTenantUser.Id);
            otherTenantUser.IsAdmin = false;
            otherTenantUser.Role = "member";
            await restoreDb.SaveChangesAsync();
        }
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{eventId}/postpone", new { reason = "Weather" })).StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var history = await db.EventStatusHistories.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
        var mutate = async () => await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE event_status_history SET \"Reason\" = {'x'} WHERE \"Id\" = {history.Id}");
        await mutate.Should().ThrowAsync<PostgresException>().Where(x => x.SqlState == "P0001");
    }

    [Fact]
    public async Task PublicationFromOccurrence_TransitionsWholeSeriesWithOneAuthoritativeRootFact()
    {
        await SetEventModerationAsync(true);
        var (rootId, _, futureId) = await CreateSeriesAsync("draft");
        await AuthenticateAsMemberAsync();

        var submitted = await Client.PostAsJsonAsync($"/api/v2/events/{futureId}/submit", new { });
        submitted.StatusCode.Should().Be(HttpStatusCode.OK);
        var replay = await Client.PostAsJsonAsync($"/api/v2/events/{futureId}/submit", new { });
        replay.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var members = await db.Events.IgnoreQueryFilters().Where(x => x.Id == rootId || x.ParentEventId == rootId).OrderBy(x => x.Id).ToListAsync();
            members.Should().HaveCount(3).And.OnlyContain(x => x.PublicationStatus == "pending_review");
            (await db.ContentModerationQueue.IgnoreQueryFilters().Where(x => x.ContentType == "event" && members.Select(e => e.Id).Contains(x.ContentId)).ToListAsync())
                .Should().ContainSingle(x => x.ContentId == rootId && x.Status == "pending");
            (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => members.Select(e => e.Id).Contains(x.EventId))).Should().Be(3);
            var childHistory = await db.EventStatusHistories.IgnoreQueryFilters().SingleAsync(x => x.EventId == futureId);
            using var metadata = JsonDocument.Parse(childHistory.Metadata);
            metadata.RootElement.GetProperty("notifications_suppressed").GetBoolean().Should().BeTrue();
            metadata.RootElement.GetProperty("series").GetProperty("root_event_id").GetInt32().Should().Be(rootId);
            var outboxes = await db.EventDomainOutbox.IgnoreQueryFilters().Where(x => members.Select(e => e.Id).Contains(x.EventId)).ToListAsync();
            outboxes.Should().ContainSingle(x => x.EventId == rootId && x.ProductionMode == "outbox_authoritative");
            outboxes.Where(x => x.EventId != rootId).Should().OnlyContain(x => x.ProductionMode == "shadow_outbox" && x.Status == "processed");
        }

        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/v2/admin/events/{futureId}/approve", new { reason = "Approved" })).StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Events.IgnoreQueryFilters().Where(x => x.Id == rootId || x.ParentEventId == rootId).Select(x => x.PublicationStatus).ToListAsync())
                .Should().OnlyContain(x => x == "published");
        }
    }

    [Fact]
    public async Task TemplateCancelAndArchive_TargetOnlyFutureOccurrencesAndNeverDeleteRows()
    {
        var (rootId, pastId, futureId) = await CreateSeriesAsync("published", withFutureParticipantState: true);
        await AuthenticateAsMemberAsync();

        var cancelled = await Client.PostAsJsonAsync($"/api/v2/events/{rootId}/cancel", new { reason = "Venue unavailable" });
        cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        var cancelledJson = await cancelled.Content.ReadFromJsonAsync<JsonElement>();
        cancelledJson.GetProperty("data").GetProperty("cancelled").GetBoolean().Should().BeTrue();
        var aliasReplay = await Client.PostAsJsonAsync($"/api/events/{rootId}/cancel", new { reason = "Venue unavailable" });
        aliasReplay.StatusCode.Should().Be(HttpStatusCode.OK);

        var archiveRequest = new HttpRequestMessage(HttpMethod.Delete, $"/api/v2/events/{rootId}")
        {
            Content = JsonContent.Create(new { reason = "Series retired" })
        };
        var archived = await Client.SendAsync(archiveRequest);
        archived.StatusCode.Should().Be(HttpStatusCode.OK);
        var archivedJson = await archived.Content.ReadFromJsonAsync<JsonElement>();
        archivedJson.GetProperty("data").GetProperty("deleted").GetBoolean().Should().BeFalse();
        archivedJson.GetProperty("data").GetProperty("publication_status").GetString().Should().Be("archived");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var members = await db.Events.IgnoreQueryFilters().Where(x => x.Id == rootId || x.ParentEventId == rootId).ToDictionaryAsync(x => x.Id);
        members.Should().HaveCount(3);
        members[rootId].PublicationStatus.Should().Be("archived");
        members[rootId].OperationalStatus.Should().Be("cancelled");
        members[futureId].PublicationStatus.Should().Be("archived");
        members[futureId].OperationalStatus.Should().Be("cancelled");
        members[pastId].PublicationStatus.Should().Be("published");
        members[pastId].OperationalStatus.Should().Be("scheduled");
        (await db.EventRsvps.IgnoreQueryFilters().SingleAsync(x => x.EventId == futureId)).Status.Should().Be("cancelled");
        (await db.EventReminders.IgnoreQueryFilters().SingleAsync(x => x.EventId == futureId)).Status.Should().Be("cancelled");
    }

    [Fact]
    public async Task PublicationRepairsChildDrift_WithSyntheticRootRevision()
    {
        await SetEventModerationAsync(false);
        var (rootId, _, futureId) = await CreateSeriesAsync("published", futurePublication: "draft");
        await AuthenticateAsMemberAsync();

        var published = await Client.PostAsJsonAsync($"/api/v2/events/{futureId}/publish", new { });
        published.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var root = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == rootId);
        var child = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == futureId);
        root.PublicationStatus.Should().Be("published");
        root.LifecycleVersion.Should().Be(1);
        child.PublicationStatus.Should().Be("published");
        var rootHistory = await db.EventStatusHistories.IgnoreQueryFilters().SingleAsync(x => x.EventId == rootId);
        rootHistory.FromPublicationStatus.Should().Be("published");
        rootHistory.ToPublicationStatus.Should().Be("published");
        using var metadata = JsonDocument.Parse(rootHistory.Metadata);
        metadata.RootElement.GetProperty("series").GetProperty("synthetic_root_revision").GetBoolean().Should().BeTrue();
        var rootOutbox = await db.EventDomainOutbox.IgnoreQueryFilters().SingleAsync(x => x.EventId == rootId);
        rootOutbox.ProductionMode.Should().Be("outbox_authoritative");

        (await Client.PostAsJsonAsync($"/api/v2/events/{futureId}/publish", new { })).StatusCode.Should().Be(HttpStatusCode.OK);
        (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == rootId || x.EventId == futureId)).Should().Be(2);
    }

    [Fact]
    public async Task MemberDeleteWithoutRequiredReason_AllowsEmptyBodyAndFailsClosedWithoutPhysicalDeletion()
    {
        var eventId = await CreateEventAsync("draft", "scheduled", "draft");
        await AuthenticateAsMemberAsync();
        var archived = await Client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/v2/events/{eventId}"));
        archived.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var payload = await archived.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("errors")[0].GetProperty("field").GetString().Should().Be("reason");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId)).PublicationStatus.Should().Be("draft");
        (await db.EventStatusHistories.IgnoreQueryFilters().CountAsync(x => x.EventId == eventId)).Should().Be(0);
    }

    private async Task<int> CreateEventAsync(string publication, string operational, string legacy, bool withParticipantState = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.MemberUser.Id, Title = $"Lifecycle {Guid.NewGuid():N}", StartsAt = DateTime.UtcNow.AddDays(7), PublicationStatus = publication, OperationalStatus = operational, Status = legacy, IsCancelled = legacy == "cancelled" };
        db.Events.Add(evt); await db.SaveChangesAsync();
        if (withParticipantState)
        {
            db.EventRsvps.Add(new EventRsvp { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, Status = "going" });
            db.EventReminders.Add(new EventReminder { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, Status = "pending" });
            await db.SaveChangesAsync();
        }
        return evt.Id;
    }

    private async Task<(int RootId, int PastId, int FutureId)> CreateSeriesAsync(
        string rootPublication,
        string? futurePublication = null,
        bool withFutureParticipantState = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var root = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.MemberUser.Id,
            Title = $"Series {Guid.NewGuid():N}",
            StartsAt = DateTime.UtcNow.AddDays(7),
            PublicationStatus = rootPublication,
            OperationalStatus = "scheduled",
            Status = rootPublication is "draft" or "pending_review" ? "draft" : "active",
            IsRecurringTemplate = true,
            RecurrenceEngine = "sabre-vobject",
            RecurrenceEngineVersion = "2"
        };
        db.Events.Add(root);
        await db.SaveChangesAsync();
        var past = new Event
        {
            TenantId = root.TenantId, CreatedById = root.CreatedById, ParentEventId = root.Id,
            Title = root.Title + " past", StartsAt = DateTime.UtcNow.AddDays(-7),
            PublicationStatus = rootPublication, OperationalStatus = "scheduled", Status = root.Status,
            RecurrenceEngine = root.RecurrenceEngine, RecurrenceEngineVersion = root.RecurrenceEngineVersion,
            RecurrenceId = "20260706T090000Z", OccurrenceKey = $"event:{root.Id}:occurrence:20260706T090000Z"
        };
        var childPublication = futurePublication ?? rootPublication;
        var future = new Event
        {
            TenantId = root.TenantId, CreatedById = root.CreatedById, ParentEventId = root.Id,
            Title = root.Title + " future", StartsAt = DateTime.UtcNow.AddDays(14),
            PublicationStatus = childPublication, OperationalStatus = "scheduled",
            Status = childPublication is "draft" or "pending_review" ? "draft" : "active",
            RecurrenceEngine = root.RecurrenceEngine, RecurrenceEngineVersion = root.RecurrenceEngineVersion,
            RecurrenceId = "20260727T090000Z", OccurrenceKey = $"event:{root.Id}:occurrence:20260727T090000Z"
        };
        db.Events.AddRange(past, future);
        await db.SaveChangesAsync();
        if (withFutureParticipantState)
        {
            db.EventRsvps.Add(new EventRsvp { TenantId = root.TenantId, EventId = future.Id, UserId = TestData.MemberUser.Id, Status = "going" });
            db.EventReminders.Add(new EventReminder { TenantId = root.TenantId, EventId = future.Id, UserId = TestData.MemberUser.Id, Status = "pending" });
            await db.SaveChangesAsync();
        }
        return (root.Id, past.Id, future.Id);
    }

    private async Task SetEventModerationAsync(bool required)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        foreach (var (key, value) in new[]
                 {
                     ("moderation.enabled", required ? "1" : "0"),
                     ("moderation.require_event", required ? "1" : "0")
                 })
        {
            var row = await db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == TestData.Tenant1.Id && x.Key == key);
            if (row is null) db.TenantConfigs.Add(new TenantConfig { TenantId = TestData.Tenant1.Id, Key = key, Value = value });
            else row.Value = value;
        }
        await db.SaveChangesAsync();
    }
}
