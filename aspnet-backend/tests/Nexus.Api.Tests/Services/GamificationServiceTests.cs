// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests.Services;

/// <summary>
/// Unit tests for GamificationService.
/// Uses InMemory database for isolation.
/// </summary>
public class GamificationServiceTests : IDisposable
{
    private readonly NexusDbContext _db;
    private readonly GamificationService _service;
    private readonly Mock<ILogger<GamificationService>> _loggerMock;

    public GamificationServiceTests()
    {
        // Create InMemory database for each test
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        var tenantContext = new TenantContext();
        tenantContext.SetTenant(1); // Set tenant for tests

        _db = new NexusDbContext(options, tenantContext);
        _loggerMock = new Mock<ILogger<GamificationService>>();
        _service = new GamificationService(_db, _loggerMock.Object);
    }

    public void Dispose()
    {
        _db.Dispose();
    }

    #region AwardXpAsync Tests

    [Fact]
    public async Task AwardXpAsync_UserNotFound_ReturnsFailure()
    {
        // Act
        var result = await _service.AwardXpAsync(999, 100, "test");

        // Assert
        result.Success.Should().BeFalse();
        result.Error.Should().Be("User not found");
    }

    [Fact]
    public async Task AwardXpAsync_ValidUser_AddsXpAndCreatesLog()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 0,
            Level = 1
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardXpAsync(user.Id, 50, "test_source", 123, "Test description");

        // Assert
        result.Success.Should().BeTrue();
        result.Amount.Should().Be(50);
        result.PreviousXp.Should().Be(0);
        result.NewXp.Should().Be(50);

