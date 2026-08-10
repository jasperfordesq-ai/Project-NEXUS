// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class CaringRegionalPointApprovedHoursAwardTests
{
    [Fact]
    public async Task AwardForApprovedHours_CreditsRoundedPointsAndPersistsLaravelLedgerEvidence()
    {
        await using var db = CreateDbContext(tenantId: 42);
        SeedConfiguration(db, featureEnabled: true, pointsEnabled: true, autoIssueEnabled: true, pointsPerHour: "6.67");
        SeedUser(db, tenantId: 42, userId: 10);
        SeedUser(db, tenantId: 42, userId: 99);
        db.CaringRegionalPointAccounts.Add(new CaringRegionalPointAccount
        {
            Id = 1001,
            TenantId = 42,
            UserId = 10,
            Balance = 3m,
            LifetimeEarned = 4m,
            LifetimeSpent = 1m
        });
        await db.SaveChangesAsync();

        var result = await new CaringRegionalPointService(db).AwardForApprovedHoursAsync(
            tenantId: 42,
            userId: 10,
            volLogId: 701,
            hours: 1.5m,
            actorId: 99,
            ct: CancellationToken.None);

        result.Should().NotBeNull();
        result!.UserId.Should().Be(10);
        result.Points.Should().Be(10.01m, "PHP round uses half-up semantics");
        result.Balance.Should().Be(13.01m);
        result.AlreadyAwarded.Should().BeFalse();

        var account = await db.CaringRegionalPointAccounts
            .IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == 42 && row.UserId == 10);
        account.Balance.Should().Be(13.01m);
        account.LifetimeEarned.Should().Be(14.01m);
        account.LifetimeSpent.Should().Be(1m);

        var transaction = await db.CaringRegionalPointTransactions
            .IgnoreQueryFilters()
            .SingleAsync();
        transaction.Id.Should().Be(result.TransactionId);
        transaction.AccountId.Should().Be(account.Id);
        transaction.UserId.Should().Be(10);
        transaction.ActorUserId.Should().Be(99);
        transaction.Type.Should().Be("earned_for_hours");
        transaction.Direction.Should().Be("credit");
        transaction.Points.Should().Be(10.01m);
        transaction.BalanceAfter.Should().Be(13.01m);
        transaction.ReferenceType.Should().Be("vol_log");
        transaction.ReferenceId.Should().Be(701L);
        transaction.Description.Should().Be("Regional points earned for 1.5 approved support hours.");

        using var metadata = JsonDocument.Parse(transaction.Metadata!);
        metadata.RootElement.GetProperty("hours").GetDecimal().Should().Be(1.5m);
    }

    [Fact]
    public async Task AwardForApprovedHours_RepeatedVolunteerLogReturnsOriginalAwardWithoutDoubleCredit()
    {
        await using var db = CreateDbContext(tenantId: 42);
        SeedConfiguration(db, featureEnabled: true, pointsEnabled: true, autoIssueEnabled: true, pointsPerHour: "10");
        SeedUser(db, tenantId: 42, userId: 10);
        await db.SaveChangesAsync();
        var service = new CaringRegionalPointService(db);

        var first = await service.AwardForApprovedHoursAsync(42, 10, 702, 3m, null, CancellationToken.None);
        var duplicate = await service.AwardForApprovedHoursAsync(42, 10, 702, 9m, 999, CancellationToken.None);

        first.Should().NotBeNull();
        duplicate.Should().NotBeNull();
        first!.AlreadyAwarded.Should().BeFalse();
        duplicate!.AlreadyAwarded.Should().BeTrue();
        duplicate.TransactionId.Should().Be(first.TransactionId);
        duplicate.UserId.Should().Be(10);
        duplicate.Points.Should().Be(30m);
        duplicate.Balance.Should().Be(30m);

        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().CountAsync()).Should().Be(1);
        var account = await db.CaringRegionalPointAccounts.IgnoreQueryFilters().SingleAsync();
        account.Balance.Should().Be(30m);
        account.LifetimeEarned.Should().Be(30m);
    }

    [Theory]
    [InlineData(false, true, true, 10d, 1d, 703)]
    [InlineData(true, false, true, 10d, 1d, 703)]
    [InlineData(true, true, false, 10d, 1d, 703)]
    [InlineData(true, true, true, 0d, 1d, 703)]
    [InlineData(true, true, true, 10d, 0d, 703)]
    [InlineData(true, true, true, 10d, 1d, 0)]
    public async Task AwardForApprovedHours_WhenAnyLaravelGateFails_ReturnsNullWithoutLedgerMutation(
        bool pointsEnabled,
        bool autoIssueEnabled,
        bool featureEnabled,
        double pointsPerHour,
        double hours,
        int volLogId)
    {
        await using var db = CreateDbContext(tenantId: 42);
        SeedConfiguration(
            db,
            featureEnabled,
            pointsEnabled,
            autoIssueEnabled,
            pointsPerHour.ToString(System.Globalization.CultureInfo.InvariantCulture));
        SeedUser(db, tenantId: 42, userId: 10);
        await db.SaveChangesAsync();

        var result = await new CaringRegionalPointService(db).AwardForApprovedHoursAsync(
            42,
            10,
            volLogId,
            Convert.ToDecimal(hours),
            null,
            CancellationToken.None);

        result.Should().BeNull();
        (await db.CaringRegionalPointAccounts.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task AwardForApprovedHours_RejectsUserOutsideRequestedTenant()
    {
        await using var db = CreateDbContext(tenantId: 42);
        SeedConfiguration(db, featureEnabled: true, pointsEnabled: true, autoIssueEnabled: true, pointsPerHour: "10");
        SeedUser(db, tenantId: 7, userId: 10);
        await db.SaveChangesAsync();

        Func<Task> action = async () => await new CaringRegionalPointService(db).AwardForApprovedHoursAsync(
                42,
                10,
                704,
                1m,
                null,
                CancellationToken.None);

        await action.Should().ThrowAsync<RegionalPointValidationException>()
            .WithMessage("User not found.");
        (await db.CaringRegionalPointAccounts.IgnoreQueryFilters().CountAsync()).Should().Be(0);
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    private static NexusDbContext CreateDbContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        return new NexusDbContext(options, tenant);
    }

    private static void SeedConfiguration(
        NexusDbContext db,
        bool featureEnabled,
        bool pointsEnabled,
        bool autoIssueEnabled,
        string pointsPerHour)
    {
        db.TenantConfigs.AddRange(
            Setting("features.caring_community", featureEnabled ? "true" : "false"),
            Setting(CaringRegionalPointService.KeyPrefix + "enabled", pointsEnabled ? "true" : "false"),
            Setting(CaringRegionalPointService.KeyPrefix + "auto_issue_enabled", autoIssueEnabled ? "true" : "false"),
            Setting(CaringRegionalPointService.KeyPrefix + "points_per_approved_hour", pointsPerHour));
    }

    private static TenantConfig Setting(string key, string value)
    {
        return new TenantConfig
        {
            TenantId = 42,
            Key = key,
            Value = value
        };
    }

    private static void SeedUser(NexusDbContext db, int tenantId, int userId)
    {
        db.Users.Add(new User
        {
            Id = userId,
            TenantId = tenantId,
            Email = $"user-{tenantId}-{userId}@example.test",
            PasswordHash = "test",
            FirstName = "Regional",
            LastName = "Member",
            Role = Role.Names.Member,
            IsActive = true
        });
    }
}
