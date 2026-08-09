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
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class ShiftSwapAssignmentParityTests : IntegrationTestBase
{
    public ShiftSwapAssignmentParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalMemberRoutesUseLaravelPayloadsEnvelopesAndActions()
    {
        await WithSwapAdminSettingAsync(false, async () =>
        {
            var scenario = await SeedScenarioAsync(createSwap: false);
            await AuthenticateAsMemberAsync();

            var invalidRequiredIds = await Client.PostAsJsonAsync(
                "/api/v2/volunteering/swaps",
                new { from_shift_id = 0, to_shift_id = 0, to_user_id = 0 });
            invalidRequiredIds.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var invalidRequiredBody = await invalidRequiredIds.Content
                .ReadFromJsonAsync<JsonElement>();
            invalidRequiredBody.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VALIDATION_ERROR");
            AssertV2Headers(invalidRequiredIds);

            var overlongMessage = await Client.PostAsJsonAsync(
                "/api/v2/volunteering/swaps",
                new
                {
                    from_shift_id = scenario.FromShiftId,
                    to_shift_id = scenario.ToShiftId,
                    to_user_id = TestData.AdminUser.Id,
                    message = new string('x', 1001)
                });
            overlongMessage.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var overlongBody = await overlongMessage.Content.ReadFromJsonAsync<JsonElement>();
            overlongBody.GetProperty("errors")[0].GetProperty("code").GetString()
                .Should().Be("VALIDATION_ERROR");

            var create = await Client.PostAsJsonAsync("/api/v2/volunteering/swaps", new
            {
                from_shift_id = scenario.FromShiftId,
                to_shift_id = scenario.ToShiftId,
                to_user_id = TestData.AdminUser.Id,
                message = "  Canonical request  "
            });
            create.StatusCode.Should().Be(HttpStatusCode.Created);
            AssertV2Headers(create);
            var createBody = await create.Content.ReadFromJsonAsync<JsonElement>();
            var swapId = createBody.GetProperty("data").GetProperty("id").GetInt32();
            scenario = scenario with { SwapId = swapId };

            var list = await Client.GetAsync("/api/v2/volunteering/swaps?direction=outgoing");
            list.StatusCode.Should().Be(HttpStatusCode.OK);
            var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
            var row = listBody.GetProperty("data").EnumerateArray()
                .Single(item => item.GetProperty("id").GetInt32() == swapId);
            row.GetProperty("direction").GetString().Should().Be("sent");
            row.GetProperty("message").GetString().Should().Be("Canonical request");
            row.GetProperty("requester").GetProperty("id").GetInt32()
                .Should().Be(TestData.MemberUser.Id);
            row.GetProperty("recipient").GetProperty("id").GetInt32()
                .Should().Be(TestData.AdminUser.Id);
            row.GetProperty("original_shift").GetProperty("id").GetInt32()
                .Should().Be(scenario.FromShiftId);
            row.GetProperty("proposed_shift").GetProperty("id").GetInt32()
                .Should().Be(scenario.ToShiftId);

            await AuthenticateAsAdminAsync();
            var invalid = await Client.PutAsJsonAsync(
                $"/api/v2/volunteering/swaps/{swapId}",
                new { action = "approve" });
            invalid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            var invalidBody = await invalid.Content.ReadFromJsonAsync<JsonElement>();
            invalidBody.GetProperty("errors")[0].GetProperty("field").GetString()
                .Should().Be("action");

            var accept = await Client.PutAsJsonAsync(
                $"/api/v2/volunteering/swaps/{swapId}",
                new { action = "accept" });
            accept.StatusCode.Should().Be(HttpStatusCode.OK);
            var acceptBody = await accept.Content.ReadFromJsonAsync<JsonElement>();
            acceptBody.GetProperty("data").GetProperty("status").GetString()
                .Should().Be("accepted");
            await AssertPersistedStateAsync(
                scenario,
                scenario.ToShiftId,
                scenario.FromShiftId,
                "accepted");
        });
    }

    [Fact]
    public async Task CanonicalAdminRoutesResolveTenantConfiguredPendingSwap()
    {
        await WithSwapAdminSettingAsync(true, async () =>
        {
            var scenario = await SeedScenarioAsync(createSwap: false);
            await AuthenticateAsMemberAsync();
            var create = await Client.PostAsJsonAsync("/api/v2/volunteering/swaps", new
            {
                from_shift_id = scenario.FromShiftId,
                to_shift_id = scenario.ToShiftId,
                to_user_id = TestData.AdminUser.Id,
                message = "Administrator approval required"
            });
            create.StatusCode.Should().Be(HttpStatusCode.Created);
            var createBody = await create.Content.ReadFromJsonAsync<JsonElement>();
            var swapId = createBody.GetProperty("data").GetProperty("id").GetInt32();
            scenario = scenario with { SwapId = swapId };

            await AuthenticateAsAdminAsync();
            var accept = await Client.PutAsJsonAsync(
                $"/api/v2/volunteering/swaps/{swapId}",
                new { action = "accept" });
            accept.StatusCode.Should().Be(HttpStatusCode.OK);
            var acceptBody = await accept.Content.ReadFromJsonAsync<JsonElement>();
            acceptBody.GetProperty("data").GetProperty("status").GetString()
                .Should().Be("admin_pending");

            var pending = await Client.GetAsync("/api/v2/volunteering/admin/swaps");
            pending.StatusCode.Should().Be(HttpStatusCode.OK);
            AssertV2Headers(pending);
            var pendingBody = await pending.Content.ReadFromJsonAsync<JsonElement>();
            pendingBody.GetProperty("data").EnumerateArray()
                .Should().Contain(row => row.GetProperty("id").GetInt32() == swapId);

            var approve = await Client.PutAsJsonAsync(
                $"/api/v2/volunteering/admin/swaps/{swapId}",
                new { action = "approve" });
            approve.StatusCode.Should().Be(HttpStatusCode.OK);
            var approveBody = await approve.Content.ReadFromJsonAsync<JsonElement>();
            approveBody.GetProperty("data").GetProperty("status").GetString()
                .Should().Be("admin_approved");
            await AssertPersistedStateAsync(
                scenario,
                scenario.ToShiftId,
                scenario.FromShiftId,
                "admin_approved");

            await AuthenticateAsMemberAsync();
            using var forbidden = await Client.GetAsync("/api/v2/volunteering/admin/swaps");
            forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            AssertV2Headers(forbidden);
        });
    }

    [Fact]
    public async Task CanonicalListsOmitHistoricalSwapWhoseOptionalTargetShiftWasCleared()
    {
        var scenario = await SeedScenarioAsync(createSwap: false, includeQrRows: false);
        int incompleteSwapId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var incomplete = new ShiftSwapRequest
            {
                TenantId = TestData.Tenant1.Id,
                FromUserId = TestData.MemberUser.Id,
                ToUserId = TestData.AdminUser.Id,
                FromShiftId = scenario.FromShiftId,
                ToShiftId = null,
                Status = "admin_pending",
                RequiresAdminApproval = true,
                Message = "Target shift was deleted",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftSwapRequests.Add(incomplete);
            await db.SaveChangesAsync();
            incompleteSwapId = incomplete.Id;
        }

        await AuthenticateAsMemberAsync();
        var memberList = await Client.GetAsync("/api/v2/volunteering/swaps");
        memberList.StatusCode.Should().Be(HttpStatusCode.OK);
        var memberBody = await memberList.Content.ReadFromJsonAsync<JsonElement>();
        memberBody.GetProperty("data").EnumerateArray().Should().NotContain(row =>
            row.GetProperty("id").GetInt32() == incompleteSwapId);

        await AuthenticateAsAdminAsync();
        var adminList = await Client.GetAsync("/api/v2/volunteering/admin/swaps");
        adminList.StatusCode.Should().Be(HttpStatusCode.OK);
        var adminBody = await adminList.Content.ReadFromJsonAsync<JsonElement>();
        adminBody.GetProperty("data").EnumerateArray().Should().NotContain(row =>
            row.GetProperty("id").GetInt32() == incompleteSwapId);
    }

    [Fact]
    public async Task RequestSwap_UsesApprovedAssignmentsRatherThanQrAttendance()
    {
        var valid = await SeedScenarioAsync(createSwap: false, includeQrRows: false);

        using (var scope = Factory.Services.CreateScope())
        {
            SetTenant(scope.ServiceProvider);
            var service = scope.ServiceProvider.GetRequiredService<ShiftManagementService>();
            var (swap, error) = await service.RequestSwapAsync(
                TestData.MemberUser.Id,
                new SwapRequest(
                    valid.FromShiftId,
                    valid.ToShiftId,
                    TestData.AdminUser.Id,
                    "Approved assignment swap"));

            error.Should().BeNull();
            swap.Should().NotBeNull();
            swap!.Status.Should().Be("pending");
        }

        var qrOnly = await SeedScenarioAsync(
            createSwap: false,
            includeQrRows: true,
            fromApplicationStatus: ApplicationStatus.Declined);

        using var deniedScope = Factory.Services.CreateScope();
        SetTenant(deniedScope.ServiceProvider);
        var deniedService = deniedScope.ServiceProvider.GetRequiredService<ShiftManagementService>();
        var (deniedSwap, deniedError) = await deniedService.RequestSwapAsync(
            TestData.MemberUser.Id,
            new SwapRequest(
                qrOnly.FromShiftId,
                qrOnly.ToShiftId,
                TestData.AdminUser.Id,
                "A QR row is not an assignment"));

        deniedSwap.Should().BeNull();
        deniedError.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task RespondToSwap_AcceptedDirectSwapMovesApplicationsAndPreservesQrRows()
    {
        var scenario = await SeedScenarioAsync();

        var result = await RespondAsync(scenario.SwapId, accept: true);

        result.Error.Should().BeNull();
        result.Swap.Should().NotBeNull();
        result.Swap!.Status.Should().Be("accepted");
        await AssertPersistedStateAsync(
            scenario,
            expectedFromApplicationShiftId: scenario.ToShiftId,
            expectedToApplicationShiftId: scenario.FromShiftId,
            expectedSwapStatus: "accepted");
    }

    [Fact]
    public async Task RespondToSwap_WhenTargetAssignmentWentStaleIsAtomic()
    {
        var scenario = await SeedScenarioAsync();
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.VolunteerApplications.IgnoreQueryFilters()
                .Where(application => application.Id == scenario.ToApplicationId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(application => application.Status, ApplicationStatus.Declined));
        }

        var result = await RespondAsync(scenario.SwapId, accept: true);

        result.Swap.Should().BeNull();
        result.Error.Should().NotBeNullOrWhiteSpace();
        await AssertPersistedStateAsync(
            scenario,
            expectedFromApplicationShiftId: scenario.FromShiftId,
            expectedToApplicationShiftId: scenario.ToShiftId,
            expectedSwapStatus: "pending",
            expectedToApplicationStatus: ApplicationStatus.Declined);
    }

    [Fact]
    public async Task RespondToSwap_WhenAdminApprovalRequiredOnlyTransitionsToAdminPending()
    {
        var scenario = await SeedScenarioAsync(requiresAdminApproval: true);

        var result = await RespondAsync(scenario.SwapId, accept: true);

        result.Error.Should().BeNull();
        result.Swap.Should().NotBeNull();
        result.Swap!.Status.Should().Be("admin_pending");
        await AssertPersistedStateAsync(
            scenario,
            expectedFromApplicationShiftId: scenario.FromShiftId,
            expectedToApplicationShiftId: scenario.ToShiftId,
            expectedSwapStatus: "admin_pending");
    }

    [Fact]
    public async Task RespondToSwap_WhenShiftHasStartedLeavesEverythingPending()
    {
        var scenario = await SeedScenarioAsync();
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.VolunteerShifts.IgnoreQueryFilters()
                .Where(shift => shift.Id == scenario.FromShiftId)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(shift => shift.StartsAt, DateTime.UtcNow.AddMinutes(-1))
                    .SetProperty(shift => shift.EndsAt, DateTime.UtcNow.AddHours(1)));
        }

        var result = await RespondAsync(scenario.SwapId, accept: true);

        result.Swap.Should().BeNull();
        result.Error.Should().NotBeNullOrWhiteSpace();
        await AssertPersistedStateAsync(
            scenario,
            expectedFromApplicationShiftId: scenario.FromShiftId,
            expectedToApplicationShiftId: scenario.ToShiftId,
            expectedSwapStatus: "pending");
    }

    [Fact]
    public async Task RespondToSwap_WhenDestinationOverlapsAnotherApprovedShiftIsAtomic()
    {
        var scenario = await SeedScenarioAsync();
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var target = await db.VolunteerShifts.IgnoreQueryFilters()
                .AsNoTracking()
                .SingleAsync(shift => shift.Id == scenario.ToShiftId);
            var overlap = new VolunteerShift
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = scenario.OpportunityId,
                Title = "Overlapping assignment",
                StartsAt = target.StartsAt.AddMinutes(15),
                EndsAt = target.EndsAt.AddMinutes(-15),
                MaxVolunteers = 2,
                Status = ShiftStatus.Scheduled,
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerShifts.Add(overlap);
            await db.SaveChangesAsync();
            db.VolunteerApplications.Add(new VolunteerApplication
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = scenario.OpportunityId,
                ShiftId = overlap.Id,
                UserId = TestData.MemberUser.Id,
                Status = ApplicationStatus.Approved,
                ReviewedById = TestData.AdminUser.Id,
                ReviewedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        var result = await RespondAsync(scenario.SwapId, accept: true);

        result.Swap.Should().BeNull();
        result.Error.Should().NotBeNullOrWhiteSpace();
        await AssertPersistedStateAsync(
            scenario,
            expectedFromApplicationShiftId: scenario.FromShiftId,
            expectedToApplicationShiftId: scenario.ToShiftId,
            expectedSwapStatus: "pending");
    }

    [Fact]
    public async Task AcceptedSwapCannotBeRelabelledCancelled()
    {
        var scenario = await SeedScenarioAsync();
        (await RespondAsync(scenario.SwapId, accept: true)).Error.Should().BeNull();
        await AuthenticateAsMemberAsync();

        var cancel = await Client.DeleteAsync($"/api/v2/volunteering/swaps/{scenario.SwapId}");

        cancel.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertPersistedStateAsync(
            scenario,
            scenario.ToShiftId,
            scenario.FromShiftId,
            "accepted");
    }

    [Fact]
    public async Task ConcurrentIdenticalRequestsPersistOnePendingSwap()
    {
        var scenario = await SeedScenarioAsync(createSwap: false, includeQrRows: false);
        using var firstScope = Factory.Services.CreateScope();
        using var secondScope = Factory.Services.CreateScope();
        SetTenant(firstScope.ServiceProvider);
        SetTenant(secondScope.ServiceProvider);
        var request = new SwapRequest(
            scenario.FromShiftId,
            scenario.ToShiftId,
            TestData.AdminUser.Id,
            "Concurrent duplicate");

        var results = await Task.WhenAll(
            firstScope.ServiceProvider.GetRequiredService<ShiftManagementService>()
                .RequestSwapAsync(TestData.MemberUser.Id, request),
            secondScope.ServiceProvider.GetRequiredService<ShiftManagementService>()
                .RequestSwapAsync(TestData.MemberUser.Id, request));

        results.Count(result => result.Swap is not null && result.Error is null).Should().Be(1);
        results.Single(result => result.Swap is null).Error.Should()
            .Be("A matching swap request is already pending");
        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.ShiftSwapRequests.IgnoreQueryFilters().CountAsync(swap =>
            swap.TenantId == TestData.Tenant1.Id
            && swap.FromUserId == TestData.MemberUser.Id
            && swap.ToUserId == TestData.AdminUser.Id
            && swap.FromShiftId == scenario.FromShiftId
            && swap.ToShiftId == scenario.ToShiftId
            && swap.Status == "pending")).Should().Be(1);
    }

    [Fact]
    public async Task CanonicalSwapRateBucketsReturnLaravelHeadersAndEnvelope()
    {
        var users = await SeedRateLimitUsersAsync();
        await AssertRateLimitedAsync(
            users.MemberList,
            60,
            () => Client.GetAsync("/api/v2/volunteering/swaps"));
        await AssertRateLimitedAsync(
            users.MemberRequest,
            10,
            () => Client.PostAsJsonAsync(
                "/api/v2/volunteering/swaps",
                new { from_shift_id = 0, to_shift_id = 0, to_user_id = 0 }));
        await AssertRateLimitedAsync(
            users.MemberRespond,
            20,
            () => Client.PutAsJsonAsync(
                "/api/v2/volunteering/swaps/999999999",
                new { action = "invalid" }));
        await AssertRateLimitedAsync(
            users.MemberCancel,
            20,
            () => Client.DeleteAsync("/api/v2/volunteering/swaps/999999999"));
        await AssertRateLimitedAsync(
            users.AdminList,
            60,
            () => Client.GetAsync("/api/v2/volunteering/admin/swaps"));
        await AssertRateLimitedAsync(
            users.AdminDecide,
            20,
            () => Client.PutAsJsonAsync(
                "/api/v2/volunteering/admin/swaps/999999999",
                new { action = "invalid" }));
    }

    private async Task<SwapScenario> SeedScenarioAsync(
        bool createSwap = true,
        bool includeQrRows = true,
        bool requiresAdminApproval = false,
        ApplicationStatus fromApplicationStatus = ApplicationStatus.Approved)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            OrganizerId = TestData.AdminUser.Id,
            Title = $"Shift swap opportunity {suffix}",
            Description = "Approved application assignment swap fixture",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 2,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        var fromShift = new VolunteerShift
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            Title = "Requester shift",
            StartsAt = DateTime.UtcNow.AddHours(2),
            EndsAt = DateTime.UtcNow.AddHours(3),
            MaxVolunteers = 2,
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        };
        var toShift = new VolunteerShift
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            Title = "Recipient shift",
            StartsAt = DateTime.UtcNow.AddHours(4),
            EndsAt = DateTime.UtcNow.AddHours(5),
            MaxVolunteers = 2,
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerShifts.AddRange(fromShift, toShift);
        await db.SaveChangesAsync();

        var fromApplication = new VolunteerApplication
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            ShiftId = fromShift.Id,
            UserId = TestData.MemberUser.Id,
            Status = fromApplicationStatus,
            ReviewedById = TestData.AdminUser.Id,
            ReviewedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        var toApplication = new VolunteerApplication
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            ShiftId = toShift.Id,
            UserId = TestData.AdminUser.Id,
            Status = ApplicationStatus.Approved,
            ReviewedById = TestData.AdminUser.Id,
            ReviewedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerApplications.AddRange(fromApplication, toApplication);
        await db.SaveChangesAsync();

        int? fromQrId = null;
        int? toQrId = null;
        var fromToken = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var toToken = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        if (includeQrRows)
        {
            var fromQr = new VolunteerCheckIn
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = fromShift.Id,
                UserId = TestData.MemberUser.Id,
                QrToken = fromToken,
                Status = "pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            var toQr = new VolunteerCheckIn
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = toShift.Id,
                UserId = TestData.AdminUser.Id,
                QrToken = toToken,
                Status = "pending",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            db.VolunteerCheckIns.AddRange(fromQr, toQr);
            await db.SaveChangesAsync();
            fromQrId = fromQr.Id;
            toQrId = toQr.Id;
        }

        var swapId = 0;
        if (createSwap)
        {
            var swap = new ShiftSwapRequest
            {
                TenantId = TestData.Tenant1.Id,
                FromUserId = TestData.MemberUser.Id,
                ToUserId = TestData.AdminUser.Id,
                FromShiftId = fromShift.Id,
                ToShiftId = toShift.Id,
                Status = "pending",
                RequiresAdminApproval = requiresAdminApproval,
                Message = "Please swap",
                CreatedAt = DateTime.UtcNow
            };
            db.ShiftSwapRequests.Add(swap);
            await db.SaveChangesAsync();
            swapId = swap.Id;
        }

        return new SwapScenario(
            opportunity.Id,
            fromShift.Id,
            toShift.Id,
            fromApplication.Id,
            toApplication.Id,
            swapId,
            fromQrId,
            toQrId,
            fromToken,
            toToken);
    }

    private async Task<(ShiftSwapRequest? Swap, string? Error)> RespondAsync(
        int swapId,
        bool accept)
    {
        using var scope = Factory.Services.CreateScope();
        SetTenant(scope.ServiceProvider);
        return await scope.ServiceProvider.GetRequiredService<ShiftManagementService>()
            .RespondToSwapAsync(swapId, TestData.AdminUser.Id, accept);
    }

    private async Task AssertPersistedStateAsync(
        SwapScenario scenario,
        int expectedFromApplicationShiftId,
        int expectedToApplicationShiftId,
        string expectedSwapStatus,
        ApplicationStatus expectedToApplicationStatus = ApplicationStatus.Approved)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var applications = await db.VolunteerApplications.IgnoreQueryFilters()
            .AsNoTracking()
            .Where(application =>
                application.Id == scenario.FromApplicationId
                || application.Id == scenario.ToApplicationId)
            .ToDictionaryAsync(application => application.Id);
        applications[scenario.FromApplicationId].ShiftId.Should()
            .Be(expectedFromApplicationShiftId);
        applications[scenario.ToApplicationId].ShiftId.Should()
            .Be(expectedToApplicationShiftId);
        applications[scenario.ToApplicationId].Status.Should()
            .Be(expectedToApplicationStatus);

        var swapStatus = await db.ShiftSwapRequests.IgnoreQueryFilters()
            .Where(swap => swap.Id == scenario.SwapId)
            .Select(swap => swap.Status)
            .SingleAsync();
        swapStatus.Should().Be(expectedSwapStatus);

        if (scenario.FromQrId.HasValue && scenario.ToQrId.HasValue)
        {
            var qrRows = await db.VolunteerCheckIns.IgnoreQueryFilters()
                .AsNoTracking()
                .Where(row => row.Id == scenario.FromQrId || row.Id == scenario.ToQrId)
                .ToDictionaryAsync(row => row.Id);
            qrRows[scenario.FromQrId.Value].ShiftId.Should().Be(scenario.FromShiftId);
            qrRows[scenario.FromQrId.Value].QrToken.Should().Be(scenario.FromToken);
            qrRows[scenario.FromQrId.Value].Status.Should().Be("pending");
            qrRows[scenario.ToQrId.Value].ShiftId.Should().Be(scenario.ToShiftId);
            qrRows[scenario.ToQrId.Value].QrToken.Should().Be(scenario.ToToken);
            qrRows[scenario.ToQrId.Value].Status.Should().Be("pending");
        }
    }

    private void SetTenant(IServiceProvider services) =>
        services.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);

    private async Task WithSwapAdminSettingAsync(bool enabled, Func<Task> action)
    {
        TenantConfigSnapshot snapshot;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var existing = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleOrDefaultAsync(config =>
                    config.TenantId == TestData.Tenant1.Id
                    && config.Key == ShiftManagementService.SwapRequiresAdminConfigKey);
            snapshot = existing is null
                ? new(false, null, default, null)
                : new(true, existing.Value, existing.CreatedAt, existing.UpdatedAt);
            if (existing is null)
            {
                db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = TestData.Tenant1.Id,
                    Key = ShiftManagementService.SwapRequiresAdminConfigKey,
                    Value = enabled ? "true" : "false",
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                });
            }
            else
            {
                existing.Value = enabled ? "true" : "false";
                existing.UpdatedAt = DateTime.UtcNow;
            }

            await db.SaveChangesAsync();
        }

        try
        {
            await action();
        }
        finally
        {
            using var restore = Factory.Services.CreateScope();
            var db = restore.ServiceProvider.GetRequiredService<NexusDbContext>();
            var current = await db.TenantConfigs.IgnoreQueryFilters()
                .SingleOrDefaultAsync(config =>
                    config.TenantId == TestData.Tenant1.Id
                    && config.Key == ShiftManagementService.SwapRequiresAdminConfigKey);
            if (!snapshot.Exists)
            {
                if (current is not null) db.TenantConfigs.Remove(current);
            }
            else if (current is not null)
            {
                current.Value = snapshot.Value!;
                current.CreatedAt = snapshot.CreatedAt;
                current.UpdatedAt = snapshot.UpdatedAt;
            }

            await db.SaveChangesAsync();
        }
    }

    private async Task<RateLimitUsers> SeedRateLimitUsersAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        User NewUser(string label, bool admin) => new()
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"{label}-{suffix}@swap-rate.test",
            PasswordHash = TestData.MemberUser.PasswordHash,
            FirstName = label,
            LastName = "RateLimit",
            Role = admin ? "admin" : "member",
            IsAdmin = admin,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        var memberList = NewUser("member-list", admin: false);
        var memberRequest = NewUser("member-request", admin: false);
        var memberRespond = NewUser("member-respond", admin: false);
        var memberCancel = NewUser("member-cancel", admin: false);
        var adminList = NewUser("admin-list", admin: true);
        var adminDecide = NewUser("admin-decide", admin: true);
        db.Users.AddRange(
            memberList,
            memberRequest,
            memberRespond,
            memberCancel,
            adminList,
            adminDecide);
        await db.SaveChangesAsync();
        return new RateLimitUsers(
            memberList.Email,
            memberRequest.Email,
            memberRespond.Email,
            memberCancel.Email,
            adminList.Email,
            adminDecide.Email);
    }

    private async Task AssertRateLimitedAsync(
        string email,
        int limit,
        Func<Task<HttpResponseMessage>> send)
    {
        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
        for (var attempt = 0; attempt < limit; attempt++)
        {
            using var response = await send();
            response.StatusCode.Should().NotBe(HttpStatusCode.TooManyRequests);
            if (attempt == 0) AssertV2Headers(response);
        }

        using var rejected = await send();
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        AssertV2Headers(rejected);
        rejected.Headers.GetValues("X-RateLimit-Limit").Single().Should()
            .Be(limit.ToString());
        rejected.Headers.GetValues("X-RateLimit-Remaining").Single().Should().Be("0");
        rejected.Headers.Contains("X-RateLimit-Reset").Should().BeTrue();
        rejected.Headers.RetryAfter.Should().NotBeNull();
        var body = await rejected.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
    }

    private void AssertV2Headers(HttpResponseMessage response)
    {
        response.Headers.GetValues("API-Version").Single().Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Single().Should()
            .Be(TestData.Tenant1.Id.ToString());
    }

    private sealed record SwapScenario(
        int OpportunityId,
        int FromShiftId,
        int ToShiftId,
        int FromApplicationId,
        int ToApplicationId,
        int SwapId,
        int? FromQrId,
        int? ToQrId,
        string FromToken,
        string ToToken);

    private sealed record TenantConfigSnapshot(
        bool Exists,
        string? Value,
        DateTime CreatedAt,
        DateTime? UpdatedAt);

    private sealed record RateLimitUsers(
        string MemberList,
        string MemberRequest,
        string MemberRespond,
        string MemberCancel,
        string AdminList,
        string AdminDecide);
}
