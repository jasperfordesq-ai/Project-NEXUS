// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Phase 63 — tests for the 9 scheduled hosted services.
///
/// Each protected RunForTenantAsync / RunGlobalAsync method is invoked via a
/// test-only subclass that exposes the protected method publicly. We do not
/// rely on the BackgroundService loop firing — these tests run the per-tenant
/// or global tick deterministically and verify the observable side effects.
/// </summary>
[Collection("Integration")]
public class Phase63ScheduledJobsTests : IntegrationTestBase
{
    public Phase63ScheduledJobsTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ─── Test-only subclasses that expose the protected method ──────────────

    private sealed class TestableSyncFederationPartnersJob : SyncFederationPartnersJob
    {
        public TestableSyncFederationPartnersJob(IServiceScopeFactory s, IConfiguration c, ILogger<SyncFederationPartnersJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestablePruneFederationLogsJob : PruneFederationLogsJob
    {
        public TestablePruneFederationLogsJob(IServiceScopeFactory s, IConfiguration c, ILogger<PruneFederationLogsJob> l) : base(s, c, l) { }
        public Task RunGlobalPublic(IServiceProvider sp, CancellationToken ct = default) => RunGlobalAsync(sp, ct);
    }
    private sealed class TestableCheckInactiveGroupsJob : CheckInactiveGroupsJob
    {
        public TestableCheckInactiveGroupsJob(IServiceScopeFactory s, IConfiguration c, ILogger<CheckInactiveGroupsJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestablePollStuckIdentityVerificationsJob : PollStuckIdentityVerificationsJob
    {
        public TestablePollStuckIdentityVerificationsJob(IServiceScopeFactory s, IConfiguration c, ILogger<PollStuckIdentityVerificationsJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableSafeguardingSlaEscalateJob : SafeguardingSlaEscalateJob
    {
        public TestableSafeguardingSlaEscalateJob(IServiceScopeFactory s, IConfiguration c, ILogger<SafeguardingSlaEscalateJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableMarkOverdueDuesJob : MarkOverdueDuesJob
    {
        public TestableMarkOverdueDuesJob(IServiceScopeFactory s, IConfiguration c, ILogger<MarkOverdueDuesJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestablePruneLogsJob : PruneLogsJob
    {
        public TestablePruneLogsJob(IServiceScopeFactory s, IConfiguration c, ILogger<PruneLogsJob> l) : base(s, c, l) { }
        public Task RunGlobalPublic(IServiceProvider sp, CancellationToken ct = default) => RunGlobalAsync(sp, ct);
    }
    private sealed class TestableGenerateMonthlyReportsJob : GenerateMonthlyReportsJob
    {
        public TestableGenerateMonthlyReportsJob(IServiceScopeFactory s, IConfiguration c, ILogger<GenerateMonthlyReportsJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }
    private sealed class TestableReconcileFederatedHourTransfersJob : ReconcileFederatedHourTransfersJob
    {
        public TestableReconcileFederatedHourTransfersJob(IServiceScopeFactory s, IConfiguration c, ILogger<ReconcileFederatedHourTransfersJob> l) : base(s, c, l) { }
        public Task RunForTenantPublic(IServiceProvider sp, int tid, CancellationToken ct = default) => RunForTenantAsync(sp, tid, ct);
    }

    // ─── 1. SyncFederationPartnersJob ───────────────────────────────────────

    [Fact]
    public async Task SyncFederationPartners_StaleActivePartner_MarkedSuspended()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        await arrangeDb.FederationPartners.IgnoreQueryFilters()
            .Where(p => p.TenantId == TestData.Tenant1.Id && p.PartnerTenantId == TestData.Tenant2.Id)
            .ExecuteDeleteAsync();
        var partner = new FederationPartner
        {
            TenantId = TestData.Tenant1.Id,
            PartnerTenantId = TestData.Tenant2.Id,
            Status = PartnerStatus.Active,
            CreatedAt = DateTime.UtcNow.AddDays(-60),
            UpdatedAt = DateTime.UtcNow.AddDays(-45),
            RequestedById = TestData.AdminUser.Id
        };
        arrangeDb.FederationPartners.Add(partner);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableSyncFederationPartnersJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.FederationPartners.IgnoreQueryFilters().FirstAsync(p => p.Id == partner.Id);
        refreshed.Status.Should().Be(PartnerStatus.Suspended);
    }

    [Fact]
    public async Task SyncFederationPartners_RecentPartner_LeftAlone()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        await arrangeDb.FederationPartners.IgnoreQueryFilters()
            .Where(p => p.TenantId == TestData.Tenant1.Id && p.PartnerTenantId == TestData.Tenant2.Id)
            .ExecuteDeleteAsync();
        var partner = new FederationPartner
        {
            TenantId = TestData.Tenant1.Id,
            PartnerTenantId = TestData.Tenant2.Id,
            Status = PartnerStatus.Active,
            CreatedAt = DateTime.UtcNow.AddDays(-5),
            UpdatedAt = DateTime.UtcNow.AddDays(-1),
            RequestedById = TestData.AdminUser.Id
        };
        arrangeDb.FederationPartners.Add(partner);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableSyncFederationPartnersJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.FederationPartners.IgnoreQueryFilters().FirstAsync(p => p.Id == partner.Id);
        refreshed.Status.Should().Be(PartnerStatus.Active);
    }

    // ─── 2. PruneFederationLogsJob ─────────────────────────────────────────

    [Fact]
    public async Task PruneFederationLogs_DeletesLogsOlderThanRetention()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        arrangeDb.FederationApiLogs.Add(new FederationApiLog
        {
            TenantId = TestData.Tenant1.Id,
            HttpMethod = "GET",
            Path = "/api/very-old",
            StatusCode = 200,
            CreatedAt = DateTime.UtcNow.AddDays(-180)
        });
        arrangeDb.FederationApiLogs.Add(new FederationApiLog
        {
            TenantId = TestData.Tenant1.Id,
            HttpMethod = "GET",
            Path = "/api/recent-keep",
            StatusCode = 200,
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        });
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestablePruneFederationLogsJob>(act.ServiceProvider);
        await job.RunGlobalPublic(act.ServiceProvider);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var paths = await assertDb.FederationApiLogs.IgnoreQueryFilters()
            .Where(l => l.Path == "/api/very-old" || l.Path == "/api/recent-keep")
            .Select(l => l.Path).ToListAsync();
        paths.Should().NotContain("/api/very-old").And.Contain("/api/recent-keep");
    }

    // ─── 3. CheckInactiveGroupsJob ─────────────────────────────────────────

    [Fact]
    public async Task CheckInactiveGroups_NoActivity_WritesSummaryToTenantConfig()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        arrangeDb.Groups.Add(new Group
        {
            TenantId = TestData.Tenant1.Id,
            Name = "Stale group",
            Description = "Should be flagged",
            CreatedById = TestData.AdminUser.Id,
            CreatedAt = DateTime.UtcNow.AddDays(-200)
        });
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableCheckInactiveGroupsJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var summary = await assertDb.TenantConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "scheduled.summary.inactive_groups");
        summary.Should().NotBeNull();
        summary!.Value.Should().Contain("\"count\"");
    }

    // ─── 4. PollStuckIdentityVerificationsJob ──────────────────────────────

    [Fact]
    public async Task PollStuckIdentityVerifications_OldSession_MarkedExpired()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var session = new IdentityVerificationSession
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Provider = VerificationProvider.Mock,
            Level = VerificationLevel.DocumentOnly,
            Status = VerificationSessionStatus.Created,
            CreatedAt = DateTime.UtcNow.AddHours(-72),
            ExpiresAt = DateTime.UtcNow.AddDays(-1)
        };
        arrangeDb.IdentityVerificationSessions.Add(session);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestablePollStuckIdentityVerificationsJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.IdentityVerificationSessions.IgnoreQueryFilters().FirstAsync(s => s.Id == session.Id);
        refreshed.Status.Should().Be(VerificationSessionStatus.Expired);
        refreshed.CompletedAt.Should().NotBeNull();
    }

    // ─── 5. SafeguardingSlaEscalateJob ─────────────────────────────────────

    [Fact]
    public async Task SafeguardingSlaEscalate_StalePendingReports_WritesSummary()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        arrangeDb.ContentReports.Add(new ContentReport
        {
            TenantId = TestData.Tenant1.Id,
            ReporterId = TestData.MemberUser.Id,
            ContentType = "listing",
            ContentId = 1,
            Reason = ReportReason.Spam,
            Status = ReportStatus.Pending,
            CreatedAt = DateTime.UtcNow.AddHours(-48)
        });
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableSafeguardingSlaEscalateJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var summary = await assertDb.TenantConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == "scheduled.summary.safeguarding_sla");
        summary.Should().NotBeNull();
        summary!.Value.Should().Contain("\"stale_count\"");
    }

    // ─── 6. MarkOverdueDuesJob ─────────────────────────────────────────────

    [Fact]
    public async Task MarkOverdueDues_ActiveSubscriptionPastBilling_MarkedPastDue()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        var plan = new SubscriptionPlan
        {
            TenantId = TestData.Tenant1.Id,
            Name = "Test plan",
            Price = 10m,
            Currency = "EUR",
            IsActive = true
        };
        arrangeDb.SubscriptionPlans.Add(plan);
        await arrangeDb.SaveChangesAsync();
        var sub = new UserSubscription
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            PlanId = plan.Id,
            Status = SubscriptionStatus.Active,
            StartedAt = DateTime.UtcNow.AddDays(-60),
            NextBillingDate = DateTime.UtcNow.AddDays(-3)
        };
        arrangeDb.UserSubscriptions.Add(sub);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableMarkOverdueDuesJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.UserSubscriptions.IgnoreQueryFilters().FirstAsync(s => s.Id == sub.Id);
        refreshed.Status.Should().Be(SubscriptionStatus.PastDue);
    }

