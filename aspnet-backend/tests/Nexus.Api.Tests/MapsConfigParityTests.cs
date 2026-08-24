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
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class MapsConfigParityTests(NexusWebApplicationFactory factory) : IntegrationTestBase(factory)
{
    [Fact]
    public async Task Config_ProjectsTenantProviderSettingsWithoutInventingGoogleAvailability()
    {
        var tenantId = TestData.Tenant1.Id;
        var keys = new[] { "features.maps", "general.map_provider", "general.geocoding_provider" };
        Dictionary<string, string> previous;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var old = await db.TenantConfigs.Where(x => x.TenantId == tenantId && keys.Contains(x.Key)).ToListAsync();
            previous = old.ToDictionary(x => x.Key, x => x.Value);
            db.TenantConfigs.RemoveRange(old);
            db.TenantConfigs.AddRange(
                new TenantConfig { TenantId = tenantId, Key = "features.maps", Value = "true" },
                new TenantConfig { TenantId = tenantId, Key = "general.map_provider", Value = "openstreetmap" },
                new TenantConfig { TenantId = tenantId, Key = "general.geocoding_provider", Value = "nominatim" });
            await db.SaveChangesAsync();
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v2/config/google-maps");
            request.Headers.Add("X-Tenant-ID", tenantId.ToString());
            var response = await Client.SendAsync(request);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            data.GetProperty("mapsEnabled").GetBoolean().Should().BeTrue();
            data.GetProperty("mapProvider").GetString().Should().Be("openstreetmap");
            data.GetProperty("geocodingProvider").GetString().Should().Be("nominatim");
            data.GetProperty("enabled").GetBoolean().Should().BeFalse();
            data.GetProperty("googleMapsEnabled").GetBoolean().Should().BeFalse();
            data.GetProperty("googlePlacesEnabled").GetBoolean().Should().BeFalse();
            data.GetProperty("osmTileProvider").GetString().Should().Be("osm");
            data.GetProperty("osmTileUrl").GetString().Should().Contain("tile.openstreetmap.org");
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var current = await db.TenantConfigs.Where(x => x.TenantId == tenantId && keys.Contains(x.Key)).ToListAsync();
            db.TenantConfigs.RemoveRange(current);
            db.TenantConfigs.AddRange(previous.Select(pair => new TenantConfig
            {
                TenantId = tenantId,
                Key = pair.Key,
                Value = pair.Value
            }));
            await db.SaveChangesAsync();
        }
    }
}
