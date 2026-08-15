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
/// Group data export pruning (R-6).
///
/// 🔴 Nothing ran, so every export ever produced stayed on disk for ever. A
/// group export holds member names, email addresses, discussions and files —
/// which is exactly why it is given an expiry date. Recording the expiry and
/// never acting on it is a data-protection exposure that grows with use.
/// </summary>
[Collection("Integration")]
public sealed class PruneGroupExportsJobTests : IntegrationTestBase
{
    public PruneGroupExportsJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static PruneGroupExportsJob Job(IServiceProvider services)
        => services.GetServices<IHostedService>().OfType<PruneGroupExportsJob>().Single();

    private static async Task RunAsync(PruneGroupExportsJob job, IServiceProvider services, int tenantId)
    {
        var method = typeof(ScheduledHostedService).GetMethod(
            "RunForTenantAsync",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;
        await (Task)method.Invoke(job, [services, tenantId, CancellationToken.None])!;
    }

    private async Task RunJobAsync()
    {
        var job = Job(Factory.Services);
        using var scope = Factory.Services.CreateScope();
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
    }

    private async Task<(Guid Id, int GroupId)> SeedExportAsync(
        DateTime expiresAt, string status = "completed", DateTime? updatedAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var group = new Group
        {
            TenantId = TestData.Tenant1.Id,
            Name = $"Export group {Guid.NewGuid():N}"[..24],
            CreatedById = TestData.AdminUser.Id,
        };
        db.Set<Group>().Add(group);
        await db.SaveChangesAsync();

        var export = new GroupDataExport
        {
            Id = Guid.NewGuid(),
            TenantId = TestData.Tenant1.Id,
            GroupId = group.Id,
            RequestedByUserId = TestData.AdminUser.Id,
            Status = status,
            StoragePath = $"groups/{TestData.Tenant1.Id}/{group.Id}/exports/export.json",
            ByteSize = 1024,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow.AddDays(-40),
            UpdatedAt = updatedAt ?? DateTime.UtcNow.AddDays(-40),
        };
        db.Set<GroupDataExport>().Add(export);
        await db.SaveChangesAsync();
        return (export.Id, group.Id);
    }

    private async Task<GroupDataExport?> LoadAsync(Guid id)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<GroupDataExport>().IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(e => e.Id == id);
    }

    [Fact]
    public async Task AnExpiredExport_IsMarkedExpired_AndItsPointerCleared()
    {
        var (id, _) = await SeedExportAsync(DateTime.UtcNow.AddDays(-1));

        await RunJobAsync();

        var stored = await LoadAsync(id);
        stored.Should().NotBeNull();
        stored!.Status.Should().Be("expired");
        stored.StoragePath.Should().BeNull("the pointer to a file of member data must not linger");
        stored.ByteSize.Should().BeNull();
    }

    [Fact]
    public async Task AnExportStillInDate_IsUntouched()
    {
        var (id, _) = await SeedExportAsync(DateTime.UtcNow.AddDays(3));

        await RunJobAsync();

        var stored = await LoadAsync(id);
        stored!.Status.Should().Be("completed",
            "deleting an export a member is still entitled to download is its own failure");
        stored.StoragePath.Should().NotBeNull();
    }

    [Fact]
    public async Task ALongExpiredRecord_IsPrunedEntirely()
    {
        var (id, _) = await SeedExportAsync(
            DateTime.UtcNow.AddDays(-90),
            status: "expired",
            updatedAt: DateTime.UtcNow.AddDays(-45));

        await RunJobAsync();

        (await LoadAsync(id)).Should().BeNull(
            "expired records older than the retention window are dropped, as Laravel does");
    }

    [Fact]
    public async Task ARecentlyExpiredRecord_IsKeptForTheRetentionWindow()
    {
        var (id, _) = await SeedExportAsync(
            DateTime.UtcNow.AddDays(-2),
            status: "expired",
            updatedAt: DateTime.UtcNow.AddDays(-2));

        await RunJobAsync();

        (await LoadAsync(id)).Should().NotBeNull(
            "the bookkeeping row survives 30 days so an admin can still see the export happened");
    }
}