    // ─── 7. PruneLogsJob ───────────────────────────────────────────────────

    [Fact]
    public async Task PruneLogs_DeletesReadNotificationsOlderThanRetention()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        arrangeDb.Notifications.Add(new Notification
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Type = "p63_old_read",
            Title = "old",
            Body = "delete me",
            IsRead = true,
            CreatedAt = DateTime.UtcNow.AddDays(-200)
        });
        arrangeDb.Notifications.Add(new Notification
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Type = "p63_recent_read",
            Title = "recent",
            Body = "keep",
            IsRead = true,
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        });
        arrangeDb.Notifications.Add(new Notification
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            Type = "p63_old_unread",
            Title = "old unread",
            Body = "keep — IsRead=false",
            IsRead = false,
            CreatedAt = DateTime.UtcNow.AddDays(-200)
        });
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestablePruneLogsJob>(act.ServiceProvider);
        await job.RunGlobalPublic(act.ServiceProvider);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var types = await assertDb.Notifications.IgnoreQueryFilters()
            .Where(n => n.Type.StartsWith("p63_")).Select(n => n.Type).ToListAsync();
        types.Should().NotContain("p63_old_read");
        types.Should().Contain("p63_recent_read");
        types.Should().Contain("p63_old_unread");
    }

    // ─── 8. GenerateMonthlyReportsJob ──────────────────────────────────────

    [Fact]
    public async Task GenerateMonthlyReports_NotFirstOfMonth_NoSnapshotEmitted()
    {
        // The production job reads DateTime.UtcNow.Day directly. Without a
        // time-freezing seam, we can only assert the contract dynamically:
        // outside of the 1st, no snapshot row should appear.
        var isFirstOfMonth = DateTime.UtcNow.Day == 1;
        var thisMonth = DateTime.UtcNow.ToString("yyyy-MM");

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableGenerateMonthlyReportsJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var snapshot = await assertDb.TenantConfigs.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == $"reports.monthly.{thisMonth}");
        if (isFirstOfMonth) snapshot.Should().NotBeNull();
        else snapshot.Should().BeNull();
    }

    // ─── 9. ReconcileFederatedHourTransfersJob ─────────────────────────────

    [Fact]
    public async Task ReconcileFederatedHourTransfers_WhenSagaDisabled_LeavesTransferUntouched()
    {
        using var arrange = Factory.Services.CreateScope();
        var arrangeDb = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
        await arrangeDb.FederationPartners.IgnoreQueryFilters()
            .Where(p => p.TenantId == TestData.Tenant1.Id && p.PartnerTenantId == TestData.Tenant2.Id)
            .ExecuteDeleteAsync();
        var partner = new FederationPartner
        {
            TenantId = TestData.Tenant1.Id,
            PartnerTenantId = TestData.Tenant2.Id,
            Status = PartnerStatus.Active,
            RequestedById = TestData.AdminUser.Id,
            CreatedAt = DateTime.UtcNow
        };
        arrangeDb.FederationPartners.Add(partner);
        await arrangeDb.SaveChangesAsync();
        var transfer = new FederatedHourTransfer
        {
            TenantId = TestData.Tenant1.Id,
            PartnerId = partner.Id,
            Direction = FederatedTransferDirection.Outbound,
            LocalUserId = TestData.MemberUser.Id,
            Amount = 1.5m,
            Protocol = "credit-commons",
            Status = FederatedTransferStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };
        arrangeDb.FederatedHourTransfers.Add(transfer);
        await arrangeDb.SaveChangesAsync();

        using var act = Factory.Services.CreateScope();
        var job = ActivatorUtilities.CreateInstance<TestableReconcileFederatedHourTransfersJob>(act.ServiceProvider);
        await job.RunForTenantPublic(act.ServiceProvider, TestData.Tenant1.Id);

        using var assertScope = Factory.Services.CreateScope();
        var assertDb = assertScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var refreshed = await assertDb.FederatedHourTransfers.IgnoreQueryFilters().FirstAsync(t => t.Id == transfer.Id);
        refreshed.Status.Should().Be(FederatedTransferStatus.Pending);
        refreshed.FailureReason.Should().BeNull();
        refreshed.RetryCount.Should().Be(0);
        refreshed.LastReconcileAttemptAt.Should().BeNull();
    }
}