        // Verify XP log was created
        var xpLog = await _db.XpLogs.FirstOrDefaultAsync(x => x.UserId == user.Id);
        xpLog.Should().NotBeNull();
        xpLog!.Amount.Should().Be(50);
        xpLog.Source.Should().Be("test_source");
        xpLog.ReferenceId.Should().Be(123);
        xpLog.Description.Should().Be("Test description");
    }

    [Fact]
    public async Task AwardXpAsync_EnoughXpForLevelUp_IncrementsLevel()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 90, // Close to level 2 (100 XP)
            Level = 1
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardXpAsync(user.Id, 20, "test"); // Takes to 110 XP

        // Assert
        result.Success.Should().BeTrue();
        result.LeveledUp.Should().BeTrue();
        result.PreviousLevel.Should().Be(1);
        result.NewLevel.Should().BeGreaterThan(1);
    }

    [Fact]
    public async Task AwardXpAsync_NegativeAmount_PreventsNegativeXp()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 50,
            Level = 1
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardXpAsync(user.Id, -100, "penalty"); // Would be -50

        // Assert
        result.Success.Should().BeTrue();
        result.NewXp.Should().Be(0); // Clamped to 0
    }

    #endregion

    #region AwardBadgeAsync Tests

    [Fact]
    public async Task AwardBadgeAsync_BadgeNotFound_ReturnsFailure()
    {
        // Arrange: isolate the missing-badge branch from the tenant-safe
        // missing-user guard.
        var user = new User
        {
            TenantId = 1,
            Email = "missing-badge@test.com",
            PasswordHash = "hash",
            FirstName = "Missing",
            LastName = "Badge"
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardBadgeAsync(user.Id, "nonexistent_badge");

        // Assert
        result.Success.Should().BeFalse();
        result.Error.Should().Be("Badge not found");
    }

    [Fact]
    public async Task AwardBadgeAsync_UserAlreadyHasBadge_ReturnsAlreadyEarned()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User"
        };
        _db.Users.Add(user);

        var badge = new Badge
        {
            TenantId = 1,
            Slug = "test_badge",
            Name = "Test Badge",
            XpReward = 25,
            IsActive = true
        };
        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();

        // User already has the badge
        _db.UserBadges.Add(new UserBadge { UserId = user.Id, BadgeId = badge.Id });
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardBadgeAsync(user.Id, "test_badge");

        // Assert
        result.Success.Should().BeFalse();
        result.AlreadyEarned.Should().BeTrue();
        result.Error.Should().Be("User already has this badge");
    }

    [Fact]
    public async Task AwardBadgeAsync_ValidBadge_AwardsBadgeAndXp()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 0,
            Level = 1
        };
        _db.Users.Add(user);

        var badge = new Badge
        {
            TenantId = 1,
            Slug = "test_badge",
            Name = "Test Badge",
            XpReward = 50,
            IsActive = true
        };
        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardBadgeAsync(user.Id, "test_badge");

        // Assert
        result.Success.Should().BeTrue();
        result.Badge.Should().NotBeNull();
        result.Badge!.Slug.Should().Be("test_badge");
        result.XpAwarded.Should().NotBeNull();
        result.XpAwarded!.Amount.Should().Be(50);

        // Verify badge was awarded
        var userBadge = await _db.UserBadges.FirstOrDefaultAsync(ub => ub.UserId == user.Id);
        userBadge.Should().NotBeNull();
    }

    [Fact]
    public async Task AwardBadgeAsync_InactiveBadge_ReturnsNotFound()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "inactive-badge@test.com",
            PasswordHash = "hash",
            FirstName = "Inactive",
            LastName = "Badge"
        };
        var badge = new Badge
        {
            TenantId = 1,
            Slug = "inactive_badge",
            Name = "Inactive Badge",
            XpReward = 25,
            IsActive = false // Inactive
        };
        _db.Users.Add(user);
        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();

        // Act
        var result = await _service.AwardBadgeAsync(user.Id, "inactive_badge");

        // Assert
        result.Success.Should().BeFalse();
        result.Error.Should().Be("Badge not found");
    }

    #endregion

    #region CheckAndAwardBadgesAsync Tests

    [Fact]
    public async Task CheckAndAwardBadgesAsync_FirstListing_AwardsBadge()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 0,
            Level = 1
        };
        _db.Users.Add(user);

        var badge = new Badge
        {
            TenantId = 1,
            Slug = Badge.Slugs.FirstListing,
            Name = "First Listing",
            XpReward = 25,
            IsActive = true
        };
        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();

        // Create exactly one listing for the user
        var listing = new Listing
        {
            TenantId = 1,
            UserId = user.Id,
            Title = "Test Listing",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        };
        _db.Listings.Add(listing);
        await _db.SaveChangesAsync();

        // Act
        await _service.CheckAndAwardBadgesAsync(user.Id, "listing_created");

        // Assert
        var userBadge = await _db.UserBadges.FirstOrDefaultAsync(ub => ub.UserId == user.Id);
        userBadge.Should().NotBeNull();
        userBadge!.BadgeId.Should().Be(badge.Id);
    }

    [Fact]
    public async Task CheckAndAwardBadgesAsync_SecondListing_DoesNotDuplicateBadge()
    {
        // Arrange
        var user = new User
        {
            TenantId = 1,
            Email = "test@test.com",
            PasswordHash = "hash",
            FirstName = "Test",
            LastName = "User",
            TotalXp = 0,
            Level = 1
        };
        _db.Users.Add(user);

        var badge = new Badge
        {
            TenantId = 1,
            Slug = Badge.Slugs.FirstListing,
            Name = "First Listing",
            XpReward = 25,
            IsActive = true
        };
        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();

        // Create two listings for the user
        _db.Listings.AddRange(
            new Listing { TenantId = 1, UserId = user.Id, Title = "Listing 1", Type = ListingType.Offer, Status = ListingStatus.Active },
            new Listing { TenantId = 1, UserId = user.Id, Title = "Listing 2", Type = ListingType.Offer, Status = ListingStatus.Active }
        );
        await _db.SaveChangesAsync();

        // Award first listing badge (first call)
        await _service.CheckAndAwardBadgesAsync(user.Id, "listing_created");

        // Act - call again (second listing created)
        await _service.CheckAndAwardBadgesAsync(user.Id, "listing_created");

        // Assert - badge should be awarded exactly once (no duplicate),
        // because having 2 listings means first_listing threshold (>=1) is met
        var userBadgeCount = await _db.UserBadges.CountAsync(ub => ub.UserId == user.Id);
        userBadgeCount.Should().Be(1, "first_listing badge should be awarded once, never duplicated");
    }

    #endregion
}
