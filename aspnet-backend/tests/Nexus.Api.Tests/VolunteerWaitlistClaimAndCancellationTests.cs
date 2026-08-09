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
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerWaitlistClaimAndCancellationTests : IntegrationTestBase
{
    public VolunteerWaitlistClaimAndCancellationTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Claim_RequiresNotifiedOfferThenConditionallyAssignsApprovedApplication()
    {
        int shiftId;
        int applicationId;
        int waitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Notified claim");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var application = NewApplication(opportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            var waitlist = NewWaitlistEntry(shift, TestData.MemberUser.Id, "waiting");
            db.AddRange(application, waitlist);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            applicationId = application.Id;
            waitlistId = waitlist.Id;
        }

        await AuthenticateAsMemberAsync();

        var tooEarly = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist/promote",
            new { });
        tooEarly.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadWorkflowErrorAsync(tooEarly)).Should().Be(
            "Your turn has not come up yet \u2014 you will be notified when a spot opens up.");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.ShiftWaitlistEntries.IgnoreQueryFilters()
                .Where(entry => entry.Id == waitlistId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(entry => entry.Status, "notified")
                    .SetProperty(entry => entry.NotifiedAt, DateTime.UtcNow));
        }

        var claimed = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist/promote",
            new { });
        claimed.StatusCode.Should().Be(HttpStatusCode.OK);
        var claimedBody = await ReadJsonAsync(claimed);
        claimedBody.GetProperty("data").GetProperty("shift_id").GetInt32().Should().Be(shiftId);

        var retry = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist/promote",
            new { });
        retry.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadWorkflowErrorAsync(retry)).Should().Be("Waitlist entry not found");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedApplication = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId);
        storedApplication.Status.Should().Be(ApplicationStatus.Approved);
        storedApplication.ShiftId.Should().Be(shiftId);
        var storedWaitlist = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == waitlistId);
        storedWaitlist.Status.Should().Be("promoted");
        storedWaitlist.PromotedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Claim_MovingBetweenShifts_NotifiesTheOldShiftsNextWaiterAfterCommit()
    {
        int oldShiftId;
        int targetShiftId;
        int applicationId;
        int targetWaitlistId;
        int oldWaitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Waitlist claim move");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();

            var oldShift = NewShift(opportunity, maxVolunteers: 1);
            oldShift.Title = "Old shift";
            var targetShift = NewShift(opportunity, maxVolunteers: 1);
            targetShift.Title = "Target shift";
            db.AddRange(oldShift, targetShift);
            await db.SaveChangesAsync();

            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            application.ShiftId = oldShift.Id;
            var targetWaitlist = NewWaitlistEntry(
                targetShift,
                TestData.MemberUser.Id,
                "notified");
            var oldWaitingEntry = NewWaitlistEntry(
                oldShift,
                TestData.AdminUser.Id,
                "waiting");
            db.AddRange(application, targetWaitlist, oldWaitingEntry);
            await db.SaveChangesAsync();

            oldShiftId = oldShift.Id;
            targetShiftId = targetShift.Id;
            applicationId = application.Id;
            targetWaitlistId = targetWaitlist.Id;
            oldWaitlistId = oldWaitingEntry.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{targetShiftId}/waitlist/promote",
            new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId))
            .ShiftId.Should().Be(targetShiftId);
        (await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == targetWaitlistId))
            .Status.Should().Be("promoted");
        var oldWaitlist = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == oldWaitlistId);
        oldWaitlist.ShiftId.Should().Be(oldShiftId);
        oldWaitlist.Status.Should().Be("notified");
        oldWaitlist.NotifiedAt.Should().NotBeNull();
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.AdminUser.Id
            && notification.Type == "vol_waitlist_spot"
            && notification.Link == "/volunteering?tab=waitlist"
            && notification.Data != null
            && notification.Data.Contains($"\"shift_id\":{oldShiftId}")))
            .Should().BeTrue();
    }

    [Fact]
    public async Task Claim_IsTenantAndCallerScoped()
    {
        int otherTenantShiftId;
        int otherUserShiftId;
        int otherTenantWaitlistId;
        int otherUserWaitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var otherTenantOpportunity = NewOpportunity(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Other tenant offer");
            var localOpportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Other user offer");
            var otherLocalUser = NewUser(TestData.Tenant1.Id, "other-waitlist-user");
            db.AddRange(otherTenantOpportunity, localOpportunity, otherLocalUser);
            await db.SaveChangesAsync();
            var otherTenantShift = NewShift(otherTenantOpportunity, maxVolunteers: 2);
            var localShift = NewShift(localOpportunity, maxVolunteers: 2);
            db.AddRange(otherTenantShift, localShift);
            await db.SaveChangesAsync();
            var otherTenantWaitlist = NewWaitlistEntry(
                otherTenantShift,
                TestData.OtherTenantUser.Id,
                "notified");
            var otherUserWaitlist = NewWaitlistEntry(localShift, otherLocalUser.Id, "notified");
            db.AddRange(otherTenantWaitlist, otherUserWaitlist);
            await db.SaveChangesAsync();
            otherTenantShiftId = otherTenantShift.Id;
            otherUserShiftId = localShift.Id;
            otherTenantWaitlistId = otherTenantWaitlist.Id;
            otherUserWaitlistId = otherUserWaitlist.Id;
        }

        await AuthenticateAsMemberAsync();

        var crossTenant = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{otherTenantShiftId}/waitlist/promote",
            new { });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadWorkflowErrorAsync(crossTenant)).Should().Be("Waitlist entry not found");

        var otherCaller = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{otherUserShiftId}/waitlist/promote",
            new { });
        otherCaller.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadWorkflowErrorAsync(otherCaller)).Should().Be("Waitlist entry not found");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var statuses = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .Where(entry => entry.Id == otherTenantWaitlistId || entry.Id == otherUserWaitlistId)
            .Select(entry => entry.Status)
            .ToListAsync();
        statuses.Should().OnlyContain(status => status == "notified");
    }

    [Fact]
    public async Task Claim_RechecksFuturePublicCapacityAndApprovedApplication()
    {
        int startedShiftId;
        int draftShiftId;
        int fullShiftId;
        int unapprovedShiftId;
        var waitlistIds = new List<int>();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var startedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Started claim");
            var draftOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Draft claim");
            draftOpportunity.Status = OpportunityStatus.Draft;
            var fullOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Full claim");
            var unapprovedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Unapproved claim");
            var fullUser = NewUser(TestData.Tenant1.Id, "full-shift-user");
            db.AddRange(startedOpportunity, draftOpportunity, fullOpportunity, unapprovedOpportunity, fullUser);
            await db.SaveChangesAsync();

            var startedShift = NewShift(startedOpportunity, maxVolunteers: 2);
            startedShift.StartsAt = DateTime.UtcNow.AddHours(-2);
            startedShift.EndsAt = DateTime.UtcNow.AddHours(-1);
            var draftShift = NewShift(draftOpportunity, maxVolunteers: 2);
            var fullShift = NewShift(fullOpportunity, maxVolunteers: 1);
            var unapprovedShift = NewShift(unapprovedOpportunity, maxVolunteers: 2);
            db.AddRange(startedShift, draftShift, fullShift, unapprovedShift);
            await db.SaveChangesAsync();

            var startedApplication = NewApplication(
                startedOpportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var draftApplication = NewApplication(
                draftOpportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var fullApplication = NewApplication(
                fullOpportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var occupiedApplication = NewApplication(
                fullOpportunity,
                fullUser.Id,
                ApplicationStatus.Approved);
            occupiedApplication.ShiftId = fullShift.Id;
            var startedWaitlist = NewWaitlistEntry(startedShift, TestData.MemberUser.Id, "notified");
            var draftWaitlist = NewWaitlistEntry(draftShift, TestData.MemberUser.Id, "notified");
            var fullWaitlist = NewWaitlistEntry(fullShift, TestData.MemberUser.Id, "notified");
            var unapprovedWaitlist = NewWaitlistEntry(unapprovedShift, TestData.MemberUser.Id, "notified");
            db.AddRange(
                startedApplication,
                draftApplication,
                fullApplication,
                occupiedApplication,
                startedWaitlist,
                draftWaitlist,
                fullWaitlist,
                unapprovedWaitlist);
            await db.SaveChangesAsync();
            startedShiftId = startedShift.Id;
            draftShiftId = draftShift.Id;
            fullShiftId = fullShift.Id;
            unapprovedShiftId = unapprovedShift.Id;
            waitlistIds.AddRange(new[]
            {
                startedWaitlist.Id,
                draftWaitlist.Id,
                fullWaitlist.Id,
                unapprovedWaitlist.Id
            });
        }

        await AuthenticateAsMemberAsync();

        var started = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{startedShiftId}/waitlist/promote",
            new { });
        started.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadWorkflowErrorAsync(started)).Should().Be("This shift has already started");

        var draft = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{draftShiftId}/waitlist/promote",
            new { });
        draft.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadWorkflowErrorAsync(draft)).Should().Be("Opportunity not found or is not active");

        var full = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{fullShiftId}/waitlist/promote",
            new { });
        full.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadWorkflowErrorAsync(full)).Should().Be("That spot is no longer available.");

        var unapproved = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{unapprovedShiftId}/waitlist/promote",
            new { });
        unapproved.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadWorkflowErrorAsync(unapproved))
            .Should().Be("You must have an approved application to sign up for shifts");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var statuses = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .Where(entry => waitlistIds.Contains(entry.Id))
            .Select(entry => entry.Status)
            .ToListAsync();
        statuses.Should().HaveCount(4);
        statuses.Should().OnlyContain(status => status == "notified");
    }

    [Fact]
    public async Task ClaimReservationAndApprovalRaceForFinalPlace_HasExactlyOneWinner()
    {
        int shiftId;
        int groupId;
        int pendingApplicationId;
        int waitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Three-way capacity race");
            var group = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Three-way race group");
            var pendingUser = NewUser(TestData.Tenant1.Id, "three-way-pending");
            db.AddRange(opportunity, group, pendingUser);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var claimApplication = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var pendingApplication = NewApplication(
                opportunity,
                pendingUser.Id,
                ApplicationStatus.Pending);
            pendingApplication.ShiftId = shift.Id;
            var waitlist = NewWaitlistEntry(shift, TestData.MemberUser.Id, "notified");
            db.AddRange(claimApplication, pendingApplication, waitlist);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            groupId = group.Id;
            pendingApplicationId = pendingApplication.Id;
            waitlistId = waitlist.Id;
        }

        var memberToken = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);
        var adminToken = await GetAccessTokenAsync(TestData.AdminUser.Email, TestData.Tenant1.Slug);
        SetAuthToken(memberToken);
        using var adminClient = Factory.CreateClient();
        adminClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var claimTask = Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist/promote",
            new { });
        var reservationTask = Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/group-reserve",
            new { group_id = groupId, reserved_slots = 1, notes = "Capacity race" });
        var approvalTask = adminClient.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/approvals/{pendingApplicationId}/approve",
            new { });
        await Task.WhenAll(claimTask, reservationTask, approvalTask);

        var claim = await claimTask;
        var reservation = await reservationTask;
        var approval = await approvalTask;
        new[]
        {
            claim.StatusCode == HttpStatusCode.OK,
            reservation.StatusCode == HttpStatusCode.Created,
            approval.StatusCode == HttpStatusCode.OK
        }.Count(won => won).Should().Be(1);
        claim.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity);
        reservation.StatusCode.Should().BeOneOf(HttpStatusCode.Created, HttpStatusCode.UnprocessableEntity);
        approval.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var assignedApplications = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .CountAsync(application =>
                application.TenantId == TestData.Tenant1.Id
                && application.ShiftId == shiftId
                && application.Status == ApplicationStatus.Approved);
        var reservedSlots = await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .Where(reservationRow =>
                reservationRow.TenantId == TestData.Tenant1.Id
                && reservationRow.ShiftId == shiftId
                && reservationRow.Status == "active")
            .SumAsync(reservationRow => reservationRow.ReservedSlots);
        (assignedApplications + reservedSlots).Should().Be(1);
        var storedWaitlist = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == waitlistId);
        storedWaitlist.Status.Should().Be(
            claim.StatusCode == HttpStatusCode.OK ? "promoted" : "notified");
    }

    [Fact]
    public async Task JoinWaitlist_EnforcesCanonicalTenantApplicationShiftAndCapacityGates()
    {
        int fullShiftId;
        int openShiftId;
        int signedShiftId;
        int unapprovedShiftId;
        int pastShiftId;
        int draftShiftId;
        int otherTenantShiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var fullOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join full");
            var openOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join open");
            var signedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join signed");
            var unapprovedOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join unapproved");
            var pastOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join past");
            var draftOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Join draft");
            draftOpportunity.Status = OpportunityStatus.Draft;
            var otherOpportunity = NewOpportunity(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Join other tenant");
            var occupantOne = NewUser(TestData.Tenant1.Id, "join-occupant-one");
            var occupantTwo = NewUser(TestData.Tenant1.Id, "join-occupant-two");
            db.AddRange(
                fullOpportunity,
                openOpportunity,
                signedOpportunity,
                unapprovedOpportunity,
                pastOpportunity,
                draftOpportunity,
                otherOpportunity,
                occupantOne,
                occupantTwo);
            await db.SaveChangesAsync();

            var fullShift = NewShift(fullOpportunity, maxVolunteers: 1);
            var openShift = NewShift(openOpportunity, maxVolunteers: 2);
            var signedShift = NewShift(signedOpportunity, maxVolunteers: 1);
            var unapprovedShift = NewShift(unapprovedOpportunity, maxVolunteers: 1);
            var pastShift = NewShift(pastOpportunity, maxVolunteers: 1);
            pastShift.StartsAt = DateTime.UtcNow.AddHours(-2);
            pastShift.EndsAt = DateTime.UtcNow.AddHours(-1);
            var draftShift = NewShift(draftOpportunity, maxVolunteers: 1);
            var otherShift = NewShift(otherOpportunity, maxVolunteers: 1);
            db.AddRange(fullShift, openShift, signedShift, unapprovedShift, pastShift, draftShift, otherShift);
            await db.SaveChangesAsync();

            var fullCaller = NewApplication(fullOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            var fullOccupant = NewApplication(fullOpportunity, occupantOne.Id, ApplicationStatus.Approved);
            fullOccupant.ShiftId = fullShift.Id;
            var openCaller = NewApplication(openOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            var signedCaller = NewApplication(signedOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            signedCaller.ShiftId = signedShift.Id;
            var unapprovedOccupant = NewApplication(unapprovedOpportunity, occupantTwo.Id, ApplicationStatus.Approved);
            unapprovedOccupant.ShiftId = unapprovedShift.Id;
            var pastCaller = NewApplication(pastOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            var draftCaller = NewApplication(draftOpportunity, TestData.MemberUser.Id, ApplicationStatus.Approved);
            db.AddRange(
                fullCaller,
                fullOccupant,
                openCaller,
                signedCaller,
                unapprovedOccupant,
                pastCaller,
                draftCaller);
            await db.SaveChangesAsync();
            fullShiftId = fullShift.Id;
            openShiftId = openShift.Id;
            signedShiftId = signedShift.Id;
            unapprovedShiftId = unapprovedShift.Id;
            pastShiftId = pastShift.Id;
            draftShiftId = draftShift.Id;
            otherTenantShiftId = otherShift.Id;
        }

        await AuthenticateAsMemberAsync();

        var joined = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{fullShiftId}/waitlist",
            new { });
        joined.StatusCode.Should().Be(HttpStatusCode.Created);
        var joinedBody = await ReadJsonAsync(joined);
        joinedBody.GetProperty("data").GetProperty("position").GetInt32().Should().Be(1);
        joinedBody.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();

        var duplicate = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{fullShiftId}/waitlist",
            new { });
        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ReadJsonAsync(duplicate)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("ALREADY_EXISTS");

        var open = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{openShiftId}/waitlist",
            new { });
        open.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadWorkflowErrorAsync(open)).Should().Be(
            "This shift still has open places, so you do not need the waitlist yet.");

        var signed = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{signedShiftId}/waitlist",
            new { });
        signed.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ReadWorkflowErrorAsync(signed)).Should().Be("You are already signed up for this shift");

        var unapproved = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{unapprovedShiftId}/waitlist",
            new { });
        unapproved.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        var past = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{pastShiftId}/waitlist",
            new { });
        past.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var draft = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{draftShiftId}/waitlist",
            new { });
        draft.StatusCode.Should().Be(HttpStatusCode.NotFound);

        var crossTenant = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{otherTenantShiftId}/waitlist",
            new { });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task JoinWaitlist_ConfiguredMinorRequiresConsent_ThenAcceptsUnexpiredGlobalConsent()
    {
        int shiftId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Guardian-gated waitlist");
            var occupant = NewUser(TestData.Tenant1.Id, "guardian-waitlist-occupant");
            db.AddRange(opportunity, occupant);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var callerApplication = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            var occupantApplication = NewApplication(
                opportunity,
                occupant.Id,
                ApplicationStatus.Approved);
            occupantApplication.ShiftId = shift.Id;
            db.AddRange(
                callerApplication,
                occupantApplication,
                new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "volunteering.guardian_consent_required",
                    Value = "true",
                    CreatedAt = DateTime.UtcNow
                },
                new VolunteerGuardianConsent
                {
                    TenantId = TestData.Tenant1.Id,
                    MinorUserId = TestData.MemberUser.Id,
                    OpportunityId = opportunity.Id,
                    GuardianName = "Expired Guardian",
                    GuardianEmail = "expired-guardian@test.local",
                    Status = VolunteerGuardianConsentStatus.Active,
                    ConsentedAt = DateTime.UtcNow.AddDays(-2),
                    ExpiresAt = DateTime.UtcNow.AddMinutes(-1),
                    CreatedAt = DateTime.UtcNow.AddDays(-2)
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
            shiftId = shift.Id;
        }

        await AuthenticateAsMemberAsync();

        var blocked = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist",
            new { });

        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var blockedBody = await ReadJsonAsync(blocked);
        var blockedError = blockedBody.GetProperty("errors")[0];
        blockedError.GetProperty("code").GetString().Should().Be("GUARDIAN_CONSENT_REQUIRED");
        blockedError.GetProperty("message").GetString().Should().Be(
            "A parent or guardian needs to approve your participation before you can volunteer. Please send a consent request first.");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.VolunteerGuardianConsents.Add(new VolunteerGuardianConsent
            {
                TenantId = TestData.Tenant1.Id,
                MinorUserId = TestData.MemberUser.Id,
                OpportunityId = null,
                GuardianName = "Global Guardian",
                GuardianEmail = "global-guardian@test.local",
                Status = VolunteerGuardianConsentStatus.Active,
                ConsentedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(30),
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var permitted = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist",
            new { });
        permitted.StatusCode.Should().Be(HttpStatusCode.Created);
        (await ReadJsonAsync(permitted)).GetProperty("data").GetProperty("position").GetInt32()
            .Should().Be(1);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters().CountAsync(entry =>
            entry.TenantId == TestData.Tenant1.Id
            && entry.ShiftId == shiftId
            && entry.UserId == TestData.MemberUser.Id
            && entry.Status == "waiting"))
            .Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentWaitlistJoinsAllocateDistinctPositionsAndRejectRetry()
    {
        int shiftId;
        User otherWaiter;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Concurrent join");
            var occupant = NewUser(TestData.Tenant1.Id, "concurrent-join-occupant");
            otherWaiter = NewUser(TestData.Tenant1.Id, "concurrent-join-waiter");
            db.AddRange(opportunity, occupant, otherWaiter);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var occupantApplication = NewApplication(opportunity, occupant.Id, ApplicationStatus.Approved);
            occupantApplication.ShiftId = shift.Id;
            db.AddRange(
                occupantApplication,
                NewApplication(opportunity, TestData.MemberUser.Id, ApplicationStatus.Approved),
                NewApplication(opportunity, otherWaiter.Id, ApplicationStatus.Approved));
            await db.SaveChangesAsync();
            shiftId = shift.Id;
        }

        var memberToken = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);
        var otherToken = await GetAccessTokenAsync(otherWaiter.Email, TestData.Tenant1.Slug);
        SetAuthToken(memberToken);
        using var otherClient = Factory.CreateClient();
        otherClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherToken);

        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/waitlist", new { }),
            otherClient.PostAsJsonAsync($"/api/v2/volunteering/shifts/{shiftId}/waitlist", new { }));
        responses.Should().OnlyContain(response => response.StatusCode == HttpStatusCode.Created);
        var positions = new List<int>();
        foreach (var response in responses)
        {
            positions.Add((await ReadJsonAsync(response)).GetProperty("data").GetProperty("position").GetInt32());
        }
        positions.Should().BeEquivalentTo(new[] { 1, 2 });

        var retry = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/waitlist",
            new { });
        retry.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedPositions = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .Where(entry => entry.TenantId == TestData.Tenant1.Id && entry.ShiftId == shiftId)
            .OrderBy(entry => entry.Position)
            .Select(entry => entry.Position)
            .ToListAsync();
        storedPositions.Should().Equal(1, 2);
    }

    [Fact]
    public async Task NotifyProducerAndExpiryDurablyOfferAndReofferWithoutDoubleOffering()
    {
        int shiftId;
        int firstWaitlistId;
        int secondWaitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Offer producer");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var first = NewWaitlistEntry(shift, TestData.MemberUser.Id, "waiting");
            var second = NewWaitlistEntry(shift, TestData.AdminUser.Id, "waiting");
            second.Position = 2;
            var firstPush = new PushSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                DeviceToken = $"waitlist-member-{Guid.NewGuid():N}",
                Platform = "web",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            var secondPush = new PushSubscription
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                DeviceToken = $"waitlist-admin-{Guid.NewGuid():N}",
                Platform = "web",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.AddRange(first, second, firstPush, secondPush);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            firstWaitlistId = first.Id;
            secondWaitlistId = second.Id;
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
            tenant.SetTenant(TestData.Tenant1.Id);
            var service = scope.ServiceProvider.GetRequiredService<ShiftManagementService>();
            (await service.NotifyNextWaitlistedVolunteerAsync(shiftId, TestData.Tenant1.Id))
                .Should().BeTrue();
            (await service.NotifyNextWaitlistedVolunteerAsync(shiftId, TestData.Tenant1.Id))
                .Should().BeFalse("the outstanding offer consumes the only available place");
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.ShiftWaitlistEntries.IgnoreQueryFilters()
                .Where(entry => entry.Id == firstWaitlistId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(entry => entry.NotifiedAt, DateTime.UtcNow.AddHours(-72)));
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
            tenant.SetTenant(TestData.Tenant1.Id);
            var service = scope.ServiceProvider.GetRequiredService<ShiftManagementService>();
            (await service.ExpireStaleWaitlistedVolunteerOffersAsync(hours: 48)).Should().Be(1);
        }

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == firstWaitlistId)).Status.Should().Be("expired");
        var secondStored = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == secondWaitlistId);
        secondStored.Status.Should().Be("notified");
        secondStored.NotifiedAt.Should().NotBeNull();
        var offerNotifications = await verifyDb.Notifications.IgnoreQueryFilters()
            .Where(notification =>
                notification.TenantId == TestData.Tenant1.Id
                && notification.Type == "vol_waitlist_spot")
            .ToListAsync();
        offerNotifications.Should().HaveCount(2);
        offerNotifications.Should().OnlyContain(notification =>
            notification.Link == "/volunteering?tab=waitlist");
        (await verifyDb.EmailLogs.IgnoreQueryFilters().CountAsync(log =>
            log.TenantId == TestData.Tenant1.Id
            && log.TemplateKey == "vol_waitlist_spot"
            && (log.UserId == TestData.MemberUser.Id || log.UserId == TestData.AdminUser.Id)))
            .Should().Be(2);
        (await verifyDb.PushNotificationLogs.IgnoreQueryFilters().CountAsync(log =>
            log.TenantId == TestData.Tenant1.Id
            && (log.UserId == TestData.MemberUser.Id || log.UserId == TestData.AdminUser.Id)))
            .Should().Be(2);
    }

    [Fact]
    public async Task CancelSignup_ClearsAssignmentNotifiesVolunteerAndWaiter_ThenRetryIsNotFound()
    {
        int shiftId;
        int applicationId;
        int waitlistId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Idempotent cancellation");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 2);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            application.ShiftId = shift.Id;
            var waitlistEntry = NewWaitlistEntry(
                shift,
                TestData.AdminUser.Id,
                "waiting");
            db.AddRange(application, waitlistEntry);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            applicationId = application.Id;
            waitlistId = waitlistEntry.Id;
        }

        await AuthenticateAsMemberAsync();

        var first = await Client.DeleteAsync($"/api/v2/volunteering/shifts/{shiftId}/signup");
        first.StatusCode.Should().Be(HttpStatusCode.NoContent);
        var retry = await Client.DeleteAsync($"/api/v2/volunteering/shifts/{shiftId}/signup");
        retry.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var retryError = (await ReadJsonAsync(retry)).GetProperty("errors")[0];
        retryError.GetProperty("code").GetString().Should().Be("NOT_FOUND");
        retryError.GetProperty("message").GetString()
            .Should().Be("You are not signed up for this shift");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId);
        stored.Status.Should().Be(ApplicationStatus.Approved);
        stored.ShiftId.Should().BeNull();
        var waitlist = await verifyDb.ShiftWaitlistEntries.IgnoreQueryFilters()
            .SingleAsync(entry => entry.Id == waitlistId);
        waitlist.Status.Should().Be("notified");
        waitlist.NotifiedAt.Should().NotBeNull();
        (await verifyDb.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.MemberUser.Id
            && notification.Type == "volunteer_shift"
            && notification.Body == "Your volunteer shift signup has been cancelled"))
            .Should().Be(1);
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.AdminUser.Id
            && notification.Type == "vol_waitlist_spot"))
            .Should().BeTrue();
    }

    [Fact]
    public async Task CancelSignup_IsTenantSafeAndRejectsStartedShift()
    {
        int otherTenantShiftId;
        int otherTenantApplicationId;
        int startedShiftId;
        int startedApplicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var otherOpportunity = NewOpportunity(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Other tenant cancellation");
            var startedOpportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Started cancellation");
            db.AddRange(otherOpportunity, startedOpportunity);
            await db.SaveChangesAsync();
            var otherShift = NewShift(otherOpportunity, maxVolunteers: 2);
            var startedShift = NewShift(startedOpportunity, maxVolunteers: 2);
            startedShift.StartsAt = DateTime.UtcNow.AddHours(-2);
            startedShift.EndsAt = DateTime.UtcNow.AddHours(-1);
            db.AddRange(otherShift, startedShift);
            await db.SaveChangesAsync();
            var otherApplication = NewApplication(
                otherOpportunity,
                TestData.OtherTenantUser.Id,
                ApplicationStatus.Approved);
            otherApplication.ShiftId = otherShift.Id;
            var startedApplication = NewApplication(
                startedOpportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            startedApplication.ShiftId = startedShift.Id;
            db.AddRange(otherApplication, startedApplication);
            await db.SaveChangesAsync();
            otherTenantShiftId = otherShift.Id;
            otherTenantApplicationId = otherApplication.Id;
            startedShiftId = startedShift.Id;
            startedApplicationId = startedApplication.Id;
        }

        await AuthenticateAsMemberAsync();

        var crossTenant = await Client.DeleteAsync(
            $"/api/v2/volunteering/shifts/{otherTenantShiftId}/signup");
        crossTenant.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var crossTenantError = (await ReadJsonAsync(crossTenant)).GetProperty("errors")[0];
        crossTenantError.GetProperty("code").GetString().Should().Be("NOT_FOUND");

        var started = await Client.DeleteAsync(
            $"/api/v2/volunteering/shifts/{startedShiftId}/signup");
        started.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var startedError = (await ReadJsonAsync(started)).GetProperty("errors")[0];
        startedError.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        startedError.GetProperty("message").GetString()
            .Should().Be("Cannot cancel a shift that has already started");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == otherTenantApplicationId))
            .ShiftId.Should().Be(otherTenantShiftId);
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == startedApplicationId))
            .ShiftId.Should().Be(startedShiftId);
    }

    [Fact]
    public async Task CancelSignup_EnforcesConfiguredAdvanceNoticeDeadline()
    {
        int shiftId;
        int applicationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "volunteering.cancellation_deadline_hours",
                Value = "24",
                CreatedAt = DateTime.UtcNow
            });
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Cancellation deadline");
            db.VolunteerOpportunities.Add(opportunity);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 2);
            shift.StartsAt = DateTime.UtcNow.AddHours(6);
            shift.EndsAt = DateTime.UtcNow.AddHours(8);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var application = NewApplication(
                opportunity,
                TestData.MemberUser.Id,
                ApplicationStatus.Approved);
            application.ShiftId = shift.Id;
            db.VolunteerApplications.Add(application);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            applicationId = application.Id;
        }

        await AuthenticateAsMemberAsync();

        var response = await Client.DeleteAsync(
            $"/api/v2/volunteering/shifts/{shiftId}/signup");

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be(
            "This shift can no longer be cancelled. Cancellations close 24 hours before the shift starts.");
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerApplications.IgnoreQueryFilters()
            .SingleAsync(application => application.Id == applicationId))
            .ShiftId.Should().Be(shiftId);
        (await verifyDb.Notifications.IgnoreQueryFilters().AnyAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.MemberUser.Id
            && notification.Type == "volunteer_shift"))
            .Should().BeFalse();
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId, string title) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = $"{title} {Guid.NewGuid():N}",
        Description = "Waitlist and cancellation workflow test",
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

    private static ShiftWaitlistEntry NewWaitlistEntry(
        VolunteerShift shift,
        int userId,
        string status) => new()
    {
        TenantId = shift.TenantId,
        ShiftId = shift.Id,
        UserId = userId,
        Position = 1,
        Status = status,
        NotifiedAt = status == "notified" ? DateTime.UtcNow : null,
        CreatedAt = DateTime.UtcNow
    };

    private static Group NewGroup(int tenantId, int creatorId, string name) => new()
    {
        TenantId = tenantId,
        CreatedById = creatorId,
        Name = $"{name} {Guid.NewGuid():N}",
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

    private static async Task<string?> ReadWorkflowErrorAsync(HttpResponseMessage response)
    {
        var body = await ReadJsonAsync(response);
        return body.GetProperty("errors")[0].GetProperty("message").GetString();
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
}
