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
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventStaffWorkflowParityTests : IntegrationTestBase
{
    public EventStaffWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task OwnerGrantListRevoke_IsVersionedIdempotentAndReactShaped()
    {
        var eventId = await EventAsync(); await AuthenticateAsAdminAsync(); var expiry = DateTime.UtcNow.AddMonths(1).ToString("O");
        var created = await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "communications_manager", expires_at = expiry }, "staff-grant-0001");
        var createdText = await created.Content.ReadAsStringAsync(); created.StatusCode.Should().Be(HttpStatusCode.Created, createdText); var data = JsonDocument.Parse(createdText).RootElement.GetProperty("data"); var assignment = data.GetProperty("assignment"); assignment.GetProperty("member").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id); assignment.GetProperty("capabilities").EnumerateArray().Select(x => x.GetString()).Should().Contain("broadcast"); assignment.GetProperty("history_metadata").GetProperty("immutable").GetBoolean().Should().BeTrue(); var assignmentId = assignment.GetProperty("id").GetInt64();
        var replay = await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "communications_manager", expires_at = expiry }, "staff-grant-0001"); var replayText = await replay.Content.ReadAsStringAsync(); replay.StatusCode.Should().Be(HttpStatusCode.OK, replayText); JsonDocument.Parse(replayText).RootElement.GetProperty("data").GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();
        var listed = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/staff?include_inactive=true"); listed.GetProperty("data").GetArrayLength().Should().Be(1); listed.GetProperty("meta").GetProperty("role_capabilities").GetProperty("co_organizer").EnumerateArray().Select(x => x.GetString()).Should().Contain("manageStaff");
        var revoked = await Delete($"/api/v2/events/{eventId}/staff/{assignmentId}", "staff-revoke-0001"); var revokedText = await revoked.Content.ReadAsStringAsync(); revoked.StatusCode.Should().Be(HttpStatusCode.OK, revokedText); var r = JsonDocument.Parse(revokedText).RootElement.GetProperty("data").GetProperty("assignment"); r.GetProperty("status").GetString().Should().Be("revoked"); r.GetProperty("version").GetInt64().Should().Be(2); r.GetProperty("history").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task CoOrganizerDelegation_IsContainedToNonPrivilegedRoles()
    {
        var eventId = await EventAsync(); var targetId = await MemberAsync(); await AuthenticateAsAdminAsync(); await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "co_organizer" }, "staff-coorg-seed"); await AuthenticateAsMemberAsync(); var allowed = await Post($"/api/v2/events/{eventId}/staff", new { user_id = targetId, role = "registration_manager" }, "staff-delegated-allowed"); allowed.StatusCode.Should().Be(HttpStatusCode.Created); (await Post($"/api/v2/events/{eventId}/staff", new { user_id = targetId, role = "finance_manager" }, "staff-delegated-finance")).StatusCode.Should().Be(HttpStatusCode.Forbidden); (await Post($"/api/v2/events/{eventId}/staff", new { user_id = targetId, role = "co_organizer" }, "staff-delegated-coorg")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task TenantOwnerAndIdempotencyBoundaries_FailClosed()
    {
        var eventId = await EventAsync(); await AuthenticateAsAdminAsync(); (await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.AdminUser.Id, role = "check_in_staff" }, "staff-owner-invalid")).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity); await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "check_in_staff" }, "staff-key-conflict"); var conflict = await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "communications_manager" }, "staff-key-conflict"); conflict.StatusCode.Should().Be(HttpStatusCode.Conflict); var mismatch = new HttpRequestMessage(HttpMethod.Post, $"/api/v2/events/{eventId}/staff") { Content = JsonContent.Create(new { user_id = TestData.MemberUser.Id, role = "check_in_staff", idempotency_key = "body-key" }) }; mismatch.Headers.Add("Idempotency-Key", "header-key"); (await Client.SendAsync(mismatch)).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity); await AuthenticateAsOtherTenantUserAsync(); (await Client.GetAsync($"/api/v2/events/{eventId}/staff")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MutationsAppendVersionedHistoryAndDomainOutboxEvidence()
    {
        var eventId = await EventAsync(); await AuthenticateAsAdminAsync(); var created = await Post($"/api/v2/events/{eventId}/staff", new { user_id = TestData.MemberUser.Id, role = "check_in_staff" }, "staff-evidence-grant"); var assignmentId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("assignment").GetProperty("id").GetInt64(); await Delete($"/api/v2/events/{eventId}/staff/{assignmentId}", "staff-evidence-revoke"); using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var history = await db.EventStaffAssignmentHistory.IgnoreQueryFilters().Where(x => x.EventId == eventId).OrderBy(x => x.AssignmentVersion).ToListAsync(); history.Should().HaveCount(2); history.Select(x => x.Action).Should().Equal("granted", "revoked"); history.Select(x => x.AssignmentVersion).Should().Equal(1, 2); var outbox = await db.EventDomainOutbox.IgnoreQueryFilters().Where(x => x.EventId == eventId && x.AggregateStream == "staff").OrderBy(x => x.AggregateVersion).ToListAsync(); outbox.Should().HaveCount(2); outbox.Select(x => x.Action).Should().Equal("event.staff_role.granted", "event.staff_role.revoked");
    }

    private async Task<int> EventAsync() { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Staff event", StartsAt = DateTime.UtcNow.AddDays(3), EndsAt = DateTime.UtcNow.AddDays(3).AddHours(2), Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" }; db.Events.Add(evt); await db.SaveChangesAsync(); return evt.Id; }
    private async Task<int> MemberAsync() { using var scope = Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>(); var user = new User { TenantId = TestData.Tenant1.Id, Email = $"staff-target-{Guid.NewGuid():N}@example.test", FirstName = "Target", LastName = "Member", PasswordHash = "unused", Role = "member", IsActive = true }; db.Users.Add(user); await db.SaveChangesAsync(); return user.Id; }
    private Task<HttpResponseMessage> Post(string path, object body, string key) { var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); } private Task<HttpResponseMessage> Delete(string path, string key) { var request = new HttpRequestMessage(HttpMethod.Delete, path); request.Headers.Add("Idempotency-Key", key); return Client.SendAsync(request); }
}
