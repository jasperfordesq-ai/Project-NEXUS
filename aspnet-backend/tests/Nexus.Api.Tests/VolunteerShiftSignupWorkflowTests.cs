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
public sealed class VolunteerShiftSignupWorkflowTests : IntegrationTestBase
{
    public VolunteerShiftSignupWorkflowTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Signup_IsTenantScopedAndRequiresAnExistingApprovedApplication()
    {
        int localShiftId;
        int otherTenantShiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var localOpportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Approved application gate");
            var otherOpportunity = NewOpportunity(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Other tenant shift");
            db.AddRange(localOpportunity, otherOpportunity);
            await db.SaveChangesAsync();

            var localShift = NewShift(localOpportunity, 2);
            var otherShift = NewShift(otherOpportunity, 2);
            db.AddRange(localShift, otherShift);
            await db.SaveChangesAsync();
            localShiftId = localShift.Id;
            otherTenantShiftId = otherShift.Id;
        }

        await AuthenticateAsMemberAsync();

        var crossTenant = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{otherTenantShiftId}/signup",
            new { });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var crossTenantError = (await ReadJsonAsync(crossTenant)).GetProperty("errors")[0];
        crossTenantError.GetProperty("code").GetString().Should().Be("NOT_FOUND");
        crossTenantError.GetProperty("message").GetString().Should().Be("Shift not found");

