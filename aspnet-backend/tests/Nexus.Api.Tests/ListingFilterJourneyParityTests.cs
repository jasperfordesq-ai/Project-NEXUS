// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class ListingFilterJourneyParityTests : IntegrationTestBase
{
    public ListingFilterJourneyParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SearchTypeAndCategory_ReturnOnlyTheReactMatchingListing()
    {
        var marker = $"needle-{Guid.NewGuid():N}";
        int expectedId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var repairs = Category(marker, "Repairs");
            var gardening = Category($"garden-{Guid.NewGuid():N}", "Gardening");
            db.Categories.AddRange(repairs, gardening);
            await db.SaveChangesAsync();

            var expected = Listing(marker, repairs.Id, title: $"Bicycle {marker}");
            db.Listings.AddRange(
                expected,
                Listing(marker, gardening.Id, title: $"Wrong category {marker}"),
                Listing("different", repairs.Id, title: "Different search term"),
                Listing(marker, repairs.Id, title: $"Wrong type {marker}", type: ListingType.Request));
            await db.SaveChangesAsync();
            expectedId = expected.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync(
            $"/api/v2/listings?q={Uri.EscapeDataString(marker)}&type=offer&category={Uri.EscapeDataString(marker)}&personalised=false");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var rows = payload.GetProperty("data").EnumerateArray().ToArray();
        rows.Select(x => x.GetProperty("id").GetInt32()).Should().Equal(expectedId);
        rows[0].TryGetProperty("distance_km", out _).Should().BeFalse();
        payload.GetProperty("meta").GetProperty("total_items").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task AdvancedFilters_ReturnOnlyListingMatchingEveryConsumedFacet()
    {
        var marker = $"facets-{Guid.NewGuid():N}";
        int expectedId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var category = Category(marker, "Faceted category");
            db.Categories.Add(category);
            await db.SaveChangesAsync();

            var expected = Listing(marker, category.Id, estimatedHours: 2m, serviceType: "hybrid", latitude: 53.35, longitude: -6.26);
            db.Listings.AddRange(
                expected,
                Listing(marker, category.Id, estimatedHours: 8m, serviceType: "hybrid", latitude: 53.35, longitude: -6.26),
                Listing(marker, category.Id, estimatedHours: 2m, serviceType: "physical_only", latitude: 53.35, longitude: -6.26),
                Listing(marker, category.Id, estimatedHours: 2m, serviceType: "hybrid", latitude: 53.35, longitude: -6.26, createdAt: DateTime.UtcNow.AddDays(-40)),
                Listing(marker, category.Id, estimatedHours: 2m, serviceType: "hybrid"));
            await db.SaveChangesAsync();
            expectedId = expected.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync(
            $"/api/v2/listings?q={Uri.EscapeDataString(marker)}&min_hours=1&max_hours=3"
            + "&service_type=remote_only,hybrid&posted_within=7&with_coordinates=1&personalised=false");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        payload.GetProperty("data").EnumerateArray().Select(x => x.GetProperty("id").GetInt32())
            .Should().Equal(expectedId);
        payload.GetProperty("meta").GetProperty("total_items").GetInt32().Should().Be(1);
    }

    [Fact]
    public async Task ProximityFilter_ExcludesFarListingAndReturnsDistanceForTheClient()
    {
        var marker = $"nearby-{Guid.NewGuid():N}";
        int expectedId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var category = Category(marker, "Nearby category");
            db.Categories.Add(category);
            await db.SaveChangesAsync();

            var expected = Listing(marker, category.Id, latitude: 53.3498, longitude: -6.2603);
            db.Listings.AddRange(
                expected,
                Listing(marker, category.Id, latitude: 51.8985, longitude: -8.4756));
            await db.SaveChangesAsync();
            expectedId = expected.Id;
        }

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync(
            $"/api/v2/listings?q={Uri.EscapeDataString(marker)}&near_lat=53.3498&near_lng=-6.2603&radius_km=5&personalised=false");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var rows = payload.GetProperty("data").EnumerateArray().ToArray();
        rows.Select(x => x.GetProperty("id").GetInt32()).Should().Equal(expectedId);
        rows[0].GetProperty("distance_km").GetDouble().Should().BeInRange(0, 5);
        payload.GetProperty("meta").GetProperty("total_items").GetInt32().Should().Be(1);
    }

    private Category Category(string slug, string name) => new()
    {
        TenantId = TestData.Tenant1.Id,
        Name = name,
        Slug = slug,
        IsActive = true,
    };

    private Listing Listing(
        string marker,
        int categoryId,
        string? title = null,
        ListingType type = ListingType.Offer,
        decimal? estimatedHours = 2m,
        string? serviceType = "hybrid",
        double? latitude = null,
        double? longitude = null,
        DateTime? createdAt = null) => new()
    {
        TenantId = TestData.Tenant1.Id,
        UserId = TestData.MemberUser.Id,
        CategoryId = categoryId,
        Title = title ?? $"Listing {marker}",
        Description = $"Description containing {marker}",
        Type = type,
        Status = ListingStatus.Active,
        EstimatedHours = estimatedHours,
        ServiceType = serviceType,
        Latitude = latitude,
        Longitude = longitude,
        CreatedAt = createdAt ?? DateTime.UtcNow,
    };
}
