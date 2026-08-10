// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerHourBadgeAwardTests : IntegrationTestBase
{
    public VolunteerHourBadgeAwardTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ApprovedTenantUserSum_TruncatesAndAwardsReachedBadgesAndXpExactlyOnce()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<GamificationService>();

        db.Badges.Add(new Badge
        {
            TenantId = TestData.Tenant1.Id,
            Slug = Badge.Slugs.Volunteer1Hour,
            Name = "Stale volunteer badge",
            Description = "Stale",
            Icon = null,
            XpReward = 999,
            IsActive = false,
            SortOrder = 999,
            CreatedAt = DateTime.UtcNow.AddYears(-1)
        });
        db.VolunteerLogs.AddRange(
            Log(TestData.Tenant1.Id, TestData.MemberUser.Id, 24m, "approved", -5),
            Log(TestData.Tenant1.Id, TestData.MemberUser.Id, 24m, "approved", -4),
            Log(TestData.Tenant1.Id, TestData.MemberUser.Id, 1.99m, "approved", -3),
            Log(TestData.Tenant1.Id, TestData.MemberUser.Id, 24m, "pending", -2),
            Log(TestData.Tenant1.Id, TestData.AdminUser.Id, 24m, "approved", -1));
        db.PushSubscriptions.Add(new PushSubscription
        {
            TenantId = TestData.Tenant1.Id,
            UserId = TestData.MemberUser.Id,
            DeviceToken = $"badge-device-{Guid.NewGuid():N}",
            Platform = "web",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var initialXp = TestData.MemberUser.TotalXp;
        var first = await service.CheckAndAwardVolunteerHourBadgesAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id);

        first.Success.Should().BeTrue();
        first.ApprovedHours.Should().Be(49.99m);
        first.WholeHours.Should().Be(49);
        first.NewlyEarnedBadges.Should().Equal(
            Badge.Slugs.Volunteer1Hour,
            Badge.Slugs.Volunteer10Hours);
        first.XpAwarded.Should().Be(2 * XpLog.Amounts.BadgeEarned);

        Badge.VolunteerHours.Definitions.Select(definition => definition.Threshold)
            .Should().Equal(1, 10, 50, 100, 250, 500);
        var definitionSlugs = Badge.VolunteerHours.Definitions
            .Select(definition => definition.Slug)
            .ToArray();
        var definitions = await db.Badges
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(badge => badge.TenantId == TestData.Tenant1.Id
                && definitionSlugs.Contains(badge.Slug))
            .OrderBy(badge => badge.SortOrder)
            .ToListAsync();
        definitions.Select(badge => badge.Slug)
            .Should().Equal(Badge.VolunteerHours.Definitions.Select(definition => definition.Slug));
        definitions.Should().OnlyContain(badge =>
            badge.IsActive && badge.XpReward == XpLog.Amounts.BadgeEarned);
        foreach (var definition in Badge.VolunteerHours.Definitions)
        {
            var stored = definitions.Single(badge => badge.Slug == definition.Slug);
            stored.Name.Should().Be(definition.Name);
            stored.Description.Should().Be(definition.Description);
            stored.Icon.Should().Be(definition.Icon);
            stored.SortOrder.Should().Be(definition.SortOrder);
        }

        var earnedSlugs = await EarnedVolunteerBadgeSlugsAsync(db);
        earnedSlugs.Should().Equal(
            Badge.Slugs.Volunteer1Hour,
            Badge.Slugs.Volunteer10Hours);

        var badgeXp = await BadgeXpAsync(db);
        badgeXp.Should().HaveCount(2);
        badgeXp.Should().OnlyContain(log => log.Amount == XpLog.Amounts.BadgeEarned);
        badgeXp.Select(log => log.ReferenceId).Should().OnlyHaveUniqueItems();
        (await db.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.MemberUser.Id
            && notification.Type == "achievement"
            && notification.Data != null
            && notification.Data.Contains("\"badge_key\":\"vol_")))
            .Should().Be(2);
        (await db.PushNotificationLogs.IgnoreQueryFilters().CountAsync(push =>
            push.TenantId == TestData.Tenant1.Id
            && push.UserId == TestData.MemberUser.Id
            && push.Title == "Badge earned"))
            .Should().Be(2);
        (await db.EmailLogs.IgnoreQueryFilters().CountAsync(email =>
            email.TenantId == TestData.Tenant1.Id
            && email.UserId == TestData.MemberUser.Id
            && email.TemplateKey == "badge_earned"))
            .Should().Be(2);
        var badgeFeed = await db.FeedActivities.IgnoreQueryFilters().SingleAsync(activity =>
            activity.TenantId == TestData.Tenant1.Id
            && activity.UserId == TestData.MemberUser.Id
            && activity.SourceType == FeedActivitySourceTypes.BadgeEarned
            && activity.SourceId == TestData.MemberUser.Id);
        badgeFeed.Content.Should().Contain("Helping Hand");

        var user = await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == TestData.MemberUser.Id);
        user.TotalXp.Should().Be(initialXp + (2 * XpLog.Amounts.BadgeEarned));

        var second = await service.CheckAndAwardVolunteerHourBadgesAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id);

        second.Success.Should().BeTrue();
        second.NewlyEarnedBadges.Should().BeEmpty();
        second.XpAwarded.Should().Be(0);
        (await EarnedVolunteerBadgeSlugsAsync(db)).Should().HaveCount(2);
        (await BadgeXpAsync(db)).Should().HaveCount(2);
        (await db.Notifications.IgnoreQueryFilters().CountAsync(notification =>
            notification.TenantId == TestData.Tenant1.Id
            && notification.UserId == TestData.MemberUser.Id
            && notification.Type == "achievement"
            && notification.Data != null
            && notification.Data.Contains("\"badge_key\":\"vol_")))
            .Should().Be(2);
        (await db.FeedActivities.IgnoreQueryFilters().CountAsync(activity =>
            activity.TenantId == TestData.Tenant1.Id
            && activity.UserId == TestData.MemberUser.Id
            && activity.SourceType == FeedActivitySourceTypes.BadgeEarned))
            .Should().Be(1);
        (await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == TestData.MemberUser.Id))
            .TotalXp.Should().Be(initialXp + (2 * XpLog.Amounts.BadgeEarned));
    }

    [Fact]
    public async Task AmbientRollback_RevertsDefinitionBadgeXpAndUserTotalTogether()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var service = scope.ServiceProvider.GetRequiredService<GamificationService>();

        db.VolunteerLogs.Add(Log(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            1m,
            "approved",
            -1));
        await db.SaveChangesAsync();
        var initialXp = TestData.MemberUser.TotalXp;

        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            var result = await service.CheckAndAwardVolunteerHourBadgesAsync(
                TestData.Tenant1.Id,
                TestData.MemberUser.Id);

            result.NewlyEarnedBadges.Should().Equal(Badge.Slugs.Volunteer1Hour);
            (await EarnedVolunteerBadgeSlugsAsync(db)).Should().ContainSingle();
            (await BadgeXpAsync(db)).Should().ContainSingle();

            await transaction.RollbackAsync();
        }

        db.ChangeTracker.Clear();
        (await EarnedVolunteerBadgeSlugsAsync(db)).Should().BeEmpty();
        (await BadgeXpAsync(db)).Should().BeEmpty();
        (await db.Badges
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(badge => badge.TenantId == TestData.Tenant1.Id
                && badge.Slug.StartsWith("vol_")))
            .Should().Be(0);
        (await db.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == TestData.MemberUser.Id))
            .TotalXp.Should().Be(initialXp);
    }

    private VolunteerLog Log(
        int tenantId,
        int userId,
        decimal hours,
        string status,
        int dayOffset) => new()
    {
        TenantId = tenantId,
        UserId = userId,
        DateLogged = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(dayOffset)),
        Hours = hours,
        Description = $"Badge test {dayOffset}",
        Status = status,
        CreatedAt = DateTime.UtcNow.AddDays(dayOffset),
        UpdatedAt = DateTime.UtcNow.AddDays(dayOffset)
    };

    private async Task<List<string>> EarnedVolunteerBadgeSlugsAsync(NexusDbContext db)
    {
        var volunteerSlugs = Badge.VolunteerHours.Definitions
            .Select(definition => definition.Slug)
            .ToArray();
        return await (
                from userBadge in db.UserBadges.IgnoreQueryFilters().AsNoTracking()
                join badge in db.Badges.IgnoreQueryFilters().AsNoTracking()
                    on userBadge.BadgeId equals badge.Id
                where userBadge.TenantId == TestData.Tenant1.Id
                    && userBadge.UserId == TestData.MemberUser.Id
                    && volunteerSlugs.Contains(badge.Slug)
                orderby badge.SortOrder
                select badge.Slug)
            .ToListAsync();
    }

    private Task<List<XpLog>> BadgeXpAsync(NexusDbContext db) =>
        db.XpLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(log => log.TenantId == TestData.Tenant1.Id
                && log.UserId == TestData.MemberUser.Id
                && log.Source == XpLog.Sources.BadgeEarned)
            .OrderBy(log => log.Id)
            .ToListAsync();
}
