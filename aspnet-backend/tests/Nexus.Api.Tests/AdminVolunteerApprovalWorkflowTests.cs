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
public sealed class AdminVolunteerApprovalWorkflowTests : IntegrationTestBase
{
    public AdminVolunteerApprovalWorkflowTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalWorkflow_RequiresAdminAuthentication()
    {
        ClearAuthToken();
        (await Client.GetAsync("/api/v2/admin/volunteering/approvals"))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await AuthenticateAsMemberAsync();
        (await Client.PostAsJsonAsync(
            "/api/v2/admin/volunteering/approvals/1/approve",
            new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ExplicitlyDisabledFeature_BlocksListAndDecisionBeforeLookup()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "feature.volunteering",
                Value = "false",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var list = await Client.GetAsync("/api/v2/admin/volunteering/approvals");
        list.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadJsonAsync(list)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");

        var decision = await Client.PostAsJsonAsync(
            "/api/v2/admin/volunteering/approvals/2147483000/approve",
            new { });
        decision.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadJsonAsync(decision)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task List_ReturnsAllCurrentTenantStatusesPendingFirst_WithReactFields()
    {
        int pendingId;
        int approvedId;
        int declinedId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Food-bank rota");
            var approvedUser = NewUser(TestData.Tenant1.Id, "approved");
            var declinedUser = NewUser(TestData.Tenant1.Id, "declined");
            var otherOpportunity = NewOpportunity(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other tenant rota");
            db.AddRange(opportunity, approvedUser, declinedUser, otherOpportunity);
            await db.SaveChangesAsync();

            var pending = NewApplication(opportunity, TestData.MemberUser.Id, ApplicationStatus.Pending);
            var approved = NewApplication(opportunity, approvedUser.Id, ApplicationStatus.Approved);
            approved.UpdatedAt = DateTime.UtcNow.AddMinutes(-1);
            var declined = NewApplication(opportunity, declinedUser.Id, ApplicationStatus.Declined);
            declined.OrgNote = "No availability this month";
            declined.UpdatedAt = DateTime.UtcNow;
            var other = NewApplication(otherOpportunity, TestData.OtherTenantUser.Id, ApplicationStatus.Pending);
            db.AddRange(pending, approved, declined, other);
            await db.SaveChangesAsync();
            pendingId = pending.Id;
            approvedId = approved.Id;
            declinedId = declined.Id;
            otherTenantId = other.Id;
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/v2/admin/volunteering/approvals");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var rows = body.GetProperty("data").EnumerateArray().ToList();
        rows.Select(row => row.GetProperty("id").GetInt32())
            .Should().Contain(new[] { pendingId, approvedId, declinedId });
        rows.Select(row => row.GetProperty("id").GetInt32()).Should().NotContain(otherTenantId);
        rows[0].GetProperty("id").GetInt32().Should().Be(pendingId);

        var pendingRow = rows.Single(row => row.GetProperty("id").GetInt32() == pendingId);
        pendingRow.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        pendingRow.GetProperty("first_name").GetString().Should().Be(TestData.MemberUser.FirstName);
        pendingRow.GetProperty("last_name").GetString().Should().Be(TestData.MemberUser.LastName);
        pendingRow.GetProperty("email").GetString().Should().Be(TestData.MemberUser.Email);
        pendingRow.GetProperty("opportunity_title").GetString().Should().Be("Food-bank rota");
        pendingRow.GetProperty("status").GetString().Should().Be("pending");
        pendingRow.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
        rows.Single(row => row.GetProperty("id").GetInt32() == declinedId)
            .GetProperty("org_note").GetString().Should().Be("No availability this month");
    }

    [Fact]
    public async Task Approve_ShiftlessPendingApplication_CommitsOnceAndNotifies()
    {
        var scenario = await CreateApplicationAsync();
        await AuthenticateAsAdminAsync();

        var first = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{scenario.ApplicationId}/approve",
            new { });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstBody = await ReadJsonAsync(first);
        firstBody.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        firstBody.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        var retry = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{scenario.ApplicationId}/approve",
            new { });
        retry.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(retry)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId);
        stored.Status.Should().Be(ApplicationStatus.Approved);
        stored.ReviewedById.Should().Be(TestData.AdminUser.Id);
        stored.ReviewedAt.Should().NotBeNull();

        var notifications = await db.Notifications.IgnoreQueryFilters()
            .Where(row => row.UserId == scenario.ApplicantId && row.Type == "moderation")
            .ToListAsync();
        notifications.Should().ContainSingle();
        notifications[0].Title.Should().Be("New Notification");
        notifications[0].Body.Should().Be("Your volunteer application has been approved!");
        notifications[0].Link.Should().Be("/volunteering");
        notifications[0].Data.Should().Contain("/volunteering");

        var emails = await db.Set<EmailLog>().IgnoreQueryFilters()
            .Where(row => row.UserId == scenario.ApplicantId && row.TemplateKey == "volunteer_application_approved")
            .ToListAsync();
        emails.Should().ContainSingle();
        emails[0].Subject.Should().Be("Your volunteer application was approved");

        await AuthenticateAsMemberAsync();
        var notificationsResponse = await Client.GetAsync("/api/v2/notifications");
        notificationsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var notificationWire = (await ReadJsonAsync(notificationsResponse))
            .GetProperty("data")
            .EnumerateArray()
            .Single(item => item.GetProperty("type").GetString() == "moderation");
        notificationWire.GetProperty("title").GetString().Should().Be("New Notification");
        notificationWire.GetProperty("link").GetString().Should().Be("/volunteering");
        notificationWire.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Object);
        notificationWire.GetProperty("data").GetProperty("application_id").GetInt32()
            .Should().Be(scenario.ApplicationId);
    }

