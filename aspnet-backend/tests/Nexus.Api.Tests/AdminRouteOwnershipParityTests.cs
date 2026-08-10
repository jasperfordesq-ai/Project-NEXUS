// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Nexus.Api.Tests;

public sealed class AdminRouteOwnershipParityTests : IClassFixture<AdminRouteOwnershipParityTests.AdminRouteFactory>
{
    private static readonly Regex RouteParameterPattern = new(
        @"\{(?<catchAll>\*{0,2})?(?<name>[^}:?=]+)(?<suffix>[^}]*)\}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly AdminRouteFactory _factory;

    public AdminRouteOwnershipParityTests(AdminRouteFactory factory)
    {
        _factory = factory;
    }

    public static TheoryData<string, string, string, string> HighRiskRouteOwners => CreateHighRiskRouteOwners();

    [Fact]
    public void AdminRouteTable_HasNoDuplicateControllerOwnersForVerbAndNormalizedTemplate()
    {
        var duplicates = GetAdminEndpoints()
            .GroupBy(endpoint => (endpoint.Method, endpoint.Shape))
            .Where(group => group.Count() > 1)
            .Select(group =>
                $"{group.Key.Method} {group.Key.Shape}: {string.Join(", ", group.Select(Describe))}")
            .OrderBy(description => description, StringComparer.Ordinal)
            .ToList();

        duplicates.Should().BeEmpty(
            "each /api/admin or /api/v2/admin verb/template must have exactly one controller owner; duplicates:{0}{1}",
            Environment.NewLine,
            string.Join(Environment.NewLine, duplicates));
    }

    [Theory]
    [MemberData(nameof(HighRiskRouteOwners))]
    public void HighRiskAdminRoute_HasExpectedSingleOwner(
        string method,
        string template,
        string expectedController,
        string expectedAction)
    {
        var normalizedMethod = method.ToUpperInvariant();
        var normalizedTemplate = Normalize(template);
        var matches = GetAdminEndpoints()
            .Where(endpoint => endpoint.Method == normalizedMethod && endpoint.Shape == normalizedTemplate)
            .ToList();

        var owner = matches.Should().ContainSingle(
            $"{normalizedMethod} {normalizedTemplate} must have one canonical controller owner; found {string.Join(", ", matches.Select(Describe))}")
            .Which;

        owner.Controller.Should().Be(expectedController);
        owner.Action.Should().Be(expectedAction);
    }

    private IReadOnlyList<OwnedAdminEndpoint> GetAdminEndpoints()
    {
        return _factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Distinct()
            .SelectMany(endpoint =>
            {
                var action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                if (action == null || methods == null)
                {
                    return Array.Empty<OwnedAdminEndpoint>();
                }

                var rawTemplate = endpoint.RoutePattern.RawText ?? string.Empty;
                var shape = Normalize(rawTemplate);
                if (!IsAdminRoute(shape))
                {
                    return Array.Empty<OwnedAdminEndpoint>();
                }

                return methods.Select(method => new OwnedAdminEndpoint(
                    method.ToUpperInvariant(),
                    shape,
                    rawTemplate,
                    endpoint.Order,
                    TrimControllerSuffix(action.ControllerTypeInfo.Name),
                    action.ActionName));
            })
            .ToList();
    }

    private static bool IsAdminRoute(string shape) =>
        shape == "api/admin" ||
        shape.StartsWith("api/admin/", StringComparison.Ordinal) ||
        shape == "api/v2/admin" ||
        shape.StartsWith("api/v2/admin/", StringComparison.Ordinal);

    private static string Normalize(string? template)
    {
        var normalized = (template ?? string.Empty).Trim().TrimStart('/').ToLowerInvariant();
        return RouteParameterPattern.Replace(
            normalized,
            match => "{" + match.Groups["catchAll"].Value + "_" + match.Groups["suffix"].Value + "}");
    }

    private static string Describe(OwnedAdminEndpoint endpoint) =>
        $"{endpoint.Controller}.{endpoint.Action} [{endpoint.RawTemplate}; order={endpoint.Order}]";

    private static string TrimControllerSuffix(string typeName) =>
        typeName.EndsWith("Controller", StringComparison.Ordinal)
            ? typeName[..^"Controller".Length]
            : typeName;

    private static TheoryData<string, string, string, string> CreateHighRiskRouteOwners()
    {
        var routes = new TheoryData<string, string, string, string>();

        AddLegacyAndV2(routes, "GET", "broker/dashboard", "AdminBroker", "Dashboard");
        AddLegacyAndV2(routes, "GET", "broker/exchanges", "AdminBroker", "Exchanges");
        AddLegacyAndV2(routes, "GET", "broker/exchanges/{id:int}", "AdminBroker", "ShowExchange");
        AddLegacyAndV2(routes, "POST", "broker/exchanges/{id:int}/approve", "AdminBroker", "ApproveExchange");
        AddLegacyAndV2(routes, "POST", "broker/exchanges/{id:int}/reject", "AdminBroker", "RejectExchange");
        AddLegacyAndV2(routes, "GET", "broker/messages", "AdminBroker", "Messages");
        AddLegacyAndV2(routes, "GET", "broker/messages/{id:int}", "AdminBroker", "ShowMessage");
        AddLegacyAndV2(routes, "POST", "broker/messages/{id:int}/review", "AdminBroker", "ReviewMessage");
        AddLegacyAndV2(routes, "POST", "broker/messages/{id:int}/approve", "AdminBroker", "ReviewMessage");
        AddLegacyAndV2(routes, "POST", "broker/messages/{id:int}/flag", "AdminBroker", "FlagMessage");
        AddLegacyAndV2(routes, "GET", "broker/risk-tags", "AdminBroker", "RiskTags");
        AddLegacyAndV2(routes, "POST", "broker/risk-tags/{listingId}", "AdminBroker", "SaveRiskTag");
        AddLegacyAndV2(routes, "DELETE", "broker/risk-tags/{listingId}", "AdminBroker", "RemoveRiskTag");
        AddLegacyAndV2(routes, "GET", "broker/messages/unreviewed-count", "AdminBroker", "UnreviewedCount");
        AddLegacyAndV2(routes, "GET", "broker/monitoring", "AdminBroker", "Monitoring");
        AddLegacyAndV2(routes, "POST", "broker/monitoring/{userId}", "AdminBroker", "SetMonitoring");
        AddLegacyAndV2(routes, "GET", "broker/configuration", "AdminBroker", "GetConfiguration");
        AddLegacyAndV2(routes, "POST", "broker/configuration", "AdminBroker", "SaveConfiguration");

        AddLegacyAndV2(routes, "GET", "newsletters/subscribers", "AdminCompatibility2", "ListSubscribers");
        AddLegacyAndV2(routes, "GET", "newsletters/send-time-optimizer", "AdminCompatibility2", "SendTimeOptimizer");
        AddLegacyAndV2(routes, "GET", "newsletters/bounce-trends", "AdminCompatibility2", "BounceTrends");
        AddLegacyAndV2(routes, "GET", "newsletters/{id:int}/activity", "AdminCompatibility2", "NewsletterActivity");
        AddLegacyAndV2(routes, "GET", "newsletters/{id:int}/openers", "AdminCompatibility2", "NewsletterOpeners");
        AddLegacyAndV2(routes, "GET", "newsletters/{id:int}/clickers", "AdminCompatibility2", "NewsletterClickers");
        AddLegacyAndV2(routes, "GET", "newsletters/{id:int}/non-openers", "AdminCompatibility2", "NewsletterNonOpeners");
        AddLegacyAndV2(routes, "GET", "newsletters/{id:int}/openers-no-click", "AdminCompatibility2", "NewsletterOpenersNoClick");
        AddLegacyAndV2(routes, "POST", "newsletters/suppression-list/{email}/unsuppress", "AdminCompatibility2", "Unsuppress");

        AddLegacyAndV2(routes, "POST", "safeguarding/flagged-messages/{id:int}/review", "AdminSafeguarding", "ReviewMessage");
        AddLegacyAndV2(routes, "DELETE", "safeguarding/assignments/{id:int}", "AdminSafeguarding", "DeleteAssignment");
        AddLegacyAndV2(routes, "GET", "safeguarding/options", "AdminSafeguarding", "Options");
        AddLegacyAndV2(routes, "POST", "safeguarding/options", "AdminSafeguarding", "CreateOption");
        AddLegacyAndV2(routes, "PUT", "safeguarding/options/reorder", "AdminSafeguarding", "ReorderOptions");
        AddLegacyAndV2(routes, "PUT", "safeguarding/options/{id:int}", "AdminSafeguarding", "UpdateOption");
        AddLegacyAndV2(routes, "DELETE", "safeguarding/options/{id:int}", "AdminSafeguarding", "DeactivateOption");
        routes.Add("GET", "api/v2/admin/vetting", "AdminSafeguardingVetting", "List");
        routes.Add("GET", "api/v2/admin/vetting/stats", "AdminSafeguardingVetting", "Stats");
        routes.Add("GET", "api/v2/admin/vetting/policy", "AdminSafeguardingVetting", "Policy");
        routes.Add("PUT", "api/v2/admin/vetting/policy", "AdminSafeguardingVetting", "UpdatePolicy");
        routes.Add("POST", "api/v2/admin/vetting/policy/rotate", "AdminSafeguardingVetting", "RotatePolicy");
        routes.Add("GET", "api/v2/admin/vetting/user/{userId:int}", "AdminSafeguardingVetting", "GetUserRecords");
        routes.Add("POST", "api/v2/admin/vetting/user/{userId:int}/confirm", "AdminSafeguardingVetting", "Confirm");
        routes.Add("POST", "api/v2/admin/vetting/user/{userId:int}/revoke", "AdminSafeguardingVetting", "Revoke");
        routes.Add("POST", "api/v2/admin/vetting/reviews/{reviewId:long}/resolve", "AdminSafeguardingVetting", "ResolveReview");
        routes.Add("GET", "api/v2/admin/vetting/{id:long}", "AdminSafeguardingVetting", "Show");
        AddLegacyAndV2(routes, "GET", "tools/seo-audit", "AdminCompatibility", "RunSeoAudit");
        AddLegacyAndV2(routes, "GET", "community-analytics/geography", "AdminCompatibility", "GetCommunityAnalyticsGeography");
        AddLegacyAndV2(routes, "POST", "federation/partnerships/{id:int}/approve", "AdminCompatibility2", "ApprovePartnership");
        AddLegacyAndV2(routes, "POST", "federation/partnerships/{id:int}/reject", "AdminCompatibility2", "RejectPartnership");
        AddLegacyAndV2(routes, "POST", "volunteering/approvals/{id:int}/approve", "AdminCompatibility2", "ApproveVolunteering");
        AddLegacyAndV2(routes, "POST", "volunteering/approvals/{id:int}/decline", "AdminCompatibility2", "DeclineVolunteering");
        AddLegacyAndV2(routes, "GET", "volunteering/organizations", "AdminExplicitParity", "Get");
        routes.Add("POST", "api/v2/admin/volunteering/organizations", "AdminExplicitParity", "Post");
        routes.Add("PUT", "api/v2/admin/volunteering/organizations/{id}", "AdminExplicitParity", "Put");
        routes.Add("PUT", "api/v2/admin/volunteering/organizations/{id}/status", "AdminExplicitParity", "Put");
        routes.Add("GET", "api/v2/admin/volunteering/organizations/{id:int}/wallet/transactions", "AdminVolunteerOrganisationWallet", "GetTransactions");
        routes.Add("PUT", "api/v2/admin/volunteering/organizations/{id:int}/wallet/adjust", "AdminVolunteerOrganisationWallet", "Adjust");
        routes.Add("GET", "api/v2/admin/volunteering/guardian-consents", "VolunteerAdmin", "ListCanonicalGuardianConsents");
        AddLegacyAndV2(routes, "PUT", "groups/{id:int}", "AdminExplicitParity", "Put");
        AddLegacyAndV2(routes, "POST", "listings/{id:int}/approve", "Admin", "ApproveListing");
        AddLegacyAndV2(routes, "POST", "users/{id:int}/suspend", "AdminCompatibility", "SuspendUser");

        routes.Add("DELETE", "api/v2/admin/events/{id:int}", "AdminEvents", "DeleteEvent");
        routes.Add("DELETE", "api/v2/admin/groups/{id:int}", "AdminGroups", "DeleteGroup");
        routes.Add("DELETE", "api/v2/admin/listings/{id:int}", "AdminCompatibility", "DeleteListing");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/approve", "AdminExplicitParity", "ApproveFederationCreditAgreement");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/reject", "AdminExplicitParity", "RejectFederationCreditAgreement");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/suspend", "AdminExplicitParity", "SuspendFederationCreditAgreement");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/activate", "AdminExplicitParity", "ActivateFederationCreditAgreement");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/reactivate", "AdminExplicitParity", "ReactivateFederationCreditAgreement");
        routes.Add("POST", "api/v2/admin/federation/credit-agreements/{id:int}/terminate", "AdminExplicitParity", "TerminateFederationCreditAgreement");

        return routes;
    }

    private static void AddLegacyAndV2(
        TheoryData<string, string, string, string> routes,
        string method,
        string relativeTemplate,
        string controller,
        string action)
    {
        routes.Add(method, $"api/admin/{relativeTemplate}", controller, action);
        routes.Add(method, $"api/v2/admin/{relativeTemplate}", controller, action);
    }

    private sealed record OwnedAdminEndpoint(
        string Method,
        string Shape,
        string RawTemplate,
        int Order,
        string Controller,
        string Action);

    public sealed class AdminRouteFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
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
        }
    }
}
