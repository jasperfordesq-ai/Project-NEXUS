// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Headers;
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
public class ResourcesControllerTests : IntegrationTestBase
{
    public ResourcesControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task ResourceUploadV2_PersistsLaravelReactFileMetadataAndDownloadBytes()
    {
        var marker = Guid.NewGuid().ToString("N");
        var fileBytes = "hello from laravel react resources upload"u8.ToArray();

        await AuthenticateAsMemberAsync();
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent($"Laravel React upload {marker}"), "title");
        form.Add(new StringContent("Uploaded through the React resources page"), "description");
        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse("text/plain");
        form.Add(fileContent, "file", "react-resource.txt");

        var uploadResponse = await Client.PostAsync("/api/v2/resources", form);

        uploadResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        using var uploadDocument = JsonDocument.Parse(await uploadResponse.Content.ReadAsStringAsync());
        var uploadRoot = uploadDocument.RootElement;
        uploadRoot.GetProperty("success").GetBoolean().Should().BeTrue();
        var uploadData = uploadRoot.GetProperty("data");
        var resourceId = uploadData.GetProperty("id").GetInt32();
        uploadData.GetProperty("title").GetString().Should().Be($"Laravel React upload {marker}");
        uploadData.GetProperty("description").GetString().Should().Be("Uploaded through the React resources page");
        uploadData.GetProperty("file_path").GetString().Should().NotBeNullOrWhiteSpace();
        uploadData.GetProperty("file_path").GetString().Should().EndWith(".txt");
        uploadData.GetProperty("file_url").GetString().Should().Contain($"/uploads/{TestData.Tenant1.Id}/resources/");
        uploadData.GetProperty("file_type").GetString().Should().Be("text/plain");
        uploadData.GetProperty("file_size").GetInt64().Should().Be(fileBytes.Length);
        uploadData.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();

        ClearAuthToken();
        using var listRequest = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/resources?search=Laravel%20React%20upload%20{marker}");
        listRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var listResponse = await Client.SendAsync(listRequest);
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var listDocument = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
        var listed = listDocument.RootElement.GetProperty("data").EnumerateArray().Single();
        listed.GetProperty("id").GetInt32().Should().Be(resourceId);
        listed.GetProperty("file_type").GetString().Should().Be("text/plain");
        listed.GetProperty("file_size").GetInt64().Should().Be(fileBytes.Length);
        listed.GetProperty("downloads").GetInt32().Should().Be(0);

        await AuthenticateAsMemberAsync();
        var downloadResponse = await Client.GetAsync($"/api/v2/resources/{resourceId}/download");
        downloadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        downloadResponse.Content.Headers.ContentType?.MediaType.Should().Be("text/plain");
        (await downloadResponse.Content.ReadAsByteArrayAsync()).Should().Equal(fileBytes);

        ClearAuthToken();
        using var afterDownloadRequest = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/resources?search=Laravel%20React%20upload%20{marker}");
        afterDownloadRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var afterDownloadResponse = await Client.SendAsync(afterDownloadRequest);
        afterDownloadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var afterDownloadDocument = JsonDocument.Parse(await afterDownloadResponse.Content.ReadAsStringAsync());
        var afterDownloadResource = afterDownloadDocument.RootElement.GetProperty("data").EnumerateArray().Single();
        afterDownloadResource.GetProperty("downloads").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task ResourceUploadV2_RejectsSvgWithLaravelErrorEnvelope()
    {
        var marker = Guid.NewGuid().ToString("N");

        await AuthenticateAsMemberAsync();
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent($"Laravel React rejected svg {marker}"), "title");
        var fileContent = new ByteArrayContent("<svg><script>alert(1)</script></svg>"u8.ToArray());
        fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse("image/svg+xml");
        form.Add(fileContent, "file", "blocked.svg");

