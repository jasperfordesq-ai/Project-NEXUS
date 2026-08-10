// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class V15SocialCompatibilityControllerUnitTests
{
    [Fact]
    public async Task ToggleLikeV2_AcceptsLaravelReactTargetPayloadForPostAndListing()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.FeedPosts.Add(new FeedPost
        {
            Id = 10,
            TenantId = 1,
            UserId = 1,
            Content = "React likeable post"
        });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 1,
            Title = "React likeable listing",
            Description = "Listing liked through the Laravel React feed API",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        await db.SaveChangesAsync();

        var postLike = await controller.ToggleLike(JsonDocument.Parse("""
        {
          "target_type": "post",
          "target_id": 10
        }
        """).RootElement);

        var postOk = postLike.Should().BeOfType<OkObjectResult>().Subject;
        using var postDocument = JsonDocument.Parse(JsonSerializer.Serialize(postOk.Value));
        postDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var postData = postDocument.RootElement.GetProperty("data");
        postData.GetProperty("action").GetString().Should().Be("liked");
        postData.GetProperty("status").GetString().Should().Be("liked");
        postData.GetProperty("likes_count").GetInt32().Should().Be(1);
        db.PostLikes.Count(l => l.TenantId == 1 && l.PostId == 10 && l.UserId == 2).Should().Be(1);
        db.ContentLikes.Count(l =>
            l.TenantId == 1 &&
            l.TargetType == "post" &&
            l.TargetId == 10 &&
            l.UserId == 2).Should().Be(1);

        var postUnlike = await controller.ToggleLike(JsonDocument.Parse("""
        {
          "target_type": "post",
          "target_id": 10
        }
        """).RootElement);

        var postUnlikeOk = postUnlike.Should().BeOfType<OkObjectResult>().Subject;
        using var postUnlikeDocument = JsonDocument.Parse(JsonSerializer.Serialize(postUnlikeOk.Value));
        var postUnlikeData = postUnlikeDocument.RootElement.GetProperty("data");
        postUnlikeData.GetProperty("action").GetString().Should().Be("unliked");
        postUnlikeData.GetProperty("likes_count").GetInt32().Should().Be(0);
        db.ContentLikes.Count(l =>
            l.TenantId == 1 &&
            l.TargetType == "post" &&
            l.TargetId == 10 &&
            l.UserId == 2).Should().Be(0);

        var listingLike = await controller.ToggleLike(JsonDocument.Parse("""
        {
          "target_type": "listing",
          "target_id": 20
        }
        """).RootElement);

        var listingOk = listingLike.Should().BeOfType<OkObjectResult>().Subject;
        using var listingDocument = JsonDocument.Parse(JsonSerializer.Serialize(listingOk.Value));
        var listingData = listingDocument.RootElement.GetProperty("data");
        listingData.GetProperty("action").GetString().Should().Be("liked");
        listingData.GetProperty("likes_count").GetInt32().Should().Be(1);
        db.ContentLikes.Count(r =>
            r.TenantId == 1 &&
            r.TargetType == "listing" &&
            r.TargetId == 20 &&
            r.UserId == 2).Should().Be(1);
    }

    [Fact]
    public async Task PusherAuth_WhenConfigured_ReturnsRawLaravelPusherAuth()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(
            db,
            tenant,
            userId: 2,
            configurationValues: PusherConfiguration());

        var result = controller.PusherAuth(JsonDocument.Parse("""
        {
          "socket_id": "123.456",
          "channel_name": "private-tenant.1.user.2"
        }
        """).RootElement);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("auth").GetString()
            .Should().Be("test-key:bbfa56e4552f2467081105c47f58fceecba2730766661e72f0f8b5b3c5627d1b");
        document.RootElement.TryGetProperty("success", out _).Should().BeFalse("Pusher expects raw auth JSON");
    }

    [Fact]
    public async Task PusherAuth_RejectsCrossTenantPrivateAndPresenceChannels()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(
            db,
            tenant,
            userId: 2,
            configurationValues: PusherConfiguration());

        AssertForbidden(controller.PusherAuth(JsonDocument.Parse("""
        {
          "socket_id": "123.456",
          "channel_name": "private-tenant.2.feed"
        }
        """).RootElement));

        AssertForbidden(controller.PusherAuth(JsonDocument.Parse("""
        {
          "socket_id": "123.456",
          "channel_name": "presence-tenant.2"
        }
        """).RootElement));
    }

    [Fact]
    public async Task HideFeedItemV2_AcceptsLaravelReactPolymorphicHideAndNotInterestedPayloads()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 2,
            Title = "React hideable listing",
            Description = "Listing hidden through the Laravel React feed API",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        await db.SaveChangesAsync();

        var hide = await controller.HidePost(20, JsonDocument.Parse("""
        {
          "type": "listing"
        }
        """).RootElement);

        var hideOk = hide.Should().BeOfType<OkObjectResult>().Subject;
        using var hideDocument = JsonDocument.Parse(JsonSerializer.Serialize(hideOk.Value));
        var hideData = hideDocument.RootElement.GetProperty("data");
        hideData.GetProperty("hidden").GetBoolean().Should().BeTrue();
        hideData.GetProperty("post_id").GetInt32().Should().Be(20);

        var notInterested = await controller.NotInterested(20, JsonDocument.Parse("""
        {
          "type": "listing"
        }
        """).RootElement);

        var notInterestedOk = notInterested.Should().BeOfType<OkObjectResult>().Subject;
        using var notInterestedDocument = JsonDocument.Parse(JsonSerializer.Serialize(notInterestedOk.Value));
        var notInterestedData = notInterestedDocument.RootElement.GetProperty("data");
        notInterestedData.GetProperty("success").GetBoolean().Should().BeTrue();
        notInterestedData.GetProperty("post_id").GetInt32().Should().Be(20);
        db.HiddenPosts.Count(h => h.TenantId == 1 && h.PostId == 20 && h.UserId == 2).Should().Be(0);
        db.TenantConfigs.Count(c => c.TenantId == 1 && c.Key == "feed.hidden.2.listing.20").Should().Be(1);
    }

    [Fact]
    public async Task ReportFeedItemV2_PersistsLaravelReactPolymorphicReport()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 1,
            Title = "React reportable listing",
            Description = "Listing reported through the Laravel React feed API",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        await db.SaveChangesAsync();

        var result = await controller.ReportFeedItem("listing", 20, JsonDocument.Parse("""
        {
          "reason": "spam"
        }
        """).RootElement);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("reported").GetBoolean().Should().BeTrue();
        data.GetProperty("target_type").GetString().Should().Be("listing");
        data.GetProperty("target_id").GetInt32().Should().Be(20);
        db.ContentReports.Count(r =>
            r.TenantId == 1 &&
            r.ReporterId == 2 &&
            r.ContentType == "listing" &&
            r.ContentId == 20 &&
            r.Reason == ReportReason.Spam).Should().Be(1);
    }

    [Fact]
    public async Task DeletePostV2_ReturnsLaravelReactDeletedEnvelopeAndForbiddenErrors()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.FeedPosts.AddRange(
            new FeedPost
            {
                Id = 10,
                TenantId = 1,
                UserId = 2,
                Content = "Owned post to delete"
            },
            new FeedPost
            {
                Id = 11,
                TenantId = 1,
                UserId = 1,
                Content = "Other user post"
            });
        await db.SaveChangesAsync();

        var deleted = await controller.DeletePost(10);

        var deletedOk = deleted.Should().BeOfType<OkObjectResult>().Subject;
        using var deletedDocument = JsonDocument.Parse(JsonSerializer.Serialize(deletedOk.Value));
        deletedDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var deletedData = deletedDocument.RootElement.GetProperty("data");
        deletedData.GetProperty("deleted").GetBoolean().Should().BeTrue();
        deletedData.GetProperty("id").GetInt32().Should().Be(10);
        db.FeedPosts.Any(p => p.TenantId == 1 && p.Id == 10).Should().BeFalse();

        var forbidden = await controller.DeletePost(11);

        var forbiddenResult = forbidden.Should().BeOfType<ObjectResult>().Subject;
        forbiddenResult.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var forbiddenDocument = JsonDocument.Parse(JsonSerializer.Serialize(forbiddenResult.Value));
        forbiddenDocument.RootElement.GetProperty("success").GetBoolean().Should().BeFalse();
        forbiddenDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("FORBIDDEN");
        db.FeedPosts.Any(p => p.TenantId == 1 && p.Id == 11).Should().BeTrue();
    }

    [Fact]
    public async Task MuteUserV2_ReturnsLaravelReactEnvelopeAndRejectsSelfMute()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.AddRange(
            new User
            {
                Id = 2,
                TenantId = 1,
                Email = "member@example.test",
                PasswordHash = "hash",
                FirstName = "Member",
                LastName = "User",
                Role = "member",
                IsActive = true
            },
            new User
            {
                Id = 3,
                TenantId = 1,
                Email = "other@example.test",
                PasswordHash = "hash",
                FirstName = "Other",
                LastName = "User",
                Role = "member",
                IsActive = true
            });
        await db.SaveChangesAsync();

        var muted = await controller.MuteUserV2(3);

        var ok = muted.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("muted").GetBoolean().Should().BeTrue();
        data.GetProperty("user_id").GetInt32().Should().Be(3);
        db.MutedUsers.Count(m => m.TenantId == 1 && m.UserId == 2 && m.MutedUserId == 3).Should().Be(1);

        var selfMute = await controller.MuteUserV2(2);

        var invalid = selfMute.Should().BeOfType<ObjectResult>().Subject;
        invalid.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value));
        invalidDocument.RootElement.GetProperty("success").GetBoolean().Should().BeFalse();
        invalidDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("INVALID_INPUT");
        db.MutedUsers.Count(m => m.TenantId == 1 && m.UserId == 2 && m.MutedUserId == 2).Should().Be(0);
    }

    [Fact]
    public async Task TrendingHashtagsV2_HonorsLaravelReactLimitAndTenantScope()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);
        controller.ControllerContext.HttpContext.Request.QueryString = new QueryString("?limit=2");
        var now = DateTime.UtcNow;

        db.Hashtags.AddRange(
            new Hashtag
            {
                Id = 1,
                TenantId = 1,
                Tag = "alpha",
                UsageCount = 5,
                LastUsedAt = now.AddHours(-2)
            },
            new Hashtag
            {
                Id = 2,
                TenantId = 1,
                Tag = "beta",
                UsageCount = 10,
                LastUsedAt = now.AddHours(-3)
            },
            new Hashtag
            {
                Id = 3,
                TenantId = 1,
                Tag = "gamma",
                UsageCount = 3,
                LastUsedAt = now.AddHours(-1)
            },
            new Hashtag
            {
                Id = 4,
                TenantId = 2,
                Tag = "other-tenant",
                UsageCount = 999,
                LastUsedAt = now
            });
        await db.SaveChangesAsync();

        var result = await controller.TrendingHashtags();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("tag").GetString().Should().Be("beta");
        rows[0].GetProperty("post_count").GetInt32().Should().Be(10);
        rows[1].GetProperty("tag").GetString().Should().Be("alpha");
        rows.Select(row => row.GetProperty("tag").GetString()).Should().NotContain("other-tenant");
    }

    [Fact]
    public async Task SearchHashtagsV2_HonorsLaravelReactQueryLimitAndTenantScope()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Hashtags.AddRange(
            new Hashtag
            {
                Id = 1,
                TenantId = 1,
                Tag = "alpha",
                UsageCount = 5,
                LastUsedAt = DateTime.UtcNow
            },
            new Hashtag
            {
                Id = 2,
                TenantId = 1,
                Tag = "alpine",
                UsageCount = 10,
                LastUsedAt = DateTime.UtcNow
            },
            new Hashtag
            {
                Id = 3,
                TenantId = 1,
                Tag = "beta",
                UsageCount = 50,
                LastUsedAt = DateTime.UtcNow
            },
            new Hashtag
            {
                Id = 4,
                TenantId = 2,
                Tag = "atlas",
                UsageCount = 999,
                LastUsedAt = DateTime.UtcNow
            });
        await db.SaveChangesAsync();

        var empty = await controller.SearchHashtags();

        var emptyOk = empty.Should().BeOfType<OkObjectResult>().Subject;
        using var emptyDocument = JsonDocument.Parse(JsonSerializer.Serialize(emptyOk.Value));
        emptyDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        emptyDocument.RootElement.GetProperty("data").EnumerateArray().Should().BeEmpty();

        controller.ControllerContext.HttpContext.Request.QueryString = new QueryString("?limit=1");
        var result = await controller.SearchHashtags("a%_");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().ContainSingle();
        rows[0].GetProperty("tag").GetString().Should().Be("alpine");
        rows[0].GetProperty("post_count").GetInt32().Should().Be(10);
    }

    [Fact]
    public async Task HashtagPostsV2_ReturnsLaravelReactCollectionEnvelopeWithCursorAndVisibleTenantPosts()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);
        controller.ControllerContext.HttpContext.Request.QueryString = new QueryString("?per_page=1");

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.Hashtags.AddRange(
            new Hashtag { Id = 1, TenantId = 1, Tag = "alpha", UsageCount = 4, LastUsedAt = DateTime.UtcNow },
            new Hashtag { Id = 2, TenantId = 2, Tag = "alpha", UsageCount = 1, LastUsedAt = DateTime.UtcNow });
        db.FeedPosts.AddRange(
            new FeedPost
            {
                Id = 10,
                TenantId = 1,
                UserId = 2,
                Content = "Older visible alpha post",
                CreatedAt = DateTime.UtcNow.AddHours(-2)
            },
            new FeedPost
            {
                Id = 20,
                TenantId = 1,
                UserId = 2,
                Content = "Hidden alpha post",
                IsHidden = true,
                CreatedAt = DateTime.UtcNow.AddHours(-1)
            },
            new FeedPost
            {
                Id = 30,
                TenantId = 1,
                UserId = 2,
                Content = "Newest visible alpha post",
                CreatedAt = DateTime.UtcNow
            },
            new FeedPost
            {
                Id = 40,
                TenantId = 2,
                UserId = 2,
                Content = "Other tenant alpha post",
                CreatedAt = DateTime.UtcNow.AddMinutes(1)
            });
        db.HashtagUsages.AddRange(
            new HashtagUsage { TenantId = 1, HashtagId = 1, TargetType = "post", TargetId = 10, CreatedById = 2 },
            new HashtagUsage { TenantId = 1, HashtagId = 1, TargetType = "post", TargetId = 20, CreatedById = 2 },
            new HashtagUsage { TenantId = 1, HashtagId = 1, TargetType = "post", TargetId = 30, CreatedById = 2 },
            new HashtagUsage { TenantId = 2, HashtagId = 2, TargetType = "post", TargetId = 40, CreatedById = 2 },
            new HashtagUsage { TenantId = 1, HashtagId = 1, TargetType = "listing", TargetId = 50, CreatedById = 2 });
        await db.SaveChangesAsync();

        var result = await controller.HashtagPosts("#alpha");

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().ContainSingle();
        rows[0].GetProperty("id").GetInt32().Should().Be(30);
        rows[0].GetProperty("type").GetString().Should().Be("post");
        rows[0].GetProperty("content").GetString().Should().Be("Newest visible alpha post");

        var meta = document.RootElement.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("limit").GetInt32().Should().Be(1);
        meta.GetProperty("total_items").GetInt32().Should().Be(2);
        meta.GetProperty("has_more").GetBoolean().Should().BeTrue();
        meta.GetProperty("cursor").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Likers_ReturnsLaravelReactLikersResultShape()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 1,
            TenantId = 1,
            Email = "admin@example.test",
            PasswordHash = "hash",
            FirstName = "Admin",
            LastName = "User",
            Role = "admin",
            IsActive = true
        });
        db.FeedPosts.Add(new FeedPost
        {
            Id = 10,
            TenantId = 1,
            UserId = 2,
            Content = "Liked post"
        });
        db.ContentLikes.Add(new ContentLike
        {
            TenantId = 1,
            TargetType = "post",
            TargetId = 10,
            UserId = 1,
            CreatedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();

        var result = await controller.Likers(JsonDocument.Parse("""
        {
          "target_type": "post",
          "target_id": 10,
          "page": 1,
          "limit": 20
        }
        """).RootElement);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("total_count").GetInt32().Should().Be(1);
        data.GetProperty("page").GetInt32().Should().Be(1);
        data.GetProperty("has_more").GetBoolean().Should().BeFalse();
        var liker = data.GetProperty("likers").EnumerateArray().Should().ContainSingle().Subject;
        liker.GetProperty("id").GetInt32().Should().Be(1);
        liker.GetProperty("name").GetString().Should().Be("Admin User");
        liker.GetProperty("avatar_url").GetString().Should().Be("/assets/img/defaults/default_avatar.png");
        liker.GetProperty("liked_at").GetString().Should().Contain("2026-01-02");
        liker.GetProperty("liked_at_formatted").GetString().Should().Be("Jan 2, 2026");
    }

    [Fact]
    public async Task Likers_ReturnsLaravelReactPolymorphicLikersForListing()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.AddRange(
            new User
            {
                Id = 1,
                TenantId = 1,
                Email = "first@example.test",
                PasswordHash = "hash",
                FirstName = "First",
                LastName = "Liker",
                Role = "member",
                IsActive = true
            },
            new User
            {
                Id = 3,
                TenantId = 1,
                Email = "second@example.test",
                PasswordHash = "hash",
                FirstName = "Second",
                LastName = "Liker",
                AvatarUrl = "/avatars/second.png",
                Role = "member",
                IsActive = true
            });
        db.ContentLikes.AddRange(
            new ContentLike
            {
                TenantId = 1,
                TargetType = "listing",
                TargetId = 20,
                UserId = 1,
                CreatedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc)
            },
            new ContentLike
            {
                TenantId = 1,
                TargetType = "listing",
                TargetId = 20,
                UserId = 3,
                CreatedAt = new DateTime(2026, 1, 3, 3, 4, 5, DateTimeKind.Utc)
            },
            new ContentLike
            {
                TenantId = 1,
                TargetType = "event",
                TargetId = 20,
                UserId = 1,
                CreatedAt = new DateTime(2026, 1, 4, 3, 4, 5, DateTimeKind.Utc)
            });
        await db.SaveChangesAsync();

        var result = await controller.Likers(JsonDocument.Parse("""
        {
          "target_type": "listing",
          "target_id": 20,
          "page": 1,
          "limit": 5
        }
        """).RootElement);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("total_count").GetInt32().Should().Be(2);
        data.GetProperty("page").GetInt32().Should().Be(1);
        data.GetProperty("has_more").GetBoolean().Should().BeFalse();
        var likers = data.GetProperty("likers").EnumerateArray().ToArray();
        likers.Should().HaveCount(2);
        likers[0].GetProperty("id").GetInt32().Should().Be(3);
        likers[0].GetProperty("name").GetString().Should().Be("Second Liker");
        likers[0].GetProperty("avatar_url").GetString().Should().Be("/avatars/second.png");
        likers[0].GetProperty("liked_at_formatted").GetString().Should().Be("Jan 3, 2026");
        likers[1].GetProperty("id").GetInt32().Should().Be(1);
        likers[1].GetProperty("avatar_url").GetString().Should().Be("/assets/img/defaults/default_avatar.png");
    }

    [Fact]
    public async Task SocialComments_AcceptsLaravelActionFetchAndSubmitPayloads()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            AvatarUrl = "/avatars/member.png",
            Role = "member",
            IsActive = true
        });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 2,
            Title = "Commentable listing",
            Description = "Listing with Laravel social comments",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        db.ThreadedComments.Add(new ThreadedComment
        {
            Id = 100,
            TenantId = 1,
            TargetType = "listing",
            TargetId = 20,
            AuthorId = 2,
            Content = "Existing comment",
            CreatedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();

        var fetch = await controller.Comments(JsonDocument.Parse("""
        {
          "action": "fetch",
          "target_type": "listing",
          "target_id": 20
        }
        """).RootElement);

        var fetchOk = fetch.Should().BeOfType<OkObjectResult>().Subject;
        using var fetchDocument = JsonDocument.Parse(JsonSerializer.Serialize(fetchOk.Value));
        var fetchData = fetchDocument.RootElement.GetProperty("data");
        fetchData.GetProperty("available_reactions").EnumerateArray().Select(item => item.GetString()).Should().Contain("love");
        var existing = fetchData.GetProperty("comments").EnumerateArray().Should().ContainSingle().Subject;
        existing.GetProperty("id").GetInt32().Should().Be(100);
        existing.GetProperty("content").GetString().Should().Be("Existing comment");
        existing.GetProperty("author_name").GetString().Should().Be("Member User");
        existing.GetProperty("author_avatar").GetString().Should().Be("/avatars/member.png");

        var submit = await controller.Comments(JsonDocument.Parse("""
        {
          "action": "submit",
          "target_type": "listing",
          "target_id": 20,
          "parent_id": 100,
          "content": "Reply from legacy social comments"
        }
        """).RootElement);

        var submitOk = submit.Should().BeOfType<OkObjectResult>().Subject;
        using var submitDocument = JsonDocument.Parse(JsonSerializer.Serialize(submitOk.Value));
        var submitData = submitDocument.RootElement.GetProperty("data");
        submitData.GetProperty("status").GetString().Should().Be("success");
        submitData.GetProperty("comment").GetProperty("content").GetString().Should().Be("Reply from legacy social comments");
        db.ThreadedComments.Count(c => c.TenantId == 1 && c.TargetType == "listing" && c.TargetId == 20 && c.ParentId == 100)
            .Should().Be(1);
    }

    [Fact]
    public async Task MentionSearchLegacy_ReturnsLaravelUsersEnvelope()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.AddRange(
            new User
            {
                Id = 1,
                TenantId = 1,
                Email = "alina@example.test",
                Username = "alina",
                PasswordHash = "hash",
                FirstName = "Alina",
                LastName = "Able",
                AvatarUrl = "/avatars/alina.png",
                Role = "member",
                IsActive = true
            },
            new User
            {
                Id = 3,
                TenantId = 2,
                Email = "alina-other@example.test",
                PasswordHash = "hash",
                FirstName = "Alina",
                LastName = "Other",
                Role = "member",
                IsActive = true
            },
            new User
            {
                Id = 4,
                TenantId = 1,
                Email = "inactive@example.test",
                PasswordHash = "hash",
                FirstName = "Alina",
                LastName = "Inactive",
                Role = "member",
                IsActive = false
            });
        await db.SaveChangesAsync();

        var result = await controller.MentionSearch(JsonDocument.Parse("""
        {
          "query": "Ali"
        }
        """).RootElement);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var users = document.RootElement.GetProperty("data").GetProperty("users").EnumerateArray().ToArray();
        users.Should().ContainSingle();
        users[0].GetProperty("id").GetInt32().Should().Be(1);
        users[0].GetProperty("name").GetString().Should().Be("Alina Able");
        users[0].GetProperty("first_name").GetString().Should().Be("Alina");
        users[0].GetProperty("username").GetString().Should().Be("alina");
        users[0].GetProperty("avatar_url").GetString().Should().Be("/avatars/alina.png");
    }

    [Fact]
    public async Task SocialComments_SanitizesHtmlBeforeMentionResolutionAndPersistence()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.AddRange(
            new User { Id = 1, TenantId = 1, Email = "owner@example.test", Username = "owner", PasswordHash = "hash", FirstName = "Owner", LastName = "User", Role = "member", IsActive = true },
            new User { Id = 2, TenantId = 1, Email = "author@example.test", Username = "author", PasswordHash = "hash", FirstName = "Comment", LastName = "Author", Role = "member", IsActive = true },
            new User { Id = 3, TenantId = 1, Email = "script@example.test", Username = "scriptmention", PasswordHash = "hash", FirstName = "Script", LastName = "Mention", Role = "member", IsActive = true });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 1,
            Title = "Sanitized listing",
            Description = "Sanitizer contract target",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        await db.SaveChangesAsync();

        var result = await controller.Comments(JsonDocument.Parse("""
        {
          "action": "submit",
          "target_type": "listing",
          "target_id": 20,
          "content": "<script>@scriptmention alert('xss')</script><style>body{display:none}</style><p class='intro' style='color:red' onclick='bad()'>Safe <strong>formatting</strong> <a href='javascript:alert(1)' target='_blank'>link</a></p>"
        }
        """).RootElement);

        result.Should().BeOfType<OkObjectResult>();
        var saved = db.ThreadedComments.Should().ContainSingle().Subject;
        saved.Content.Should().Contain("<p class=\"intro\">");
        saved.Content.Should().Contain("<strong>formatting</strong>");
        saved.Content.Should().Contain("rel=\"noopener noreferrer\"");
        saved.Content.Contains("script", StringComparison.OrdinalIgnoreCase).Should().BeFalse();
        saved.Content.Contains("display:none", StringComparison.OrdinalIgnoreCase).Should().BeFalse();
        saved.Content.Contains("style=", StringComparison.OrdinalIgnoreCase).Should().BeFalse();
        saved.Content.Contains("onclick", StringComparison.OrdinalIgnoreCase).Should().BeFalse();
        saved.Content.Contains("javascript:", StringComparison.OrdinalIgnoreCase).Should().BeFalse();
        db.ContentMentions.Should().BeEmpty("mentions inside removed script blocks are not recipients");
    }

    [Fact]
    public async Task SocialComments_PersistsMentionsAndRecipientNotificationsBehindSafeguardingBoundary()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var policy = new RecordingSocialCommentContactPolicy();
        var controller = CreateController(db, tenant, userId: 2, contactPolicy: policy);

        db.Users.AddRange(
            new User { Id = 1, TenantId = 1, Email = "owner@example.test", Username = "owner", PasswordHash = "hash", FirstName = "Owner", LastName = "User", Role = "member", IsActive = true },
            new User { Id = 2, TenantId = 1, Email = "author@example.test", Username = "author", PasswordHash = "hash", FirstName = "Comment", LastName = "Author", Role = "member", IsActive = true },
            new User { Id = 3, TenantId = 1, Email = "alice@example.test", Username = "alice", PasswordHash = "hash", FirstName = "Alice", LastName = "Mentioned", PreferredLanguage = "fr", Role = "member", IsActive = true },
            new User { Id = 4, TenantId = 1, Email = "parent@example.test", Username = "parent", PasswordHash = "hash", FirstName = "Parent", LastName = "Author", Role = "member", IsActive = true },
            new User { Id = 5, TenantId = 2, Email = "alice-other@example.test", Username = "alice", PasswordHash = "hash", FirstName = "Other", LastName = "Tenant", Role = "member", IsActive = true });
        db.Listings.Add(new Listing
        {
            Id = 20,
            TenantId = 1,
            UserId = 1,
            Title = "Mentionable listing",
            Description = "Listing with durable social mentions",
            Type = ListingType.Offer,
            Status = ListingStatus.Active
        });
        db.ThreadedComments.Add(new ThreadedComment
        {
            Id = 100,
            TenantId = 1,
            TargetType = "listing",
            TargetId = 20,
            AuthorId = 4,
            Content = "Parent comment"
        });
        await db.SaveChangesAsync();

        var result = await controller.Comments(JsonDocument.Parse("""
        {
          "action": "submit",
          "target_type": "listing",
          "target_id": 20,
          "parent_id": 100,
          "content": "Thanks @alice for helping"
        }
        """).RootElement);

        result.Should().BeOfType<OkObjectResult>();
        policy.RecipientIds.Should().Equal(1, 3, 4);
        var mention = db.ContentMentions.Should().ContainSingle().Subject;
        mention.MentionedUserId.Should().Be(3);
        mention.MentioningUserId.Should().Be(2);
        mention.EntityType.Should().Be("comment");
        mention.CommentId.Should().Be(mention.EntityId);
        db.Notifications.Should().ContainSingle(row => row.UserId == 3 && row.Type == "mention" && row.Link == "/feed");
        db.Notifications.Should().ContainSingle(row => row.UserId == 4 && row.Type == "comment_reply");
        db.Notifications.Should().ContainSingle(row => row.UserId == 1 && row.Type == "comment");
        db.Notifications.Single(row => row.UserId == 3 && row.Type == "mention").Body
            .Should().Be("Comment Author vous a mentionné dans un commentaire.");
        db.ContentMentions.Should().NotContain(row => row.MentionedUserId == 5);
    }

    [Fact]
    public async Task SocialComments_SafeguardingDenialDoesNotPersistCommentOrSideEffects()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var policy = new RecordingSocialCommentContactPolicy("VETTING_REQUIRED");
        var controller = CreateController(db, tenant, userId: 2, contactPolicy: policy);

        db.Users.AddRange(
            new User { Id = 1, TenantId = 1, Email = "owner@example.test", PasswordHash = "hash", FirstName = "Owner", LastName = "User", Role = "member", IsActive = true },
            new User { Id = 2, TenantId = 1, Email = "author@example.test", PasswordHash = "hash", FirstName = "Comment", LastName = "Author", Role = "member", IsActive = true });
        db.Listings.Add(new Listing { Id = 20, TenantId = 1, UserId = 1, Title = "Protected listing", Description = "Protected", Type = ListingType.Offer, Status = ListingStatus.Active });
        await db.SaveChangesAsync();

        var result = await controller.Comments(JsonDocument.Parse("""
        {
          "action": "submit",
          "target_type": "listing",
          "target_id": 20,
          "content": "Restricted contact"
        }
        """).RootElement);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        db.ThreadedComments.Should().BeEmpty();
        db.ContentMentions.Should().BeEmpty();
        db.Notifications.Should().BeEmpty();
    }

    [Fact]
    public async Task SocialReaction_TogglesLaravelCommentReactionPayload()
    {
        var tenant = CreateTenantContext();
        await using var db = CreateDbContext(tenant);
        var controller = CreateController(db, tenant, userId: 2);

        db.Users.Add(new User
        {
            Id = 2,
            TenantId = 1,
            Email = "member@example.test",
            PasswordHash = "hash",
            FirstName = "Member",
            LastName = "User",
            Role = "member",
            IsActive = true
        });
        db.ThreadedComments.Add(new ThreadedComment
        {
            Id = 100,
            TenantId = 1,
            TargetType = "listing",
            TargetId = 20,
            AuthorId = 2,
            Content = "Reactable comment"
        });
        await db.SaveChangesAsync();

        var add = await controller.ToggleReaction(null, JsonDocument.Parse("""
        {
          "comment_id": 100,
          "emoji": "love"
        }
        """).RootElement);

        var addOk = add.Should().BeOfType<OkObjectResult>().Subject;
        using var addDocument = JsonDocument.Parse(JsonSerializer.Serialize(addOk.Value));
        var addData = addDocument.RootElement.GetProperty("data");
        addData.GetProperty("action").GetString().Should().Be("added");
        addData.GetProperty("reactions").GetProperty("love").GetInt32().Should().Be(1);
        db.CommentReactions.Count(r => r.TenantId == 1 && r.CommentId == 100 && r.UserId == 2 && r.ReactionType == "love")
            .Should().Be(1);

        var remove = await controller.ToggleReaction(null, JsonDocument.Parse("""
        {
          "target_id": 100,
          "emoji": "love"
        }
        """).RootElement);

        var removeOk = remove.Should().BeOfType<OkObjectResult>().Subject;
        using var removeDocument = JsonDocument.Parse(JsonSerializer.Serialize(removeOk.Value));
        var removeData = removeDocument.RootElement.GetProperty("data");
        removeData.GetProperty("action").GetString().Should().Be("removed");
        removeData.GetProperty("reactions").EnumerateObject().Should().BeEmpty();
        db.CommentReactions.Count(r => r.TenantId == 1 && r.CommentId == 100 && r.UserId == 2)
            .Should().Be(0);
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static TenantContext CreateTenantContext()
    {
        var tenant = new TenantContext();
        tenant.SetTenant(1);
        return tenant;
    }

    private static V15SocialCompatibilityController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId,
        IReadOnlyDictionary<string, string?>? configurationValues = null,
        ISocialCommentContactPolicy? contactPolicy = null)
    {
        var configurationBuilder = new ConfigurationBuilder();
        if (configurationValues is not null)
        {
            configurationBuilder.AddInMemoryCollection(configurationValues);
        }

        var configuration = configurationBuilder.Build();
        var push = new PushNotificationService(
            db,
            tenant,
            configuration,
            NullLogger<PushNotificationService>.Instance);

        var controller = new V15SocialCompatibilityController(
            db,
            tenant,
            push,
            configuration,
            contactPolicy ?? new RecordingSocialCommentContactPolicy())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[]
                        {
                            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                            new Claim("tenant_id", "1")
                        },
                        "TestAuth"))
                }
            }
        };

        return controller;
    }

    private sealed class RecordingSocialCommentContactPolicy(string? denialCode = null) : ISocialCommentContactPolicy
    {
        public IReadOnlyList<int> RecipientIds { get; private set; } = Array.Empty<int>();

        public Task AssertAllowedAsync(
            int senderId,
            IReadOnlyCollection<int> recipientIds,
            int tenantId,
            CancellationToken cancellationToken = default)
        {
            RecipientIds = recipientIds.OrderBy(id => id).ToArray();
            if (denialCode is not null)
            {
                throw new SafeguardingPolicyException(denialCode, "Protected contact is restricted.");
            }

            return Task.CompletedTask;
        }
    }

    private static Dictionary<string, string?> PusherConfiguration() => new()
    {
        ["Pusher:Key"] = "test-key",
        ["Pusher:Secret"] = "test-secret",
        ["Pusher:AppId"] = "test-app",
        ["Pusher:Cluster"] = "eu"
    };

    private static void AssertForbidden(IActionResult result)
    {
        var objectResult = result.Should().BeOfType<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("success").GetBoolean().Should().BeFalse();
        document.RootElement.GetProperty("code").GetString().Should().Be("FORBIDDEN");
    }
}
