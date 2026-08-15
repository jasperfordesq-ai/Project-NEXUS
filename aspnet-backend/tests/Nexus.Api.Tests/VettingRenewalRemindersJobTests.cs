// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Safeguarding vetting renewal chasing (R-6).
///
/// 🔴 Nothing ran, so expired vetting was never chased. Vetting evidences that
/// someone is cleared to work with children and at-risk adults, so an expiry
/// nobody notices means a person keeps that access on a lapsed document.
/// </summary>
[Collection("Integration")]
public sealed class VettingRenewalRemindersJobTests : IntegrationTestBase
{
    public VettingRenewalRemindersJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static VettingRenewalRemindersJob Job(IServiceProvider services)
        => services.GetServices<IHostedService>().OfType<VettingRenewalRemindersJob>().Single();

    private static async Task RunAsync(VettingRenewalRemindersJob job, IServiceProvider services, int tenantId)
    {
        var method = typeof(ScheduledHostedService).GetMethod(
            "RunForTenantAsync",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        await (Task)method.Invoke(job, [services, tenantId, CancellationToken.None])!;
    }

    private async Task<int> SeedVettingAsync(DateTime? expiresAt, string status = "verified")
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var record = new VettingRecord
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            VettingType = "enhanced_dbs",
            Status = status,
            ExpiresAt = expiresAt,
            IssuedAt = DateTime.UtcNow.AddYears(-3),
            CreatedAt = DateTime.UtcNow.AddYears(-3),
        };
        db.VettingRecords.Add(record);
        await db.SaveChangesAsync();
        return record.Id;
    }

    private async Task<int> ReminderCountAsync(int recordId, string stage)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<Notification>().IgnoreQueryFilters().AsNoTracking()
            .CountAsync(n => n.Type == "safeguarding_vetting_renewal"
                && n.Data == $"vetting:{recordId}:{stage}");
    }

    private async Task RunJobAsync()
    {
        var job = Job(Factory.Services);
        using var scope = Factory.Services.CreateScope();
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
    }

    [Fact]
    public async Task ExpiredVetting_IsChased()
    {
        var recordId = await SeedVettingAsync(DateTime.UtcNow.AddDays(-5));

        await RunJobAsync();

        (await ReminderCountAsync(recordId, "expired")).Should().BeGreaterThan(0,
            "expired vetting was never chased at all before this job existed");
    }

    [Fact]
    public async Task VettingExpiringSoon_IsChasedAtTheRightStage()
    {
        var recordId = await SeedVettingAsync(DateTime.UtcNow.AddDays(5));

        await RunJobAsync();

        (await ReminderCountAsync(recordId, "7")).Should().BeGreaterThan(0,
            "five days out falls inside the 7-day reminder stage");
        (await ReminderCountAsync(recordId, "90")).Should().Be(0,
            "it must not fire every earlier stage as well");
    }

    [Fact]
    public async Task RunningTwice_DoesNotSendTheSameReminderAgain()
    {
        var recordId = await SeedVettingAsync(DateTime.UtcNow.AddDays(-1));

        await RunJobAsync();
        var afterFirst = await ReminderCountAsync(recordId, "expired");
        await RunJobAsync();
        var afterSecond = await ReminderCountAsync(recordId, "expired");

        afterFirst.Should().BeGreaterThan(0);
        afterSecond.Should().Be(afterFirst,
            "a daily job that re-notifies every day trains people to ignore it");
    }

    [Fact]
    public async Task VettingWithNoExpiryDate_IsLeftAlone()
    {
        var recordId = await SeedVettingAsync(null);

        await RunJobAsync();

        (await ReminderCountAsync(recordId, "expired")).Should().Be(0);
        (await ReminderCountAsync(recordId, "90")).Should().Be(0);
    }

    [Fact]
    public async Task VettingFarFromExpiry_IsNotChasedYet()
    {
        var recordId = await SeedVettingAsync(DateTime.UtcNow.AddDays(200));

        await RunJobAsync();

        (await ReminderCountAsync(recordId, "90")).Should().Be(0,
            "200 days out is outside every reminder window");
    }
}
