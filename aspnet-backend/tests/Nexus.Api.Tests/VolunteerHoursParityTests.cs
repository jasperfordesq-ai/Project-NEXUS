// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerHoursParityTests : IntegrationTestBase
{
    private const string FeatureKey = "feature.volunteering";
    private const string VerificationConfigKey = "volunteering.hours_require_verification";

    public VolunteerHoursParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public void CanonicalRoutes_HaveFocusedOwnersAuthenticationAndMemberRatePolicies()
    {
        var endpoints = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    ?? Array.Empty<string>();
                return methods.Select(method => new OwnedEndpoint(
                    method.ToUpperInvariant(),
                    NormalizeTemplate(endpoint.RoutePattern.RawText),
                    endpoint));
            })
            .ToList();

        var expected = new Dictionary<(string Method, string Template), ExpectedOwner>
        {
            [("GET", "api/v2/volunteering/hours")] =
                new("VolunteerHours", "MyHours", RateLimitingExtensions.VolunteerHoursListPolicy, false),
            [("POST", "api/v2/volunteering/hours")] =
                new("VolunteerHours", "LogHours", RateLimitingExtensions.VolunteerHoursLogPolicy, false),
            [("GET", "api/v2/volunteering/hours/summary")] =
                new("VolunteerHours", "Summary", RateLimitingExtensions.VolunteerHoursSummaryPolicy, false),
            [("GET", "api/v2/volunteering/hours/pending-review")] =
                new("VolunteerHours", "PendingReview", RateLimitingExtensions.VolunteerHoursPendingReviewPolicy, false),
            [("PUT", "api/v2/volunteering/hours/{}/verify")] =
                new("VolunteerHours", "Verify", RateLimitingExtensions.VolunteerHoursVerifyPolicy, false),
            [("GET", "api/v2/volunteering/organisations/{}/hours/pending")] =
                new("VolunteerHours", "OrganisationPending", RateLimitingExtensions.VolunteerHoursOrganisationPendingPolicy, false),
            [("GET", "api/v2/admin/volunteering/hours")] =
                new("AdminVolunteerHours", "List", null, true),
            [("POST", "api/v2/admin/volunteering/hours/{}/verify")] =
                new("AdminVolunteerHours", "Verify", null, true)
        };

        foreach (var (route, owner) in expected)
        {
            var matches = endpoints
                .Where(candidate => candidate.Method == route.Method
                    && candidate.Template == route.Template)
                .ToList();
            var match = matches.Should().ContainSingle(
                $"{route.Method} {route.Template} must have one focused owner; found {string.Join(", ", matches.Select(Describe))}")
                .Which;
            var action = match.Endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>();
            action.ControllerName.Should().Be(owner.Controller);
            action.ActionName.Should().Be(owner.Action);
            match.Endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Should().NotBeEmpty();
            match.Endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull();

            if (owner.AdminOnly)
            {
                match.Endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>()
                    .Should().Contain(data => data.Policy == "AdminOnly");
            }

            if (owner.RatePolicy is not null)
            {
                match.Endpoint.Metadata.GetRequiredMetadata<EnableRateLimitingAttribute>()
                    .PolicyName.Should().Be(owner.RatePolicy);
            }
        }
    }

    [Theory]
    [InlineData("GET", "/api/v2/volunteering/hours")]
    [InlineData("POST", "/api/v2/volunteering/hours")]
    [InlineData("GET", "/api/v2/volunteering/hours/summary")]
    [InlineData("GET", "/api/v2/volunteering/hours/pending-review")]
    [InlineData("PUT", "/api/v2/volunteering/hours/1/verify")]
    [InlineData("GET", "/api/v2/volunteering/organisations/1/hours/pending")]
    [InlineData("GET", "/api/v2/admin/volunteering/hours")]
    [InlineData("POST", "/api/v2/admin/volunteering/hours/1/verify")]
    public async Task CanonicalRoutes_RequireAuthentication(string method, string path)
    {
        ClearAuthToken();
        using var response = await SendAsync(method, path);
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task FeatureGate_BlocksAllEightRoutesAfterMemberFormRequestValidation()
    {
        await SetConfigAsync(FeatureKey, "false");

        await AuthenticateAsMemberAsync();
        foreach (var (method, path) in MemberRoutes())
        {
            using var response = await SendAsync(method, path);
            await AssertErrorAsync(response, HttpStatusCode.Forbidden, "FEATURE_DISABLED");
        }

        using (var memberOnAdminRoute = await Client.GetAsync("/api/v2/admin/volunteering/hours"))
        {
            memberOnAdminRoute.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await memberOnAdminRoute.Content.ReadAsStringAsync())
                .Should().NotContain("FEATURE_DISABLED");
        }

        await AuthenticateAsAdminAsync();
        foreach (var (method, path) in AdminRoutes())
        {
            using var response = await SendAsync(method, path);
            await AssertErrorAsync(response, HttpStatusCode.Forbidden, "FEATURE_DISABLED");
            var message = (await ReadJsonAsync(response)).GetProperty("errors")[0]
                .GetProperty("message").GetString();
            message.Should().Be("Service unavailable");
        }
    }

    [Fact]
    public async Task MemberMutationFormRequestsValidateBeforeFeatureGateAndReturnAllFieldErrors()
    {
        await SetConfigAsync(FeatureKey, "false");
        await AuthenticateAsMemberAsync();

        using (var emptyLog = await Client.PostAsJsonAsync(
                   "/api/v2/volunteering/hours",
                   new { }))
        {
            emptyLog.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            var errors = (await ReadJsonAsync(emptyLog)).GetProperty("errors").EnumerateArray().ToArray();
            errors.Select(error => error.GetProperty("field").GetString()).Should().Equal(
                "organization_id",
                "date",
                "hours");
            errors.Should().OnlyContain(error =>
                error.GetProperty("code").GetString() == "VALIDATION_ERROR");
        }

        using (var malformed = new HttpRequestMessage(HttpMethod.Post, "/api/v2/volunteering/hours")
               {
                   Content = new StringContent("{", Encoding.UTF8, "application/json")
               })
        using (var response = await Client.SendAsync(malformed))
        {
            response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
            (await ReadJsonAsync(response)).GetProperty("errors").GetArrayLength().Should().Be(3);
        }

        using (var invalidDecision = await Client.PutAsJsonAsync(
                   "/api/v2/volunteering/hours/2147483000/verify",
                   new { action = "Approve" }))
        {
            await AssertErrorAsync(
                invalidDecision,
                HttpStatusCode.UnprocessableEntity,
                "VALIDATION_ERROR",
                "action");
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("{")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("{\"action\":1}")]
    public async Task AdminVerify_InvalidJsonShapesReturnCanonicalLaravelBadRequest(string? body)
    {
        await SetConfigAsync(FeatureKey, "true");
        await AuthenticateAsAdminAsync();

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v2/admin/volunteering/hours/2147483000/verify");
        if (body is not null)
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var response = await Client.SendAsync(request);
        var responseBody = await AssertErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            "VALIDATION_ERROR",
            "action");
        AssertExactProperties(responseBody, "errors");
        var error = responseBody.GetProperty("errors")[0];
        AssertExactProperties(error, "code", "message", "field");
        error.GetProperty("message").GetString().Should().Be("Decision is required.");
        AssertV2Headers(response);
    }

    [Fact]
    public async Task AdminVerify_FeatureGateRunsBeforeCanonicalBodyValidation()
    {
        await SetConfigAsync(FeatureKey, "false");
        await AuthenticateAsAdminAsync();

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "/api/v2/admin/volunteering/hours/2147483000/verify")
        {
            Content = new StringContent("{", Encoding.UTF8, "application/json")
        };
        using var response = await Client.SendAsync(request);

        var responseBody = await AssertErrorAsync(
            response,
            HttpStatusCode.Forbidden,
            "FEATURE_DISABLED");
        responseBody.GetProperty("errors")[0].GetProperty("message").GetString()
            .Should().Be("Service unavailable");
    }

    [Theory]
    [InlineData("PUT", "/api/v2/not-a-route/volunteering/hours/1/verify")]
    [InlineData("PUT", "/api/v2/admin/volunteering/hours/1/verify")]
    [InlineData("POST", "/api/v2/volunteering/hourstuff")]
    [InlineData("GET", "/api/v2/volunteering/hours-not-real")]
    [InlineData("GET", "/api/v2/volunteering/organisations/1/extra/hours/pending")]
    [InlineData("GET", "/api/v2/volunteering/organisations/1/extra/wallet")]
    [InlineData("DELETE", "/api/v2/volunteering/opportunities/not-real/1")]
    [InlineData("PUT", "/api/v2/admin/volunteering/organizations/1/extra/wallet/adjust")]
    [InlineData("POST", "/api/v2/admin/volunteering/hours/1/verify/extra")]
    public async Task VolunteerMiddlewares_DoNotInterceptLookalikeRoutes(string method, string path)
    {
        await SetConfigAsync(FeatureKey, "false");
        await AuthenticateAsAdminAsync();

        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method is "POST" or "PUT")
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        using var response = await Client.SendAsync(request);

        var expectedStatus = method == "PUT"
            && path.Equals(
                "/api/v2/admin/volunteering/hours/1/verify",
                StringComparison.OrdinalIgnoreCase)
                ? HttpStatusCode.MethodNotAllowed
                : HttpStatusCode.NotFound;
        response.StatusCode.Should().Be(expectedStatus);
    }

    [Fact]
    public async Task InvalidLogBodyDoesNotConsumeLaravelActionRateBucket()
    {
        var scenario = await SeedEligibleScenarioAsync();
        var token = await GetAccessTokenAsync("member@test.com", TestData.Tenant1.Slug);
        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:VolunteerHours:LogPermitLimit"] = "1",
                    ["RateLimiting:VolunteerHours:LogWindowSeconds"] = "60"
                }));
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using (var invalid = await client.PostAsJsonAsync("/api/v2/volunteering/hours", new { }))
        {
            invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        }

        var payload = new
        {
            organization_id = scenario.OrganisationId,
            opportunity_id = scenario.OpportunityId,
            date = scenario.LogDate.ToString("yyyy-MM-dd"),
            hours = 1.25m
        };
        using (var accepted = await client.PostAsJsonAsync("/api/v2/volunteering/hours", payload))
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using var rejected = await client.PostAsJsonAsync("/api/v2/volunteering/hours", payload);
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        rejected.Headers.GetValues("X-RateLimit-Limit").Single().Should().Be("1");
    }

    [Fact]
    public async Task HoursMetadataPrefersResolvedTenantDomainAndNormalizesHttps()
    {
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var tenant = await db.Tenants.SingleAsync(row => row.Id == TestData.Tenant1.Id);
            tenant.Domain = "hours.custom.example/";
            await db.SaveChangesAsync();
        }

        await AuthenticateAsMemberAsync();
        using (var member = await Client.GetAsync("/api/v2/volunteering/hours"))
        {
            member.StatusCode.Should().Be(HttpStatusCode.OK);
            (await ReadJsonAsync(member)).GetProperty("meta").GetProperty("base_url")
                .GetString().Should().Be("https://hours.custom.example");
        }

        await AuthenticateAsAdminAsync();
        using var admin = await Client.GetAsync("/api/v2/admin/volunteering/hours");
        admin.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(admin)).GetProperty("meta").GetProperty("base_url")
            .GetString().Should().Be("https://hours.custom.example");
    }

    [Fact]
    public async Task PendingLog_ReturnsLaravelCreateListSummaryAndPendingShapes()
    {
        var scenario = await SeedEligibleScenarioAsync();
        await AuthenticateAsMemberAsync();

        using var create = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
        {
            organization_id = scenario.OrganisationId,
            opportunity_id = scenario.OpportunityId,
            date = scenario.LogDate.ToString("yyyy-MM-dd"),
            hours = 2.75m,
            description = "  Shelved food parcels  "
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        AssertV2Headers(create);
        var createBody = await ReadJsonAsync(create);
        AssertExactProperties(createBody, "data", "meta");
        var created = createBody.GetProperty("data");
        AssertExactProperties(created, "id", "status", "message");
        var logId = created.GetProperty("id").GetInt32();
        created.GetProperty("status").GetString().Should().Be("pending");
        created.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        using var mine = await Client.GetAsync("/api/v2/volunteering/hours");
        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        var mineBody = await ReadJsonAsync(mine);
        AssertExactProperties(mineBody, "data", "meta");
        var mineData = mineBody.GetProperty("data");
        AssertExactProperties(mineData, "items", "cursor", "has_more");
        mineData.GetProperty("cursor").ValueKind.Should().Be(JsonValueKind.Null);
        mineData.GetProperty("has_more").GetBoolean().Should().BeFalse();
        var mineRow = mineData.GetProperty("items").EnumerateArray().Should().ContainSingle().Which;
        AssertExactProperties(
            mineRow,
            "id",
            "tenant_id",
            "user_id",
            "organization_id",
            "opportunity_id",
            "caring_support_relationship_id",
            "support_recipient_id",
            "date_logged",
            "hours",
            "description",
            "status",
            "feedback",
            "assigned_to",
            "assigned_at",
            "escalated_at",
            "escalation_note",
            "created_at",
            "updated_at",
            "organization",
            "opportunity");
        mineRow.GetProperty("id").GetInt32().Should().Be(logId);
        mineRow.GetProperty("date_logged").GetString()
            .Should().Be($"{scenario.LogDate:yyyy-MM-dd}T00:00:00.000000Z");
        mineRow.GetProperty("hours").GetString().Should().Be("2.75");
        mineRow.GetProperty("description").GetString().Should().Be("Shelved food parcels");
        mineRow.GetProperty("status").GetString().Should().Be("pending");
        mineRow.GetProperty("caring_support_relationship_id").ValueKind.Should().Be(JsonValueKind.Null);
        mineRow.GetProperty("support_recipient_id").ValueKind.Should().Be(JsonValueKind.Null);
        AssertExactProperties(mineRow.GetProperty("organization"), "id", "name");
        mineRow.GetProperty("organization").GetProperty("id").GetInt32().Should().Be(scenario.OrganisationId);
        mineRow.GetProperty("organization").GetProperty("name").GetString().Should().Be(scenario.OrganisationName);
        AssertExactProperties(mineRow.GetProperty("opportunity"), "id", "title");
        mineRow.GetProperty("opportunity").GetProperty("id").GetInt32().Should().Be(scenario.OpportunityId);

        using var summary = await Client.GetAsync("/api/v2/volunteering/hours/summary");
        summary.StatusCode.Should().Be(HttpStatusCode.OK);
        var summaryData = (await ReadJsonAsync(summary)).GetProperty("data");
        AssertExactProperties(
            summaryData,
            "total_verified",
            "total_pending",
            "total_declined",
            "by_organization",
            "by_month",
            "total_approved_hours",
            "pending_hours",
            "this_month_hours",
            "total_entries");
        summaryData.GetProperty("total_verified").GetDecimal().Should().Be(0m);
        summaryData.GetProperty("total_pending").GetDecimal().Should().Be(2.75m);
        summaryData.GetProperty("total_declined").GetDecimal().Should().Be(0m);
        summaryData.GetProperty("total_approved_hours").GetDecimal().Should().Be(0m);
        summaryData.GetProperty("pending_hours").GetDecimal().Should().Be(2.75m);
        summaryData.GetProperty("this_month_hours").GetDecimal().Should().Be(0m);
        summaryData.GetProperty("total_entries").GetInt32().Should().Be(1);
        summaryData.GetProperty("by_organization").GetArrayLength().Should().Be(0);
        summaryData.GetProperty("by_month").GetArrayLength().Should().Be(0);

        await AuthenticateAsAdminAsync();
        using var pendingReview = await Client.GetAsync("/api/v2/volunteering/hours/pending-review");
        pendingReview.StatusCode.Should().Be(HttpStatusCode.OK);
        var pendingData = (await ReadJsonAsync(pendingReview)).GetProperty("data");
        AssertExactProperties(pendingData, "items", "cursor", "has_more");
        var pendingRow = pendingData.GetProperty("items").EnumerateArray().Should().ContainSingle().Which;
        AssertPendingRow(pendingRow, logId, scenario.OpportunityId, includeOrganisation: true);
        AssertExactProperties(pendingRow.GetProperty("user"), "id", "name", "avatar_url");
        AssertExactProperties(pendingRow.GetProperty("organization"), "id", "name", "logo_url");
        pendingRow.GetProperty("organization").GetProperty("id").GetInt32()
            .Should().Be(scenario.OrganisationId);

        using var organisationPending = await Client.GetAsync(
            $"/api/v2/volunteering/organisations/{scenario.OrganisationId}/hours/pending");
        organisationPending.StatusCode.Should().Be(HttpStatusCode.OK);
        var organisationBody = await ReadJsonAsync(organisationPending);
        var organisationRow = organisationBody.GetProperty("data").EnumerateArray()
            .Should().ContainSingle().Which;
        AssertPendingRow(organisationRow, logId, scenario.OpportunityId, includeOrganisation: false);
        AssertExactProperties(organisationRow.GetProperty("user"), "id", "name", "avatar_url");
        organisationBody.GetProperty("meta").GetProperty("per_page").GetInt32().Should().Be(20);
        organisationBody.GetProperty("meta").GetProperty("has_more").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task LogHours_EnforcesEligibilityTenantIsolationAndDuplicateNaturalKey()
    {
        var eligible = await SeedEligibleScenarioAsync();
        int unrelatedOrganisationId;
        int otherTenantOrganisationId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var unrelated = NewOrganisation(
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Unrelated volunteer organisation");
            var otherTenant = NewOrganisation(
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Other tenant volunteer organisation");
            db.VolunteerOrganisations.AddRange(unrelated, otherTenant);
            await db.SaveChangesAsync();
            unrelatedOrganisationId = unrelated.Id;
            otherTenantOrganisationId = otherTenant.Id;
        }

        await AuthenticateAsMemberAsync();
        using (var missingOrganisation = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = -1,
                   date = eligible.LogDate.ToString("yyyy-MM-dd"),
                   hours = 1m
               }))
        {
            await AssertErrorAsync(
                missingOrganisation,
                HttpStatusCode.NotFound,
                "NOT_FOUND",
                "organization_id");
        }

        using (var missingOpportunity = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = eligible.OrganisationId,
                   opportunity_id = -1,
                   date = eligible.LogDate.ToString("yyyy-MM-dd"),
                   hours = 1m
               }))
        {
            await AssertErrorAsync(
                missingOpportunity,
                HttpStatusCode.NotFound,
                "NOT_FOUND",
                "opportunity_id");
        }

        using (var zeroOpportunity = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = eligible.OrganisationId,
                   opportunity_id = 0,
                   date = eligible.LogDate.AddDays(-1).ToString("yyyy-MM-dd"),
                   hours = 1m
               }))
        {
            zeroOpportunity.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using (var ineligible = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = unrelatedOrganisationId,
                   date = eligible.LogDate.ToString("yyyy-MM-dd"),
                   hours = 1m
               }))
        {
            await AssertErrorAsync(ineligible, HttpStatusCode.Forbidden, "FORBIDDEN", "organization_id");
        }

        using (var crossTenant = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = otherTenantOrganisationId,
                   date = eligible.LogDate.ToString("yyyy-MM-dd"),
                   hours = 1m
               }))
        {
            await AssertErrorAsync(crossTenant, HttpStatusCode.NotFound, "NOT_FOUND", "organization_id");
        }

        var payload = new
        {
            organization_id = eligible.OrganisationId,
            opportunity_id = eligible.OpportunityId,
            date = eligible.LogDate.ToString("yyyy-MM-dd"),
            hours = 1.25m,
            description = "Eligible shift"
        };
        using var accepted = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", payload);
        accepted.StatusCode.Should().Be(HttpStatusCode.Created);
        using var duplicate = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", payload);
        await AssertErrorAsync(duplicate, HttpStatusCode.Conflict, "ALREADY_EXISTS");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerLogs.IgnoreQueryFilters().CountAsync(log =>
            log.TenantId == TestData.Tenant1.Id
            && log.UserId == TestData.MemberUser.Id
            && log.OrganizationId == eligible.OrganisationId
            && log.OpportunityId == eligible.OpportunityId
            && log.DateLogged == eligible.LogDate)).Should().Be(1);
    }

    [Fact]
    public async Task OrganisationPending_AllowsTenantAdministratorWithoutOrganisationMembership()
    {
        var scenario = await SeedEligibleScenarioAsync(ownerUserId: TestData.MemberUser.Id);
        var logId = await AddLogAsync(scenario, "pending", 1.25m);

        await AuthenticateAsAdminAsync();
        using var response = await Client.GetAsync(
            $"/api/v2/volunteering/organisations/{scenario.OrganisationId}/hours/pending");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var row = (await ReadJsonAsync(response)).GetProperty("data").EnumerateArray()
            .Should().ContainSingle().Which;
        row.GetProperty("id").GetInt32().Should().Be(logId);
    }

    [Fact]
    public async Task OrganisationPending_RateLimitUsesItsOwnConfiguredLimitAndCanonical429Headers()
    {
        var scenario = await SeedEligibleScenarioAsync(ownerUserId: TestData.MemberUser.Id);
        await AddLogAsync(scenario, "pending", 1.25m);
        var token = await GetAccessTokenAsync("admin@test.com", TestData.Tenant1.Slug);

        using var limitedFactory = Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RateLimiting:VolunteerHours:OrganisationPendingPermitLimit"] = "2",
                    ["RateLimiting:VolunteerHours:OrganisationPendingWindowSeconds"] = "60",
                    ["RateLimiting:VolunteerHours:PendingReviewPermitLimit"] = "97"
                }));
            builder.ConfigureServices(services =>
            {
                foreach (var hostedService in services
                             .Where(descriptor => descriptor.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService)
                                 && descriptor.ImplementationType?.Assembly == typeof(Program).Assembly)
                             .ToList())
                {
                    services.Remove(hostedService);
                }
            });
        });
        using var client = limitedFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var path = $"/api/v2/volunteering/organisations/{scenario.OrganisationId}/hours/pending";

        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var accepted = await client.GetAsync(path);
            accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var rejected = await client.GetAsync(path);
        rejected.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        rejected.Headers.GetValues("X-RateLimit-Limit").Single().Should().Be("2");
        rejected.Headers.GetValues("X-RateLimit-Remaining").Single().Should().Be("0");
        rejected.Headers.Contains("X-RateLimit-Reset").Should().BeTrue();
        rejected.Headers.RetryAfter.Should().NotBeNull();
        AssertV2Headers(rejected);
        (await ReadJsonAsync(rejected)).GetProperty("code").GetString()
            .Should().Be("RATE_LIMIT_EXCEEDED");
    }

    [Fact]
    public async Task LogHours_RejectsOpportunityFromAnotherOrganisationInSameTenant()
    {
        var selected = await SeedEligibleScenarioAsync(logDateOffset: -12);
        var other = await SeedEligibleScenarioAsync(logDateOffset: -13);

        await AuthenticateAsMemberAsync();
        using var response = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
        {
            organization_id = selected.OrganisationId,
            opportunity_id = other.OpportunityId,
            date = selected.LogDate.ToString("yyyy-MM-dd"),
            hours = 1m
        });
        await AssertErrorAsync(response, HttpStatusCode.NotFound, "NOT_FOUND", "opportunity_id");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().CountAsync(log =>
            log.TenantId == TestData.Tenant1.Id
            && log.UserId == selected.VolunteerUserId
            && log.OrganizationId == selected.OrganisationId
            && log.OpportunityId == other.OpportunityId)).Should().Be(0);
    }

    [Fact]
    public async Task LogHours_RejectsCommaDecimalButAcceptsFlexibleDateAndStoresBlankDescription()
    {
        var scenario = await SeedEligibleScenarioAsync();
        var flexibleDate = scenario.LogDate.ToString("yyyy/MM/dd");
        await AuthenticateAsMemberAsync();

        using (var commaDecimal = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
               {
                   organization_id = scenario.OrganisationId,
                   opportunity_id = scenario.OpportunityId,
                   date = flexibleDate,
                   hours = "1,5",
                   description = "Comma decimal must not be treated as fifteen hours"
               }))
        {
            await AssertErrorAsync(
                commaDecimal,
                HttpStatusCode.UnprocessableEntity,
                "VALIDATION_ERROR",
                "hours");
        }

        using var accepted = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
        {
            organization_id = scenario.OrganisationId,
            opportunity_id = scenario.OpportunityId,
            date = flexibleDate,
            hours = "1.5",
            description = "   "
        });
        accepted.StatusCode.Should().Be(HttpStatusCode.Created);
        var logId = (await ReadJsonAsync(accepted)).GetProperty("data").GetProperty("id").GetInt32();

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId);
        stored.DateLogged.Should().Be(scenario.LogDate);
        stored.Hours.Should().Be(1.5m);
        stored.Description.Should().Be(string.Empty);
    }

    [Fact]
    public async Task LogHours_OrganisationZeroReturnsLaravelBadRequestWithoutWriting()
    {
        await AuthenticateAsMemberAsync();

        using var response = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
        {
            organization_id = 0,
            date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1).ToString("yyyy-MM-dd"),
            hours = 1m
        });
        await AssertErrorAsync(
            response,
            HttpStatusCode.BadRequest,
            "VALIDATION_ERROR",
            "organization_id");

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task VerifyActions_RejectNonStringCaseAndWhitespaceForMemberAndAdminRoutes()
    {
        var scenario = await SeedEligibleScenarioAsync();
        var logId = await AddLogAsync(scenario, "pending", 1.25m);
        await AuthenticateAsAdminAsync();
        var invalidBodies = new[]
        {
            "{\"action\":\"Approve\"}",
            "{\"action\":\" approve \"}",
            "{\"action\":1}",
            "{\"action\":true}"
        };

        foreach (var body in invalidBodies)
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Put,
                $"/api/v2/volunteering/hours/{logId}/verify")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
            using var response = await Client.SendAsync(request);
            await AssertErrorAsync(
                response,
                HttpStatusCode.UnprocessableEntity,
                "VALIDATION_ERROR",
                "action");
        }

        foreach (var body in invalidBodies)
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"/api/v2/admin/volunteering/hours/{logId}/verify")
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
            using var response = await Client.SendAsync(request);
            await AssertErrorAsync(
                response,
                HttpStatusCode.BadRequest,
                "VALIDATION_ERROR",
                "action");
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("pending");
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        (await db.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour && row.ReferenceId == logId)).Should().Be(0);
    }

    [Fact]
    public async Task MemberVerify_ApprovesPaysWholeHoursAndLeavesQrEvidenceUntouched()
    {
        var scenario = await SeedEligibleScenarioAsync(includeQrEvidence: true, organisationBalance: 1m);
        var logId = await AddLogAsync(scenario, "pending", 2.75m);
        var qrBefore = await QrSnapshotAsync(scenario.QrCheckInId!.Value);
        var balanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);

        await AuthenticateAsAdminAsync();
        using var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        AssertExactProperties(data, "id", "status", "payment_result");
        data.GetProperty("id").GetInt32().Should().Be(logId);
        data.GetProperty("status").GetString().Should().Be("approved");
        data.GetProperty("payment_result").GetString().Should().Be("paid");

        await AssertPaidAsync(scenario, logId, 2m, expectedOrganisationBalance: -1m);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(balanceBefore + 2m);
        (await QrSnapshotAsync(scenario.QrCheckInId.Value)).Should().Be(qrBefore);

        using var feedScope = Factory.Services.CreateScope();
        var feedDb = feedScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var activity = await feedDb.FeedActivities.IgnoreQueryFilters().SingleAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.UserId == scenario.VolunteerUserId
            && row.SourceType == FeedActivitySourceTypes.VolunteerHours
            && row.SourceId == logId);
        activity.Content.Should().BeNull("organisation-facing log text is never broadcast");
        using var metadata = JsonDocument.Parse(activity.Metadata!);
        metadata.RootElement.GetProperty("vol_log_id").GetInt32().Should().Be(logId);
        metadata.RootElement.GetProperty("hours").GetDecimal().Should().Be(2.75m);
        metadata.RootElement.TryGetProperty("description", out _).Should().BeFalse();

        using var feedResponse = await Client.GetAsync("/api/v2/feed?page=1&limit=100");
        feedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var feedText = await feedResponse.Content.ReadAsStringAsync();
        feedText.Should().NotContain("pending parity evidence");
        using var feedDocument = JsonDocument.Parse(feedText);
        var feedItem = feedDocument.RootElement.GetProperty("data")
            .EnumerateArray()
            .Single(item => item.GetProperty("type").GetString() == FeedActivitySourceTypes.VolunteerHours
                && item.GetProperty("id").GetInt32() == logId);
        feedItem.GetProperty("title").GetString().Should().Be("Volunteered 2.75 hours");
        feedItem.GetProperty("content").ValueKind.Should().Be(JsonValueKind.Null);
        feedItem.GetProperty("hours").GetDecimal().Should().Be(2.75m);
        feedItem.GetProperty("author").GetProperty("id").GetInt32().Should().Be(scenario.VolunteerUserId);
        feedItem.TryGetProperty("created_at", out _).Should().BeTrue();
        feedItem.TryGetProperty("description", out _).Should().BeFalse();
        feedItem.TryGetProperty("metadata", out _).Should().BeFalse();
    }

    [Fact]
    public async Task MemberVerify_RespectsVolunteerPublicHoursOptOut()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 4m);
        var logId = await AddLogAsync(scenario, "pending", 1.25m);
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var volunteer = await db.Users.IgnoreQueryFilters()
                .SingleAsync(user => user.TenantId == TestData.Tenant1.Id
                    && user.Id == scenario.VolunteerUserId);
            volunteer.ShowOnLeaderboard = false;
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.FeedActivities.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.SourceType == FeedActivitySourceTypes.VolunteerHours
            && row.SourceId == logId)).Should().Be(0);

        using var feedResponse = await Client.GetAsync("/api/v2/feed?page=1&limit=100");
        feedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        using var feedDocument = JsonDocument.Parse(await feedResponse.Content.ReadAsStringAsync());
        feedDocument.RootElement.GetProperty("data")
            .EnumerateArray()
            .Should().NotContain(item =>
                item.GetProperty("type").GetString() == FeedActivitySourceTypes.VolunteerHours
                && item.GetProperty("id").GetInt32() == logId);
    }

    [Fact]
    public async Task MemberVerify_SubHourApprovalAwardsXpWithoutCreatingEitherLedger()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 6m);
        var logId = await AddLogAsync(scenario, "pending", 0.75m);
        int xpBefore;
        using (var baseline = Factory.Services.CreateScope())
        {
            var db = baseline.ServiceProvider.GetRequiredService<NexusDbContext>();
            xpBefore = await db.Users.IgnoreQueryFilters()
                .Where(user => user.Id == scenario.VolunteerUserId)
                .Select(user => user.TotalXp)
                .SingleAsync();
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("status").GetString().Should().Be("approved");
        data.GetProperty("payment_result").GetString().Should().Be("no_whole_hours");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("approved");
        (await verifyDb.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(org =>
            org.Id == scenario.OrganisationId)).Balance.Should().Be(6m);
        (await verifyDb.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        (await verifyDb.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        var xp = await verifyDb.XpLogs.IgnoreQueryFilters().SingleAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.Source == XpLog.Sources.VolunteerHour
            && row.ReferenceId == logId);
        xp.UserId.Should().Be(scenario.VolunteerUserId);
        xp.Amount.Should().Be(15);
        var badgeXp = await verifyDb.XpLogs.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.UserId == scenario.VolunteerUserId
                && row.Source == XpLog.Sources.BadgeEarned)
            .SumAsync(row => row.Amount);
        badgeXp.Should().Be(55,
            "Laravel reruns every eligible badge family after volunteer-hour XP");
        (await verifyDb.Users.IgnoreQueryFilters().SingleAsync(user =>
            user.Id == scenario.VolunteerUserId)).TotalXp.Should().Be(xpBefore + 15 + badgeXp);
        var notification = await verifyDb.Notifications.IgnoreQueryFilters().SingleAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.UserId == scenario.VolunteerUserId
            && row.Type == "vol_hours_approved"
            && row.Data != null
            && row.Data.Contains($"\"vol_log_id\":{logId}"));
        notification.Body.Should().Contain("no time credit was added");
        notification.Link.Should().Be("/volunteering?tab=hours");
    }

    [Fact]
    public async Task MemberVerify_CorruptPayoutEvidenceRefusesApprovalAndRollsBackNewXp()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 7m);
        var logId = await AddLogAsync(scenario, "pending", 2.75m);
        int xpBefore;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            xpBefore = await db.Users.IgnoreQueryFilters()
                .Where(user => user.Id == scenario.VolunteerUserId)
                .Select(user => user.TotalXp)
                .SingleAsync();
            db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
            {
                TenantId = TestData.Tenant1.Id,
                VolunteerOrganisationId = scenario.OrganisationId,
                UserId = scenario.VolunteerUserId,
                VolunteerLogId = logId,
                Type = "volunteer_payment",
                Amount = -1m,
                BalanceAfter = 6m,
                Description = "Deliberately corrupt volunteer payout evidence",
                CreatedAt = DateTime.UtcNow.AddMinutes(-1)
            });
            db.Transactions.Add(new Transaction
            {
                TenantId = TestData.Tenant1.Id,
                SenderId = null,
                ReceiverId = scenario.VolunteerUserId,
                Amount = 1m,
                Description = "Deliberately corrupt volunteer mint evidence",
                TransactionType = "volunteer",
                VolunteerLogId = logId,
                Status = TransactionStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddMinutes(-1),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-1)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        await AssertErrorAsync(response, HttpStatusCode.InternalServerError, "SERVER_ERROR");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("pending");
        (await verifyDb.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(org =>
            org.Id == scenario.OrganisationId)).Balance.Should().Be(7m);
        (await verifyDb.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(1);
        (await verifyDb.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(1);
        (await verifyDb.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour && row.ReferenceId == logId)).Should().Be(0);
        (await verifyDb.Users.IgnoreQueryFilters().SingleAsync(user =>
            user.Id == scenario.VolunteerUserId)).TotalXp.Should().Be(xpBefore);
    }

    [Fact]
    public async Task MemberVerify_CorruptXpEvidenceRefusesApprovalWithoutCreatingPayouts()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 7m);
        var logId = await AddLogAsync(scenario, "pending", 2.75m);
        int xpBefore;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            xpBefore = await db.Users.IgnoreQueryFilters()
                .Where(user => user.Id == scenario.VolunteerUserId)
                .Select(user => user.TotalXp)
                .SingleAsync();
            db.XpLogs.Add(new XpLog
            {
                TenantId = TestData.Tenant1.Id,
                UserId = scenario.VolunteerUserId,
                Amount = 1,
                Source = XpLog.Sources.VolunteerHour,
                ReferenceId = logId,
                Description = "Deliberately corrupt volunteer XP evidence",
                CreatedAt = DateTime.UtcNow.AddMinutes(-1)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.PutAsJsonAsync(
            $"/api/v2/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        await AssertErrorAsync(response, HttpStatusCode.InternalServerError, "SERVER_ERROR");

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("pending");
        (await verifyDb.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(org =>
            org.Id == scenario.OrganisationId)).Balance.Should().Be(7m);
        (await verifyDb.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        (await verifyDb.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(0);
        var corruptXp = await verifyDb.XpLogs.IgnoreQueryFilters().SingleAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour && row.ReferenceId == logId);
        corruptXp.Amount.Should().Be(1);
        (await verifyDb.Users.IgnoreQueryFilters().SingleAsync(user =>
            user.Id == scenario.VolunteerUserId)).TotalXp.Should().Be(xpBefore);
    }

    [Fact]
    public async Task MemberVerify_RejectsSelfApprovalAndSuspendedApprovalButAllowsDecline()
    {
        var selfScenario = await SeedEligibleScenarioAsync(ownerUserId: TestData.MemberUser.Id);
        var selfLogId = await AddLogAsync(selfScenario, "pending", 1.5m);
        await AuthenticateAsMemberAsync();
        using (var self = await Client.PutAsJsonAsync(
                   $"/api/v2/volunteering/hours/{selfLogId}/verify",
                   new { action = "approve" }))
        {
            await AssertErrorAsync(self, HttpStatusCode.Forbidden, "FORBIDDEN");
        }

        var suspendedScenario = await SeedEligibleScenarioAsync(
            organisationStatus: "suspended",
            logDateOffset: -5);
        var suspendedLogId = await AddLogAsync(suspendedScenario, "pending", 3.25m);
        await AuthenticateAsAdminAsync();
        using (var approve = await Client.PutAsJsonAsync(
                   $"/api/v2/volunteering/hours/{suspendedLogId}/verify",
                   new { action = "approve" }))
        {
            await AssertErrorAsync(approve, HttpStatusCode.BadRequest, "ORG_NOT_ACTIVE");
        }

        using (var decline = await Client.PutAsJsonAsync(
                   $"/api/v2/volunteering/hours/{suspendedLogId}/verify",
                   new { action = "decline" }))
        {
            decline.StatusCode.Should().Be(HttpStatusCode.OK);
            var data = (await ReadJsonAsync(decline)).GetProperty("data");
            data.GetProperty("status").GetString().Should().Be("declined");
            data.GetProperty("payment_result").ValueKind.Should().Be(JsonValueKind.Null);
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == selfLogId))
            .Status.Should().Be("pending");
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == suspendedLogId))
            .Status.Should().Be("declined");
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == selfLogId || row.VolunteerLogId == suspendedLogId)).Should().Be(0);
        (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour
            && (row.ReferenceId == selfLogId || row.ReferenceId == suspendedLogId))).Should().Be(0);
    }

    [Fact]
    public async Task AdminList_ReturnsLaravelPaymentStatsAndAdminVerifyPaysThePendingLog()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 5m);
        int pendingId;
        int approvedId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var pending = NewLog(scenario, "pending", 2.75m, -4);
            var approved = NewLog(scenario, "approved", 1.5m, -5);
            var declined = NewLog(scenario, "declined", 0.5m, -6);
            db.VolunteerLogs.AddRange(pending, approved, declined);
            await db.SaveChangesAsync();
            pendingId = pending.Id;
            approvedId = approved.Id;
            db.VolunteerOrganisationTransactions.Add(new VolunteerOrganisationTransaction
            {
                TenantId = TestData.Tenant1.Id,
                VolunteerOrganisationId = scenario.OrganisationId,
                UserId = TestData.MemberUser.Id,
                VolunteerLogId = approved.Id,
                Type = "volunteer_payment",
                Amount = -1m,
                BalanceAfter = 4m,
                Description = "Prior approved payout",
                CreatedAt = DateTime.UtcNow.AddDays(-5)
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        using var list = await Client.GetAsync("/api/v2/admin/volunteering/hours?status=pending");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listBody = await ReadJsonAsync(list);
        AssertExactProperties(listBody, "data", "meta");
        var listData = listBody.GetProperty("data");
        AssertExactProperties(listData, "items", "stats", "meta");
        var item = listData.GetProperty("items").EnumerateArray().Should().ContainSingle().Which;
        AssertExactProperties(
            item,
            "id",
            "hours",
            "status",
            "created_at",
            "paid",
            "paid_amount",
            "first_name",
            "last_name",
            "org_name");
        item.GetProperty("id").GetInt32().Should().Be(pendingId);
        item.GetProperty("hours").GetString().Should().Be("2.75");
        item.GetProperty("created_at").GetString().Should().MatchRegex(
            "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$");
        item.GetProperty("paid").GetInt32().Should().Be(0);
        item.GetProperty("paid_amount").GetString().Should().Be("0.00");
        item.GetProperty("first_name").GetString().Should().Be(TestData.MemberUser.FirstName);
        item.GetProperty("last_name").GetString().Should().Be(TestData.MemberUser.LastName);
        item.GetProperty("org_name").GetString().Should().Be(scenario.OrganisationName);

        var stats = listData.GetProperty("stats");
        AssertExactProperties(stats, "total_hours", "approved_hours", "pending_hours", "total_paid");
        stats.GetProperty("total_hours").GetDecimal().Should().Be(4.8m);
        stats.GetProperty("approved_hours").GetDecimal().Should().Be(1.5m);
        stats.GetProperty("pending_hours").GetDecimal().Should().Be(2.8m);
        stats.GetProperty("total_paid").GetDecimal().Should().Be(1m);
        var innerMeta = listData.GetProperty("meta");
        AssertExactProperties(innerMeta, "per_page", "has_more", "next_cursor");
        innerMeta.GetProperty("per_page").GetInt32().Should().Be(20);
        innerMeta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        innerMeta.GetProperty("next_cursor").ValueKind.Should().Be(JsonValueKind.Null);
        listBody.GetProperty("meta").GetProperty("next_cursor").ValueKind.Should().Be(JsonValueKind.Null);

        using var verify = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/hours/{pendingId}/verify",
            new { action = "approve" });
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        var verifyData = (await ReadJsonAsync(verify)).GetProperty("data");
        AssertExactProperties(verifyData, "id", "status", "paid", "payment_outcome");
        verifyData.GetProperty("id").GetInt32().Should().Be(pendingId);
        verifyData.GetProperty("status").GetString().Should().Be("approved");
        verifyData.GetProperty("paid").GetBoolean().Should().BeTrue();
        verifyData.GetProperty("payment_outcome").GetString().Should().Be("paid");

        using var stored = Factory.Services.CreateScope();
        var storedDb = stored.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await storedDb.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == approvedId))
            .Status.Should().Be("approved");
        (await storedDb.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == pendingId && row.Type == "volunteer_payment")).Should().Be(1);
    }

    [Fact]
    public async Task AdminVerify_RejectsMemberAndSelfApproval()
    {
        var memberLogScenario = await SeedEligibleScenarioAsync();
        var memberLogId = await AddLogAsync(memberLogScenario, "pending", 1m);

        await AuthenticateAsMemberAsync();
        using (var member = await Client.PostAsJsonAsync(
                   $"/api/v2/admin/volunteering/hours/{memberLogId}/verify",
                   new { action = "approve" }))
        {
            member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        var adminLogScenario = await SeedEligibleScenarioAsync(
            volunteerUserId: TestData.AdminUser.Id,
            ownerUserId: TestData.MemberUser.Id,
            logDateOffset: -8);
        var adminLogId = await AddLogAsync(adminLogScenario, "pending", 1m);
        await AuthenticateAsAdminAsync();
        using var self = await Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/hours/{adminLogId}/verify",
            new { action = "approve" });
        await AssertErrorAsync(self, HttpStatusCode.Forbidden, "FORBIDDEN");

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == adminLogId))
            .Status.Should().Be("pending");
    }

    [Fact]
    public async Task DisabledVerification_AutoApprovesAndPaysEvenWhenOrganisationWalletGoesNegative()
    {
        await SetConfigAsync(VerificationConfigKey, "false");
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 0m);
        var balanceBefore = await PersonalBalanceAsync(TestData.MemberUser.Id);
        await AuthenticateAsMemberAsync();

        using var response = await Client.PostAsJsonAsync("/api/v2/volunteering/hours", new
        {
            organization_id = scenario.OrganisationId,
            opportunity_id = scenario.OpportunityId,
            date = scenario.LogDate.ToString("yyyy-MM-dd"),
            hours = 3.9m,
            description = "Auto-approved community shift"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("status").GetString().Should().Be("approved");
        var logId = data.GetProperty("id").GetInt32();

        await AssertPaidAsync(scenario, logId, 3m, expectedOrganisationBalance: -3m);
        (await PersonalBalanceAsync(TestData.MemberUser.Id)).Should().Be(balanceBefore + 3m);
    }

    [Fact]
    public async Task ConcurrentAdminApprovals_HaveOneWinnerAndExactlyOnePayout()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 0m);
        var logId = await AddLogAsync(scenario, "pending", 3.9m);
        await AuthenticateAsAdminAsync();

        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync(
                $"/api/v2/admin/volunteering/hours/{logId}/verify",
                new { action = "approve" }),
            Client.PostAsJsonAsync(
                $"/api/v2/admin/volunteering/hours/{logId}/verify",
                new { action = "approve" }));

        responses.Select(response => response.StatusCode).Should().BeEquivalentTo(
            new[] { HttpStatusCode.OK, HttpStatusCode.UnprocessableEntity });
        var rejected = responses.Single(response => response.StatusCode == HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(rejected, HttpStatusCode.UnprocessableEntity, "VALIDATION_ERROR");

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("approved");
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId && row.Type == "volunteer_payment")).Should().Be(1);
        (await db.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.TransactionType == "volunteer"
            && row.VolunteerLogId == logId
            && row.ReceiverId == TestData.MemberUser.Id
            && row.Amount == 3m)).Should().Be(1);
        (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.Source == XpLog.Sources.VolunteerHour
            && row.ReferenceId == logId)).Should().Be(1);
        (await db.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(row =>
            row.Id == scenario.OrganisationId)).Balance.Should().Be(-3m);
    }

    [Fact]
    public async Task ConcurrentMemberApprovals_ReturnPaidAndAlreadyProcessedWithOnePayout()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 0m);
        var logId = await AddLogAsync(scenario, "pending", 3.9m);
        await AuthenticateAsAdminAsync();

        using var lockScope = Factory.Services.CreateScope();
        var lockDb = lockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var heldLock = await lockDb.Database.BeginTransactionAsync();
        await lockDb.VolunteerLogs
            .FromSqlInterpolated(
                $"SELECT * FROM vol_logs WHERE id = {logId} AND tenant_id = {TestData.Tenant1.Id} FOR UPDATE")
            .IgnoreQueryFilters()
            .SingleAsync();

        var requests = new[]
        {
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/hours/{logId}/verify",
                new { action = "approve" }),
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/hours/{logId}/verify",
                new { action = "approve" })
        };
        var contended = await WaitForBlockedVolunteerHourRequestsAsync(lockDb, 1);
        await heldLock.CommitAsync();
        var responses = await Task.WhenAll(requests);

        contended.Should().BeTrue("at least one approval must contend on the locked pending row");
        var paymentOutcomes = new List<string?>();
        foreach (var response in responses)
        {
            response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
            var payload = await ReadJsonAsync(response);
            if (response.StatusCode == HttpStatusCode.OK)
            {
                var data = payload.GetProperty("data");
                data.GetProperty("status").GetString().Should().Be("approved");
                paymentOutcomes.Add(data.GetProperty("payment_result").GetString());
            }
            else
            {
                payload.GetProperty("errors")[0].GetProperty("code").GetString()
                    .Should().Be("VALIDATION_ERROR");
            }
        }

        paymentOutcomes.Should().ContainSingle(outcome => outcome == "paid");
        paymentOutcomes.Where(outcome => outcome != "paid")
            .Should().OnlyContain(outcome => outcome == "already_processed");

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == logId))
            .Status.Should().Be("approved");
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(1);
        (await db.Transactions.IgnoreQueryFilters().CountAsync(row =>
            row.VolunteerLogId == logId)).Should().Be(1);
        (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour && row.ReferenceId == logId)).Should().Be(1);
        (await db.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(org =>
            org.Id == scenario.OrganisationId)).Balance.Should().Be(-3m);
    }

    [Fact]
    public async Task OpposingMemberReviews_ReturnActionStatusesAndApplyPersistedWinnerEffectsOnce()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 0m);
        var logId = await AddLogAsync(scenario, "pending", 3.9m);
        await AuthenticateAsAdminAsync();

        using var lockScope = Factory.Services.CreateScope();
        var lockDb = lockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var heldLock = await lockDb.Database.BeginTransactionAsync();
        await lockDb.VolunteerLogs
            .FromSqlInterpolated(
                $"SELECT * FROM vol_logs WHERE id = {logId} AND tenant_id = {TestData.Tenant1.Id} FOR UPDATE")
            .IgnoreQueryFilters()
            .SingleAsync();

        var requests = new[]
        {
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/hours/{logId}/verify",
                new { action = "approve" }),
            Client.PutAsJsonAsync(
                $"/api/v2/volunteering/hours/{logId}/verify",
                new { action = "decline" })
        };
        var contended = await WaitForBlockedVolunteerHourRequestsAsync(lockDb, 1);
        await heldLock.CommitAsync();
        var responses = await Task.WhenAll(requests);

        contended.Should().BeTrue("at least one opposing decision must contend on the locked pending row");
        var responseData = new JsonElement?[responses.Length];
        for (var index = 0; index < responses.Length; index++)
        {
            var response = responses[index];
            response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.BadRequest);
            var payload = await ReadJsonAsync(response);
            if (response.StatusCode == HttpStatusCode.OK)
            {
                responseData[index] = payload.GetProperty("data");
            }
            else
            {
                payload.GetProperty("errors")[0].GetProperty("code").GetString()
                    .Should().Be("VALIDATION_ERROR");
            }
        }

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedStatus = (await db.VolunteerLogs.IgnoreQueryFilters()
            .SingleAsync(log => log.Id == logId)).Status;
        storedStatus.Should().BeOneOf("approved", "declined");

        var organisationPayments = await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .CountAsync(row => row.VolunteerLogId == logId);
        var personalPayments = await db.Transactions.IgnoreQueryFilters()
            .CountAsync(row => row.VolunteerLogId == logId);
        var xpAwards = await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
            row.Source == XpLog.Sources.VolunteerHour && row.ReferenceId == logId);
        var organisationBalance = (await db.VolunteerOrganisations.IgnoreQueryFilters()
            .SingleAsync(org => org.Id == scenario.OrganisationId)).Balance;
        if (storedStatus == "approved")
        {
            responseData[0].Should().NotBeNull("the approving request won the transition");
            responseData[0]!.Value.GetProperty("status").GetString().Should().Be("approved");
            responseData[0]!.Value.GetProperty("payment_result").GetString().Should().Be("paid");
            if (responseData[1].HasValue)
            {
                responseData[1]!.Value.GetProperty("status").GetString().Should().Be("declined");
                responseData[1]!.Value.GetProperty("payment_result").GetString()
                    .Should().Be("already_processed");
            }
            organisationPayments.Should().Be(1);
            personalPayments.Should().Be(1);
            xpAwards.Should().Be(1);
            organisationBalance.Should().Be(-3m);
        }
        else
        {
            responseData[1].Should().NotBeNull("the declining request won the transition");
            responseData[1]!.Value.GetProperty("status").GetString().Should().Be("declined");
            responseData[1]!.Value.GetProperty("payment_result").ValueKind
                .Should().Be(JsonValueKind.Null);
            if (responseData[0].HasValue)
            {
                responseData[0]!.Value.GetProperty("status").GetString().Should().Be("approved");
                responseData[0]!.Value.GetProperty("payment_result").GetString()
                    .Should().Be("already_processed");
            }
            organisationPayments.Should().Be(0);
            personalPayments.Should().Be(0);
            xpAwards.Should().Be(0);
            organisationBalance.Should().Be(0m);
        }
    }

    [Fact]
    public async Task CaringRelationshipHours_UsesCanonicalLedgerAndFlagAdminAutoApproval()
    {
        await SetConfigAsync(VolunteerHoursService.CaringApprovalRequiredConfigKey, "true");
        await SetConfigAsync(VolunteerHoursService.CaringAutoApproveTrustedConfigKey, "false");
        await SetConfigAsync("features.caring_community", "true");
        await SetConfigAsync(CaringRegionalPointService.KeyPrefix + "enabled", "true");
        await SetConfigAsync(CaringRegionalPointService.KeyPrefix + "auto_issue_enabled", "true");
        await SetConfigAsync(CaringRegionalPointService.KeyPrefix + "points_per_approved_hour", "2");
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 4m, logDateOffset: -10);
        int coordinatorId;
        int relationshipId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var flagAdministrator = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = $"caring-flag-admin-{Guid.NewGuid():N}@example.test",
                PasswordHash = TestDataSeeder.TestPasswordHash,
                FirstName = "Flag",
                LastName = "Administrator",
                Role = "member",
                IsAdmin = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow.AddDays(-30)
            };
            db.Users.Add(flagAdministrator);
            await db.SaveChangesAsync();
            coordinatorId = flagAdministrator.Id;

            var relationship = new CaringSupportRelationship
            {
                TenantId = TestData.Tenant1.Id,
                SupporterId = scenario.VolunteerUserId,
                RecipientId = TestData.AdminUser.Id,
                CoordinatorId = coordinatorId,
                OrganizationId = scenario.OrganisationId,
                Title = "Flag-admin caring relationship",
                Description = "Canonical volunteer-hours convergence proof",
                Frequency = "weekly",
                ExpectedHours = 2.75m,
                StartDate = scenario.LogDate.AddDays(-14),
                Status = "active",
                CreatedAt = DateTime.UtcNow.AddDays(-14)
            };
            db.CaringSupportRelationships.Add(relationship);
            await db.SaveChangesAsync();
            relationshipId = relationship.Id;
        }

        SupportRelationshipLogHoursResult result;
        using (var act = Factory.Services.CreateScope())
        {
            var service = act.ServiceProvider.GetRequiredService<CaringSupportRelationshipService>();
            result = await service.LogHoursAsync(
                TestData.Tenant1.Id,
                relationshipId,
                coordinatorId,
                new Dictionary<string, object?>
                {
                    ["date"] = scenario.LogDate.ToString("yyyy-MM-dd"),
                    ["hours"] = 2.75m,
                    ["description"] = "  Caring hours use the canonical ledger  "
                },
                CancellationToken.None);
        }

        result.Succeeded.Should().BeTrue();
        var payload = JsonSerializer.SerializeToElement(result.Payload);
        payload.GetProperty("success").GetBoolean().Should().BeTrue();
        var payloadLog = payload.GetProperty("log");
        payloadLog.GetProperty("status").GetString().Should().Be("approved");
        payloadLog.GetProperty("payment_result").GetString().Should().Be("paid");
        var regionalAward = payloadLog.GetProperty("regional_points_result");
        regionalAward.GetProperty("points").GetDecimal().Should().Be(5.50m);
        regionalAward.GetProperty("already_awarded").GetBoolean().Should().BeFalse();
        var logId = payloadLog.GetProperty("id").GetInt32();

        using (var verify = Factory.Services.CreateScope())
        {
            var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            var log = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(row => row.Id == logId);
            log.CaringSupportRelationshipId.Should().Be(relationshipId);
            log.SupportRecipientId.Should().Be(TestData.AdminUser.Id);
            log.OrganizationId.Should().Be(scenario.OrganisationId);
            log.OpportunityId.Should().BeNull();
            log.UserId.Should().Be(scenario.VolunteerUserId);
            log.Description.Should().Be("Caring hours use the canonical ledger");
            log.Status.Should().Be("approved");
        }
        await AssertPaidAsync(
            scenario,
            logId,
            2m,
            expectedOrganisationBalance: 2m,
            expectXp: false);

        SupportRelationshipLogHoursResult subHourResult;
        using (var act = Factory.Services.CreateScope())
        {
            var service = act.ServiceProvider.GetRequiredService<CaringSupportRelationshipService>();
            subHourResult = await service.LogHoursAsync(
                TestData.Tenant1.Id,
                relationshipId,
                coordinatorId,
                new Dictionary<string, object?>
                {
                    ["date"] = scenario.LogDate.AddDays(1).ToString("yyyy-MM-dd"),
                    ["hours"] = 0.10m,
                    ["description"] = "Ten-minute caring check-in"
                },
                CancellationToken.None);
        }

        subHourResult.Succeeded.Should().BeTrue(
            "Laravel's direct Caring relationship workflow accepts any positive value up to 24 hours");
        var subHourPayload = JsonSerializer.SerializeToElement(subHourResult.Payload);
        var subHourLog = subHourPayload.GetProperty("log");
        subHourLog.GetProperty("status").GetString().Should().Be("approved");
        subHourLog.GetProperty("hours").GetDecimal().Should().Be(0.10m);
        subHourLog.GetProperty("payment_result").GetString().Should().Be("no_payable_hours");
        subHourLog.GetProperty("regional_points_result").GetProperty("points")
            .GetDecimal().Should().Be(0.20m);
        var subHourLogId = subHourLog.GetProperty("id").GetInt32();

        var boundaryLogIds = new List<int>();
        var boundaryCases = new[]
        {
            new { Offset = 2, RawHours = 0.999m, StoredHours = 1.00m, Points = 2.00m, Payment = "no_payable_hours" },
            new { Offset = 3, RawHours = 1.999m, StoredHours = 2.00m, Points = 4.00m, Payment = "paid" },
            new { Offset = 4, RawHours = 1.234m, StoredHours = 1.23m, Points = 2.47m, Payment = "paid" }
        };
        foreach (var boundary in boundaryCases)
        {
            SupportRelationshipLogHoursResult boundaryResult;
            using (var act = Factory.Services.CreateScope())
            {
                var service = act.ServiceProvider.GetRequiredService<CaringSupportRelationshipService>();
                boundaryResult = await service.LogHoursAsync(
                    TestData.Tenant1.Id,
                    relationshipId,
                    coordinatorId,
                    new Dictionary<string, object?>
                    {
                        ["date"] = scenario.LogDate.AddDays(boundary.Offset).ToString("yyyy-MM-dd"),
                        ["hours"] = boundary.RawHours,
                        ["description"] = $"Raw boundary {boundary.RawHours}"
                    },
                    CancellationToken.None);
            }

            boundaryResult.Succeeded.Should().BeTrue();
            var boundaryLog = JsonSerializer.SerializeToElement(boundaryResult.Payload).GetProperty("log");
            boundaryLog.GetProperty("hours").GetDecimal().Should().Be(boundary.StoredHours);
            boundaryLog.GetProperty("payment_result").GetString().Should().Be(boundary.Payment);
            boundaryLog.GetProperty("regional_points_result").GetProperty("points")
                .GetDecimal().Should().Be(boundary.Points);
            boundaryLogIds.Add(boundaryLog.GetProperty("id").GetInt32());
        }
        var boundaryRegionalIds = boundaryLogIds.Select(id => (long)id).ToArray();

        using (var verify = Factory.Services.CreateScope())
        {
            var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
                row.VolunteerLogId == subHourLogId)).Should().Be(0);
            (await db.Transactions.IgnoreQueryFilters().CountAsync(row =>
                row.VolunteerLogId == subHourLogId)).Should().Be(0);
            (await db.XpLogs.IgnoreQueryFilters().CountAsync(row =>
                row.Source == XpLog.Sources.VolunteerHour
                && (row.ReferenceId == logId || row.ReferenceId == subHourLogId))).Should().Be(0);
            (await db.Notifications.IgnoreQueryFilters().CountAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == scenario.VolunteerUserId
                && row.Type == "vol_hours_approved"
                && row.Data != null
                && (row.Data.Contains($"\"vol_log_id\":{logId}")
                    || row.Data.Contains($"\"vol_log_id\":{subHourLogId}")))).Should().Be(0);
            var regionalAccount = await db.CaringRegionalPointAccounts.IgnoreQueryFilters()
                .SingleAsync(row => row.TenantId == TestData.Tenant1.Id
                    && row.UserId == scenario.VolunteerUserId);
            regionalAccount.Balance.Should().Be(14.17m);
            regionalAccount.LifetimeEarned.Should().Be(14.17m);
            (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().CountAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == scenario.VolunteerUserId
                && row.Type == "earned_for_hours"
                && row.ReferenceType == "vol_log"
                && row.ReferenceId.HasValue
                && (row.ReferenceId == logId
                    || row.ReferenceId == subHourLogId
                    || boundaryRegionalIds.Contains(row.ReferenceId.Value)))).Should().Be(5);
            (await db.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(row =>
                row.Id == scenario.OrganisationId)).Balance.Should().Be(0m);
            (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(row =>
                row.VolunteerLogId.HasValue
                && (row.VolunteerLogId == logId
                    || boundaryLogIds.Contains(row.VolunteerLogId.Value)))).Should().Be(3);
        }
    }

    [Fact]
    public async Task ApprovalReloadsOrganisationBalanceAfterSharedWalletLock()
    {
        var scenario = await SeedEligibleScenarioAsync(organisationBalance: 10m);
        var logId = await AddLogAsync(scenario, "pending", 2.75m);
        await AuthenticateAsAdminAsync();

        using var lockScope = Factory.Services.CreateScope();
        var lockDb = lockScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await using var heldLock = await lockDb.Database.BeginTransactionAsync();
        await lockDb.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({TestData.Tenant1.Id}, {-scenario.OrganisationId})");

        var request = Client.PostAsJsonAsync(
            $"/api/v2/admin/volunteering/hours/{logId}/verify",
            new { action = "approve" });
        var contended = await WaitForBlockedVolunteerHourRequestsAsync(
            lockDb,
            1);

        await lockDb.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE vol_organizations SET balance = balance + {5m}, updated_at = NOW() WHERE tenant_id = {TestData.Tenant1.Id} AND id = {scenario.OrganisationId}");
        await heldLock.CommitAsync();

        using var response = await request;
        contended.Should().BeTrue(
            "approval must have loaded its precheck and then waited on the shared organisation-wallet lock");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verify = Factory.Services.CreateScope();
        var db = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(row =>
            row.Id == scenario.OrganisationId)).Balance.Should().Be(13m);
        (await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().SingleAsync(row =>
            row.VolunteerLogId == logId)).BalanceAfter.Should().Be(13m);
    }

    private static async Task<bool> WaitForBlockedVolunteerHourRequestsAsync(
        NexusDbContext observerDb,
        int minimumCount)
    {
        await using var command = observerDb.Database.GetDbConnection().CreateCommand();
        command.Transaction = observerDb.Database.CurrentTransaction?.GetDbTransaction();
        command.CommandText = """
            SELECT COUNT(DISTINCT activity.pid)
            FROM pg_stat_activity activity
            INNER JOIN pg_locks waiting_lock ON waiting_lock.pid = activity.pid
            WHERE activity.datname = current_database()
              AND activity.pid <> pg_backend_pid()
              AND activity.state = 'active'
              AND waiting_lock.granted = FALSE
            """;
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            var blocked = Convert.ToInt32(await command.ExecuteScalarAsync());
            if (blocked >= minimumCount)
                return true;
            await Task.Delay(25);
        }

        return false;
    }

    private async Task<HoursScenario> SeedEligibleScenarioAsync(
        string organisationStatus = "active",
        decimal organisationBalance = 0m,
        int? ownerUserId = null,
        int? volunteerUserId = null,
        bool includeQrEvidence = false,
        int logDateOffset = -3)
    {
        ownerUserId ??= TestData.AdminUser.Id;
        volunteerUserId ??= TestData.MemberUser.Id;
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var organisation = NewOrganisation(
            TestData.Tenant1.Id,
            ownerUserId.Value,
            $"Hours parity {Guid.NewGuid():N}",
            organisationStatus,
            organisationBalance);
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            OrganizerId = ownerUserId.Value,
            VolunteerOrganisationId = organisation.Id,
            Title = $"Community rota {Guid.NewGuid():N}",
            Description = "Volunteer-hours parity opportunity",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 5,
            CreatedAt = DateTime.UtcNow.AddDays(-10)
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        VolunteerShift? shift = null;
        if (includeQrEvidence)
        {
            shift = new VolunteerShift
            {
                TenantId = TestData.Tenant1.Id,
                OpportunityId = opportunity.Id,
                Title = "Historical QR shift",
                StartsAt = DateTime.UtcNow.AddDays(-4).AddHours(-2),
                EndsAt = DateTime.UtcNow.AddDays(-4),
                MaxVolunteers = 5,
                Status = ShiftStatus.Completed,
                CreatedAt = DateTime.UtcNow.AddDays(-10)
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
        }

        db.VolunteerApplications.Add(new VolunteerApplication
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            ShiftId = shift?.Id,
            UserId = volunteerUserId.Value,
            Status = ApplicationStatus.Approved,
            Message = "Approved volunteer-hours relationship",
            ReviewedById = ownerUserId.Value,
            ReviewedAt = DateTime.UtcNow.AddDays(-9),
            CreatedAt = DateTime.UtcNow.AddDays(-10)
        });
        await db.SaveChangesAsync();

        int? qrCheckInId = null;
        if (shift is not null)
        {
            var historicalTransactionId = await db.Transactions.IgnoreQueryFilters()
                .Where(row => row.TenantId == TestData.Tenant1.Id)
                .OrderBy(row => row.Id)
                .Select(row => row.Id)
                .FirstAsync();
            var qr = new VolunteerCheckIn
            {
                TenantId = TestData.Tenant1.Id,
                ShiftId = shift.Id,
                UserId = volunteerUserId.Value,
                QrToken = new string('b', 64),
                Status = "checked_out",
                CheckedInAt = DateTime.UtcNow.AddDays(-4).AddHours(-2),
                CheckedOutAt = DateTime.UtcNow.AddDays(-4),
                CheckedInById = ownerUserId.Value,
                CheckedOutById = ownerUserId.Value,
                HoursLogged = 9.5m,
                Notes = "Historical QR evidence must remain immutable",
                TransactionId = historicalTransactionId,
                CreatedAt = DateTime.UtcNow.AddDays(-4).AddHours(-2),
                UpdatedAt = DateTime.UtcNow.AddDays(-4)
            };
            db.VolunteerCheckIns.Add(qr);
            await db.SaveChangesAsync();
            qrCheckInId = qr.Id;
        }

        return new HoursScenario(
            organisation.Id,
            organisation.Name,
            opportunity.Id,
            volunteerUserId.Value,
            DateOnly.FromDateTime(DateTime.UtcNow.AddDays(logDateOffset)),
            qrCheckInId);
    }

    private async Task<int> AddLogAsync(
        HoursScenario scenario,
        string status,
        decimal hours,
        int dateOffset = 0)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var log = NewLog(scenario, status, hours, dateOffset);
        db.VolunteerLogs.Add(log);
        await db.SaveChangesAsync();
        return log.Id;
    }

    private VolunteerLog NewLog(
        HoursScenario scenario,
        string status,
        decimal hours,
        int dateOffset) => new()
    {
        TenantId = TestData.Tenant1.Id,
        UserId = scenario.VolunteerUserId,
        OrganizationId = scenario.OrganisationId,
        OpportunityId = scenario.OpportunityId,
        DateLogged = scenario.LogDate.AddDays(dateOffset),
        Hours = hours,
        Description = $"{status} parity evidence",
        Status = status,
        CreatedAt = DateTime.UtcNow.AddDays(dateOffset),
        UpdatedAt = DateTime.UtcNow.AddDays(dateOffset)
    };

    private static VolunteerOrganisation NewOrganisation(
        int tenantId,
        int ownerUserId,
        string name,
        string status = "active",
        decimal balance = 0m) => new()
    {
        TenantId = tenantId,
        OwnerUserId = ownerUserId,
        Name = name,
        Slug = $"hours-{Guid.NewGuid():N}",
        Description = "Volunteer-hours parity organisation",
        Status = status,
        Balance = balance,
        CreatedAt = DateTime.UtcNow.AddDays(-20)
    };

    private async Task SetConfigAsync(string key, string value)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var existing = await db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(config =>
            config.TenantId == TestData.Tenant1.Id && config.Key == key);
        if (existing is null)
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = key,
                Value = value,
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
    }

    private async Task AssertPaidAsync(
        HoursScenario scenario,
        int logId,
        decimal wholeHours,
        decimal expectedOrganisationBalance,
        bool expectXp = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var log = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(row => row.Id == logId);
        log.Status.Should().Be("approved");
        (await db.VolunteerOrganisations.IgnoreQueryFilters().SingleAsync(row =>
            row.Id == scenario.OrganisationId)).Balance.Should().Be(expectedOrganisationBalance);

        var organisationPayment = await db.VolunteerOrganisationTransactions.IgnoreQueryFilters()
            .SingleAsync(row => row.VolunteerLogId == logId && row.Type == "volunteer_payment");
        organisationPayment.TenantId.Should().Be(TestData.Tenant1.Id);
        organisationPayment.VolunteerOrganisationId.Should().Be(scenario.OrganisationId);
        organisationPayment.UserId.Should().Be(scenario.VolunteerUserId);
        organisationPayment.Amount.Should().Be(-wholeHours);
        organisationPayment.BalanceAfter.Should().Be(expectedOrganisationBalance);

        var personalPayment = await db.Transactions.IgnoreQueryFilters().SingleAsync(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.TransactionType == "volunteer"
            && row.VolunteerLogId == logId
            && row.ReceiverId == scenario.VolunteerUserId
            && row.Amount == wholeHours);
        personalPayment.SenderId.Should().BeNull(
            "approved volunteer credits are minted and must not debit the organisation owner's personal wallet");
        personalPayment.VolunteerLogId.Should().Be(logId);
        personalPayment.Status.Should().Be(TransactionStatus.Completed);

        var xpQuery = db.XpLogs.IgnoreQueryFilters().Where(row =>
            row.TenantId == TestData.Tenant1.Id
            && row.UserId == scenario.VolunteerUserId
            && row.Source == XpLog.Sources.VolunteerHour
            && row.ReferenceId == logId);
        if (expectXp)
        {
            var xp = await xpQuery.SingleAsync();
            xp.Amount.Should().Be(decimal.ToInt32(decimal.Round(
                log.Hours * XpLog.Amounts.VolunteerHour,
                0,
                MidpointRounding.AwayFromZero)));
        }
        else
        {
            (await xpQuery.CountAsync()).Should().Be(0);
        }
    }

    private async Task<decimal> PersonalBalanceAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var received = await db.Transactions.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.ReceiverId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        var sent = await db.Transactions.IgnoreQueryFilters()
            .Where(row => row.TenantId == TestData.Tenant1.Id
                && row.SenderId == userId
                && row.Status == TransactionStatus.Completed)
            .SumAsync(row => row.Amount);
        return received - sent;
    }

    private async Task<QrSnapshot> QrSnapshotAsync(int checkInId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.VolunteerCheckIns.IgnoreQueryFilters()
            .Where(row => row.Id == checkInId)
            .Select(row => new QrSnapshot(
                row.ShiftId,
                row.UserId,
                row.QrToken,
                row.Status,
                row.CheckedInAt,
                row.CheckedOutAt,
                row.CheckedInById,
                row.CheckedOutById,
                row.HoursLogged,
                row.Notes,
                row.TransactionId,
                row.CreatedAt,
                row.UpdatedAt))
            .SingleAsync();
    }

    private static IEnumerable<(string Method, string Path)> MemberRoutes()
    {
        yield return ("GET", "/api/v2/volunteering/hours");
        yield return ("POST", "/api/v2/volunteering/hours");
        yield return ("GET", "/api/v2/volunteering/hours/summary");
        yield return ("GET", "/api/v2/volunteering/hours/pending-review");
        yield return ("PUT", "/api/v2/volunteering/hours/2147483000/verify");
        yield return ("GET", "/api/v2/volunteering/organisations/2147483000/hours/pending");
    }

    private static IEnumerable<(string Method, string Path)> AdminRoutes()
    {
        yield return ("GET", "/api/v2/admin/volunteering/hours");
        yield return ("POST", "/api/v2/admin/volunteering/hours/2147483000/verify");
    }

    private async Task<HttpResponseMessage> SendAsync(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "POST"
            && path.Equals("/api/v2/volunteering/hours", StringComparison.OrdinalIgnoreCase))
        {
            request.Content = JsonContent.Create(new
            {
                organization_id = 2147483000,
                date = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd"),
                hours = 1m
            });
        }
        else if (method is "POST" or "PUT")
        {
            request.Content = new StringContent(
                "{\"action\":\"approve\"}",
                Encoding.UTF8,
                "application/json");
        }

        return await Client.SendAsync(request);
    }

    private static async Task<JsonElement> AssertErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string code,
        string? field = null)
    {
        response.StatusCode.Should().Be(status);
        var body = await ReadJsonAsync(response);
        var error = body.GetProperty("errors").EnumerateArray().Should().ContainSingle().Which;
        error.GetProperty("code").GetString().Should().Be(code);
        if (field is not null)
            error.GetProperty("field").GetString().Should().Be(field);
        return body;
    }

    private static void AssertPendingRow(
        JsonElement row,
        int logId,
        int opportunityId,
        bool includeOrganisation)
    {
        var expected = new List<string>
        {
            "id",
            "hours",
            "date",
            "description",
            "status",
            "created_at",
            "user"
        };
        if (includeOrganisation)
            expected.Add("organization");
        expected.Add("opportunity");
        AssertExactProperties(row, expected.ToArray());
        row.GetProperty("id").GetInt32().Should().Be(logId);
        row.GetProperty("hours").GetDecimal().Should().Be(2.75m);
        row.GetProperty("created_at").GetString().Should().MatchRegex(
            "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$");
        row.GetProperty("status").GetString().Should().Be("pending");
        row.GetProperty("opportunity").GetProperty("id").GetInt32().Should().Be(opportunityId);
    }

    private static void AssertExactProperties(JsonElement element, params string[] expected)
    {
        element.ValueKind.Should().Be(JsonValueKind.Object);
        element.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(expected);
    }

    private void AssertV2Headers(HttpResponseMessage response)
    {
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString());
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static string NormalizeTemplate(string? template) =>
        Regex.Replace((template ?? string.Empty).Trim().TrimStart('/'), "\\{[^}]+\\}", "{}");

    private static string Describe(OwnedEndpoint endpoint)
    {
        var action = endpoint.Endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
        return action is null
            ? endpoint.Template
            : $"{action.ControllerName}.{action.ActionName}";
    }

    private sealed record ExpectedOwner(
        string Controller,
        string Action,
        string? RatePolicy,
        bool AdminOnly);

    private sealed record OwnedEndpoint(
        string Method,
        string Template,
        RouteEndpoint Endpoint);

    private sealed record HoursScenario(
        int OrganisationId,
        string OrganisationName,
        int OpportunityId,
        int VolunteerUserId,
        DateOnly LogDate,
        int? QrCheckInId);

    private sealed record QrSnapshot(
        int ShiftId,
        int UserId,
        string? QrToken,
        string Status,
        DateTime? CheckedInAt,
        DateTime? CheckedOutAt,
        int? CheckedInById,
        int? CheckedOutById,
        decimal? HoursLogged,
        string? Notes,
        int? TransactionId,
        DateTime CreatedAt,
        DateTime UpdatedAt);
}
