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
public sealed class ShiftGroupReservationCapacityTests : IntegrationTestBase
{
    private const string ReservationPath = "/api/v2/volunteering/shifts";

    public ShiftGroupReservationCapacityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Create_ValidatesSlotsAndTenantScopesShiftAndGroup()
    {
        int localShiftId;
        int otherShiftId;
        int localGroupId;
        int otherGroupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var localOpportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Local rota");
            var otherOpportunity = NewOpportunity(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other rota");
            var localGroup = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Local group");
            var otherGroup = NewGroup(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other group");
            db.AddRange(localOpportunity, otherOpportunity, localGroup, otherGroup);
            await db.SaveChangesAsync();

            var localShift = NewShift(localOpportunity, maxVolunteers: 5);
            var otherShift = NewShift(otherOpportunity, maxVolunteers: 5);
            db.AddRange(localShift, otherShift);
            await db.SaveChangesAsync();
            localShiftId = localShift.Id;
            otherShiftId = otherShift.Id;
            localGroupId = localGroup.Id;
            otherGroupId = otherGroup.Id;
        }

        await AuthenticateAsMemberAsync();

        var invalidSlots = await ReserveAsync(localShiftId, localGroupId, 0);
        invalidSlots.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(invalidSlots)).Should().Be("Must reserve at least 1 slot");

        var crossTenantShift = await ReserveAsync(otherShiftId, localGroupId, 1);
        crossTenantShift.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadErrorAsync(crossTenantShift)).Should().Be("Shift not found");

