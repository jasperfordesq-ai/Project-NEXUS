// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
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

[Collection("Integration")]
public class AdminBlogControllerTests : IntegrationTestBase
{
    public AdminBlogControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CreateBlogPost_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.PostAsJsonAsync("/api/admin/blog", new { title = "Test", content = "Test" });
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateBlogPost_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/admin/blog", new { title = "Test", content = "Test" });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CreateBlogPost_AsAdmin_ReturnsOkOrCreated()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/admin/blog", new
        {
            title = "Test Blog Post",
            content = "This is test content",
            slug = "test-blog-post",
            excerpt = "Test excerpt"
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task UpdateBlogPost_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsJsonAsync("/api/admin/blog/99999", new { title = "Updated" });
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteBlogPost_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/admin/blog/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ToggleStatus_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsync("/api/admin/blog/99999/toggle-status", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateBlogCategory_AsAdmin_ReturnsOkOrCreated()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/admin/blog/categories", new
        {
            name = "Test Category",
            slug = "test-category"
        });
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);
    }

    [Fact]
    public async Task DeleteBlogCategory_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.DeleteAsync("/api/admin/blog/categories/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ListPosts_V2_ReturnsLaravelReactPaginatedRows()
    {
        var needle = $"NeedleContent{Guid.NewGuid():N}";
        var categoryName = $"Laravel Contract {Guid.NewGuid():N}";

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var now = DateTime.UtcNow;

            var category = new BlogCategory
            {
                TenantId = TestData.Tenant1.Id,
                Name = categoryName,
                Slug = $"laravel-contract-{Guid.NewGuid():N}",
                CreatedAt = now.AddMinutes(-5)
            };

            db.BlogCategories.Add(category);
            await db.SaveChangesAsync();

            db.BlogPosts.AddRange(
                new BlogPost
                {
                    TenantId = TestData.Tenant1.Id,
                    AuthorId = TestData.AdminUser.Id,
                    CategoryId = category.Id,
                    Title = "Laravel React list target",
                    Slug = $"laravel-react-list-target-{Guid.NewGuid():N}",
                    Content = $"Body includes {needle} for Laravel content search",
                    Excerpt = "List target excerpt",
                    FeaturedImageUrl = "/uploads/blog/list-target.jpg",
                    Status = "draft",
                    CreatedAt = now.AddMinutes(-1)
                },
                new BlogPost
                {
                    TenantId = TestData.Tenant1.Id,
                    AuthorId = TestData.AdminUser.Id,
                    Title = "Unrelated Laravel React list row",
                    Slug = $"unrelated-list-row-{Guid.NewGuid():N}",
                    Content = "No matching body",
                    Status = "published",
                    CreatedAt = now.AddMinutes(-2)
                });

            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync($"/api/v2/admin/blog?status=archived&search={needle}&page=1");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        var data = root.GetProperty("data");
        data.GetArrayLength().Should().Be(1);

        var row = data[0];
        row.GetProperty("title").GetString().Should().Be("Laravel React list target");
        row.GetProperty("excerpt").GetString().Should().Be("List target excerpt");
        row.GetProperty("status").GetString().Should().Be("draft");
        row.GetProperty("featured_image").GetString().Should().Be("/uploads/blog/list-target.jpg");
        row.GetProperty("author_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        row.GetProperty("author_name").GetString().Should().NotBeNullOrWhiteSpace();
        row.GetProperty("category_id").GetInt32().Should().BeGreaterThan(0);
        row.GetProperty("category_name").GetString().Should().Be(categoryName);
        row.TryGetProperty("author", out _).Should().BeFalse();
        row.TryGetProperty("category", out _).Should().BeFalse();

        var meta = root.GetProperty("meta");
        meta.GetProperty("current_page").GetInt32().Should().Be(1);
        meta.GetProperty("per_page").GetInt32().Should().Be(20);
        meta.GetProperty("total").GetInt32().Should().Be(1);
        meta.GetProperty("total_pages").GetInt32().Should().Be(1);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task BulkActions_V2_ReturnLaravelReactBulkResultsAndPersistTenantScopedChanges()
    {
        int draftOneId;
        int draftTwoId;
        int publishedId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var now = DateTime.UtcNow;

            var draftOne = new BlogPost
            {
                TenantId = TestData.Tenant1.Id,
                AuthorId = TestData.AdminUser.Id,
                Title = "Bulk draft one",
                Slug = $"bulk-draft-one-{Guid.NewGuid():N}",
                Content = "Draft one",
                Status = "draft",
                CreatedAt = now.AddMinutes(-3)
            };

            var draftTwo = new BlogPost
            {
                TenantId = TestData.Tenant1.Id,
                AuthorId = TestData.AdminUser.Id,
                Title = "Bulk draft two",
                Slug = $"bulk-draft-two-{Guid.NewGuid():N}",
                Content = "Draft two",
                Status = "draft",
                CreatedAt = now.AddMinutes(-2)
            };

            var published = new BlogPost
            {
                TenantId = TestData.Tenant1.Id,
                AuthorId = TestData.AdminUser.Id,
                Title = "Bulk published",
                Slug = $"bulk-published-{Guid.NewGuid():N}",
                Content = "Published",
                Status = "published",
                PublishedAt = now.AddMinutes(-1),
                CreatedAt = now.AddMinutes(-1)
            };

            db.BlogPosts.AddRange(draftOne, draftTwo, published);
            await db.SaveChangesAsync();

            draftOneId = draftOne.Id;
            draftTwoId = draftTwo.Id;
            publishedId = published.Id;
        }

        await AuthenticateAsAdminAsync();

        var publish = await Client.PostAsJsonAsync("/api/v2/admin/blog/bulk-publish", new
        {
            post_ids = new[] { draftOneId, draftTwoId, publishedId, 999999 }
        });

        publish.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var document = JsonDocument.Parse(await publish.Content.ReadAsStringAsync()))
        {
            document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("success").GetInt32().Should().Be(2);
            data.GetProperty("failed").GetInt32().Should().Be(1);
            data.GetProperty("skipped_ids").EnumerateArray().Select(x => x.GetInt32())
                .Should().BeEquivalentTo(new[] { publishedId, 999999 });
        }

        var delete = await Client.PostAsJsonAsync("/api/v2/admin/blog/bulk-delete", new
        {
            post_ids = new[] { draftOneId, 999998 }
        });

        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var document = JsonDocument.Parse(await delete.Content.ReadAsStringAsync()))
        {
            document.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("success").GetInt32().Should().Be(1);
            data.GetProperty("failed").GetInt32().Should().Be(1);
            data.GetProperty("skipped_ids").EnumerateArray().Select(x => x.GetInt32())
                .Should().BeEquivalentTo(new[] { 999998 });
        }

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

            (await db.BlogPosts.IgnoreQueryFilters().AnyAsync(p => p.Id == draftOneId)).Should().BeFalse();
            (await db.BlogPosts.IgnoreQueryFilters().Where(p => p.Id == draftTwoId).Select(p => p.Status).SingleAsync())
                .Should().Be("published");
        }
    }

    [Fact]
    public async Task CrudActions_V2_ReturnLaravelReactBlogPostEnvelopes()
    {
        await AuthenticateAsAdminAsync();
        var customSlug = $"laravel-react-blog-contract-{Guid.NewGuid():N}";

        var create = await Client.PostAsJsonAsync("/api/v2/admin/blog", new
        {
            title = "Laravel React Blog Contract",
            slug = customSlug,
            content = "<p>Contract body</p>",
            excerpt = "Contract excerpt",
            status = "published",
            featured_image = "/uploads/blog/contract.jpg",
            meta_title = "Contract SEO title",
            meta_description = "Contract SEO description",
            noindex = true
        });

        create.StatusCode.Should().Be(HttpStatusCode.Created);
        using var createDocument = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        createDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var created = createDocument.RootElement.GetProperty("data");
        var postId = created.GetProperty("id").GetInt32();
        created.GetProperty("title").GetString().Should().Be("Laravel React Blog Contract");
        created.GetProperty("slug").GetString().Should().Be(customSlug);
        created.GetProperty("status").GetString().Should().Be("published");

        var show = await Client.GetAsync($"/api/v2/admin/blog/{postId}");
        show.StatusCode.Should().Be(HttpStatusCode.OK);
        using var showDocument = JsonDocument.Parse(await show.Content.ReadAsStringAsync());
        showDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var shown = showDocument.RootElement.GetProperty("data");
        shown.GetProperty("content").GetString().Should().Contain("Contract body");
        shown.GetProperty("featured_image").GetString().Should().Be("/uploads/blog/contract.jpg");
        shown.GetProperty("meta_title").GetString().Should().Be("Contract SEO title");
        shown.GetProperty("meta_description").GetString().Should().Be("Contract SEO description");
        shown.GetProperty("noindex").GetBoolean().Should().BeTrue();

        var update = await Client.PutAsJsonAsync($"/api/v2/admin/blog/{postId}", new
        {
            title = "Updated Laravel React Blog Contract",
            excerpt = "Updated excerpt",
            status = "draft",
            featured_image = "/uploads/blog/updated.jpg",
            meta_title = "Updated SEO title",
            meta_description = "Updated SEO description",
            noindex = false
        });

        update.StatusCode.Should().Be(HttpStatusCode.OK);
        using var updateDocument = JsonDocument.Parse(await update.Content.ReadAsStringAsync());
        updateDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var updated = updateDocument.RootElement.GetProperty("data");
        updated.GetProperty("title").GetString().Should().Be("Updated Laravel React Blog Contract");
        updated.GetProperty("status").GetString().Should().Be("draft");
        updated.GetProperty("featured_image").GetString().Should().Be("/uploads/blog/updated.jpg");
        updated.GetProperty("meta_title").GetString().Should().Be("Updated SEO title");
        updated.GetProperty("noindex").GetBoolean().Should().BeFalse();

        var toggle = await Client.PostAsync($"/api/v2/admin/blog/{postId}/toggle-status", null);
        toggle.StatusCode.Should().Be(HttpStatusCode.OK);
        using var toggleDocument = JsonDocument.Parse(await toggle.Content.ReadAsStringAsync());
        toggleDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        toggleDocument.RootElement.GetProperty("data").GetProperty("status").GetString().Should().Be("published");

        var delete = await Client.DeleteAsync($"/api/v2/admin/blog/{postId}");
        delete.StatusCode.Should().Be(HttpStatusCode.OK);
        using var deleteDocument = JsonDocument.Parse(await delete.Content.ReadAsStringAsync());
        deleteDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var deleted = deleteDocument.RootElement.GetProperty("data");
        deleted.GetProperty("deleted").GetBoolean().Should().BeTrue();
        deleted.GetProperty("id").GetInt32().Should().Be(postId);
    }
}
