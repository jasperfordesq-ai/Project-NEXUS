// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Nexus.Api.Tests;

public class GroupExchangeRouteOwnershipTests
{
    [Fact]
    public void CanonicalV2RouteTable_HasExactlyOneOwnerForEachVerbAndTemplate()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Testing");
                builder.ConfigureServices(services =>
                {
                    foreach (var descriptor in services
                                 .Where(item => item.ServiceType == typeof(IHostedService) &&
                                                item.ImplementationType?.Assembly == typeof(Program).Assembly)
                                 .ToList())
                    {
                        services.Remove(descriptor);
                    }
                });
            });

        var routes = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var template = Normalize(endpoint.RoutePattern.RawText);
                return endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    .Select(method => $"{method.ToUpperInvariant()} {template}") ?? Array.Empty<string>();
            })
            .ToList();

        var expected = new[]
        {
            "GET api/v2/group-exchanges",
            "POST api/v2/group-exchanges",
            "GET api/v2/group-exchanges/{id:int}",
            "PUT api/v2/group-exchanges/{id:int}",
            "DELETE api/v2/group-exchanges/{id:int}",
            "POST api/v2/group-exchanges/{id:int}/participants",
            "DELETE api/v2/group-exchanges/{id:int}/participants/{userId:int}",
            "POST api/v2/group-exchanges/{id:int}/start",
            "POST api/v2/group-exchanges/{id:int}/confirm",
            "POST api/v2/group-exchanges/{id:int}/complete"
        };

        foreach (var route in expected)
        {
            routes.Count(candidate => candidate == route).Should().Be(
                1,
                $"{route} must have one canonical route-table owner and no compatibility fallback");
        }

        routes.Where(route => route.Contains("api/v2/group-exchanges", StringComparison.Ordinal))
            .Should().BeEquivalentTo(expected);
    }

    private static string Normalize(string? template) =>
        (template ?? string.Empty).Trim().TrimStart('/');
}
