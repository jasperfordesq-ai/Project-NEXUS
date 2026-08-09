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

public sealed class VolunteerOrganisationWalletRouteOwnershipTests
{
    [Fact]
    public void CanonicalWalletRoutes_HaveOneFocusedOwnerAndMutationRateLimits()
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

        var expected = new Dictionary<(string Method, string Template), ExpectedOwner>
        {
            [("GET", "api/v2/volunteering/organisations/{organisationId:int}/wallet")] =
                new("VolunteerOrganisationWallet", "GetWallet", RateLimitingExtensions.VolunteerOrganisationWalletReadPolicy),
            [("GET", "api/v2/volunteering/organisations/{organisationId:int}/wallet/transactions")] =
                new("VolunteerOrganisationWallet", "GetTransactions", RateLimitingExtensions.VolunteerOrganisationWalletReadPolicy),
            [("POST", "api/v2/volunteering/organisations/{organisationId:int}/wallet/deposit")] =
                new("VolunteerOrganisationWallet", "Deposit", RateLimitingExtensions.VolunteerOrganisationWalletDepositPolicy),
            [("GET", "api/v2/admin/volunteering/organizations/{organisationId:int}/wallet/transactions")] =
                new("AdminVolunteerOrganisationWallet", "GetTransactions", null),
            [("PUT", "api/v2/admin/volunteering/organizations/{organisationId:int}/wallet/adjust")] =
                new("AdminVolunteerOrganisationWallet", "Adjust", RateLimitingExtensions.VolunteerOrganisationWalletAdminAdjustPolicy),
            [("POST", "api/v2/wallet/transfer")] =
                new("V15MemberParity", "V2WalletTransfer", RateLimitingExtensions.PersonalWalletTransferPolicy),
            [("POST", "api/wallet/transfer")] =
                new("Wallet", "Transfer", RateLimitingExtensions.PersonalWalletTransferPolicy)
        };

        foreach (var (key, owner) in expected)
        {
            var matches = endpoints
                .Where(candidate => candidate.Method == key.Method && candidate.Template == key.Template)
                .ToList();
            var match = matches.Should().ContainSingle(
                $"{key.Method} {key.Template} must have exactly one focused owner; found {string.Join(", ", matches.Select(Describe))}")
                .Which;
            var action = match.Endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>();
            TrimControllerSuffix(action.ControllerTypeInfo.Name).Should().Be(owner.Controller);
            action.ActionName.Should().Be(owner.Action);
            match.Endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Should().NotBeEmpty();
            match.Endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull();

            var limiter = match.Endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>();
            if (owner.Policy is null)
                limiter.Should().BeNull();
            else
            {
                limiter.Should().NotBeNull();
                limiter!.PolicyName.Should().Be(owner.Policy);
            }
        }
    }

    private static string Normalize(string? template) =>
        (template ?? string.Empty).Trim().TrimStart('/');

    private static string TrimControllerSuffix(string typeName) =>
        typeName.EndsWith("Controller", StringComparison.Ordinal)
            ? typeName[..^"Controller".Length]
            : typeName;

    private static string Describe(OwnedEndpoint endpoint)
    {
        var action = endpoint.Endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
        return action is null
            ? endpoint.Template
            : $"{TrimControllerSuffix(action.ControllerTypeInfo.Name)}.{action.ActionName}";
    }

    private sealed record ExpectedOwner(string Controller, string Action, string? Policy);
    private sealed record OwnedEndpoint(string Method, string Template, RouteEndpoint Endpoint);
}
