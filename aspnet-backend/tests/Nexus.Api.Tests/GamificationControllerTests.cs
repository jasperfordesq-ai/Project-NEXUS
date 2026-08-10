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

/// <summary>
/// Integration tests for gamification endpoints.
/// Tests XP profiles, badges, leaderboard, and XP history via HTTP.
/// </summary>
[Collection("Integration")]
public class GamificationControllerTests : IntegrationTestBase
{
    public GamificationControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    #region Profile Tests

    [Fact]
    public async Task GetProfile_Authenticated_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/profile");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("profile").ValueKind.Should().Be(JsonValueKind.Object);
        content.GetProperty("profile").GetProperty("totalXp").GetInt32().Should().BeGreaterOrEqualTo(0);
        content.GetProperty("profile").GetProperty("level").GetInt32().Should().BeGreaterOrEqualTo(1);
        content.GetProperty("xp").GetInt32().Should().BeGreaterOrEqualTo(0);
        content.GetProperty("level").GetInt32().Should().BeGreaterOrEqualTo(1);
        content.GetProperty("badges_count").GetInt32().Should().BeGreaterOrEqualTo(0);
        content.GetProperty("level_progress").GetProperty("progress_percentage").GetDouble().Should().BeGreaterOrEqualTo(0);
    }

    [Fact]
    public async Task LaravelReactProfileV2Alias_UsesSuccessDataEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/gamification/profile");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();

        var data = json.RootElement.GetProperty("data");
        data.GetProperty("user").GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("user").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("xp").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("level").GetInt32().Should().BeGreaterOrEqualTo(1);
        data.GetProperty("level_progress").GetProperty("current_xp").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("level_progress").GetProperty("xp_for_current_level").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("level_progress").GetProperty("xp_for_next_level").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("level_progress").GetProperty("progress_percentage").GetDouble().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("badges_count").GetInt32().Should().BeGreaterOrEqualTo(0);
        data.GetProperty("showcased_badges").ValueKind.Should().Be(JsonValueKind.Array);
        data.GetProperty("is_own_profile").GetBoolean().Should().BeTrue();
        data.GetProperty("xp_values").ValueKind.Should().Be(JsonValueKind.Object);
        data.GetProperty("level_thresholds").ValueKind.Should().Be(JsonValueKind.Object);
        json.RootElement.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task GetProfile_Unauthenticated_ReturnsUnauthorized()
    {
        // Act
        var response = await Client.GetAsync("/api/gamification/profile");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetUserProfile_ExistingUser_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync($"/api/gamification/profile/{TestData.AdminUser.Id}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("totalXp").GetInt32().Should().BeGreaterOrEqualTo(0);
    }

    [Fact]
    public async Task GetUserProfile_NonExistent_ReturnsNotFound()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/profile/99999");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    #endregion

    #region Badge Tests

    [Fact]
    public async Task GetBadges_ReturnsAllBadgesWithEarnedStatus()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/badges");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").GetArrayLength().Should().BeGreaterThan(0);
        content.GetProperty("summary").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task GetMyBadges_ReturnsEarnedBadges()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/badges/my");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
    }

    [Fact]
    public async Task LaravelReactBadgesV2Alias_UsesBadgeKeyListAndStringDetailShape()
    {
        await AuthenticateAsMemberAsync();

        var list = await Client.GetAsync("/api/v2/gamification/badges");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        using var listJson = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        listJson.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var badges = listJson.RootElement.GetProperty("data").EnumerateArray().ToArray();
        badges.Should().NotBeEmpty();
        listJson.RootElement.GetProperty("meta").GetProperty("available_types").ValueKind.Should().Be(JsonValueKind.Array);

        var badge = badges[0];
        badge.GetProperty("badge_key").GetString().Should().NotBeNullOrWhiteSpace();
        badge.GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        badge.GetProperty("description").GetString().Should().NotBeNull();
        badge.GetProperty("icon").GetString().Should().NotBeNull();
        badge.GetProperty("type").GetString().Should().NotBeNullOrWhiteSpace();
        badge.GetProperty("earned").GetBoolean().Should().BeFalse();
        badge.GetProperty("is_showcased").GetBoolean().Should().BeFalse();

        var detail = await Client.GetAsync($"/api/v2/gamification/badges/{badge.GetProperty("badge_key").GetString()}");

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        using var detailJson = JsonDocument.Parse(await detail.Content.ReadAsStringAsync());
        detailJson.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var detailData = detailJson.RootElement.GetProperty("data");
        detailData.GetProperty("key").GetString().Should().Be(badge.GetProperty("badge_key").GetString());
        detailData.GetProperty("badge_key").GetString().Should().Be(badge.GetProperty("badge_key").GetString());
        detailData.GetProperty("earned").GetBoolean().Should().BeFalse();
        detailData.GetProperty("is_showcased").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task LaravelReactShowcaseV2Alias_PersistsOwnedBadgeSelectionForBadgeReload()
    {
        await AuthenticateAsMemberAsync();

        string badgeKey;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var badge = await db.Badges
                .Where(b => b.TenantId == TestData.Tenant1.Id)
                .OrderBy(b => b.Id)
                .FirstAsync();
            badgeKey = badge.Slug;

            if (!await db.UserBadges.AnyAsync(ub =>
                    ub.TenantId == TestData.Tenant1.Id &&
                    ub.UserId == TestData.MemberUser.Id &&
                    ub.BadgeId == badge.Id))
            {
                db.UserBadges.Add(new UserBadge
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = TestData.MemberUser.Id,
                    BadgeId = badge.Id,
                    EarnedAt = DateTime.UtcNow.AddDays(-1)
                });
                await db.SaveChangesAsync();
            }
        }

        var update = await Client.PutAsJsonAsync("/api/v2/gamification/showcase", new
        {
            badge_keys = new[] { badgeKey }
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var updateJson = JsonDocument.Parse(await update.Content.ReadAsStringAsync()))
        {
            updateJson.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
            var data = updateJson.RootElement.GetProperty("data");
            data.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
            data.GetProperty("showcased_badges").EnumerateArray()
                .Should().Contain(row => row.GetProperty("badge_key").GetString() == badgeKey);
        }

        var reloaded = await Client.GetAsync("/api/v2/gamification/badges");

        reloaded.StatusCode.Should().Be(HttpStatusCode.OK);
        using var reloadedJson = JsonDocument.Parse(await reloaded.Content.ReadAsStringAsync());
        var showcased = reloadedJson.RootElement.GetProperty("data").EnumerateArray()
            .Single(row => row.GetProperty("badge_key").GetString() == badgeKey);
        showcased.GetProperty("earned").GetBoolean().Should().BeTrue();
        showcased.GetProperty("is_showcased").GetBoolean().Should().BeTrue();
    }

    #endregion

    #region Leaderboard Tests

    [Fact]
    public async Task GetLeaderboard_Default_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/leaderboard");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").ValueKind.Should().Be(JsonValueKind.Object);
        content.GetProperty("meta").GetProperty("type").GetString().Should().Be("xp");

        var first = content.GetProperty("data").EnumerateArray().First();
        first.GetProperty("position").GetInt32().Should().BeGreaterThan(0);
        first.GetProperty("user").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        first.GetProperty("xp").GetInt32().Should().BeGreaterOrEqualTo(0);
    }

    [Fact]
    public async Task GetLeaderboard_WeeklyPeriod_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/leaderboard?period=week");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("period").GetString().Should().Be("week");
    }

    [Fact]
    public async Task GetLeaderboard_SupportsPagination()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/leaderboard?page=1&limit=5");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("pagination").GetProperty("limit").GetInt32().Should().Be(5);
    }

    #endregion

    #region XP History

    [Fact]
    public async Task GetXpHistory_ReturnsOk()
    {
        // Arrange
        await AuthenticateAsMemberAsync();

        // Act
        var response = await Client.GetAsync("/api/gamification/xp-history");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        content.GetProperty("pagination").ValueKind.Should().Be(JsonValueKind.Object);
    }

    #endregion
}