    [Fact]
    public async Task Decline_CommitsOnceAndDoesNotQueueApprovalEmail()
    {
        var scenario = await CreateApplicationAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{scenario.ApplicationId}/decline",
            new { });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.ApplicationId))
            .Status.Should().Be(ApplicationStatus.Declined);
        var notifications = await db.Notifications.IgnoreQueryFilters()
            .Where(row => row.UserId == scenario.ApplicantId && row.Type == "moderation")
            .ToListAsync();
        notifications.Should().ContainSingle();
        notifications[0].Title.Should().Be("New Notification");
        notifications[0].Body.Should().Be("Your volunteer application was not accepted.");
        notifications[0].Link.Should().BeNull();
        (await db.Set<EmailLog>().IgnoreQueryFilters()
            .CountAsync(row => row.UserId == scenario.ApplicantId && row.TemplateKey == "volunteer_application_approved"))
            .Should().Be(0);
    }

    [Fact]
    public async Task Approve_RejectsCrossTenantApplication_AndDatabaseRejectsCrossOpportunityShift()
    {
        int crossTenantApplicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var localOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Local opportunity");
            var otherOpportunity = NewOpportunity(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other opportunity");
            db.AddRange(localOpportunity, otherOpportunity);
            await db.SaveChangesAsync();

            var otherShift = NewShift(otherOpportunity, maxVolunteers: 2);
            db.VolunteerShifts.Add(otherShift);
            await db.SaveChangesAsync();

            var crossTenant = NewApplication(otherOpportunity, TestData.OtherTenantUser.Id, ApplicationStatus.Pending);
            db.VolunteerApplications.Add(crossTenant);
            await db.SaveChangesAsync();
            crossTenantApplicationId = crossTenant.Id;

            // A shift from another opportunity/tenant is no longer a controller-reachable
            // state: the composite application/shift foreign key rejects it at persistence.
            var crossOpportunityShift = NewApplication(
                localOpportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Pending);
            crossOpportunityShift.ShiftId = otherShift.Id;
            db.VolunteerApplications.Add(crossOpportunityShift);
            Func<Task> persistInvalidShift = () => db.SaveChangesAsync();
            await persistInvalidShift.Should().ThrowAsync<DbUpdateException>();
        }

        await AuthenticateAsAdminAsync();
        var crossTenantResponse = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{crossTenantApplicationId}/approve",
            new { });
        crossTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadJsonAsync(crossTenantResponse)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task Approve_CountsApprovedApplicationsAndActiveGroupReservationsAgainstCapacity()
    {
        int pendingId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Capacity opportunity");
            var approvedUser = NewUser(TestData.Tenant1.Id, "capacity-approved");
            var group = new Group
            {
                TenantId = TestData.Tenant1.Id,
                CreatedById = TestData.AdminUser.Id,
                Name = "Capacity group",
                CreatedAt = DateTime.UtcNow
            };
            db.AddRange(opportunity, approvedUser, group);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, maxVolunteers: 2);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var approved = NewApplication(opportunity, approvedUser.Id, ApplicationStatus.Approved);
            approved.ShiftId = shift.Id;
            var pending = NewApplication(opportunity, TestData.MemberUser.Id, ApplicationStatus.Pending);
            pending.ShiftId = shift.Id;
            db.AddRange(approved, pending, new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                GroupId = group.Id,
                ReservedBy = TestData.AdminUser.Id,
                ReservedSlots = 1,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            pendingId = pending.Id;
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{pendingId}/approve",
            new { });
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("field").GetString().Should().Be("shift_id");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().SingleAsync(row => row.Id == pendingId))
            .Status.Should().Be(ApplicationStatus.Pending);
    }

    [Fact]
    public async Task ConcurrentApprovalsForLastShiftPlace_HaveOneWinnerAndOneNotificationEmailSet()
    {
        int firstId;
        int secondId;
        int firstUserId;
        int secondUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Last place opportunity");
            var firstUser = NewUser(TestData.Tenant1.Id, "last-place-one");
            var secondUser = NewUser(TestData.Tenant1.Id, "last-place-two");
            db.AddRange(opportunity, firstUser, secondUser);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var first = NewApplication(opportunity, firstUser.Id, ApplicationStatus.Pending);
            first.ShiftId = shift.Id;
            var second = NewApplication(opportunity, secondUser.Id, ApplicationStatus.Pending);
            second.ShiftId = shift.Id;
            db.AddRange(first, second);
            await db.SaveChangesAsync();
            firstId = first.Id;
            secondId = second.Id;
            firstUserId = firstUser.Id;
            secondUserId = secondUser.Id;
        }

        await AuthenticateAsAdminAsync();
        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync($"/api/v2/admin/volunteering/approvals/{firstId}/approve", new { }),
            Client.PostAsJsonAsync($"/api/v2/admin/volunteering/approvals/{secondId}/approve", new { }));
        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity });

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync(row =>
            (row.Id == firstId || row.Id == secondId) && row.Status == ApplicationStatus.Approved))
            .Should().Be(1);
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(row =>
            (row.UserId == firstUserId || row.UserId == secondUserId) && row.Type == "moderation"))
            .Should().Be(1);
        (await verifyDb.Set<EmailLog>().IgnoreQueryFilters().CountAsync(row =>
            (row.UserId == firstUserId || row.UserId == secondUserId) &&
            row.TemplateKey == "volunteer_application_approved"))
            .Should().Be(1);
    }

    private async Task<ApplicationScenario> CreateApplicationAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Neighbour support");
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();
        var application = NewApplication(opportunity, TestData.MemberUser.Id, ApplicationStatus.Pending);
        db.VolunteerApplications.Add(application);
        await db.SaveChangesAsync();
        return new ApplicationScenario(application.Id, application.UserId);
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId, string title) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = title,
        Description = "Test opportunity",
        Status = OpportunityStatus.Published,
        RequiredVolunteers = 2,
        CreatedAt = DateTime.UtcNow
    };

    private static VolunteerShift NewShift(VolunteerOpportunity opportunity, int maxVolunteers) => new()
    {
        TenantId = opportunity.TenantId,
        OpportunityId = opportunity.Id,
        Title = "Morning",
        StartsAt = DateTime.UtcNow.AddDays(1),
        EndsAt = DateTime.UtcNow.AddDays(1).AddHours(2),
        MaxVolunteers = maxVolunteers,
        Status = ShiftStatus.Scheduled,
        CreatedAt = DateTime.UtcNow
    };

    private static VolunteerApplication NewApplication(
        VolunteerOpportunity opportunity,
        int userId,
        ApplicationStatus status) => new()
    {
        TenantId = opportunity.TenantId,
        OpportunityId = opportunity.Id,
        UserId = userId,
        Status = status,
        Message = "I can help",
        CreatedAt = DateTime.UtcNow
    };

    private static User NewUser(int tenantId, string prefix) => new()
    {
        TenantId = tenantId,
        Email = $"{prefix}-{Guid.NewGuid():N}@test.local",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
        FirstName = prefix,
        LastName = "Volunteer",
        Role = "member",
        IsActive = true,
        RegistrationStatus = RegistrationStatus.Active,
        CreatedAt = DateTime.UtcNow
    };

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private sealed record ApplicationScenario(int ApplicationId, int ApplicantId);
}
