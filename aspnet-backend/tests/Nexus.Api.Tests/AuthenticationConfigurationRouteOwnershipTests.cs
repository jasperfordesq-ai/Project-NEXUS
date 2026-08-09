// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Authorization;

namespace Nexus.Api.Tests;

public sealed class AuthenticationConfigurationRouteOwnershipTests
{
    [Fact]
    public void CanonicalRoutes_HaveFocusedPlatformSuperAdminOwners()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.ConfigureServices(services =>
                {
                    foreach (var descriptor in services
                                 .Where(item => item.ServiceType == typeof(IHostedService)
                                     && item.ImplementationType?.Assembly == typeof(Program).Assembly)
                                 .ToList())
                        services.Remove(descriptor);
                });
            });

        var endpoints = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => Normalize(endpoint.RoutePattern.RawText)
                .StartsWith("api/v2/admin/config/authentication", StringComparison.Ordinal))
            .SelectMany(endpoint =>
                (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? Array.Empty<string>())
                .Select(method => (Method: method, Endpoint: endpoint)))
            .ToList();

        var expected = new[]
        {
            ("GET", "api/v2/admin/config/authentication", "Get"),
            ("PUT", "api/v2/admin/config/authentication/bulk", "UpdateBulk")
        };
        foreach (var (method, route, actionName) in expected)
        {
            var endpoint = endpoints.Should().ContainSingle(candidate =>
                candidate.Method == method && Normalize(candidate.Endpoint.RoutePattern.RawText) == route).Which.Endpoint;
            endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>().ActionName.Should().Be(actionName);
            endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull();
            endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Should().Contain(data => data.Policy == NexusAuthorizationPolicies.PlatformSuperAdminOnly);
        }

        endpoints.Should().HaveCount(2);
    }

    private static string Normalize(string? route) => (route ?? string.Empty).TrimStart('/');
}
