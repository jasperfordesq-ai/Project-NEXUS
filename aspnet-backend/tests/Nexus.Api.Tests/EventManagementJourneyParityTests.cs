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

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventManagementJourneyParityTests : IntegrationTestBase
{
    public EventManagementJourneyParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalCreateAndEdit_ReturnClientContractAndPersistReactPayload()
    {
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("X-Events-Contract", "2");
        var startsAt = DateTimeOffset.UtcNow.AddDays(10).AddMinutes(1);
        var endsAt = startsAt.AddHours(2);

        var created = await Client.PostAsJsonAsync("/api/v2/events", new
        {
            title = "Neighbourhood repair café",
            description = "Bring one small household item.",
            start_time = startsAt,
            end_time = endsAt,
            timezone = "Europe/Dublin",
            all_day = false,
            location = "Community hall",
            latitude = 53.3498,
            longitude = -6.2603,
            venue_accessibility = new
            {
                step_free_access = true,
                accessible_toilet = true,
                hearing_loop = false,
                quiet_space = true,
                seating_available = true,
                accessible_parking = false,
                parking_details = "Blue badge spaces nearby",
                transit_details = "Bus stop outside",
                assistance_contact = "Ask at reception",
                notes = "Side entrance is step-free",
            },
            max_attendees = 24,
            allow_remote_attendance = true,
            video_url = "https://meet.example.test/repair-cafe",
        });

        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var createdData = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        createdData.GetProperty("contract_version").GetInt32().Should().Be(2);
        createdData.GetProperty("title").GetString().Should().Be("Neighbourhood repair café");
        createdData.GetProperty("schedule").GetProperty("timezone").GetString().Should().Be("Europe/Dublin");
        createdData.GetProperty("location").GetProperty("mode").GetString().Should().Be("hybrid");
        createdData.GetProperty("location").GetProperty("accessibility").GetProperty("step_free_access").GetBoolean().Should().BeTrue();
        createdData.GetProperty("permissions").GetProperty("edit").GetBoolean().Should().BeTrue();
        createdData.GetProperty("online_access").GetProperty("video_url").GetString().Should().Be("https://meet.example.test/repair-cafe");
        var eventId = createdData.GetProperty("id").GetInt32();

        var updatedStartsAt = startsAt.AddDays(1);
        var updated = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}", new
        {
            title = "Neighbourhood repair and reuse café",
            start_time = updatedStartsAt,
            end_time = updatedStartsAt.AddHours(3),
            timezone = "Europe/London",
            all_day = false,
            location = "Library workshop",
            latitude = 51.5072,
            longitude = -0.1276,
            max_attendees = 30,
            allow_remote_attendance = false,
            video_url = (string?)null,
        });

        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var updatedData = (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        updatedData.GetProperty("contract_version").GetInt32().Should().Be(2);
        updatedData.GetProperty("title").GetString().Should().Be("Neighbourhood repair and reuse café");
        updatedData.GetProperty("schedule").GetProperty("timezone").GetString().Should().Be("Europe/London");
        updatedData.GetProperty("location").GetProperty("label").GetString().Should().Be("Library workshop");
        updatedData.GetProperty("location").GetProperty("mode").GetString().Should().Be("in_person");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var saved = await db.Events.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == eventId);
        saved.TenantId.Should().Be(TestData.Tenant1.Id);
        saved.CreatedById.Should().Be(TestData.MemberUser.Id);
        saved.Title.Should().Be("Neighbourhood repair and reuse café");
        saved.StartsAt.Should().BeCloseTo(updatedStartsAt.UtcDateTime, TimeSpan.FromSeconds(1));
        saved.Timezone.Should().Be("Europe/London");
        saved.Latitude.Should().Be(51.5072);
        saved.Longitude.Should().Be(-0.1276);
        saved.MaxAttendees.Should().Be(30);
        saved.AllowRemoteAttendance.Should().BeFalse();
        saved.VideoUrl.Should().BeNull();
        saved.AccessibilityStepFree.Should().BeTrue("an omitted accessibility block on edit must preserve the organizer's earlier declaration");
    }

    [Fact]
    public async Task Edit_IsOwnerAuthorizedAndOtherTenantCannotDiscoverEvent()
    {
        await AuthenticateAsMemberAsync();
        Client.DefaultRequestHeaders.Add("X-Events-Contract", "2");
        var created = await Client.PostAsJsonAsync("/api/v2/events", new
        {
            title = "Tenant-private planning event",
            start_time = DateTimeOffset.UtcNow.AddDays(5),
            timezone = "UTC",
            all_day = false,
        });
        var eventId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();

        await AuthenticateAsOtherTenantUserAsync();
        var refused = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}", new { title = "Cross-tenant overwrite" });

        refused.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Events.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == eventId)).Title
            .Should().Be("Tenant-private planning event");
    }

    [Fact]
    public async Task Edit_RefusesSameTenantMemberWhoDoesNotManageEvent()
    {
        int eventId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var ev = new Event
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Title = "Organizer-only event",
                StartsAt = DateTime.UtcNow.AddDays(4),
                Status = "draft",
                PublicationStatus = "draft",
                OperationalStatus = "scheduled",
            };
            db.Events.Add(ev);
            await db.SaveChangesAsync();
            eventId = ev.Id;
        }

        await AuthenticateAsMemberAsync();
        var refused = await Client.PutAsJsonAsync($"/api/v2/events/{eventId}", new { title = "Unauthorized edit" });

        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.Events.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == eventId)).Title
            .Should().Be("Organizer-only event");
    }
}
