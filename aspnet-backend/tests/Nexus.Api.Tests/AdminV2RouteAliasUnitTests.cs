// Copyright 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Nexus.Api.Controllers;

namespace Nexus.Api.Tests;

public class AdminV2RouteAliasUnitTests
{
    [Fact]
    public void AdminBroker_UsesBrokerOrAdminPolicy()
    {
        typeof(AdminBrokerController)
            .GetCustomAttributes<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
            .Select(attribute => attribute.Policy)
            .Should().Contain("BrokerOrAdmin");
    }

    [Theory]
    [InlineData(typeof(AdminController), "api/v2/admin")]
    [InlineData(typeof(AdminCompatibilityController), "api/v2/admin")]
    [InlineData(typeof(AdminCompatibility2Controller), "api/v2/admin")]
    [InlineData(typeof(AdminBlogController), "api/v2/admin/blog")]
    [InlineData(typeof(AdminBrokerController), "api/v2/admin/broker")]
    public void AdminControllers_ExposeLaravelReactV2AdminPrefix(Type controllerType, string expectedRoute)
    {
        controllerType
            .GetCustomAttributes<RouteAttribute>()
            .Select(route => route.Template)
            .Should().Contain(expectedRoute);
    }

    [Theory]
    [InlineData(typeof(AdminController), "ListCategories", typeof(HttpGetAttribute), "categories")]
    [InlineData(typeof(AdminController), "CreateCategory", typeof(HttpPostAttribute), "categories")]
    [InlineData(typeof(AdminController), "UpdateCategory", typeof(HttpPutAttribute), "categories/{id:int}")]
    [InlineData(typeof(AdminController), "DeleteCategory", typeof(HttpDeleteAttribute), "categories/{id:int}")]
    [InlineData(typeof(AdminCompatibilityController), "ListAttributes", typeof(HttpGetAttribute), "attributes")]
    [InlineData(typeof(AdminCompatibilityController), "CreateAttribute", typeof(HttpPostAttribute), "attributes")]
    [InlineData(typeof(AdminCompatibilityController), "UpdateAttribute", typeof(HttpPutAttribute), "attributes/{id:int}")]
    [InlineData(typeof(AdminCompatibilityController), "DeleteAttribute", typeof(HttpDeleteAttribute), "attributes/{id:int}")]
    [InlineData(typeof(AdminCompatibilityController), "ListGamificationCampaigns", typeof(HttpGetAttribute), "gamification/campaigns")]
    [InlineData(typeof(AdminCompatibilityController), "CreateGamificationCampaign", typeof(HttpPostAttribute), "gamification/campaigns")]
    [InlineData(typeof(AdminCompatibilityController), "UpdateGamificationCampaign", typeof(HttpPutAttribute), "gamification/campaigns/{id:int}")]
    [InlineData(typeof(AdminCompatibilityController), "DeleteGamificationCampaign", typeof(HttpDeleteAttribute), "gamification/campaigns/{id:int}")]
    [InlineData(typeof(AdminCompatibilityController), "RunSeoAudit", typeof(HttpGetAttribute), "tools/seo-audit")]
    [InlineData(typeof(AdminCompatibilityController), "RunSeoAudit", typeof(HttpPostAttribute), "tools/seo-audit")]
    [InlineData(typeof(AdminCompatibilityController), "SuspendUser", typeof(HttpPostAttribute), "users/{id:int}/suspend")]
    [InlineData(typeof(AdminController), "ApproveListing", typeof(HttpPostAttribute), "listings/{id:int}/approve")]
    [InlineData(typeof(AdminBlogController), "ListPosts", typeof(HttpGetAttribute), null)]
    [InlineData(typeof(AdminBlogController), "CreatePost", typeof(HttpPostAttribute), null)]
    [InlineData(typeof(AdminBlogController), "GetPost", typeof(HttpGetAttribute), "{id:int}")]
    [InlineData(typeof(AdminBlogController), "UpdatePost", typeof(HttpPutAttribute), "{id:int}")]
    [InlineData(typeof(AdminBlogController), "DeletePost", typeof(HttpDeleteAttribute), "{id:int}")]
    [InlineData(typeof(AdminBlogController), "ToggleStatus", typeof(HttpPostAttribute), "{id:int}/toggle-status")]
    [InlineData(typeof(AdminBrokerController), "Dashboard", typeof(HttpGetAttribute), "dashboard")]
    [InlineData(typeof(AdminBrokerController), "Exchanges", typeof(HttpGetAttribute), "exchanges")]
    [InlineData(typeof(AdminBrokerController), "ShowExchange", typeof(HttpGetAttribute), "exchanges/{id:int}")]
    [InlineData(typeof(AdminBrokerController), "ApproveExchange", typeof(HttpPostAttribute), "exchanges/{id:int}/approve")]
    [InlineData(typeof(AdminBrokerController), "RejectExchange", typeof(HttpPostAttribute), "exchanges/{id:int}/reject")]
    [InlineData(typeof(AdminBrokerController), "RiskTags", typeof(HttpGetAttribute), "risk-tags")]
    [InlineData(typeof(AdminBrokerController), "SaveRiskTag", typeof(HttpPostAttribute), "risk-tags/{listingId}")]
    [InlineData(typeof(AdminBrokerController), "RemoveRiskTag", typeof(HttpDeleteAttribute), "risk-tags/{listingId}")]
    [InlineData(typeof(AdminBrokerController), "Messages", typeof(HttpGetAttribute), "messages")]
    [InlineData(typeof(AdminBrokerController), "ShowMessage", typeof(HttpGetAttribute), "messages/{id:int}")]
    [InlineData(typeof(AdminBrokerController), "UnreviewedCount", typeof(HttpGetAttribute), "messages/unreviewed-count")]
    [InlineData(typeof(AdminBrokerController), "ReviewMessage", typeof(HttpPostAttribute), "messages/{id:int}/review")]
    [InlineData(typeof(AdminBrokerController), "ReviewMessage", typeof(HttpPostAttribute), "messages/{id:int}/approve")]
    [InlineData(typeof(AdminBrokerController), "FlagMessage", typeof(HttpPostAttribute), "messages/{id:int}/flag")]
    [InlineData(typeof(AdminBrokerController), "Monitoring", typeof(HttpGetAttribute), "monitoring")]
    [InlineData(typeof(AdminBrokerController), "SetMonitoring", typeof(HttpPostAttribute), "monitoring/{userId}")]
    [InlineData(typeof(AdminBrokerController), "GetConfiguration", typeof(HttpGetAttribute), "configuration")]
    [InlineData(typeof(AdminBrokerController), "SaveConfiguration", typeof(HttpPostAttribute), "configuration")]
    [InlineData(typeof(AdminCompatibility2Controller), "BrokerArchives", typeof(HttpGetAttribute), "broker/archives")]
    [InlineData(typeof(AdminCompatibility2Controller), "BrokerArchiveDetail", typeof(HttpGetAttribute), "broker/archives/{id:int}")]
    public void LaravelReactAdminActions_HaveExpectedRouteTemplates(
        Type controllerType,
        string methodName,
        Type httpAttributeType,
        string? expectedTemplate)
    {
        var method = controllerType.GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);

        method.Should().NotBeNull();
        var templates = method!.GetCustomAttributes()
            .Where(attr => attr.GetType() == httpAttributeType)
            .Cast<HttpMethodAttribute>()
            .Select(attribute => attribute.Template);

        templates.Should().Contain(expectedTemplate);
    }
}
