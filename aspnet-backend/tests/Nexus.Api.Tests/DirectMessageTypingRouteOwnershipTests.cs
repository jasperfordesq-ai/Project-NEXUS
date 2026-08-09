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

public sealed class DirectMessageTypingRouteOwnershipTests
{
    [Fact]
    public void TypingRoutes_HaveExactlyOneOwner()
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
        var routes = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint => endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                .Select(method => $"{method.ToUpperInvariant()} {(endpoint.RoutePattern.RawText ?? "").Trim().TrimStart('/')}")
                ?? [])
            .ToList();
        routes.Count(route => route == "POST api/messages/typing").Should().Be(1);
        routes.Count(route => route == "POST api/v2/messages/typing").Should().Be(1);
    }
}
