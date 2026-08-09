// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net.Http;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Nexus.Api.Clients;
using Nexus.Api.Configuration;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests.Services;

/// <summary>
/// Unit tests for ContentModerationService.
/// Uses mocked AiService to test moderation logic.
/// </summary>
public class ContentModerationServiceTests : IDisposable
{
    private readonly NexusDbContext _db;
    private readonly Mock<AiService> _aiServiceMock;
    private readonly Mock<ILogger<ContentModerationService>> _loggerMock;
    private readonly ContentModerationService _service;

    public ContentModerationServiceTests()
    {
        // Create InMemory database for each test
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        var tenantContext = new TenantContext();
        tenantContext.SetTenant(1);

        _db = new NexusDbContext(options, tenantContext);
        _loggerMock = new Mock<ILogger<ContentModerationService>>();

        // Create mock AiService with proper mock dependencies
        // AiService constructor: (ILlamaClient, NexusDbContext, IOptions<LlamaServiceOptions>, ILogger<AiService>)
        var llamaClientMock = new Mock<ILlamaClient>();
        var llamaOptionsMock = Options.Create(new LlamaServiceOptions { BaseUrl = "http://test" });
        var aiLoggerMock = new Mock<ILogger<AiService>>();
        _aiServiceMock = new Mock<AiService>(
            MockBehavior.Loose,
            llamaClientMock.Object,
            _db,
            llamaOptionsMock,
            aiLoggerMock.Object);

        _service = new ContentModerationService(_aiServiceMock.Object, _db, _loggerMock.Object);
    }

    public void Dispose()
    {
        _db.Dispose();
    }

    #region ProcessModerationResult Tests (via ModerateListingAsync)

