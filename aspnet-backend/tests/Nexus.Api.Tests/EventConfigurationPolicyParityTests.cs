// Copyright Â© 2024â€“2026 Jasper Ford
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

[Collection("Integration")]
public sealed class EventConfigurationPolicyParityTests : IntegrationTestBase
{
    public EventConfigurationPolicyParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Configuration_IsTenantScopedVersionedTypedAndAudited()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/v2/admin/config/events")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AuthenticateAsAdminAsync();
        var initial = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/config/events");
        initial.GetProperty("data").GetProperty("version").GetInt32().Should().Be(0);
        initial.GetProperty("data").GetProperty("config").GetProperty("creation_role").GetString().Should().Be("members");
        initial.GetProperty("data").GetProperty("capabilities").GetProperty("notification_delivery").GetProperty("resolved_mode").GetString().Should().Be("direct");

        var updated = await Client.PutAsJsonAsync("/api/v2/admin/config/events", new
        {
            version = "0", reason = "Require staff ownership for the pilot.",
            settings = new { creation_role = "staff", default_capacity = 75, waitlist_enabled = false }
        });
        updated.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("version").GetInt32().Should().Be(1);
        data.GetProperty("config").GetProperty("creation_role").GetString().Should().Be("staff");
        data.GetProperty("config").GetProperty("default_capacity").GetInt32().Should().Be(75);

        (await Client.PutAsJsonAsync("/api/v2/admin/config/events", new { version = 0, reason = "Stale browser tab.", settings = new { waitlist_enabled = true } })).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await Client.PutAsJsonAsync("/api/v2/admin/config/events", new { version = 1, reason = "Unsafe dependency.", settings = new { timed_waitlist_offers_enabled = true } })).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var audit = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/config/events/audit-log");
        var entry = audit.GetProperty("data")[0];
        entry.GetProperty("action").GetString().Should().Be("events_configuration_updated");
        entry.GetProperty("actor_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        entry.GetProperty("version").GetInt32().Should().Be(1);
        entry.GetProperty("reason").GetString().Should().Be("Require staff ownership for the pilot.");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.TenantConfigs.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant1.Id && x.Key == "events.configuration")).Should().Be(1);
        (await db.TenantConfigs.IgnoreQueryFilters().CountAsync(x => x.TenantId == TestData.Tenant2.Id && x.Key == "events.configuration")).Should().Be(0);
    }

    [Fact]
    public async Task DisruptiveDisable_RequiresConfirmationAndAppliesReminderAndFederationEffects()
    {
        int eventId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Shared policy event", StartsAt = DateTime.UtcNow.AddDays(3), EndsAt = DateTime.UtcNow.AddDays(3).AddHours(1), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled", FederatedVisibility = "listed" };
            db.Events.Add(evt); await db.SaveChangesAsync(); eventId = evt.Id;
            db.EventReminders.Add(new EventReminder { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, Status = "pending", IsSent = false });
            db.FederationExternalPartners.Add(new FederationExternalPartner { TenantId = TestData.Tenant1.Id, Name = "Policy partner", BaseUrl = "https://partner.example.test", ProtocolType = "nexus", Status = "active", AllowEvents = true });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var body = new { version = 0, reason = "Pause external delivery and reminders.", settings = new { federation_sharing_enabled = false, reminders_enabled = false } };
        var blocked = await Client.PutAsJsonAsync("/api/v2/admin/config/events", body);
        blocked.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await blocked.Content.ReadAsStringAsync()).Should().Contain("confirm_disruptive");
        var applied = await Client.PutAsJsonAsync("/api/v2/admin/config/events", new { body.version, body.reason, body.settings, confirm_disruptive = true });
        applied.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await applied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("impact").GetProperty("shared_events").GetInt32().Should().Be(0);
        data.GetProperty("impact").GetProperty("pending_reminders").GetInt32().Should().Be(0);

        using var finalScope = Factory.Services.CreateScope();
        var finalDb = finalScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var evtAfter = await finalDb.Events.IgnoreQueryFilters().SingleAsync(x => x.Id == eventId);
        evtAfter.FederatedVisibility.Should().Be("none"); evtAfter.FederationVersion.Should().BeGreaterThan(0);
        (await finalDb.EventReminders.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId)).Status.Should().Be("cancelled");
        var delivery = await finalDb.EventFederationDeliveries.IgnoreQueryFilters().SingleAsync(x => x.EventId == eventId);
        delivery.Action.Should().Be("tombstone"); delivery.Status.Should().Be("pending");
    }

    [Fact]
    public async Task RestoreDefaults_IsSelectiveAuditedAndIdempotent()
    {
        await AuthenticateAsAdminAsync();
        (await Client.PutAsJsonAsync("/api/v2/admin/config/events", new { version = 0, reason = "Install tenant overrides.", settings = new { creation_role = "admins", default_capacity = 80 } })).EnsureSuccessStatusCode();
        var selective = await Client.PostAsJsonAsync("/api/v2/admin/config/events/restore-defaults", new { version = 1, reason = "Restore creation policy only.", keys = new[] { "creation_role" } });
        selective.EnsureSuccessStatusCode();
        var selected = (await selective.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        selected.GetProperty("version").GetInt32().Should().Be(2);
        selected.GetProperty("config").GetProperty("creation_role").GetString().Should().Be("members");
        selected.GetProperty("config").GetProperty("default_capacity").GetInt32().Should().Be(80);

        var all = await Client.PostAsJsonAsync("/api/v2/admin/config/events/restore-defaults", new { version = 2, reason = "Return all remaining settings to inherited policy." });
        all.EnsureSuccessStatusCode();
        var restored = (await all.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        restored.GetProperty("version").GetInt32().Should().Be(3);
        restored.GetProperty("config").GetProperty("default_capacity").GetInt32().Should().Be(0);
        restored.GetProperty("restored").GetBoolean().Should().BeTrue();

        var replay = await Client.PostAsJsonAsync("/api/v2/admin/config/events/restore-defaults", new { version = 3, reason = "Idempotent repeat." });
        replay.EnsureSuccessStatusCode();
        var replayed = (await replay.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        replayed.GetProperty("version").GetInt32().Should().Be(3);
        replayed.GetProperty("restored").GetBoolean().Should().BeFalse();
        var audit = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/config/events/audit-log");
        audit.GetProperty("data")[0].GetProperty("action").GetString().Should().Be("events_configuration_defaults_restored");
        audit.GetProperty("data")[0].GetProperty("version").GetInt32().Should().Be(3);
    }
}
