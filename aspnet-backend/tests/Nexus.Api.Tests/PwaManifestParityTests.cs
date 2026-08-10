// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class PwaManifestParityTests : IntegrationTestBase
{
    public PwaManifestParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SharedHost_PathTenant_ReturnsRawTenantScopedManifestAndExactHeaders()
    {
        ClearAuthToken();
        using var response = await Client.GetAsync("/api/v2/pwa/manifest?path=%2Fother-tenant%2Flistings%3Ftab%3Doffers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/manifest+json");
        response.Content.Headers.ContentType.CharSet.Should().BeEquivalentTo("UTF-8");
        response.Headers.CacheControl!.Public.Should().BeTrue();
        response.Headers.CacheControl.MaxAge.Should().Be(TimeSpan.FromSeconds(300));
        response.Headers.TryGetValues("Vary", out var vary).Should().BeTrue();
        vary.Should().Contain("Host");

        var manifest = await response.Content.ReadFromJsonAsync<JsonElement>();
        manifest.GetProperty("name").GetString().Should().Be(TestData.Tenant2.Name);
        manifest.GetProperty("short_name").GetString().Should().Be(TestData.Tenant2.Name);
        manifest.GetProperty("id").GetString().Should().Be("/other-tenant/");
        manifest.GetProperty("start_url").GetString().Should().Be("/other-tenant/");
        manifest.GetProperty("scope").GetString().Should().Be("/other-tenant/");
        manifest.GetProperty("shortcuts")[0].GetProperty("url").GetString()
            .Should().Be("/other-tenant/listings");
        manifest.TryGetProperty("data", out _).Should().BeFalse("a web manifest is not an API envelope");
    }

    [Fact]
    public async Task DedicatedHost_OnlyAllowsPathSwitchToActiveDirectChild()
    {
        int? hierarchyId = null;
        using (var setup = Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
            var parent = await db.Tenants.SingleAsync(tenant => tenant.Id == TestData.Tenant2.Id);
            parent.Domain = "parent.example.test";
            await db.SaveChangesAsync();
        }

        try
        {
            using var hostClient = Factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://parent.example.test")
            });
            using (var blocked = await hostClient.GetAsync(
                       "/api/v2/pwa/manifest?path=%2Ftest-tenant%2Fdashboard"))
            {
                var manifest = await blocked.Content.ReadFromJsonAsync<JsonElement>();
                manifest.GetProperty("name").GetString().Should().Be(TestData.Tenant2.Name);
                manifest.GetProperty("scope").GetString().Should().Be("/");
            }

            using (var setup = Factory.Services.CreateScope())
            {
                var db = setup.ServiceProvider.GetRequiredService<NexusDbContext>();
                var link = new TenantHierarchy
                {
                    ParentTenantId = TestData.Tenant2.Id,
                    ChildTenantId = TestData.Tenant1.Id,
                    InheritanceMode = "config",
                    IsActive = true
                };
                db.TenantHierarchies.Add(link);
                await db.SaveChangesAsync();
                hierarchyId = link.Id;
            }

            using var allowed = await hostClient.GetAsync(
                "/api/v2/pwa/manifest?path=%2Ftest-tenant%2Fdashboard");
            var allowedManifest = await allowed.Content.ReadFromJsonAsync<JsonElement>();
            allowedManifest.GetProperty("name").GetString().Should().Be(TestData.Tenant1.Name);
            allowedManifest.GetProperty("scope").GetString().Should().Be("/test-tenant/");
        }
        finally
        {
            using var cleanup = Factory.Services.CreateScope();
            var db = cleanup.ServiceProvider.GetRequiredService<NexusDbContext>();
            if (hierarchyId.HasValue)
                await db.TenantHierarchies.Where(link => link.Id == hierarchyId).ExecuteDeleteAsync();
            await db.Tenants.Where(tenant => tenant.Id == TestData.Tenant2.Id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(tenant => tenant.Domain, (string?)null));
        }
    }
}

public sealed class PwaManifestRouteOwnershipTests
{
    [Fact]
    public void ManifestAliases_HaveOneOwnerAndDedicatedPolicy()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.ConfigureServices(services =>
                {
                    foreach (var descriptor in services.Where(item =>
                                 item.ServiceType == typeof(IHostedService)
                                 && item.ImplementationType?.Assembly == typeof(Program).Assembly).ToList())
                        services.Remove(descriptor);
                });
            });
        var endpoints = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .ToArray();

        foreach (var route in new[] { "api/pwa/manifest", "api/v2/pwa/manifest" })
        {
            var matches = endpoints.Where(endpoint => endpoint.RoutePattern.RawText == route
                && (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    .Contains("GET", StringComparer.OrdinalIgnoreCase) ?? false)).ToArray();
            matches.Should().ContainSingle();
            matches[0].Metadata.GetMetadata<EnableRateLimitingAttribute>()!.PolicyName
                .Should().Be(RateLimitingExtensions.PwaManifestPolicy);
        }
    }
}
