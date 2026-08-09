// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Middleware;

namespace Nexus.Api.Tests;

public sealed class RecurringShiftRouteOwnershipTests
{
    [Fact]
    public void CanonicalRoutes_HaveOneFocusedOwnerAuthorizationAndIndependentRatePolicies()
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
                    {
                        services.Remove(descriptor);
                    }
                });
            });

        var endpoints = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    ?? Array.Empty<string>();
                return methods.Select(method => new OwnedEndpoint(
                    method.ToUpperInvariant(),
                    Normalize(endpoint.RoutePattern.RawText),
                    endpoint));
            })
            .ToList();

        var expected = new Dictionary<(string Method, string Template), (string Action, string Policy)>
        {
            [("GET", "api/v2/volunteering/opportunities/{opportunityId:int}/recurring-patterns")] =
                ("GetPatterns", RateLimitingExtensions.RecurringPatternListPolicy),
            [("POST", "api/v2/volunteering/opportunities/{opportunityId:int}/recurring-patterns")] =
                ("CreatePattern", RateLimitingExtensions.RecurringPatternCreatePolicy),
            [("PUT", "api/v2/volunteering/recurring-patterns/{patternId:int}")] =
                ("UpdatePattern", RateLimitingExtensions.RecurringPatternUpdatePolicy),
            [("DELETE", "api/v2/volunteering/recurring-patterns/{patternId:int}")] =
                ("DeactivatePattern", RateLimitingExtensions.RecurringPatternDeletePolicy)
        };

        foreach (var (key, owner) in expected)
        {
            var match = endpoints.Should().ContainSingle(
                candidate => candidate.Method == key.Method && candidate.Template == key.Template,
                $"{key.Method} {key.Template} must have exactly one focused owner").Which;
            var action = match.Endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>();

            TrimControllerSuffix(action.ControllerTypeInfo.Name).Should().Be("ShiftManagement");
            action.ActionName.Should().Be(owner.Action);
            match.Endpoint.Metadata.GetRequiredMetadata<EnableRateLimitingAttribute>()
                .PolicyName.Should().Be(owner.Policy);
            match.Endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Should().NotBeEmpty();
            match.Endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull();
        }

        endpoints.Where(endpoint =>
                endpoint.Template.Contains("/recurring-patterns", StringComparison.Ordinal)
                && endpoint.Template.StartsWith("api/v2/", StringComparison.Ordinal))
            .Should().HaveCount(expected.Count,
                "the canonical recurring-pattern contract must expose only the four CRUD actions");

        expected.Values.Select(value => value.Policy)
            .Should().OnlyHaveUniqueItems("each action must have its own Laravel-compatible rate bucket");
    }

    private static string Normalize(string? template) =>
        (template ?? string.Empty).Trim().TrimStart('/');

    private static string TrimControllerSuffix(string typeName) =>
        typeName.EndsWith("Controller", StringComparison.Ordinal)
            ? typeName[..^"Controller".Length]
            : typeName;

    private sealed record OwnedEndpoint(string Method, string Template, RouteEndpoint Endpoint);
}
