// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Middleware;

namespace Nexus.Api.Tests;

public sealed class DirectMessageReadStateRouteOwnershipTests
{
    [Fact]
    public void ReadStateRoutes_HaveOneOwnerAndIndependentLaravelRatePolicies()
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

        AssertRoute(endpoints, "GET", "api/v2/messages/unread-count",
            RateLimitingExtensions.MessagesUnreadCountPolicy);
        AssertRoute(endpoints, "PUT", "api/v2/messages/{id:int}/read",
            RateLimitingExtensions.MessagesMarkReadPolicy);
    }

    private static void AssertRoute(
        IEnumerable<RouteEndpoint> endpoints,
        string method,
        string route,
        string policy)
    {
        var matches = endpoints.Where(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText?.Trim().TrimStart('/'), route, StringComparison.Ordinal)
                && (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    .Contains(method, StringComparer.OrdinalIgnoreCase) ?? false))
            .ToArray();

        matches.Should().ContainSingle();
        var rateLimit = matches[0].Metadata.GetMetadata<EnableRateLimitingAttribute>();
        rateLimit.Should().NotBeNull();
        rateLimit!.PolicyName.Should().Be(policy);
    }
}