        var unapproved = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{localShiftId}/signup",
            new { });
        unapproved.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var unapprovedError = (await ReadJsonAsync(unapproved)).GetProperty("errors")[0];
        unapprovedError.GetProperty("code").GetString().Should().Be("FORBIDDEN");
        unapprovedError.GetProperty("message").GetString()
            .Should().Be("You must have an approved application to sign up for shifts");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync())
            .Should().Be(0, "shift signup must never fabricate an approved application");
    }

    [Fact]
    public async Task Signup_WhenConfiguredMinorLacksGuardianConsent_BlocksUntilGlobalConsentExists()
    {
        int shiftId;
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Guardian consent signup gate");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, 2);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            db.AddRange(
                application,
                new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "volunteering.guardian_consent_required",
                    Value = "true",
                    CreatedAt = DateTime.UtcNow
                });

            var dateOfBirth = DateTime.UtcNow.AddYears(-16).ToString("yyyy-MM-dd");
            var notificationPreferences = JsonSerializer.Serialize(new { date_of_birth = dateOfBirth });
            await db.Users.IgnoreQueryFilters()
                .Where(user =>
                    user.Id == TestData.MemberUser.Id
                    && user.TenantId == TestData.Tenant1.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    user => user.NotificationPreferences,
                    notificationPreferences));
            await db.SaveChangesAsync();

            shiftId = shift.Id;
            applicationId = application.Id;
        }

        await AuthenticateAsMemberAsync();

        var blocked = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup",
            new { });

        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var blockedError = (await ReadJsonAsync(blocked)).GetProperty("errors")[0];
        blockedError.GetProperty("code").GetString().Should().Be("GUARDIAN_CONSENT_REQUIRED");
        blockedError.GetProperty("message").GetString().Should().Be(
            "A parent or guardian needs to approve your participation before you can volunteer. Please send a consent request first.");

        using (var verifyBlockedScope = Factory.Services.CreateScope())
        {
            var verifyDb = verifyBlockedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var stored = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
                .SingleAsync(application => application.Id == applicationId);
            stored.ShiftId.Should().BeNull();
        }

        using (var consentScope = Factory.Services.CreateScope())
        {
            var db = consentScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.VolunteerGuardianConsents.Add(new VolunteerGuardianConsent
            {
                TenantId = TestData.Tenant1.Id,
                MinorUserId = TestData.MemberUser.Id,
                OpportunityId = null,
                GuardianName = "Test Guardian",
                GuardianEmail = "guardian@test.local",
                Status = VolunteerGuardianConsentStatus.Active,
                ConsentedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(30),
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var permitted = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup",
            new { });

        permitted.StatusCode.Should().Be(HttpStatusCode.OK);
        using var verifyPermittedScope = Factory.Services.CreateScope();
        var permittedDb = verifyPermittedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var assigned = await permittedDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId);
        assigned.ShiftId.Should().Be(shiftId);
    }

    [Fact]
    public async Task Signup_AssignsShiftAndRetryMatchesLaravelCapacityCheck()
    {
        int shiftId;
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Canonical signup envelope");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            db.VolunteerApplications.Add(application);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            applicationId = application.Id;
        }

        await AuthenticateAsMemberAsync();

        var first = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup",
            new { });
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstBody = await ReadJsonAsync(first);
        firstBody.GetProperty("data").GetProperty("shift_id").GetInt32().Should().Be(shiftId);
        firstBody.GetProperty("data").GetProperty("message").GetString()
            .Should().Be("Successfully signed up for shift");
        firstBody.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();

        var retry = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup",
            new { });
        retry.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var retryError = (await ReadJsonAsync(retry)).GetProperty("errors")[0];
        retryError.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        retryError.GetProperty("message").GetString().Should().Be("This shift is at capacity");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId);
        stored.Status.Should().Be(ApplicationStatus.Approved);
        stored.ShiftId.Should().Be(shiftId);
    }

    [Fact]
    public async Task Signup_MovingBetweenShifts_NotifiesTheOldShiftsNextWaiterAfterCommit()
    {
        int oldShiftId;
        int targetShiftId;
        int applicationId;
        int waitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Move frees old shift");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var oldShift = NewShift(opportunity, 1);
            oldShift.Title = "Old shift";
            var targetShift = NewShift(opportunity, 2);
            targetShift.Title = "Target shift";
            db.AddRange(oldShift, targetShift);
            await db.SaveChangesAsync();

            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            application.ShiftId = oldShift.Id;
            var waitlist = new ShiftWaitlistEntry
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = oldShift.Id,
                UserId = TestData.AdminUser.Id,
                Position = 1,
                Status = "waiting",
                CreatedAt = DateTime.UtcNow
            };
            db.AddRange(application, waitlist);
            await db.SaveChangesAsync();
            oldShiftId = oldShift.Id;
            targetShiftId = targetShift.Id;
            applicationId = application.Id;
            waitlistId = waitlist.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{targetShiftId}/signup",
            new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId))
            .ShiftId.Should().Be(targetShiftId);
        var storedWaitlist = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(waitlist => waitlist.Id == waitlistId);
        storedWaitlist.ShiftId.Should().Be(oldShiftId);
        storedWaitlist.Status.Should().Be("notified");
        storedWaitlist.NotifiedAt.Should().NotBeNull();
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.AdminUser.Id
            && notification.Type == "vol_waitlist_spot"
            && notification.Data != null
            && notification.Data.Contains($"\"shift_id\":{oldShiftId}")))
            .Should().BeTrue();
    }

    [Fact]
    public async Task Signup_CountsOnlyApprovedAssignmentsAndActiveTenantReservations()
    {
        int fullShiftId;
        int availableShiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var fullOpportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Reservation capacity full");
            var availableOpportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Inactive reservations ignored");
            var localGroup = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Local capacity group");
            var otherGroup = NewGroup(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other capacity group");
            db.AddRange(fullOpportunity, availableOpportunity, localGroup, otherGroup);
            await db.SaveChangesAsync();

            var fullShift = NewShift(fullOpportunity, 1);
            var availableShift = NewShift(availableOpportunity, 1);
            db.AddRange(fullShift, availableShift);
            await db.SaveChangesAsync();

            db.AddRange(
                NewApplication(fullOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved),
                NewApplication(availableOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved),
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant1.Id,
                    ShiftId = fullShift.Id,
                    GroupId = localGroup.Id,
                    ReservedBy = TestData.AdminUser.Id,
                    ReservedSlots = 1,
                    Status = "active",
                    CreatedAt = DateTime.UtcNow
                },
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant1.Id,
                    ShiftId = availableShift.Id,
                    GroupId = localGroup.Id,
                    ReservedBy = TestData.AdminUser.Id,
                    ReservedSlots = 50,
                    Status = "cancelled",
                    CreatedAt = DateTime.UtcNow
                },
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant2.Id,
                    ShiftId = availableShift.Id,
                    GroupId = otherGroup.Id,
                    ReservedBy = TestData.OtherTenantUser.Id,
                    ReservedSlots = 50,
                    Status = "active",
                    CreatedAt = DateTime.UtcNow
                });
            await db.SaveChangesAsync();
            fullShiftId = fullShift.Id;
            availableShiftId = availableShift.Id;
        }

        await AuthenticateAsMemberAsync();

        var full = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{fullShiftId}/signup",
            new { });
        full.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = (await ReadJsonAsync(full)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be("This shift is at capacity");

        var available = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{availableShiftId}/signup",
            new { });
        available.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ConcurrentAdminApprovalAndSignupForFinalPlace_HaveExactlyOneWinner()
    {
        int shiftId;
        int pendingApplicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Shared final place lock");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var signupApplication = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var pendingApplication = NewApplication(
                opportunity,
                TestData.AdminUser.Id,
                ApplicationStatus.Pending);
            pendingApplication.ShiftId = shift.Id;
            db.AddRange(signupApplication, pendingApplication);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            pendingApplicationId = pendingApplication.Id;
        }

        var memberToken = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);
        var adminToken = await GetAccessTokenAsync(TestData.AdminUser.Email, TestData.Tenant1.Slug);
        SetAuthToken(memberToken);
        using var adminClient = Factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var signupTask = Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup",
            new { });
        var approvalTask = adminClient.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{pendingApplicationId}/approve",
            new { });
        await Task.WhenAll(signupTask, approvalTask);

        var signup = await signupTask;
        var approval = await approvalTask;
        new[] { signup.StatusCode, approval.StatusCode }.Count(status => status == HttpStatusCode.OK)
            .Should().Be(1);
        signup.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
        approval.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters().CountAsync(application =>
            application.TenantId == TestData.Tenant1.Id
            && application.ShiftId == shiftId
            && application.Status == ApplicationStatus.Approved))
            .Should().Be(1);
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId, string title) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = $"{title} {Guid.NewGuid():N}",
        Description = "Volunteer shift signup workflow test",
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

    private static Group NewGroup(int tenantId, int creatorId, string name) => new()
    {
        TenantId = tenantId,
        CreatedById = creatorId,
        Name = $"{name} {Guid.NewGuid():N}",
        CreatedAt = DateTime.UtcNow
    };

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
}
