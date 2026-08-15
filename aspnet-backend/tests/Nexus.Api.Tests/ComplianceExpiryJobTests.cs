// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// The two compliance expiry jobs (R-6).
///
/// 🔴 Only 17 of Laravel's 71 scheduled units had any counterpart here. These
/// two are from the group where "nothing runs" means a record quietly stays
/// true after it should have stopped being true: a prepared support action
/// lapsing in silence, and safeguarding monitoring outliving its own expiry.
///
/// The jobs are exercised through their real RunForTenantAsync rather than by
/// waiting on a timer, so the test asserts the effect, not the schedule.
/// </summary>
[Collection("Integration")]
public sealed class ComplianceExpiryJobTests : IntegrationTestBase
{
    public ComplianceExpiryJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>
    /// Take the REGISTERED instance rather than constructing one, so the test
    /// also proves the job is actually wired into the host. A job that exists
    /// but is never registered is the same as no job at all.
    /// </summary>
    private static T ResolveJob<T>(IServiceProvider services) where T : ScheduledHostedService
        => services.GetServices<IHostedService>().OfType<T>().Single();

    private static async Task RunAsync(ScheduledHostedService job, IServiceProvider services, int tenantId)
    {
        var method = typeof(ScheduledHostedService).GetMethod(
            "RunForTenantAsync",
            System.Reflection.BindingFlags.Instance
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Public)!;
        await (Task)method.Invoke(job, [services, tenantId, CancellationToken.None])!;
    }

    [Fact]
    public async Task ExpiredSupportAction_IsMarkedExpired_AndTheSupporterIsTold()
    {
        int actionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var relationship = new AccountRelationship
            {
                TenantId = TestData.Tenant1.Id,
                ParentUserId = TestData.AdminUser.Id,
                ChildUserId = TestData.MemberUser.Id,
                RelationshipType = "carer",
                Status = "active",
            };
            db.Set<AccountRelationship>().Add(relationship);
            await db.SaveChangesAsync();

            var action = new SupportPendingAction
            {
                TenantId = TestData.Tenant1.Id,
                RelationshipId = relationship.Id,
                SupporterUserId = TestData.AdminUser.Id,
                SupportedUserId = TestData.MemberUser.Id,
                ActionType = "listing_create",
                Payload = "{}",
                Status = SupportPendingAction.StatusPending,
                TokenHash = Guid.NewGuid().ToString("N"),
                ExpiresAt = DateTime.UtcNow.AddDays(-1),
                CreatedAt = DateTime.UtcNow.AddDays(-15),
            };
            db.Set<SupportPendingAction>().Add(action);
            await db.SaveChangesAsync();
            actionId = action.Id;
        }

        var job = ResolveJob<SupportActionExpiryJob>(Factory.Services);
        using (var scope = Factory.Services.CreateScope())
        {
            await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();

        var stored = await verifyDb.Set<SupportPendingAction>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.Id == actionId);
        stored.Status.Should().Be(SupportPendingAction.StatusExpired,
            "the row stayed 'pending' for ever with nothing running");

        var told = await verifyDb.Set<Notification>().IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(n => n.UserId == TestData.AdminUser.Id && n.Type == "support_action_expired");
        told.Should().BeTrue("an expiry that nobody hears about is the failure being fixed");
    }

    [Fact]
    public async Task AStillValidSupportAction_IsLeftAlone()
    {
        int actionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var relationship = new AccountRelationship
            {
                TenantId = TestData.Tenant1.Id,
                ParentUserId = TestData.AdminUser.Id,
                ChildUserId = TestData.MemberUser.Id,
                RelationshipType = "carer",
                Status = "active",
            };
            db.Set<AccountRelationship>().Add(relationship);
            await db.SaveChangesAsync();

            var action = new SupportPendingAction
            {
                TenantId = TestData.Tenant1.Id,
                RelationshipId = relationship.Id,
                SupporterUserId = TestData.AdminUser.Id,
                SupportedUserId = TestData.MemberUser.Id,
                ActionType = "listing_create",
                Payload = "{}",
                Status = SupportPendingAction.StatusPending,
                TokenHash = Guid.NewGuid().ToString("N"),
                ExpiresAt = DateTime.UtcNow.AddDays(5),
                CreatedAt = DateTime.UtcNow,
            };
            db.Set<SupportPendingAction>().Add(action);
            await db.SaveChangesAsync();
            actionId = action.Id;
        }

        var job = ResolveJob<SupportActionExpiryJob>(Factory.Services);
        using (var scope = Factory.Services.CreateScope())
        {
            await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Set<SupportPendingAction>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.Id == actionId);

        stored.Status.Should().Be(SupportPendingAction.StatusPending,
            "a job that expires things early is worse than one that never runs");
    }

    [Fact]
    public async Task ExpiredMonitoring_IsLifted_ButOtherRestrictionsSurvive()
    {
        int userId = TestData.MemberUser.Id;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Set<UserMonitoringRestriction>().Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = userId,
                UnderMonitoring = true,
                MessagingDisabled = true,
                RequiresBrokerApproval = true,
                MonitoringExpiresAt = DateTime.UtcNow.AddDays(-2),
                Reason = "expired order",
                CreatedAt = DateTime.UtcNow.AddDays(-30),
            });
            await db.SaveChangesAsync();
        }

        var job = ResolveJob<ClearExpiredMonitoringJob>(Factory.Services);
        using (var scope = Factory.Services.CreateScope())
        {
            await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Set<UserMonitoringRestriction>().IgnoreQueryFilters().AsNoTracking()
            .FirstAsync(s => s.UserId == userId);

        stored.UnderMonitoring.Should().BeFalse(
            "a restriction must not outlive the authority that justified it");
        stored.MonitoringExpiresAt.Should().BeNull();
        stored.MessagingDisabled.Should().BeTrue(
            "other restrictions have their own authority and must not be cleared as a side effect");
        stored.RequiresBrokerApproval.Should().BeTrue();
    }

    [Fact]
    public async Task MonitoringWithNoExpiryDate_IsNeverLifted()
    {
        int userId = TestData.AdminUser.Id;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Set<UserMonitoringRestriction>().Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = userId,
                UnderMonitoring = true,
                MonitoringExpiresAt = null,
                Reason = "indefinite, pending review",
                CreatedAt = DateTime.UtcNow.AddDays(-30),
            });
            await db.SaveChangesAsync();
        }

        var job = ResolveJob<ClearExpiredMonitoringJob>(Factory.Services);
        using (var scope = Factory.Services.CreateScope())
        {
            await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Set<UserMonitoringRestriction>().IgnoreQueryFilters().AsNoTracking()
            .FirstAsync(s => s.UserId == userId);

        stored.UnderMonitoring.Should().BeTrue(
            "an open-ended safeguarding decision is not the job's to lift");
    }
}
