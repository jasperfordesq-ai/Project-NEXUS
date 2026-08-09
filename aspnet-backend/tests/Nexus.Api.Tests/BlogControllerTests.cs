// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class BlogControllerTests : IntegrationTestBase
{
    public BlogControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetBlogPosts_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/blog");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetBlogPosts_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetBlogPosts_WithPagination_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog?page=1&limit=5");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetBlogCategories_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog/categories");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetBlogPostBySlug_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog/non-existent-slug-xyz");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetBlogPosts_WithCategoryFilter_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog?category_id=1");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetBlogPosts_WithTagFilter_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/blog?tag=test");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task PublicBlogV2_ReturnsLaravelReactAnonymousCursorContract()
    {
        var slug = $"laravel-react-public-blog-{Guid.NewGuid():N}";
        int categoryId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var now = DateTime.UtcNow;

            var category = new BlogCategory
            {
                TenantId = TestData.Tenant1.Id,
                Name = "Public Laravel Blog",
                Slug = $"public-laravel-blog-{Guid.NewGuid():N}",
                Color = "green",
                SortOrder = 10,
                CreatedAt = now.AddMinutes(-5)
            };

            db.BlogCategories.Add(category);
            await db.SaveChangesAsync();
            categoryId = category.Id;

            db.BlogPosts.AddRange(
                new BlogPost
                {
                    TenantId = TestData.Tenant1.Id,
                    AuthorId = TestData.AdminUser.Id,
                    CategoryId = category.Id,
                    Title = "Laravel React Public Blog",
                    Slug = slug,
                    Content = "<p>Public blog body for Laravel React detail.</p>",
                    Excerpt = "Public blog excerpt needle",
                    FeaturedImageUrl = "/uploads/blog/public.jpg",
                    Status = "published",
                    MetaTitle = "Public SEO title",
                    MetaDescription = "Public SEO description",
                    CreatedAt = now.AddMinutes(-2),
                    PublishedAt = now.AddMinutes(-2)
                },
                new BlogPost
                {
                    TenantId = TestData.Tenant1.Id,
                    AuthorId = TestData.AdminUser.Id,
                    CategoryId = category.Id,
                    Title = "Laravel React Public Blog Next",
                    Slug = $"laravel-react-public-blog-next-{Guid.NewGuid():N}",
                    Content = "Second public blog body",
                    Excerpt = "Another public excerpt",
                    FeaturedImageUrl = "/uploads/blog/next.jpg",
                    Status = "published",
                    CreatedAt = now.AddMinutes(-3),
                    PublishedAt = now.AddMinutes(-3)
                });

            await db.SaveChangesAsync();
        }

        ClearAuthToken();

        using var listRequest = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/blog?per_page=1&search=Public%20blog%20excerpt&category_id={categoryId}");
        listRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var list = await Client.SendAsync(listRequest);

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        using var listDocument = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        var listRoot = listDocument.RootElement;
        listRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        var listData = listRoot.GetProperty("data");
        listData.GetArrayLength().Should().Be(1);
        var summary = listData[0];
        summary.GetProperty("slug").GetString().Should().Be(slug);
        summary.GetProperty("featured_image").GetString().Should().Contain("/uploads/blog/public.jpg");
        summary.GetProperty("views").GetInt32().Should().Be(0);
        summary.GetProperty("reading_time").GetInt32().Should().BeGreaterThan(0);
        summary.GetProperty("author").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        summary.GetProperty("category").GetProperty("color").GetString().Should().Be("green");
        summary.TryGetProperty("featured_image_url", out _).Should().BeFalse();

        var meta = listRoot.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        meta.TryGetProperty("cursor", out _).Should().BeTrue();

        using var detailRequest = new HttpRequestMessage(HttpMethod.Get, $"/api/v2/blog/{slug}");
        detailRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var detail = await Client.SendAsync(detailRequest);

        detail.StatusCode.Should().Be(HttpStatusCode.OK);
        using var detailDocument = JsonDocument.Parse(await detail.Content.ReadAsStringAsync());
        var detailRoot = detailDocument.RootElement;
        detailRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        var post = detailRoot.GetProperty("data");
        post.GetProperty("content").GetString().Should().Contain("Public blog body");
        post.GetProperty("featured_image").GetString().Should().Contain("/uploads/blog/public.jpg");
        post.GetProperty("meta_title").GetString().Should().Be("Public SEO title");
        post.GetProperty("meta_description").GetString().Should().Be("Public SEO description");
        post.GetProperty("noindex").GetBoolean().Should().BeFalse();
    }
}
