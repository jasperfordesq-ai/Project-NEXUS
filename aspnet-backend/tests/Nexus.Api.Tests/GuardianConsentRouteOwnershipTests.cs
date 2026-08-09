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

public sealed class GuardianConsentRouteOwnershipTests
{
    [Fact]
    public void CanonicalRoutes_HaveOneFocusedOwnerAndExpectedSecurityMetadata()
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

        var expected = new Dictionary<(string Method, string Template), (string Controller, string Action, string? Policy)>
        {
            [("GET", "api/v2/volunteering/guardian-consents")] =
                ("VolunteeringParity", "GuardianConsents", RateLimitingExtensions.GuardianConsentListPolicy),
            [("POST", "api/v2/volunteering/guardian-consents")] =
                ("VolunteeringParity", "CreateGuardianConsent", RateLimitingExtensions.GuardianConsentRequestPolicy),
            [("GET", "api/v2/volunteering/guardian-consents/verify/{token}")] =
                ("VolunteeringParity", "ShowGuardianConsentVerification", RateLimitingExtensions.GuardianConsentVerifyLookupPolicy),
            [("POST", "api/v2/volunteering/guardian-consents/verify/{token}")] =
                ("VolunteeringParity", "VerifyGuardianConsent", RateLimitingExtensions.GuardianConsentVerifyPolicy),
            [("DELETE", "api/v2/volunteering/guardian-consents/{consentId:int}")] =
                ("VolunteeringParity", "DeleteGuardianConsent", RateLimitingExtensions.GuardianConsentWithdrawPolicy),
            [("GET", "api/v2/admin/volunteering/guardian-consents")] =
                ("VolunteerAdmin", "ListCanonicalGuardianConsents", null)
        };

        foreach (var (key, owner) in expected)
        {
            var match = endpoints.Should().ContainSingle(
                candidate => candidate.Method == key.Method && candidate.Template == key.Template,
                $"{key.Method} {key.Template} must have exactly one focused owner").Which;
            var action = match.Endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>();
            TrimControllerSuffix(action.ControllerTypeInfo.Name).Should().Be(owner.Controller);
            action.ActionName.Should().Be(owner.Action);

            if (owner.Policy is not null)
            {
                match.Endpoint.Metadata.GetRequiredMetadata<EnableRateLimitingAttribute>()
                    .PolicyName.Should().Be(owner.Policy);
            }
        }

        foreach (var verify in endpoints.Where(endpoint =>
                     (endpoint.Method == "GET" || endpoint.Method == "POST")
                     && endpoint.Template == "api/v2/volunteering/guardian-consents/verify/{token}"))
        {
            verify.Endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().NotBeNull(
                "the guardian's email credential is the authentication factor for the public verify action");
        }

        endpoints.Where(endpoint =>
                endpoint.Template.StartsWith("api/v2/volunteering/guardian-consents", StringComparison.Ordinal)
                || endpoint.Template == "api/v2/admin/volunteering/guardian-consents")
            .Should().HaveCount(expected.Count);
    }

    private static string Normalize(string? template) =>
        (template ?? string.Empty).Trim().TrimStart('/');

    private static string TrimControllerSuffix(string typeName) =>
        typeName.EndsWith("Controller", StringComparison.Ordinal)
            ? typeName[..^"Controller".Length]
            : typeName;

    private sealed record OwnedEndpoint(string Method, string Template, RouteEndpoint Endpoint);
}
