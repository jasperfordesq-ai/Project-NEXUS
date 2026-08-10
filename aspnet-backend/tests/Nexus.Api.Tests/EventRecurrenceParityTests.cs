// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Npgsql;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventRecurrenceParityTests(NexusWebApplicationFactory factory) : IntegrationTestBase(factory)
{
    [Fact]
    public async Task Capabilities_AreStrictPrivateAndSchemaBacked()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/events/recurrence-capabilities");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        response.Headers.Vary.Should().Contain(new[] { "Authorization", "Cookie", "X-Tenant-ID" });
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.EnumerateObject().Select(x => x.Name).Should().Equal(
            "contract_version", "engine", "structured_input", "supported_frequencies", "max_occurrences",
            "supported_end_types", "supports_rolling_never", "supports_effective_revisions",
            "supports_definition_blueprints", "schema_ready", "rollout_state");
        data.GetProperty("engine").GetString().Should().Be("v2");
        data.GetProperty("supports_effective_revisions").GetBoolean().Should().BeTrue();
        data.GetProperty("supports_definition_blueprints").GetBoolean().Should().BeTrue();
        Factory.Services.GetServices<IHostedService>().OfType<Nexus.Api.Services.Scheduled.EventRecurrenceMaterializationJob>().Should().ContainSingle();
    }

    [Fact]
    public async Task RecurringCreate_MaterializesStableIdentitiesLedgerAndStrictProjection()
    {
        var created = await CreateSeries(3);
        created.GetProperty("occurrences_created").GetInt32().Should().Be(3);
        var template = created.GetProperty("template");
        template.GetProperty("contract_version").GetInt32().Should().Be(2);
        var recurrence = template.GetProperty("series").GetProperty("recurrence");
        recurrence.GetProperty("is_template").GetBoolean().Should().BeTrue();
        recurrence.GetProperty("engine").GetString().Should().Be("sabre-vobject");
        recurrence.GetProperty("engine_version").GetString().Should().Be("2");
        recurrence.GetProperty("occurrence_count").GetInt32().Should().Be(3);
        recurrence.GetProperty("occurrences").GetArrayLength().Should().Be(3);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rootId = template.GetProperty("id").GetInt32();
        var root = await db.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == rootId);
        root.IsRecurringTemplate.Should().BeTrue();
        root.RecurrenceId.Should().BeNull();
        var children = await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).ToListAsync();
        children.Should().HaveCount(3);
        children.Select(x => x.RecurrenceId).Should().OnlyHaveUniqueItems().And.AllSatisfy(x => x.Should().MatchRegex("^[0-9]{8}T[0-9]{6}Z$"));
        children.Select(x => x.OccurrenceKey).Should().OnlyHaveUniqueItems();
        (await db.EventRecurrenceRules.IgnoreQueryFilters().SingleAsync(x => x.EventId == rootId)).RRule.Should().Be("FREQ=DAILY;INTERVAL=1;COUNT=3");
        (await db.EventRecurrenceOccurrenceLedger.IgnoreQueryFilters().CountAsync(x => x.RootEventId == rootId)).Should().Be(3);
    }

    [Fact]
    public async Task CustomRule_PreservesCanonicalRuleExceptionsAdditionsAndLocalWallTime()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = "Month-end custom series", description = "Custom recurrence contract", location = "Hall A",
            start_time = "2027-01-31T09:00:00Z", end_time = "2027-01-31T10:00:00Z", timezone = "UTC",
            recurrence_frequency = "custom", recurrence_rrule = "BYMONTHDAY=-1;COUNT=3;FREQ=MONTHLY",
            recurrence_exdates = new[] { "2027-02-28 09:00:00" }, recurrence_additions = new[] { "2027-02-27 09:00:00", "2027-02-28 09:00:00" }
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var rootId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("template").GetProperty("id").GetInt32();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var rule = await db.EventRecurrenceRules.IgnoreQueryFilters().SingleAsync(x => x.EventId == rootId);
            rule.RRule.Should().Be("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3");
            JsonSerializer.Deserialize<string[]>(rule.ExDates).Should().Equal("20270228T090000Z");
            JsonSerializer.Deserialize<string[]>(rule.RDates).Should().Equal("20270227T090000Z", "20270228T090000Z");
            (await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).Select(x => x.StartsAt).ToListAsync())
                .Should().Equal(new DateTime(2027, 1, 31, 9, 0, 0, DateTimeKind.Utc), new DateTime(2027, 2, 27, 9, 0, 0, DateTimeKind.Utc), new DateTime(2027, 3, 31, 9, 0, 0, DateTimeKind.Utc));
        }

        var dst = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = "Dublin wall-time series", description = "DST-safe recurrence contract", location = "Hall A",
            start_time = "2027-03-27T09:00:00Z", end_time = "2027-03-27T10:00:00Z", timezone = "Europe/Dublin",
            recurrence_frequency = "daily", recurrence_ends_type = "after_count", recurrence_ends_after_count = 2
        });
        dst.StatusCode.Should().Be(HttpStatusCode.Created);
        var dstRoot = (await dst.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("template").GetProperty("id").GetInt32();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == dstRoot).OrderBy(x => x.StartsAt).Select(x => x.StartsAt).ToListAsync())
                .Should().Equal(new DateTime(2027, 3, 27, 9, 0, 0, DateTimeKind.Utc), new DateTime(2027, 3, 28, 8, 0, 0, DateTimeKind.Utc));
        }

        var weekStart = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = "Sunday anchored biweekly series", start_time = "2027-01-03T09:00:00Z", timezone = "UTC",
            recurrence_rrule = "COUNT=4;BYDAY=MO,SU;WKST=SU;INTERVAL=2;FREQ=WEEKLY"
        });
        weekStart.StatusCode.Should().Be(HttpStatusCode.Created);
        var weekStartRoot = (await weekStart.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("template").GetProperty("id").GetInt32();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.EventRecurrenceRules.IgnoreQueryFilters().SingleAsync(x => x.EventId == weekStartRoot)).RRule
                .Should().Be("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,SU;WKST=SU;COUNT=4");
            (await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == weekStartRoot).OrderBy(x => x.StartsAt).Select(x => x.StartsAt.Date).ToListAsync())
                .Should().Equal(new DateTime(2027, 1, 3), new DateTime(2027, 1, 4), new DateTime(2027, 1, 17), new DateTime(2027, 1, 18));
        }

        var invalid = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = "Invalid custom series", start_time = "2027-01-31T09:00:00Z", timezone = "UTC",
            recurrence_frequency = "custom", recurrence_rrule = "FREQ=MONTHLY;COUNT=3;UNTIL=20271231T235959Z"
        });
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var invalidAddition = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = "Invalid custom addition", start_time = "2027-01-31T09:00:00Z", timezone = "UTC",
            recurrence_rrule = "FREQ=MONTHLY;COUNT=2", recurrence_rdates = new[] { "2027-01-30 09:00:00" }
        });
        invalidAddition.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Revision_IsBoundaryScopedSignedDurableAndExactlyIdempotent()
    {
        var created = await CreateSeries(3);
        var rootId = created.GetProperty("template").GetProperty("id").GetInt32();
        int[] children;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            children = await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).Select(x => x.Id).ToArrayAsync();
        }

        var previewResponse = await Client.PostAsJsonAsync($"/api/v2/events/{children[1]}/recurrence-revisions/preview", new { patch = new { location = "Revised venue" } });
        previewResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var preview = (await previewResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        preview.GetProperty("scope").GetString().Should().Be("this_and_future");
        preview.GetProperty("impact").GetProperty("affected_event_ids").EnumerateArray().Select(x => x.GetInt32()).Should().Equal(children[1], children[2]);
        preview.GetProperty("can_commit").GetBoolean().Should().BeTrue();

        var token = preview.GetProperty("preview_token").GetString()!;
        using var commit = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{children[1]}/recurrence-revisions/commit")
        {
            Content = JsonContent.Create(new { patch = new { location = "Revised venue" }, preview_token = token })
        };
        commit.Headers.Add("Idempotency-Key", "revision-location-1");
        var committed = await Client.SendAsync(commit);
        committed.StatusCode.Should().Be(HttpStatusCode.Created);
        var committedData = (await committed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        committedData.GetProperty("changed_event_ids").EnumerateArray().Select(x => x.GetInt32()).Should().Equal(children[1], children[2]);

        using var replayRequest = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{children[1]}/recurrence-revisions/commit")
        {
            Content = JsonContent.Create(new { patch = new { location = "Revised venue" }, preview_token = token })
        };
        replayRequest.Headers.Add("Idempotency-Key", "revision-location-1");
        var replay = await Client.SendAsync(replayRequest);
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();

        using var verifyScope = Factory.Services.CreateScope();
        var verify = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verify.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == children[0])).Location.Should().Be("Hall A");
        (await verify.Events.IgnoreQueryFilters().Where(x => x.Id == children[1] || x.Id == children[2]).Select(x => x.Location).ToListAsync()).Should().OnlyContain(x => x == "Revised venue");
        (await verify.EventRecurrenceRevisions.IgnoreQueryFilters().CountAsync(x => x.RootEventId == rootId)).Should().Be(1);
        (await verify.EventRecurrenceOccurrenceLedger.IgnoreQueryFilters().CountAsync(x => x.RootEventId == rootId)).Should().Be(5);
    }

    [Fact]
    public async Task Blueprint_PreviewsCapturesAndPagesWithoutExposingManifest()
    {
        var created = await CreateSeries(2);
        var rootId = created.GetProperty("template").GetProperty("id").GetInt32();
        int sourceId; string recurrenceId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var source = await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).FirstAsync();
            sourceId = source.Id; recurrenceId = source.RecurrenceId!;
            db.EventSessions.Add(new EventSession { TenantId = TestData.Tenant1.Id, EventId = sourceId, Title = "Welcome", StartsAtUtc = source.StartsAt, EndsAtUtc = source.StartsAt.AddMinutes(30), Timezone = "UTC", Position = 0, CreatedBy = TestData.MemberUser.Id, UpdatedBy = TestData.MemberUser.Id, Status = "scheduled" });
            db.EventTicketTypes.Add(new EventTicketType { TenantId = TestData.Tenant1.Id, EventId = sourceId, OccurrenceKey = $"event:{sourceId}", Name = "Free", Kind = "free", AllocationLimit = 20, PerMemberLimit = 1, UnitPriceCredits = 0, SalesOpensAt = source.StartsAt.AddDays(-5), SalesClosesAt = source.StartsAt.AddHours(-1), EventStartsAtSnapshot = source.StartsAt, EventTimezoneSnapshot = "UTC", Status = "draft", EligibilityPolicy = "{}", CreatedBy = TestData.MemberUser.Id, UpdatedBy = TestData.MemberUser.Id });
            await db.SaveChangesAsync();
        }
        var sections = new { agenda = true, ticket_types = true, registration = false, safety = false, staff = false };
        var previewResponse = await Client.PostAsJsonAsync($"/api/v2/events/{sourceId}/recurrence-definition-blueprints/preview", new { effective_from_recurrence_id = recurrenceId, sections });
        previewResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var preview = (await previewResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        preview.GetProperty("counts").GetProperty("sessions").GetInt32().Should().Be(1);
        preview.GetProperty("counts").GetProperty("ticket_types").GetInt32().Should().Be(1);
        preview.GetProperty("can_commit").GetBoolean().Should().BeTrue();
        var token = preview.GetProperty("preview_token").GetString()!;

        using var commit = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{sourceId}/recurrence-definition-blueprints/commit") { Content = JsonContent.Create(new { effective_from_recurrence_id = recurrenceId, sections, preview_token = token }) };
        commit.Headers.Add("Idempotency-Key", "blueprint-1");
        (await Client.SendAsync(commit)).StatusCode.Should().Be(HttpStatusCode.Created);

        var history = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{sourceId}/recurrence-definition-blueprints?limit=1");
        var item = history.GetProperty("data").GetProperty("items")[0];
        item.EnumerateObject().Select(x => x.Name).Should().NotContain("manifest");
        item.GetProperty("manifest_hash").GetString().Should().MatchRegex("^[0-9a-f]{64}$");
        item.GetProperty("selected_sections").GetProperty("agenda").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RollingMaterializer_AppliesLatestBlueprintOnlyToNewOccurrencesAndResumesWithoutDuplicates()
    {
        var created = await CreateSeries(2);
        var rootId = created.GetProperty("template").GetProperty("id").GetInt32();
        int sourceId; string recurrenceId;
        using (var setupScope = Factory.Services.CreateScope())
        {
            var db = setupScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var source = await db.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).FirstAsync();
            sourceId = source.Id; recurrenceId = source.RecurrenceId!;
            var session = new EventSession { TenantId = TestData.Tenant1.Id, EventId = source.Id, Title = "Portable session", StartsAtUtc = source.StartsAt.AddMinutes(15), EndsAtUtc = source.StartsAt.AddMinutes(45), Timezone = source.Timezone, Position = 0, CreatedBy = TestData.MemberUser.Id, UpdatedBy = TestData.MemberUser.Id, Status = "scheduled" };
            db.EventSessions.Add(session);
            await db.SaveChangesAsync();
            db.EventSessionSpeakers.Add(new EventSessionSpeaker { TenantId = TestData.Tenant1.Id, EventId = source.Id, SessionId = session.Id, UserId = TestData.MemberUser.Id, RoleLabel = "Host", Position = 0 });
            db.EventSessionResources.Add(new EventSessionResource { TenantId = TestData.Tenant1.Id, EventId = source.Id, SessionId = session.Id, ResourceType = "link", Visibility = "public", Title = "Agenda", UrlCiphertext = "encrypted-agenda-url", Position = 0, CreatedBy = TestData.MemberUser.Id, UpdatedBy = TestData.MemberUser.Id });
            db.EventTicketTypes.Add(new EventTicketType { TenantId = TestData.Tenant1.Id, EventId = source.Id, OccurrenceKey = $"event:{source.Id}", Name = "Portable free ticket", Kind = "free", AllocationLimit = 20, PerMemberLimit = 1, UnitPriceCredits = 0, SalesOpensAt = source.StartsAt.AddDays(-5), SalesClosesAt = source.StartsAt.AddHours(-1), EventStartsAtSnapshot = source.StartsAt, EventTimezoneSnapshot = source.Timezone, Status = "draft", EligibilityPolicy = "{}", CreatedBy = TestData.MemberUser.Id, UpdatedBy = TestData.MemberUser.Id });
            await db.SaveChangesAsync();
        }

        var sections = new { agenda = true, ticket_types = true, registration = false, safety = false, staff = false };
        var previewResponse = await Client.PostAsJsonAsync($"/api/v2/events/{sourceId}/recurrence-definition-blueprints/preview", new { effective_from_recurrence_id = recurrenceId, sections });
        previewResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var preview = (await previewResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        using (var commit = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{sourceId}/recurrence-definition-blueprints/commit") { Content = JsonContent.Create(new { effective_from_recurrence_id = recurrenceId, sections, preview_token = preview.GetProperty("preview_token").GetString() }) })
        {
            commit.Headers.Add("Idempotency-Key", "rolling-blueprint-1");
            (await Client.SendAsync(commit)).StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using var scope = Factory.Services.CreateScope();
        var verify = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rule = await verify.EventRecurrenceRules.IgnoreQueryFilters().SingleAsync(x => x.EventId == rootId);
        rule.EndsType = "never"; rule.EndsAfterCount = null; rule.RRule = "FREQ=DAILY;INTERVAL=1";
        await verify.SaveChangesAsync();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Events:Recurrence:Materialization:LookaheadDays"] = "30",
            ["Events:Recurrence:Materialization:RefreshMarginDays"] = "1",
            ["Events:Recurrence:Materialization:OccurrenceLimit"] = "5",
            ["Events:Recurrence:Materialization:ScanLimit"] = "100"
        }).Build();
        using var loggerFactory = LoggerFactory.Create(builder => builder.SetMinimumLevel(LogLevel.Debug).AddConsole());
        var materializer = new Nexus.Api.Services.EventRecurrenceMaterializationService(
            verify,
            new Nexus.Api.Services.EventRecurrenceDefinitionApplicationService(verify),
            config,
            loggerFactory.CreateLogger<Nexus.Api.Services.EventRecurrenceMaterializationService>());
        var asOf = new DateTime(2027, 6, 16, 12, 0, 0, DateTimeKind.Utc);
        var first = await materializer.MaterializeDueAsync(TestData.Tenant1.Id, asOf, CancellationToken.None);
        first.Succeeded.Should().Be(1); first.OccurrencesInserted.Should().Be(5); first.Truncated.Should().Be(1);

        var existingIds = await verify.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).OrderBy(x => x.StartsAt).Select(x => x.Id).ToListAsync();
        (await verify.EventRecurrenceDefinitionApplications.IgnoreQueryFilters().CountAsync(x => x.RootEventId == rootId)).Should().Be(5);
        (await verify.EventRecurrenceDefinitionApplications.IgnoreQueryFilters().AnyAsync(x => x.EventId == sourceId)).Should().BeFalse();
        var appliedIds = await verify.EventRecurrenceDefinitionApplications.IgnoreQueryFilters().Where(x => x.RootEventId == rootId).Select(x => x.EventId).ToListAsync();
        (await verify.EventSessions.IgnoreQueryFilters().Where(x => appliedIds.Contains(x.EventId)).ToListAsync()).Should().OnlyContain(x => x.StartsAtUtc.Minute == 15 && x.EndsAtUtc.Minute == 45);
        (await verify.EventSessionSpeakers.IgnoreQueryFilters().CountAsync(x => appliedIds.Contains(x.EventId))).Should().Be(5);
        (await verify.EventSessionResources.IgnoreQueryFilters().CountAsync(x => appliedIds.Contains(x.EventId))).Should().Be(5);
        (await verify.EventTicketTypes.IgnoreQueryFilters().Where(x => appliedIds.Contains(x.EventId)).ToListAsync()).Should().OnlyContain(x => x.SalesOpensAt == x.EventStartsAtSnapshot.AddDays(-5) && x.SalesClosesAt == x.EventStartsAtSnapshot.AddHours(-1));

        var second = await materializer.MaterializeDueAsync(TestData.Tenant1.Id, asOf, CancellationToken.None);
        second.OccurrencesInserted.Should().Be(5);
        var recurrenceIds = await verify.Events.IgnoreQueryFilters().Where(x => x.ParentEventId == rootId).Select(x => x.RecurrenceId).ToListAsync();
        recurrenceIds.Should().OnlyHaveUniqueItems();
        (await verify.EventRecurrenceDefinitionApplications.IgnoreQueryFilters().CountAsync(x => x.RootEventId == rootId)).Should().Be(10);
        existingIds.Should().HaveCount(7);

        var root = await verify.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == rootId);
        root.OperationalStatus = "postponed";
        await verify.SaveChangesAsync();
        (await materializer.MaterializeDueAsync(TestData.Tenant1.Id, asOf, CancellationToken.None)).Examined.Should().Be(0);
    }

    [Fact]
    public async Task RecurrenceBoundariesRejectCrossTenantMalformedCursorAndTamperedToken()
    {
        var created = await CreateSeries(2);
        var rootId = created.GetProperty("template").GetProperty("id").GetInt32();
        int sourceId; string recurrenceId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var source = await db.Events.IgnoreQueryFilters().FirstAsync(x => x.ParentEventId == rootId);
            sourceId = source.Id; recurrenceId = source.RecurrenceId!;
        }
        (await Client.GetAsync($"/api/v2/events/{sourceId}/recurrence-definition-blueprints?limit=01")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var preview = await Client.PostAsJsonAsync($"/api/v2/events/{sourceId}/recurrence-revisions/preview", new { patch = new { location = "Safe" } });
        var token = (await preview.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("preview_token").GetString()!;
        using var tampered = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{sourceId}/recurrence-revisions/commit") { Content = JsonContent.Create(new { patch = new { location = "Safe" }, preview_token = token[..^1] + (token[^1] == 'A' ? "B" : "A") }) };
        tampered.Headers.Add("Idempotency-Key", "tampered");
        (await Client.SendAsync(tampered)).StatusCode.Should().Be(HttpStatusCode.Conflict);

        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{sourceId}/recurrence-definition-blueprints")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await Client.PostAsJsonAsync($"/api/v2/events/{sourceId}/recurrence-definition-blueprints/preview", new { effective_from_recurrence_id = recurrenceId, sections = new { agenda = true } })).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RevisionPreview_BlocksNonexistentAndAmbiguousWallTimes()
    {
        var gap = await CreateSeriesAt(1, "2027-03-28T09:00:00Z", "2027-03-28T10:00:00Z", "UTC");
        var gapId = gap.GetProperty("template").GetProperty("series").GetProperty("recurrence").GetProperty("occurrences")[0].GetProperty("id").GetInt32();
        var gapResponse = await Client.PostAsJsonAsync($"/api/v2/events/{gapId}/recurrence-revisions/preview", new { patch = new { timezone = "Europe/Dublin", local_start_time = "01:30" } });
        gapResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var gapData = (await gapResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        gapData.GetProperty("can_commit").GetBoolean().Should().BeFalse();
        gapData.GetProperty("impact").GetProperty("blocking_conflicts")[0].GetProperty("code").GetString().Should().Be("wall_time_nonexistent");

        var fold = await CreateSeriesAt(1, "2027-10-31T09:00:00Z", "2027-10-31T10:00:00Z", "UTC");
        var foldId = fold.GetProperty("template").GetProperty("series").GetProperty("recurrence").GetProperty("occurrences")[0].GetProperty("id").GetInt32();
        var foldResponse = await Client.PostAsJsonAsync($"/api/v2/events/{foldId}/recurrence-revisions/preview", new { patch = new { timezone = "Europe/Dublin", local_start_time = "01:30" } });
        foldResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var foldData = (await foldResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        foldData.GetProperty("can_commit").GetBoolean().Should().BeFalse();
        foldData.GetProperty("impact").GetProperty("blocking_conflicts")[0].GetProperty("code").GetString().Should().Be("wall_time_ambiguous");
    }

    [Fact]
    public async Task MigrationInstalledRecurrenceEvidenceIsImmutableWhenTriggersExist()
    {
        var created = await CreateSeries(2);
        var rootId = created.GetProperty("template").GetProperty("id").GetInt32();
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var triggerInstalled = await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_event_recur_occ_ledger_immutable') AS \"Value\"").SingleAsync();
        if (!triggerInstalled) return; // EnsureCreated path; the clean migration-replay gate exercises this assertion.
        var id = await db.EventRecurrenceOccurrenceLedger.IgnoreQueryFilters().Where(x => x.RootEventId == rootId).Select(x => x.Id).FirstAsync();
        Func<Task> mutation = async () => await db.Database.ExecuteSqlRawAsync("UPDATE event_recurrence_occurrence_ledger SET \"State\"='retired' WHERE \"Id\"={0}", id);
        var failure = await mutation.Should().ThrowAsync<PostgresException>();
        failure.Which.SqlState.Should().Be("P0001");
    }

    private Task<JsonElement> CreateSeries(int count) => CreateSeriesAt(count, "2027-06-15T09:00:00Z", "2027-06-15T10:00:00Z", "UTC");

    private async Task<JsonElement> CreateSeriesAt(int count, string start, string end, string timezone)
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/v2/events/recurring", new
        {
            title = $"Daily series {Guid.NewGuid():N}", description = "Recurring contract test", location = "Hall A",
            start_time = start, end_time = end, timezone,
            recurrence_frequency = "daily", recurrence_interval = 1, recurrence_ends_type = "after_count",
            recurrence_ends_after_count = count
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
    }
}
