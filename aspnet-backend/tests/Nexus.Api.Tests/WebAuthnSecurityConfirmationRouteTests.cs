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

public sealed class WebAuthnSecurityConfirmationRouteTests
{
    [Fact]
    public void SecurityConfirmation_HasOneOwnerAndDedicatedPolicy()
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

        var matches = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText == "api/webauthn/security-confirm"
                && (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    .Contains("POST", StringComparer.OrdinalIgnoreCase) ?? false))
            .ToArray();

        matches.Should().ContainSingle();
        var limiter = matches[0].Metadata.GetMetadata<EnableRateLimitingAttribute>();
        limiter.Should().NotBeNull();
        limiter!.PolicyName.Should().Be(RateLimitingExtensions.WebAuthnSecurityConfirmPolicy);
    }
}
