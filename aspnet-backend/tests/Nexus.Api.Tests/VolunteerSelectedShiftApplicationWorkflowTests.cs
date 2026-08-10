// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
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
public sealed class VolunteerSelectedShiftApplicationWorkflowTests : IntegrationTestBase
{
    private const string AutoApproveKey = "volunteering.auto_approve_applications";

    public VolunteerSelectedShiftApplicationWorkflowTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SelectedShift_DefaultsPendingAndReturnsCanonicalCreatedEnvelope()
    {
        var scenario = await CreateOpportunityWithShiftAsync(maxVolunteers: 2);
        await AuthenticateAsMemberAsync();

        var response = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "I can cover this shift");

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync(response);
        var data = body.GetProperty("data");
        data.GetProperty("opportunity_id").GetInt32().Should().Be(scenario.OpportunityId);
        data.GetProperty("user_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("shift_id").GetInt32().Should().Be(scenario.ShiftId);
        data.GetProperty("status").GetString().Should().Be("pending");
        data.GetProperty("message").GetString().Should().Be("I can cover this shift");
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == data.GetProperty("id").GetInt32());
        stored.Status.Should().Be(ApplicationStatus.Pending);
        stored.ShiftId.Should().Be(scenario.ShiftId);
        var notification = await db.Notifications.IgnoreQueryFilters()
            .SingleAsync(candidate =>
                candidate.TenantId == TestData.Tenant1.Id
                && candidate.UserId == TestData.AdminUser.Id
                && candidate.Type == "vol_application_received"
                && candidate.Data != null
                && candidate.Data.Contains($"\"application_id\":{stored.Id}"));
        notification.Title.Should().Be("New volunteer application");
        notification.Body.Should().Be(
            $"{TestData.MemberUser.FirstName} {TestData.MemberUser.LastName} applied for your volunteer opportunity: "
            + (await db.VolunteerOpportunities.IgnoreQueryFilters()
                .Where(opportunity => opportunity.Id == scenario.OpportunityId)
                .Select(opportunity => opportunity.Title)
                .SingleAsync()));
    }

    [Fact]
    public async Task Apply_WhenVolunteeringFeatureIsDisabled_ReturnsCanonicalForbiddenWithoutWriting()
    {
        var scenario = await CreateOpportunityWithShiftAsync(maxVolunteers: 2);
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

        await AuthenticateAsMemberAsync();

        var response = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertErrorAsync(
            response,
            "FEATURE_DISABLED",
            "Volunteering module is not enabled for this community");
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().AnyAsync(application =>
            application.TenantId == TestData.Tenant1.Id
            && application.OpportunityId == scenario.OpportunityId))
            .Should().BeFalse();
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.Type == "vol_application_received"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task Apply_WhenConfiguredMinorLacksGuardianConsent_BlocksUntilGrantedConsentExists()
    {
        var scenario = await CreateOpportunityWithShiftAsync(maxVolunteers: 2);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "volunteering.guardian_consent_required",
                Value = "true",
                CreatedAt = DateTime.UtcNow
            });
            var dateOfBirth = DateTime.UtcNow.AddYears(-12).ToString("yyyy-MM-dd");
            var notificationPreferences = JsonSerializer.Serialize(new { date_of_birth = dateOfBirth });
            await db.Users.IgnoreQueryFilters()
                .Where(user =>
                    user.Id == TestData.MemberUser.Id
                    && user.TenantId == TestData.Tenant1.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    user => user.NotificationPreferences,
                    notificationPreferences));
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();

        var blocked = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId);

        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertErrorAsync(
            blocked,
            "GUARDIAN_CONSENT_REQUIRED",
            "A parent or guardian needs to approve your participation before you can volunteer. Please send a consent request first.");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.VolunteerGuardianConsents.Add(new VolunteerGuardianConsent
            {
                TenantId = TestData.Tenant1.Id,
                MinorUserId = TestData.MemberUser.Id,
                GuardianName = "Test Guardian",
                GuardianEmail = "guardian@test.local",
                Status = VolunteerGuardianConsentStatus.Active,
                ConsentedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var permitted = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId);
        permitted.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task SelectedShift_RejectsCrossOpportunityCrossTenantAndStartedRows()
    {
        int opportunityId;
        int crossOpportunityShiftId;
        int crossTenantShiftId;
        int startedShiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Apply target");
            var otherOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Wrong opportunity");
            var otherTenantOpportunity = NewOpportunity(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Wrong tenant");
            db.AddRange(opportunity, otherOpportunity, otherTenantOpportunity);
            await db.SaveChangesAsync();

            var crossOpportunityShift = NewShift(otherOpportunity, 2);
            var crossTenantShift = NewShift(otherTenantOpportunity, 2);
            var startedShift = NewShift(opportunity, 2);
            startedShift.StartsAt = DateTime.UtcNow.AddHours(-2);
            startedShift.EndsAt = DateTime.UtcNow.AddHours(-1);
            db.AddRange(crossOpportunityShift, crossTenantShift, startedShift);
            await db.SaveChangesAsync();
            opportunityId = opportunity.Id;
            crossOpportunityShiftId = crossOpportunityShift.Id;
            crossTenantShiftId = crossTenantShift.Id;
            startedShiftId = startedShift.Id;
        }

        await AuthenticateAsMemberAsync();

        var wrongOpportunity = await ApplyAsync(opportunityId, crossOpportunityShiftId);
        wrongOpportunity.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(wrongOpportunity, "NOT_FOUND", "Shift not found");

        var wrongTenant = await ApplyAsync(opportunityId, crossTenantShiftId);
        wrongTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(wrongTenant, "NOT_FOUND", "Shift not found");

        var started = await ApplyAsync(opportunityId, startedShiftId);
        started.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(started, "VALIDATION_ERROR", "This shift has already started");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync())
            .Should().Be(0);
    }

    [Fact]
    public async Task AutoApproval_CountsActiveReservationsAndPersistsApprovedShift()
    {
        int fullOpportunityId;
        int fullShiftId;
        int availableOpportunityId;
        int availableShiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = AutoApproveKey,
                Value = "true",
                CreatedAt = DateTime.UtcNow
            });

            var fullOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Reserved full");
            var availableOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "One place remains");
            var group = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Reservation group");
            db.AddRange(fullOpportunity, availableOpportunity, group);
            await db.SaveChangesAsync();

            var fullShift = NewShift(fullOpportunity, 1);
            var availableShift = NewShift(availableOpportunity, 2);
            db.AddRange(fullShift, availableShift);
            await db.SaveChangesAsync();

            db.AddRange(
                NewReservation(fullShift, group, 1),
                NewReservation(availableShift, group, 1));
            await db.SaveChangesAsync();
            fullOpportunityId = fullOpportunity.Id;
            fullShiftId = fullShift.Id;
            availableOpportunityId = availableOpportunity.Id;
            availableShiftId = availableShift.Id;
        }

        await AuthenticateAsMemberAsync();

        var full = await ApplyAsync(fullOpportunityId, fullShiftId);
        full.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(full, "VALIDATION_ERROR", "This shift is at capacity");

        var available = await ApplyAsync(availableOpportunityId, availableShiftId);
        available.StatusCode.Should().Be(HttpStatusCode.Created);
        var availableData = (await ReadJsonAsync(available)).GetProperty("data");
        availableData.GetProperty("status").GetString().Should().Be("approved");
        availableData.GetProperty("shift_id").GetInt32().Should().Be(availableShiftId);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.OpportunityId == availableOpportunityId);
        stored.Status.Should().Be(ApplicationStatus.Approved);
        stored.ShiftId.Should().Be(availableShiftId);
    }

    [Fact]
    public async Task ActiveDuplicateConflicts_ButDeclinedAndWithdrawnHistoryCanReapply()
    {
        var scenario = await CreateOpportunityWithShiftAsync(maxVolunteers: 5);
        await AuthenticateAsMemberAsync();

        var first = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "First");
        first.StatusCode.Should().Be(HttpStatusCode.Created);

        var duplicate = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "Duplicate");
        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        await AssertErrorAsync(
            duplicate,
            "ALREADY_EXISTS",
            "You have already applied to this opportunity");

        var firstId = (await ReadJsonAsync(first)).GetProperty("data").GetProperty("id").GetInt32();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var firstRow = await db.VolunteerApplications.IgnoreQueryFilters()
                .SingleAsync(application => application.Id == firstId);
            firstRow.Status = ApplicationStatus.Declined;
            await db.SaveChangesAsync();
        }

        var second = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "After decline");
        second.StatusCode.Should().Be(HttpStatusCode.Created);
        var secondId = (await ReadJsonAsync(second)).GetProperty("data").GetProperty("id").GetInt32();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var secondRow = await db.VolunteerApplications.IgnoreQueryFilters()
                .SingleAsync(application => application.Id == secondId);
            secondRow.Status = ApplicationStatus.Withdrawn;
            await db.SaveChangesAsync();
        }

        var third = await ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "After withdrawal");
        third.StatusCode.Should().Be(HttpStatusCode.Created);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var history = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .Where(application =>
                application.TenantId == TestData.Tenant1.Id
                && application.OpportunityId == scenario.OpportunityId
                && application.UserId == TestData.MemberUser.Id)
            .OrderBy(application => application.Id)
            .Select(application => application.Status)
            .ToListAsync();
        history.Should().Equal(
            ApplicationStatus.Declined,
            ApplicationStatus.Withdrawn,
            ApplicationStatus.Pending);
    }

    [Fact]
    public async Task ConcurrentIdenticalApplications_CreateOneActiveRow()
    {
        var scenario = await CreateOpportunityWithShiftAsync(maxVolunteers: 5);
        await AuthenticateAsMemberAsync();

        var responses = await Task.WhenAll(
            ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "Concurrent one"),
            ApplyAsync(scenario.OpportunityId, scenario.ShiftId, "Concurrent two"));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.Created, HttpStatusCode.Conflict });

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync(application =>
            application.TenantId == TestData.Tenant1.Id
            && application.OpportunityId == scenario.OpportunityId
            && application.UserId == TestData.MemberUser.Id
            && (application.Status == ApplicationStatus.Pending
                || application.Status == ApplicationStatus.Approved)))
            .Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentAdminApprovalAndAutoApprovedApplyForFinalPlace_HaveOneWinner()
    {
        int opportunityId;
        int shiftId;
        int pendingApplicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = AutoApproveKey,
                Value = "1",
                CreatedAt = DateTime.UtcNow
            });

            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Final auto-approved place");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var pending = new VolunteerApplication
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = opportunity.Id,
                ShiftId = shift.Id,
                UserId = TestData.AdminUser.Id,
                Status = ApplicationStatus.Pending,
                Message = "Pending approval competitor",
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerApplications.Add(pending);
            await db.SaveChangesAsync();
            opportunityId = opportunity.Id;
            shiftId = shift.Id;
            pendingApplicationId = pending.Id;
        }

        var memberToken = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);
        var adminToken = await GetAccessTokenAsync(TestData.AdminUser.Email, TestData.Tenant1.Slug);
        SetAuthToken(memberToken);
        using var adminClient = Factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var applyTask = ApplyAsync(opportunityId, shiftId, "Auto-approved competitor");
        var approvalTask = adminClient.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{pendingApplicationId}/approve",
            new { });
        await Task.WhenAll(applyTask, approvalTask);

        var apply = await applyTask;
        var approval = await approvalTask;
        new[] { apply.StatusCode, approval.StatusCode }
            .Count(status => status is HttpStatusCode.Created or HttpStatusCode.OK)
            .Should().Be(1);
        apply.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.UnprocessableEntity);
        approval.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync(application =>
            application.TenantId == TestData.Tenant1.Id
            && application.ShiftId == shiftId
            && application.Status == ApplicationStatus.Approved))
            .Should().Be(1);
    }

    [Fact]
    public async Task Withdraw_DeletesPermittedStatusesRejectsApprovedAndIsTenantSafe()
    {
        int pendingId;
        int declinedId;
        int withdrawnId;
        int approvedId;
        int otherUsersId;
        int otherTenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var pendingOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Withdraw pending");
            var declinedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Withdraw declined");
            var withdrawnOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Withdraw withdrawn");
            var approvedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Withdraw approved");
            var otherUsersOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Another user's application");
            var otherTenantOpportunity = NewOpportunity(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Other tenant application");
            db.AddRange(
                pendingOpportunity,
                declinedOpportunity,
                withdrawnOpportunity,
                approvedOpportunity,
                otherUsersOpportunity,
                otherTenantOpportunity);
            await db.SaveChangesAsync();

            var pending = NewApplication(pendingOpportunity, TestData.MemberUser.Id, ApplicationStatus.Pending);
            var declined = NewApplication(declinedOpportunity, TestData.MemberUser.Id, ApplicationStatus.Declined);
            var withdrawn = NewApplication(withdrawnOpportunity, TestData.MemberUser.Id, ApplicationStatus.Withdrawn);
            var approved = NewApplication(approvedOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            var otherUsers = NewApplication(otherUsersOpportunity, TestData.AdminUser.Id, ApplicationStatus.Pending);
            var otherTenant = NewApplication(
                otherTenantOpportunity,
                TestData.OtherTenantUser.Id,
                ApplicationStatus.Pending);
            db.AddRange(pending, declined, withdrawn, approved, otherUsers, otherTenant);
            await db.SaveChangesAsync();
            pendingId = pending.Id;
            declinedId = declined.Id;
            withdrawnId = withdrawn.Id;
            approvedId = approved.Id;
            otherUsersId = otherUsers.Id;
            otherTenantId = otherTenant.Id;
        }

        await AuthenticateAsMemberAsync();

        foreach (var id in new[] { pendingId, declinedId, withdrawnId })
        {
            (await Client.DeleteAsync($"/api/v2/volunteering/applications/{id}"))
                .StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        var approvedResponse = await Client.DeleteAsync(
            $"/api/v2/volunteering/applications/{approvedId}");
        approvedResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertErrorAsync(
            approvedResponse,
            "VALIDATION_ERROR",
            "You cannot withdraw an approved application. Please contact the organisation directly.");

        var otherUsersResponse = await Client.DeleteAsync(
            $"/api/v2/volunteering/applications/{otherUsersId}");
        otherUsersResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertErrorAsync(otherUsersResponse, "FORBIDDEN", "This is not your application");

        var otherTenantResponse = await Client.DeleteAsync(
            $"/api/v2/volunteering/applications/{otherTenantId}");
        otherTenantResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(otherTenantResponse, "NOT_FOUND", "Application not found");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var remainingIds = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .Where(application => new[]
            {
                pendingId,
                declinedId,
                withdrawnId,
                approvedId,
                otherUsersId,
                otherTenantId
            }.Contains(application.Id))
            .Select(application => application.Id)
            .ToListAsync();
        remainingIds.Should().BeEquivalentTo(new[] { approvedId, otherUsersId, otherTenantId });
    }

    private Task<HttpResponseMessage> ApplyAsync(
        int opportunityId,
        int? shiftId,
        string message = "Selected shift application") =>
        Client.PostAsJsonAsync($"/api/v2/volunteering/opportunities/{opportunityId}/apply", new
        {
            message,
            shift_id = shiftId
        });

    private async Task<ApplicationScenario> CreateOpportunityWithShiftAsync(int maxVolunteers)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Selected shift apply");
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();
        var shift = NewShift(opportunity, maxVolunteers);
        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();
        return new ApplicationScenario(opportunity.Id, shift.Id);
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId, string title) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = $"{title} {Guid.NewGuid():N}",
        Description = "Selected shift application workflow test",
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

    private ShiftGroupReservation NewReservation(VolunteerShift shift, Group group, int slots) => new()
    {
        TenantId = shift.TenantId,
        ShiftId = shift.Id,
        GroupId = group.Id,
        ReservedBy = TestData.AdminUser.Id,
        ReservedSlots = slots,
        Status = "active",
        CreatedAt = DateTime.UtcNow
    };

    private static Group NewGroup(int tenantId, int creatorId, string name) => new()
    {
        TenantId = tenantId,
        CreatedById = creatorId,
        Name = $"{name} {Guid.NewGuid():N}",
        CreatedAt = DateTime.UtcNow
    };

    private static async Task AssertErrorAsync(
        HttpResponseMessage response,
        string expectedCode,
        string expectedMessage)
    {
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(expectedCode);
        error.GetProperty("message").GetString().Should().Be(expectedMessage);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private sealed record ApplicationScenario(int OpportunityId, int ShiftId);
}
