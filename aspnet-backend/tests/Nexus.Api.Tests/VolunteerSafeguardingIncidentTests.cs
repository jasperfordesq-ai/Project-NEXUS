// Copyright © 2024–2026 Jasper Ford
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
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Safeguarding concerns raised during volunteering (R-27).
///
/// 🔴 The worst gap found in this backend. A volunteer could report a
/// safeguarding concern and be told "Incident recorded" while the report went
/// into an opaque tenant-config blob nothing read: their own list returned an
/// empty array, the single-incident endpoint fabricated {id, status:"open"} for
/// any id, and no admin surface read incidents at all. Accepted, acknowledged,
/// and lost.
///
/// Every test here asserts something a safeguarding process depends on, so none
/// of them is a shape check: the report reaches the staff queue, the reporter
/// cannot read anyone else's, nobody can delete one, a closure needs a reason,
/// and the queue puts the most severe first.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerSafeguardingIncidentTests : IntegrationTestBase
{
    public VolunteerSafeguardingIncidentTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> ReportAsync(string description, string severity = "high", string? title = null)
    {
        var response = await Client.PostAsJsonAsync("/api/v2/volunteering/incidents", new
        {
            title = title ?? "Concern raised on shift",
            description,
            severity,
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task AReportedConcern_ReachesTheStaffQueue()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("A child disclosed something during the session.", "critical");

        // The reporter can see their own.
        var mine = await Client.GetAsync("/api/v2/volunteering/incidents");
        // 🔴 Laravel sends {"data":{"items":[...],"total":N}} — verified live 2026-08-19.
        // The list used to sit at the root with `page`/`per_page` beside it, neither of
        // which Laravel sends on this endpoint.
        var items = (await mine.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("items");
        items.EnumerateArray().Select(i => i.GetProperty("id").GetInt32())
            .Should().Contain(id, "the reporter's own list returned an empty array before");

        // And so can staff — which is the part that was entirely missing.
        await AuthenticateAsAdminAsync();
        var queue = await Client.GetAsync("/api/v2/admin/volunteering/incidents");
        queue.StatusCode.Should().Be(HttpStatusCode.OK);
        var queued = (await queue.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        var found = queued.EnumerateArray().SingleOrDefault(i => i.GetProperty("id").GetInt32() == id);
        found.ValueKind.Should().NotBe(JsonValueKind.Undefined,
            "no admin surface read incidents at all, so every report was invisible to safeguarding staff");
        found.GetProperty("description").GetString()
            .Should().Be("A child disclosed something during the session.");
        found.GetProperty("status").GetString().Should().Be("open");
    }

    [Fact]
    public async Task AMemberCannotReadAnotherMembersConcern()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("Private detail about a named person.");

        await AuthenticateAsOtherTenantUserAsync();
        var attempt = await Client.GetAsync($"/api/v2/volunteering/incidents/{id}");

        attempt.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "404 rather than 403 — confirming an incident exists is itself a disclosure, "
            + "and the old handler answered a fabricated record for any id");
    }

    [Fact]
    public async Task NobodyCanDeleteAReport()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("Raised then regretted.");

        // No DELETE route exists, by design.
        var asReporter = await Client.DeleteAsync($"/api/v2/volunteering/incidents/{id}");
        asReporter.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed);

        await AuthenticateAsAdminAsync();
        var asAdmin = await Client.DeleteAsync($"/api/v2/admin/volunteering/incidents/{id}");
        asAdmin.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Set<VolunteerSafeguardingIncident>().IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(i => i.Id == id))
            .Should().BeTrue("a raised concern is a record; withdrawal is a status, not an erasure");
    }

    [Fact]
    public async Task AnOrdinaryMemberCannotTriage()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("Needs triage.");

        var attempt = await Client.PutAsJsonAsync($"/api/v2/admin/volunteering/incidents/{id}", new
        {
            status = "closed",
            resolution_notes = "Nothing to see here",
        });

        // Forbidden or Unauthorized both mean "refused"; the point is that an
        // ordinary member cannot close a safeguarding concern.
        attempt.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Set<VolunteerSafeguardingIncident>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(i => i.Id == id))
            .Status.Should().Be("open");
    }

    [Fact]
    public async Task ClosingAConcern_RequiresAReason()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("To be closed.");

        await AuthenticateAsAdminAsync();

        var withoutReason = await Client.PutAsJsonAsync($"/api/v2/admin/volunteering/incidents/{id}", new
        {
            status = "closed",
        });
        withoutReason.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "'why was this closed?' is the first question any review asks");

        var withReason = await Client.PutAsJsonAsync($"/api/v2/admin/volunteering/incidents/{id}", new
        {
            status = "closed",
            resolution_notes = "Spoke with both parties; no further action needed.",
        });
        withReason.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var closed = await db.Set<VolunteerSafeguardingIncident>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(i => i.Id == id);
        closed.Status.Should().Be("closed");
        closed.ResolvedAt.Should().NotBeNull("a closure needs a date as well as a reason");
    }

    [Fact]
    public async Task TheQueuePutsTheMostSevereFirst()
    {
        await AuthenticateAsMemberAsync();
        var low = await ReportAsync("Low concern.", "low", "Low one");
        var critical = await ReportAsync("Critical concern.", "critical", "Critical one");

        await AuthenticateAsAdminAsync();
        var queue = await Client.GetAsync("/api/v2/admin/volunteering/incidents");
        var ids = (await queue.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .EnumerateArray().Select(i => i.GetProperty("id").GetInt32()).ToList();

        ids.IndexOf(critical).Should().BeLessThan(ids.IndexOf(low),
            "the queue is read top-down under pressure, so a critical concern must not sit below a low one");
    }

    [Fact]
    public async Task AConcernCannotBeRaisedWithoutADescription_OrInAnUnknownState()
    {
        await AuthenticateAsMemberAsync();

        (await Client.PostAsJsonAsync("/api/v2/volunteering/incidents", new { title = "Empty" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await Client.PostAsJsonAsync("/api/v2/volunteering/incidents",
            new { description = "x", severity = "apocalyptic" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest,
                "a report in a severity no queue filters on would never be looked at");

        (await Client.PostAsJsonAsync("/api/v2/volunteering/incidents",
            new { description = "x", incident_type = "gossip" }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task NotifyingTheSafeguardingLead_IsRecordedWithATime()
    {
        await AuthenticateAsMemberAsync();
        var id = await ReportAsync("Needs the designated lead.");

        await AuthenticateAsAdminAsync();
        var response = await Client.PutAsJsonAsync($"/api/v2/admin/volunteering/incidents/{id}", new
        {
            dlp_user_id = TestData.AdminUser.Id,
            authority_notified = true,
            authority_reference = "REF-1234",
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var incident = await db.Set<VolunteerSafeguardingIncident>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(i => i.Id == id);

        incident.DlpUserId.Should().Be(TestData.AdminUser.Id);
        incident.DlpNotifiedAt.Should().NotBeNull(
            "'the lead was told' without a time cannot answer how long it took");
        incident.AuthorityNotified.Should().BeTrue();
        incident.AuthorityReference.Should().Be("REF-1234");
    }
}
