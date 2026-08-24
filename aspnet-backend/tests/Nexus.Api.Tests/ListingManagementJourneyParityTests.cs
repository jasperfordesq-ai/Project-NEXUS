// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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
public sealed class ListingManagementJourneyParityTests : IntegrationTestBase
{
    public ListingManagementJourneyParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalEdit_ReturnsClientContractAndPersistsReactPayload()
    {
        int listingId;
        int categoryId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var category = new Category
            {
                TenantId = TestData.Tenant1.Id,
                Name = $"Repairs {Guid.NewGuid():N}",
                Slug = $"repairs-{Guid.NewGuid():N}",
                IsActive = true,
            };
            var listing = new Listing
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Title = "Repair help",
                Description = "Original description",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
                EstimatedHours = 1m,
            };
            db.Categories.Add(category);
            db.Listings.Add(listing);
            await db.SaveChangesAsync();
            categoryId = category.Id;
            listingId = listing.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.PutAsJsonAsync($"/api/v2/listings/{listingId}", new
        {
            title = "Bicycle repair help",
            description = "Updated description",
            type = "request",
            location = "Community workshop",
            latitude = 53.3498,
            longitude = -6.2603,
            category_id = categoryId,
            hours_estimate = 2.5m,
            hours_available = 8m,
            service_type = "hybrid",
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("title").GetString().Should().Be("Bicycle repair help");
        data.GetProperty("type").GetString().Should().Be("request");
        data.GetProperty("category_id").GetInt32().Should().Be(categoryId);
        data.GetProperty("latitude").GetDouble().Should().Be(53.3498);
        data.GetProperty("longitude").GetDouble().Should().Be(-6.2603);
        data.GetProperty("hours_estimate").GetDecimal().Should().Be(2.5m);
        data.GetProperty("hours_available").GetDecimal().Should().Be(8m);
        data.GetProperty("service_type").GetString().Should().Be("hybrid");

        var tags = await Client.PutAsJsonAsync($"/api/v2/listings/{listingId}/tags", new
        {
            tags = new[] { "bicycles", "maintenance" },
        });
        tags.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var saved = await verifyDb.Listings.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == listingId);
        saved.Title.Should().Be("Bicycle repair help");
        saved.Type.Should().Be(ListingType.Request);
        saved.CategoryId.Should().Be(categoryId);
        saved.Latitude.Should().Be(53.3498);
        saved.Longitude.Should().Be(-6.2603);
        saved.EstimatedHours.Should().Be(2.5m);
    }

    [Fact]
    public async Task EditAndDelete_RefuseSameTenantMemberWhoDoesNotOwnListing()
    {
        int listingId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listing = new Listing
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                Title = "Owner-only listing",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
            };
            db.Listings.Add(listing);
            await db.SaveChangesAsync();
            listingId = listing.Id;
        }

        await AuthenticateAsMemberAsync();
        var edit = await Client.PutAsJsonAsync($"/api/v2/listings/{listingId}", new { title = "Unauthorized edit" });
        var tags = await Client.PutAsJsonAsync($"/api/v2/listings/{listingId}/tags", new { tags = new[] { "unauthorized" } });
        var delete = await Client.DeleteAsync($"/api/v2/listings/{listingId}");

        edit.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        tags.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        delete.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var saved = await verifyDb.Listings.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == listingId);
        saved.Title.Should().Be("Owner-only listing");
        saved.DeletedAt.Should().BeNull();
    }

    [Fact]
    public async Task OwnerDelete_SoftDeletesListingAndReturnsLaravelSuccessStatus()
    {
        int listingId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listing = new Listing
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                Title = "Listing to delete",
                Type = ListingType.Offer,
                Status = ListingStatus.Active,
            };
            db.Listings.Add(listing);
            await db.SaveChangesAsync();
            listingId = listing.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.DeleteAsync($"/api/v2/listings/{listingId}");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var saved = await verifyDb.Listings.IgnoreQueryFilters().AsNoTracking().SingleAsync(x => x.Id == listingId);
        saved.DeletedAt.Should().NotBeNull();
    }
}
