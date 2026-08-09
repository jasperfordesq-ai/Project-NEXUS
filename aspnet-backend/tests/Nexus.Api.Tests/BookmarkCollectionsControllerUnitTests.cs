// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class BookmarkCollectionsControllerUnitTests
{
    [Fact]
    public async Task LaravelCollectionsRoute_ReturnsCurrentUserCollectionsWithBookmarkCounts()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        var reading = new BookmarkCollection
        {
            TenantId = 42,
            UserId = userId,
            Name = "Reading",
            Description = "Saved articles"
        };
        var tools = new BookmarkCollection
        {
            TenantId = 42,
            UserId = userId,
            Name = "Tools"
        };
        db.BookmarkCollections.AddRange(
            reading,
            tools,
            new BookmarkCollection { TenantId = 42, UserId = 2002, Name = "Other user" },
            new BookmarkCollection { TenantId = 7, UserId = userId, Name = "Other tenant" });
        await db.SaveChangesAsync();

        db.Bookmarks.AddRange(
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.BlogPost, ContentId = 10, CollectionId = reading.Id },
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.Event, ContentId = 11, CollectionId = reading.Id },
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.Job, ContentId = 12, CollectionId = tools.Id },
            new Bookmark { TenantId = 42, UserId = 2002, ContentType = BookmarkContentType.Event, ContentId = 13 });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpGetAttribute>("/api/bookmark-collections");

        action.Should().NotBeNull("Laravel exposes GET /api/v2/bookmark-collections");
        var result = await (Task<IActionResult>)action!.Invoke(controller, [])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data").EnumerateArray().ToArray();

        data.Should().HaveCount(2);
        data.Select(item => item.GetProperty("name").GetString())
            .Should().BeEquivalentTo(["Reading", "Tools"]);
        data.Single(item => item.GetProperty("name").GetString() == "Reading")
            .GetProperty("bookmarks_count")
            .GetInt32()
            .Should()
            .Be(2);
    }

    [Fact]
    public async Task CreateLaravelCollection_TrimsNameAndReturnsCreatedDataEnvelope()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpPostAttribute>("/api/bookmark-collections");

        action.Should().NotBeNull("Laravel exposes POST /api/v2/bookmark-collections");
        var result = await (Task<IActionResult>)action!.Invoke(
            controller,
            [new BookmarksController.CreateCollectionRequest { Name = " Reading ", Description = "Saved articles" }])!;

        var created = result.Should().BeOfType<CreatedResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");

        data.GetProperty("name").GetString().Should().Be("Reading");
        data.GetProperty("description").GetString().Should().Be("Saved articles");
        data.GetProperty("is_default").GetBoolean().Should().BeFalse();

        var collection = await db.BookmarkCollections.IgnoreQueryFilters().SingleAsync();
        collection.TenantId.Should().Be(42);
        collection.UserId.Should().Be(userId);
        collection.Name.Should().Be("Reading");
    }

    [Fact]
    public async Task DeleteLaravelCollection_UnlinksBookmarksAndReturnsDataEnvelope()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        var collection = new BookmarkCollection
        {
            TenantId = 42,
            UserId = userId,
            Name = "Reading"
        };
        var otherCollection = new BookmarkCollection
        {
            TenantId = 42,
            UserId = userId,
            Name = "Tools"
        };
        db.BookmarkCollections.AddRange(collection, otherCollection);
        await db.SaveChangesAsync();

        db.Bookmarks.AddRange(
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.BlogPost, ContentId = 10, CollectionId = collection.Id },
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.Event, ContentId = 11, CollectionId = collection.Id },
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.Job, ContentId = 12, CollectionId = otherCollection.Id });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpDeleteAttribute>("/api/bookmark-collections/{id:int}");

        action.Should().NotBeNull("Laravel exposes DELETE /api/v2/bookmark-collections/{id}");
        var result = await (Task<IActionResult>)action!.Invoke(controller, [collection.Id])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        (await db.BookmarkCollections.IgnoreQueryFilters().AnyAsync(c => c.Id == collection.Id))
            .Should()
            .BeFalse();
        (await db.BookmarkCollections.IgnoreQueryFilters().AnyAsync(c => c.Id == otherCollection.Id))
            .Should()
            .BeTrue();
        (await db.Bookmarks.IgnoreQueryFilters().CountAsync(b => b.CollectionId == null))
            .Should()
            .Be(2);
        (await db.Bookmarks.IgnoreQueryFilters().CountAsync(b => b.CollectionId == otherCollection.Id))
            .Should()
            .Be(1);
    }

    [Fact]
    public async Task DeleteLaravelCollection_ReturnsNotFoundForAnotherUsersCollection()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);

        var collection = new BookmarkCollection
        {
            TenantId = 42,
            UserId = 2002,
            Name = "Other user"
        };
        db.BookmarkCollections.Add(collection);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId: 1001);
        var action = FindAction<HttpDeleteAttribute>("/api/bookmark-collections/{id:int}");

        action.Should().NotBeNull("Laravel exposes DELETE /api/v2/bookmark-collections/{id}");
        var result = await (Task<IActionResult>)action!.Invoke(controller, [collection.Id])!;

        var notFound = result.Should().BeOfType<NotFoundObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should()
            .Be("NOT_FOUND");
        (await db.BookmarkCollections.IgnoreQueryFilters().AnyAsync(c => c.Id == collection.Id))
            .Should()
            .BeTrue();
    }

    [Fact]
    public async Task LaravelBookmarkStatus_ReturnsCurrentUserFlagAndTenantScopedCount()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        db.Bookmarks.AddRange(
            new Bookmark { TenantId = 42, UserId = userId, ContentType = BookmarkContentType.BlogPost, ContentId = 10 },
            new Bookmark { TenantId = 42, UserId = 2002, ContentType = BookmarkContentType.BlogPost, ContentId = 10 },
            new Bookmark { TenantId = 42, UserId = 2002, ContentType = BookmarkContentType.Event, ContentId = 10 },
            new Bookmark { TenantId = 7, UserId = userId, ContentType = BookmarkContentType.BlogPost, ContentId = 10 });
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpGetAttribute>("/api/bookmarks/status");

        action.Should().NotBeNull("Laravel exposes GET /api/v2/bookmarks/status");
        var result = await (Task<IActionResult>)action!.Invoke(controller, ["blog", 10])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");

        data.GetProperty("bookmarked").GetBoolean().Should().BeTrue();
        data.GetProperty("count").GetInt32().Should().Be(2);
    }

    [Fact]
    public async Task LaravelBookmarkMove_UpdatesOwnedBookmarkCollectionAndReturnsSuccess()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        var source = new BookmarkCollection { TenantId = 42, UserId = userId, Name = "Reading" };
        var target = new BookmarkCollection { TenantId = 42, UserId = userId, Name = "Tools" };
        db.BookmarkCollections.AddRange(source, target);
        await db.SaveChangesAsync();

        var bookmark = new Bookmark
        {
            TenantId = 42,
            UserId = userId,
            ContentType = BookmarkContentType.BlogPost,
            ContentId = 10,
            CollectionId = source.Id
        };
        db.Bookmarks.Add(bookmark);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpPostAttribute>("/api/bookmarks/{id:int}/move");

        action.Should().NotBeNull("Laravel exposes POST /api/v2/bookmarks/{id}/move");
        var result = await (Task<IActionResult>)action!.Invoke(
            controller,
            [bookmark.Id, JsonDocument.Parse($$"""{ "collection_id": {{target.Id}} }""").RootElement.Clone()])!;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        document.RootElement.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();

        (await db.Bookmarks.IgnoreQueryFilters().SingleAsync(b => b.Id == bookmark.Id))
            .CollectionId
            .Should()
            .Be(target.Id);
    }

    [Fact]
    public async Task LaravelBookmarkMove_ReturnsNotFoundForForeignCollectionAndPreservesBookmark()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var userId = 1001;

        var source = new BookmarkCollection { TenantId = 42, UserId = userId, Name = "Reading" };
        var foreign = new BookmarkCollection { TenantId = 42, UserId = 2002, Name = "Foreign" };
        db.BookmarkCollections.AddRange(source, foreign);
        await db.SaveChangesAsync();

        var bookmark = new Bookmark
        {
            TenantId = 42,
            UserId = userId,
            ContentType = BookmarkContentType.BlogPost,
            ContentId = 10,
            CollectionId = source.Id
        };
        db.Bookmarks.Add(bookmark);
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenantContext, userId);
        var action = FindAction<HttpPostAttribute>("/api/bookmarks/{id:int}/move");

        action.Should().NotBeNull("Laravel exposes POST /api/v2/bookmarks/{id}/move");
        var result = await (Task<IActionResult>)action!.Invoke(
            controller,
            [bookmark.Id, JsonDocument.Parse($$"""{ "collection_id": {{foreign.Id}} }""").RootElement.Clone()])!;

        var notFound = result.Should().BeOfType<NotFoundObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should()
            .Be("NOT_FOUND");

        (await db.Bookmarks.IgnoreQueryFilters().SingleAsync(b => b.Id == bookmark.Id))
            .CollectionId
            .Should()
            .Be(source.Id);
    }

    private static MethodInfo? FindAction<TAttribute>(string template)
        where TAttribute : HttpMethodAttribute
        => typeof(BookmarksController)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public)
            .SingleOrDefault(method => method
                .GetCustomAttributes<TAttribute>()
                .Any(attribute => attribute.Template == template));

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }

    private static BookmarksController CreateController(
        NexusDbContext db,
        TenantContext tenantContext,
        int userId)
    {
        var controller = new BookmarksController(new BookmarkService(db, tenantContext));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("sub", userId.ToString())
                ], "unit-test"))
            }
        };

        return controller;
    }
}
