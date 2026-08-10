// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
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
public sealed class V15FeedActivityCompatibilityTests : IntegrationTestBase
{
    public V15FeedActivityCompatibilityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task FeedV2_MergesVolunteerHoursChronologicallyWithoutChangingPostShapeOrLeakingDescription()
    {
        await AuthenticateAsMemberAsync();
        var now = DateTime.UtcNow;
        const int activitySourceId = 910001;
        const string privateDescription = "private organisation-facing volunteer evidence";
        int pinnedPostId;
        int regularPostId;

        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var pinnedPost = new FeedPost
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                Content = "Pinned post remains ahead of activity",
                IsPinned = true,
                CreatedAt = now.AddHours(-2)
            };
            var regularPost = new FeedPost
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                Content = "Older unpinned post follows activity",
                CreatedAt = now.AddHours(-1)
            };
            db.FeedPosts.AddRange(pinnedPost, regularPost);
            db.FeedActivities.Add(new FeedActivity
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                SourceType = FeedActivitySourceTypes.VolunteerHours,
                SourceId = activitySourceId,
                Title = "Volunteered 2.75 hours",
                Content = null,
                Metadata = JsonSerializer.Serialize(new
                {
                    hours = 2.75m,
                    organization = "Community Kitchen",
                    description = privateDescription
                }),
                IsVisible = true,
                IsHidden = false,
                CreatedAt = now.AddMinutes(-5)
            });
            await db.SaveChangesAsync();
            pinnedPostId = pinnedPost.Id;
            regularPostId = regularPost.Id;
        }

        using var response = await Client.GetAsync("/api/v2/feed?page=1&limit=100");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var responseText = await response.Content.ReadAsStringAsync();
        responseText.Should().NotContain(privateDescription);
        using var document = JsonDocument.Parse(responseText);
        var items = document.RootElement.GetProperty("data")
            .EnumerateArray()
            .Select(item => item.Clone())
            .ToList();

        var pinnedIndex = items.FindIndex(item =>
            item.GetProperty("type").GetString() == FeedActivitySourceTypes.Post
            && item.GetProperty("id").GetInt32() == pinnedPostId);
        var activityIndex = items.FindIndex(item =>
            item.GetProperty("type").GetString() == FeedActivitySourceTypes.VolunteerHours
            && item.GetProperty("id").GetInt32() == activitySourceId);
        var regularIndex = items.FindIndex(item =>
            item.GetProperty("type").GetString() == FeedActivitySourceTypes.Post
            && item.GetProperty("id").GetInt32() == regularPostId);
        pinnedIndex.Should().BeGreaterThanOrEqualTo(0);
        activityIndex.Should().BeGreaterThan(pinnedIndex);
        regularIndex.Should().BeGreaterThan(activityIndex);

        var activity = items[activityIndex];
        activity.GetProperty("title").GetString().Should().Be("Volunteered 2.75 hours");
        activity.GetProperty("content").ValueKind.Should().Be(JsonValueKind.Null);
        activity.GetProperty("hours").GetDecimal().Should().Be(2.75m);
        activity.GetProperty("organization").GetString().Should().Be("Community Kitchen");
        activity.GetProperty("author").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        activity.TryGetProperty("created_at", out _).Should().BeTrue();
        activity.TryGetProperty("description", out _).Should().BeFalse();
        activity.TryGetProperty("metadata", out _).Should().BeFalse();

        items[pinnedIndex].EnumerateObject().Select(property => property.Name).Should().BeEquivalentTo(
            new[]
            {
                "id",
                "type",
                "content",
                "image_url",
                "group_id",
                "user_id",
                "author",
                "likes_count",
                "comments_count",
                "is_liked",
                "created_at",
                "updated_at"
            });
        document.RootElement.GetProperty("meta").GetProperty("total").GetInt32()
            .Should().BeGreaterThanOrEqualTo(3);
    }

    [Fact]
    public async Task FeedV2_ExcludesHiddenInvisibleMutedAndOtherTenantActivities()
    {
        await AuthenticateAsMemberAsync();
        var now = DateTime.UtcNow;
        const int visibleSourceId = 920001;
        const int hiddenSourceId = 920002;
        const int invisibleSourceId = 920003;
        const int mutedSourceId = 920004;
        const int otherTenantSourceId = 920005;

        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.FeedActivities.AddRange(
                Activity(TestData.Tenant1.Id, TestData.MemberUser.Id, visibleSourceId, now),
                Activity(TestData.Tenant1.Id, TestData.MemberUser.Id, hiddenSourceId, now.AddMinutes(1), isHidden: true),
                Activity(TestData.Tenant1.Id, TestData.MemberUser.Id, invisibleSourceId, now.AddMinutes(2), isVisible: false),
                Activity(TestData.Tenant1.Id, TestData.AdminUser.Id, mutedSourceId, now.AddMinutes(3)),
                Activity(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, otherTenantSourceId, now.AddMinutes(4)));
            if (!await db.MutedUsers.IgnoreQueryFilters().AnyAsync(muted =>
                muted.TenantId == TestData.Tenant1.Id
                && muted.UserId == TestData.MemberUser.Id
                && muted.MutedUserId == TestData.AdminUser.Id))
            {
                db.MutedUsers.Add(new MutedUser
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = TestData.MemberUser.Id,
                    MutedUserId = TestData.AdminUser.Id,
                    MutedAt = now
                });
            }
            await db.SaveChangesAsync();
        }

        using var response = await Client.GetAsync("/api/v2/feed?page=1&limit=100");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var activityIds = document.RootElement.GetProperty("data")
            .EnumerateArray()
            .Where(item => item.GetProperty("type").GetString() == FeedActivitySourceTypes.VolunteerHours)
            .Select(item => item.GetProperty("id").GetInt32())
            .ToList();

        activityIds.Should().Contain(visibleSourceId);
        activityIds.Should().NotContain(hiddenSourceId);
        activityIds.Should().NotContain(invisibleSourceId);
        activityIds.Should().NotContain(mutedSourceId);
        activityIds.Should().NotContain(otherTenantSourceId);
    }

    private static FeedActivity Activity(
        int tenantId,
        int userId,
        int sourceId,
        DateTime createdAt,
        bool isVisible = true,
        bool isHidden = false) => new()
    {
        TenantId = tenantId,
        UserId = userId,
        SourceType = FeedActivitySourceTypes.VolunteerHours,
        SourceId = sourceId,
        Title = "Volunteered 1 hour",
        Metadata = "{\"hours\":1}",
        IsVisible = isVisible,
        IsHidden = isHidden,
        CreatedAt = createdAt
    };
}