        var crossTenantGroup = await ReserveAsync(localShiftId, otherGroupId, 1);
        crossTenantGroup.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadErrorAsync(crossTenantGroup)).Should().Be("Group not found");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .CountAsync(row => row.ShiftId == localShiftId || row.ShiftId == otherShiftId))
            .Should().Be(0);
    }

    [Fact]
    public async Task Create_RequiresTenantAdminGroupOwnerOrGroupAdmin()
    {
        int shiftId;
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Leader check rota");
            var group = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Admin-owned group");
            db.AddRange(opportunity, group);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 5);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            groupId = group.Id;
        }

        await AuthenticateAsMemberAsync();
        var unauthorized = await ReserveAsync(shiftId, groupId, 1);
        unauthorized.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadErrorAsync(unauthorized))
            .Should().Be("Only group leaders/admins can reserve slots for this group");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.GroupMembers.Add(new GroupMember
            {
                TenantId = TestData.Tenant1.Id,
                GroupId = groupId,
                UserId = TestData.MemberUser.Id,
                Role = Group.Roles.Admin,
                JoinedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var authorized = await ReserveAsync(shiftId, groupId, 1);
        authorized.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Create_RejectsStartedShiftAndUnpublishedOpportunity()
    {
        int pastShiftId;
        int draftShiftId;
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var published = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Past rota");
            var draft = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Draft rota");
            draft.Status = OpportunityStatus.Draft;
            var group = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Validation group");
            db.AddRange(published, draft, group);
            await db.SaveChangesAsync();

            var pastShift = NewShift(published, maxVolunteers: 5);
            pastShift.StartsAt = DateTime.UtcNow.AddHours(-2);
            pastShift.EndsAt = DateTime.UtcNow.AddHours(-1);
            var draftShift = NewShift(draft, maxVolunteers: 5);
            db.AddRange(pastShift, draftShift);
            await db.SaveChangesAsync();
            pastShiftId = pastShift.Id;
            draftShiftId = draftShift.Id;
            groupId = group.Id;
        }

        await AuthenticateAsMemberAsync();

        var started = await ReserveAsync(pastShiftId, groupId, 1);
        started.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(started))
            .Should().Be("Cannot reserve slots for a shift that has already started");

        var inactive = await ReserveAsync(draftShiftId, groupId, 1);
        inactive.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadErrorAsync(inactive)).Should().Be("Opportunity not found or is not active");
    }

    [Fact]
    public async Task Create_CountsApprovedApplicationsAndActiveTenantReservationsOnly()
    {
        int shiftId;
        int leaderGroupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Capacity rota");
            var approvedUser = NewUser(TestData.Tenant1.Id, "capacity-approved");
            var leaderGroup = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Capacity leader group");
            var occupiedGroup = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Occupied group");
            var otherGroup = NewGroup(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other capacity group");
            db.AddRange(opportunity, approvedUser, leaderGroup, occupiedGroup, otherGroup);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, maxVolunteers: 4);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            db.AddRange(
                new VolunteerApplication
                {
                    TenantId = TestData.Tenant1.Id,
                    OpportunityId = opportunity.Id,
                    ShiftId = shift.Id,
                    UserId = approvedUser.Id,
                    Status = ApplicationStatus.Approved,
                    CreatedAt = DateTime.UtcNow
                },
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant1.Id,
                    ShiftId = shift.Id,
                    GroupId = occupiedGroup.Id,
                    ReservedBy = TestData.AdminUser.Id,
                    ReservedSlots = 1,
                    Status = "active",
                    CreatedAt = DateTime.UtcNow
                },
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant1.Id,
                    ShiftId = shift.Id,
                    GroupId = occupiedGroup.Id,
                    ReservedBy = TestData.AdminUser.Id,
                    ReservedSlots = 50,
                    Status = "cancelled",
                    CreatedAt = DateTime.UtcNow
                },
                new ShiftGroupReservation
                {
                    TenantId = TestData.Tenant2.Id,
                    ShiftId = shift.Id,
                    GroupId = otherGroup.Id,
                    ReservedBy = TestData.OtherTenantUser.Id,
                    ReservedSlots = 50,
                    Status = "active",
                    CreatedAt = DateTime.UtcNow
                });
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            leaderGroupId = leaderGroup.Id;
        }

        await AuthenticateAsMemberAsync();

        var tooMany = await ReserveAsync(shiftId, leaderGroupId, 3);
        tooMany.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(tooMany)).Should().Be("Only 2 slots available");

        var exactCapacity = await ReserveAsync(shiftId, leaderGroupId, 2);
        exactCapacity.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task ConcurrentReservationsForFinalSlot_HaveExactlyOneWinner()
    {
        int shiftId;
        int firstGroupId;
        int secondGroupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Final slot rota");
            var firstGroup = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Final slot one");
            var secondGroup = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Final slot two");
            db.AddRange(opportunity, firstGroup, secondGroup);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 1);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            firstGroupId = firstGroup.Id;
            secondGroupId = secondGroup.Id;
        }

        await AuthenticateAsMemberAsync();
        var responses = await Task.WhenAll(
            ReserveAsync(shiftId, firstGroupId, 1),
            ReserveAsync(shiftId, secondGroupId, 1));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.Created, HttpStatusCode.UnprocessableEntity });
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(loser)).Should().Be("Only 0 slots available");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var reservations = await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id && row.ShiftId == shiftId && row.Status == "active")
            .ToListAsync();
        reservations.Should().ContainSingle();
        reservations.Sum(row => row.ReservedSlots).Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentDuplicateReservations_HaveExactlyOneWinner()
    {
        int shiftId;
        int groupId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Duplicate rota");
            var group = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Duplicate group");
            db.AddRange(opportunity, group);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 10);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            shiftId = shift.Id;
            groupId = group.Id;
        }

        await AuthenticateAsMemberAsync();
        var responses = await Task.WhenAll(
            ReserveAsync(shiftId, groupId, 1),
            ReserveAsync(shiftId, groupId, 1));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.Created, HttpStatusCode.Conflict });
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.Conflict);
        (await ReadErrorAsync(loser))
            .Should().Be("This group already has a reservation for this shift");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftGroupReservations.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.ShiftId == shiftId
            && row.GroupId == groupId
            && row.Status == "active"))
            .Should().Be(1);
    }

    [Fact]
    public async Task AddMember_RejectsCrossTenantUserAndSerializesFinalReservedPlace()
    {
        int reservationId;
        int firstUserId;
        int secondUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Member lock rota");
            var group = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Member lock group");
            var firstUser = NewUser(TestData.Tenant1.Id, "member-lock-one");
            var secondUser = NewUser(TestData.Tenant1.Id, "member-lock-two");
            db.AddRange(opportunity, group, firstUser, secondUser);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 5);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var reservation = new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                GroupId = group.Id,
                ReservedBy = TestData.MemberUser.Id,
                ReservedSlots = 1,
                FilledSlots = 0,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftGroupReservations.Add(reservation);
            await db.SaveChangesAsync();
            reservationId = reservation.Id;
            firstUserId = firstUser.Id;
            secondUserId = secondUser.Id;
        }

        await AuthenticateAsMemberAsync();

        var crossTenant = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/group-reservations/{reservationId}/members",
            new { user_id = TestData.OtherTenantUser.Id });
        crossTenant.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(crossTenant)).Should().Be("Invalid user");

        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync(
                $"/api/v2/volunteering/group-reservations/{reservationId}/members",
                new { user_id = firstUserId }),
            Client.PostAsJsonAsync(
                $"/api/v2/volunteering/group-reservations/{reservationId}/members",
                new { user_id = secondUserId }));
        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity });
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        (await ReadErrorAsync(loser)).Should().Be("All reserved slots are filled");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftGroupMembers.IgnoreQueryFilters().CountAsync(member =>
            member.ReservationId == reservationId && member.Status == "confirmed"))
            .Should().Be(1);
        (await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == reservationId))
            .FilledSlots.Should().Be(1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AddMember_ConfiguredMinorRequiresMatchingOrGlobalUnexpiredGuardianConsent(
        bool globalConsent)
    {
        int opportunityId;
        int reservationId;
        int minorUserId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Guardian consent group rota");
            var group = NewGroup(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Guardian consent group");
            var minor = NewUser(TestData.Tenant1.Id, "guardian-consent-minor");
            minor.NotificationPreferences = JsonSerializer.Serialize(new
            {
                date_of_birth = DateTime.UtcNow.AddYears(-15).ToString("yyyy-MM-dd")
            });
            db.AddRange(opportunity, group, minor);
            await db.SaveChangesAsync();

            var shift = NewShift(opportunity, maxVolunteers: 2);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();

            var reservation = new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                GroupId = group.Id,
                ReservedBy = TestData.MemberUser.Id,
                ReservedSlots = 1,
                FilledSlots = 0,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.AddRange(
                reservation,
                new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = "volunteering.guardian_consent_required",
                    Value = "true",
                    CreatedAt = DateTime.UtcNow
                });
            await db.SaveChangesAsync();

            opportunityId = opportunity.Id;
            reservationId = reservation.Id;
            minorUserId = minor.Id;
        }

        await AuthenticateAsMemberAsync();

        var blocked = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/group-reservations/{reservationId}/members",
            new { user_id = minorUserId });

        blocked.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var blockedError = (await ReadJsonAsync(blocked)).GetProperty("errors")[0];
        blockedError.GetProperty("code").GetString().Should().Be("GUARDIAN_CONSENT_REQUIRED");
        blockedError.GetProperty("message").GetString().Should().Be(
            "A parent or guardian needs to approve your participation before you can volunteer. Please send a consent request first.");

        using (var verifyBlockedScope = Factory.Services.CreateScope())
        {
            var verifyBlockedDb = verifyBlockedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await verifyBlockedDb.ShiftGroupMembers.IgnoreQueryFilters().AnyAsync(member =>
                member.ReservationId == reservationId && member.UserId == minorUserId))
                .Should().BeFalse();
            (await verifyBlockedDb.ShiftGroupReservations.IgnoreQueryFilters()
                .SingleAsync(row => row.Id == reservationId))
                .FilledSlots.Should().Be(0);
        }

        using (var consentScope = Factory.Services.CreateScope())
        {
            var consentDb = consentScope.ServiceProvider.GetRequiredService<NexusDbContext>();
            consentDb.VolunteerGuardianConsents.Add(new VolunteerGuardianConsent
            {
                TenantId = TestData.Tenant1.Id,
                MinorUserId = minorUserId,
                OpportunityId = globalConsent ? null : opportunityId,
                GuardianName = "Test Guardian",
                GuardianEmail = "guardian@test.local",
                Status = VolunteerGuardianConsentStatus.Active,
                ConsentedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(30),
                CreatedAt = DateTime.UtcNow
            });
            await consentDb.SaveChangesAsync();
        }

        var permitted = await Client.PostAsJsonAsync(
            $"/api/v2/volunteering/group-reservations/{reservationId}/members",
            new { user_id = minorUserId });

        permitted.StatusCode.Should().Be(HttpStatusCode.OK);
        var permittedData = (await ReadJsonAsync(permitted)).GetProperty("data");
        permittedData.GetProperty("user_id").GetInt32().Should().Be(minorUserId);

        using var verifyPermittedScope = Factory.Services.CreateScope();
        var verifyPermittedDb = verifyPermittedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyPermittedDb.ShiftGroupMembers.IgnoreQueryFilters().CountAsync(member =>
            member.ReservationId == reservationId
            && member.UserId == minorUserId
            && member.Status == "confirmed"))
            .Should().Be(1);
        (await verifyPermittedDb.ShiftGroupReservations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == reservationId))
            .FilledSlots.Should().Be(1);
    }

    [Fact]
    public async Task CanonicalListIncludesMemberReservationsAndRemovalUsesTargetUserId()
    {
        int reservationId;
        int memberRowId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.AdminUser.Id, "Member-involved list");
            var group = NewGroup(TestData.Tenant1.Id, TestData.AdminUser.Id, "Member-involved group");
            var formerUser = NewUser(TestData.Tenant1.Id, "former-reservation-member");
            db.AddRange(opportunity, group, formerUser);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 5);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var reservation = new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                GroupId = group.Id,
                ReservedBy = TestData.AdminUser.Id,
                ReservedSlots = 2,
                FilledSlots = 1,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftGroupReservations.Add(reservation);
            await db.SaveChangesAsync();
            var member = new ShiftGroupMember
            {
                TenantId = TestData.Tenant1.Id,
                ReservationId = reservation.Id,
                UserId = TestData.MemberUser.Id,
                Status = "confirmed",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftGroupMembers.AddRange(
                member,
                new ShiftGroupMember
                {
                    TenantId = TestData.Tenant1.Id,
                    ReservationId = reservation.Id,
                    UserId = formerUser.Id,
                    Status = "cancelled",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-1)
                });
            await db.SaveChangesAsync();
            reservationId = reservation.Id;
            memberRowId = member.Id;
        }

        await AuthenticateAsMemberAsync();
        var list = await Client.GetAsync("/api/v2/volunteering/group-reservations");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listBody = await ReadJsonAsync(list);
        listBody.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();
        var row = listBody.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == reservationId);
        row.GetProperty("is_leader").GetBoolean().Should().BeFalse();
        row.GetProperty("members").GetArrayLength().Should().Be(2);
        row.GetProperty("members").EnumerateArray()
            .Should().Contain(item =>
                item.GetProperty("id").GetInt32() == TestData.MemberUser.Id
                && item.GetProperty("status").GetString() == "confirmed");

        await AuthenticateAsAdminAsync();
        var removed = await Client.DeleteAsync(
            $"/api/v2/volunteering/group-reservations/{reservationId}/members/{TestData.MemberUser.Id}");
        removed.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedMember = await verifyDb.ShiftGroupMembers.IgnoreQueryFilters()
            .SingleAsync(member => member.Id == memberRowId);
        storedMember.Status.Should().Be("cancelled");
        (await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == reservationId))
            .FilledSlots.Should().Be(0);
    }

    [Fact]
    public async Task Cancel_CancelsReservationAndAllConfirmedMemberRows()
    {
        int reservationId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = NewOpportunity(TestData.Tenant1.Id, TestData.MemberUser.Id, "Cancellation rota");
            var group = NewGroup(TestData.Tenant1.Id, TestData.MemberUser.Id, "Cancellation group");
            var localUser = NewUser(TestData.Tenant1.Id, "cancel-local");
            db.AddRange(opportunity, group, localUser);
            await db.SaveChangesAsync();
            var shift = NewShift(opportunity, maxVolunteers: 5);
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            var reservation = new ShiftGroupReservation
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                GroupId = group.Id,
                ReservedBy = TestData.MemberUser.Id,
                ReservedSlots = 2,
                FilledSlots = 2,
                Status = "active",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftGroupReservations.Add(reservation);
            await db.SaveChangesAsync();
            db.ShiftGroupMembers.AddRange(
                new ShiftGroupMember
                {
                    TenantId = TestData.Tenant1.Id,
                    ReservationId = reservation.Id,
                    UserId = localUser.Id,
                    Status = "confirmed",
                    CreatedAt = DateTime.UtcNow
                },
                // A malformed legacy tenant id must not leave an active member
                // attached to a reservation that has been cancelled.
                new ShiftGroupMember
                {
                    TenantId = TestData.Tenant2.Id,
                    ReservationId = reservation.Id,
                    UserId = TestData.OtherTenantUser.Id,
                    Status = "confirmed",
                    CreatedAt = DateTime.UtcNow
                });
            await db.SaveChangesAsync();
            reservationId = reservation.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.DeleteAsync(
            $"/api/v2/volunteering/group-reservations/{reservationId}");
        response.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.ShiftGroupReservations.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == reservationId))
            .Status.Should().Be("cancelled");
        var members = await verifyDb.ShiftGroupMembers.IgnoreQueryFilters()
            .Where(member => member.ReservationId == reservationId)
            .ToListAsync();
        members.Should().HaveCount(2);
        members.Should().OnlyContain(member => member.Status == "cancelled");
    }

    private Task<HttpResponseMessage> ReserveAsync(int shiftId, int groupId, int reservedSlots) =>
        Client.PostAsJsonAsync($"{ReservationPath}/{shiftId}/group-reserve", new
        {
            group_id = groupId,
            reserved_slots = reservedSlots,
            notes = "Integration test reservation"
        });

    private static async Task<string?> ReadErrorAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.GetProperty("errors")[0].GetProperty("message").GetString();
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static VolunteerOpportunity NewOpportunity(int tenantId, int organizerId, string title) => new()
    {
        TenantId = tenantId,
        OrganizerId = organizerId,
        Title = title,
        Description = "Test opportunity",
        Status = OpportunityStatus.Published,
        RequiredVolunteers = 5,
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
}