        var response = await Client.PostAsync("/api/v2/resources", form);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        root.TryGetProperty("success", out _).Should().BeFalse();
        var error = root.GetProperty("errors").EnumerateArray().Single();
        error.GetProperty("code").GetString().Should().Be("FILE_TYPE_NOT_ALLOWED");
        error.GetProperty("field").GetString().Should().Be("file");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Resources.AnyAsync(r => r.TenantId == TestData.Tenant1.Id && r.Title == $"Laravel React rejected svg {marker}"))
            .Should().BeFalse();
        (await db.FileUploads.AnyAsync(f => f.TenantId == TestData.Tenant1.Id && f.OriginalFilename == "blocked.svg"))
            .Should().BeFalse();
    }

    [Fact]
    public async Task PublicResourcesV2_OrdersByLaravelSortOrderBeforeCreatedAt()
    {
        var marker = Guid.NewGuid().ToString("N");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Resources.AddRange(
                new Resource
                {
                    TenantId = TestData.Tenant1.Id,
                    Title = $"Laravel ordered first {marker}",
                    Description = $"Sort order marker {marker}",
                    Url = "ordered-first.txt",
                    ResourceType = "text/plain",
                    CreatedById = TestData.MemberUser.Id,
                    SortOrder = 1,
                    IsPublished = true,
                    CreatedAt = DateTime.UtcNow.AddMinutes(-10)
                },
                new Resource
                {
                    TenantId = TestData.Tenant1.Id,
                    Title = $"Laravel ordered second {marker}",
                    Description = $"Sort order marker {marker}",
                    Url = "ordered-second.txt",
                    ResourceType = "text/plain",
                    CreatedById = TestData.MemberUser.Id,
                    SortOrder = 2,
                    IsPublished = true,
                    CreatedAt = DateTime.UtcNow
                });
            await db.SaveChangesAsync();
        }

        ClearAuthToken();
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/resources?search=Sort%20order%20marker%20{marker}");
        request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var titles = document.RootElement
            .GetProperty("data")
            .EnumerateArray()
            .Select(row => row.GetProperty("title").GetString())
            .ToArray();

        titles.Should().Equal(
            $"Laravel ordered first {marker}",
            $"Laravel ordered second {marker}");
    }

    [Fact]
    public async Task PublicResourcesV2_ReturnsLaravelReactAnonymousCursorContract()
    {
        var marker = Guid.NewGuid().ToString("N");
        ResourceCategory category;
        int targetResourceId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

            category = new ResourceCategory
            {
                TenantId = TestData.Tenant1.Id,
                Name = $"Guides {marker}",
                Description = "Guides for public resource discovery",
                SortOrder = 3,
                CreatedAt = DateTime.UtcNow.AddMinutes(-10)
            };

            db.ResourceCategories.Add(category);
            await db.SaveChangesAsync();

            var targetResource = new Resource
            {
                TenantId = TestData.Tenant1.Id,
                Title = $"Laravel React resource target {marker}",
                Description = "Needle public resource contract",
                Url = "public-guide.pdf",
                ResourceType = "document",
                CategoryId = category.Id,
                CreatedById = TestData.MemberUser.Id,
                SortOrder = 1,
                IsPublished = true,
                CreatedAt = DateTime.UtcNow.AddMinutes(-3)
            };

            db.Resources.AddRange(
                targetResource,
                new Resource
                {
                    TenantId = TestData.Tenant1.Id,
                    Title = $"Laravel React resource extra {marker}",
                    Description = "Another public resource",
                    Url = "/uploads/shared/extra.pdf",
                    ResourceType = "document",
                    CategoryId = category.Id,
                    CreatedById = TestData.AdminUser.Id,
                    SortOrder = 2,
                    IsPublished = true,
                    CreatedAt = DateTime.UtcNow.AddMinutes(-2)
                });

            await db.SaveChangesAsync();
            targetResourceId = targetResource.Id;
        }

        ClearAuthToken();
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v2/resources?per_page=1&search=Needle%20public&category_id={category.Id}");
        request.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var response = await Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeTrue();

        var data = root.GetProperty("data").EnumerateArray().ToArray();
        data.Should().HaveCount(1);
        var row = data[0];
        row.GetProperty("title").GetString().Should().Be($"Laravel React resource target {marker}");
        row.GetProperty("description").GetString().Should().Be("Needle public resource contract");
        row.GetProperty("file_path").GetString().Should().Be("public-guide.pdf");
        row.GetProperty("file_url").GetString().Should().Contain($"/uploads/{TestData.Tenant1.Id}/resources/public-guide.pdf");
        row.GetProperty("file_type").GetString().Should().Be("document");
        row.GetProperty("file_size").GetInt32().Should().Be(0);
        row.GetProperty("downloads").GetInt32().Should().Be(0);
        row.GetProperty("uploader").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        row.GetProperty("uploader").GetProperty("name").GetString().Should().Be("Member User");
        row.GetProperty("category").GetProperty("id").GetInt32().Should().Be(category.Id);
        row.GetProperty("category").GetProperty("name").GetString().Should().Be(category.Name);
        row.GetProperty("category").GetProperty("color").GetString().Should().Be("blue");
        row.GetProperty("is_liked").GetBoolean().Should().BeFalse();
        row.GetProperty("likes_count").GetInt32().Should().Be(0);
        row.GetProperty("comments_count").GetInt32().Should().Be(0);

        var meta = root.GetProperty("meta");
        meta.GetProperty("per_page").GetInt32().Should().Be(1);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        meta.GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        meta.TryGetProperty("cursor", out _).Should().BeTrue();

        using var categoriesRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v2/resources/categories");
        categoriesRequest.Headers.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());
        var categoriesResponse = await Client.SendAsync(categoriesRequest);

        categoriesResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var categoriesDocument = JsonDocument.Parse(await categoriesResponse.Content.ReadAsStringAsync());
        categoriesDocument.RootElement.GetProperty("success").GetBoolean().Should().BeTrue();
        var categories = categoriesDocument.RootElement.GetProperty("data").EnumerateArray().ToArray();
        var contractCategory = categories.Single(c => c.GetProperty("id").GetInt32() == category.Id);
        contractCategory.GetProperty("name").GetString().Should().Be(category.Name);
        contractCategory.GetProperty("slug").GetString().Should().NotBeNullOrWhiteSpace();
        contractCategory.GetProperty("color").GetString().Should().Be("blue");
        contractCategory.GetProperty("resource_count").GetInt32().Should().Be(2);

        await AuthenticateAsMemberAsync();
        var downloadResponse = await Client.GetAsync($"/api/v2/resources/{targetResourceId}/download");
        downloadResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        downloadResponse.Content.Headers.ContentDisposition?.FileNameStar.Should().Be("public-guide.pdf");
    }

    [Fact]
    public async Task List_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/resources");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task List_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/resources");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Get_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/resources/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetCategories_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/resources/categories");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetCategoriesTree_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/resources/categories/tree");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Delete_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/resources/99999");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.Forbidden);
    }
}