    [Fact]
    public async Task ModerateListingAsync_CriticalSeverity_ReturnsBlocked()
    {
        // Arrange
        var listing = new Listing
        {
            Id = 1,
            TenantId = 1,
            UserId = 1,
            Title = "Test Listing",
            Description = "Test description",
            Type = ListingType.Offer,
            Status = ListingStatus.Pending
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent(It.IsAny<string>(), "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult
            {
                IsApproved = false,
                Severity = "critical",
                FlaggedIssues = new List<string> { "Prohibited content detected" },
                Suggestions = new List<string>()
            });

        // Act
        var result = await _service.ModerateListingAsync(listing);

        // Assert
        result.IsApproved.Should().BeFalse();
        result.RequiresReview.Should().BeFalse();
        result.Action.Should().Be(ModerationAction.Block);
        result.Severity.Should().Be("critical");
    }

    [Fact]
    public async Task ModerateListingAsync_HighSeverity_ReturnsFlagged()
    {
        // Arrange
        var listing = new Listing
        {
            Id = 1,
            TenantId = 1,
            UserId = 1,
            Title = "Questionable Listing",
            Description = "Test",
            Type = ListingType.Offer,
            Status = ListingStatus.Pending
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent(It.IsAny<string>(), "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult
            {
                IsApproved = false,
                Severity = "high",
                FlaggedIssues = new List<string> { "Potentially misleading" },
                Suggestions = new List<string> { "Consider clarifying" }
            });

        // Act
        var result = await _service.ModerateListingAsync(listing);

        // Assert
        result.IsApproved.Should().BeFalse();
        result.RequiresReview.Should().BeTrue();
        result.Action.Should().Be(ModerationAction.Flag);
        result.Severity.Should().Be("high");
    }

    [Fact]
    public async Task ModerateListingAsync_MediumSeverity_ReturnsWarn()
    {
        // Arrange
        var listing = new Listing
        {
            Id = 1,
            TenantId = 1,
            UserId = 1,
            Title = "Listing with minor issues",
            Type = ListingType.Offer,
            Status = ListingStatus.Pending
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent(It.IsAny<string>(), "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult
            {
                IsApproved = true,
                Severity = "medium",
                FlaggedIssues = new List<string> { "Minor spelling issues" },
                Suggestions = new List<string> { "Check spelling" }
            });

        // Act
        var result = await _service.ModerateListingAsync(listing);

        // Assert
        result.IsApproved.Should().BeTrue();
        result.RequiresReview.Should().BeTrue();
        result.Action.Should().Be(ModerationAction.Warn);
        result.Severity.Should().Be("medium");
    }

    [Fact]
    public async Task ModerateListingAsync_LowSeverity_ReturnsApproved()
    {
        // Arrange
        var listing = new Listing
        {
            Id = 1,
            TenantId = 1,
            UserId = 1,
            Title = "Clean Listing",
            Description = "A perfectly fine listing",
            Type = ListingType.Offer,
            Status = ListingStatus.Pending
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent(It.IsAny<string>(), "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult
            {
                IsApproved = true,
                Severity = "low",
                FlaggedIssues = new List<string>(),
                Suggestions = new List<string>()
            });

        // Act
        var result = await _service.ModerateListingAsync(listing);

        // Assert
        result.IsApproved.Should().BeTrue();
        result.RequiresReview.Should().BeFalse();
        result.Action.Should().Be(ModerationAction.Allow);
    }

    [Fact]
    public async Task ModerateListingAsync_AiServiceException_AllowsWithReview()
    {
        // Arrange
        var listing = new Listing
        {
            Id = 1,
            TenantId = 1,
            UserId = 1,
            Title = "Test Listing",
            Type = ListingType.Offer,
            Status = ListingStatus.Pending
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent(It.IsAny<string>(), "listing", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("AI service unavailable"));

        // Act
        var result = await _service.ModerateListingAsync(listing);

        // Assert
        result.IsApproved.Should().BeTrue();
        result.RequiresReview.Should().BeTrue();
        result.Severity.Should().Be("unknown");
        result.Message.Should().Contain("Moderation service unavailable");
    }

    #endregion

    #region NotifyAdminsAboutFlaggedContent Tests

    [Fact]
    public async Task NotifyAdminsAboutFlaggedContent_CreatesNotificationsForAllAdmins()
    {
        // Arrange
        var admin1 = new User
        {
            TenantId = 1,
            Email = "admin1@test.com",
            PasswordHash = "hash",
            FirstName = "Admin",
            LastName = "One",
            Role = "admin",
            IsActive = true
        };
        var admin2 = new User
        {
            TenantId = 1,
            Email = "admin2@test.com",
            PasswordHash = "hash",
            FirstName = "Admin",
            LastName = "Two",
            Role = "admin",
            IsActive = true
        };
        var member = new User
        {
            TenantId = 1,
            Email = "member@test.com",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        };

        _db.Users.AddRange(admin1, admin2, member);
        await _db.SaveChangesAsync();

        // Act
        await _service.NotifyAdminsAboutFlaggedContent(
            "listing",
            123,
            "high",
            new List<string> { "Spam detected", "Inappropriate language" });

        // Assert
        var notifications = await _db.Notifications.ToListAsync();
        notifications.Should().HaveCount(2); // Only admins
        notifications.Should().OnlyContain(n => n.Type == "content_flagged");
        notifications.Should().Contain(n => n.UserId == admin1.Id);
        notifications.Should().Contain(n => n.UserId == admin2.Id);
        notifications.Should().NotContain(n => n.UserId == member.Id);
    }

    [Fact]
    public async Task NotifyAdminsAboutFlaggedContent_ExcludesInactiveAdmins()
    {
        // Arrange
        var activeAdmin = new User
        {
            TenantId = 1,
            Email = "active@test.com",
            PasswordHash = "hash",
            FirstName = "Active",
            LastName = "Admin",
            Role = "admin",
            IsActive = true
        };
        var inactiveAdmin = new User
        {
            TenantId = 1,
            Email = "inactive@test.com",
            PasswordHash = "hash",
            FirstName = "Inactive",
            LastName = "Admin",
            Role = "admin",
            IsActive = false
        };

        _db.Users.AddRange(activeAdmin, inactiveAdmin);
        await _db.SaveChangesAsync();

        // Act
        await _service.NotifyAdminsAboutFlaggedContent(
            "post",
            456,
            "critical",
            new List<string> { "Violation" });

        // Assert
        var notifications = await _db.Notifications.ToListAsync();
        notifications.Should().HaveCount(1);
        notifications.First().UserId.Should().Be(activeAdmin.Id);
    }

    #endregion

    #region BatchModerateAsync Tests

    [Fact]
    public async Task BatchModerateAsync_ProcessesAllItems()
    {
        // Arrange
        var items = new List<(string Content, string ContentType, int EntityId)>
        {
            ("Good content", "listing", 1),
            ("Bad content", "listing", 2),
            ("Okay content", "post", 3)
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent("Good content", "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult { IsApproved = true, Severity = "low" });

        _aiServiceMock
            .Setup(x => x.ModerateContent("Bad content", "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult { IsApproved = false, Severity = "critical" });

        _aiServiceMock
            .Setup(x => x.ModerateContent("Okay content", "post", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult { IsApproved = true, Severity = "medium" });

        // Act
        var results = await _service.BatchModerateAsync(items);

        // Assert
        results.Should().HaveCount(3);
        results[0].IsApproved.Should().BeTrue();
        results[1].IsApproved.Should().BeFalse();
        results[1].Action.Should().Be(ModerationAction.Block);
        results[2].IsApproved.Should().BeTrue();
        results[2].RequiresReview.Should().BeTrue();
    }

    [Fact]
    public async Task BatchModerateAsync_HandlesPartialFailures()
    {
        // Arrange
        var items = new List<(string Content, string ContentType, int EntityId)>
        {
            ("Good content", "listing", 1),
            ("Failing content", "listing", 2)
        };

        _aiServiceMock
            .Setup(x => x.ModerateContent("Good content", "listing", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ModerationResult { IsApproved = true, Severity = "low" });

        _aiServiceMock
            .Setup(x => x.ModerateContent("Failing content", "listing", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("Service error"));

        // Act
        var results = await _service.BatchModerateAsync(items);

        // Assert
        results.Should().HaveCount(2);
        results[0].IsApproved.Should().BeTrue();
        results[1].IsApproved.Should().BeTrue(); // Fails gracefully
        results[1].RequiresReview.Should().BeTrue();
        results[1].Severity.Should().Be("unknown");
    }

    #endregion
}
