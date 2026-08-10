// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class SafeguardingVettingControllerTests : IntegrationTestBase
{
    public SafeguardingVettingControllerTests(NexusWebApplicationFactory factory)
        : base(factory)
    {
    }

    [Fact]
    public void RouteTable_HasOneExplicitOwnerForEverySafeguardingVettingOperation()
    {
        var expected = new Dictionary<(string Method, string Template), (string Controller, string Action)>
        {
            [("GET", "api/v2/admin/vetting")] = ("AdminSafeguardingVetting", "List"),
            [("GET", "api/v2/admin/vetting/stats")] = ("AdminSafeguardingVetting", "Stats"),
            [("GET", "api/v2/admin/vetting/policy")] = ("AdminSafeguardingVetting", "Policy"),
            [("PUT", "api/v2/admin/vetting/policy")] = ("AdminSafeguardingVetting", "UpdatePolicy"),
            [("POST", "api/v2/admin/vetting/policy/rotate")] = ("AdminSafeguardingVetting", "RotatePolicy"),
            [("GET", "api/v2/admin/vetting/user/{userid:int}")] = ("AdminSafeguardingVetting", "GetUserRecords"),
            [("POST", "api/v2/admin/vetting/user/{userid:int}/confirm")] = ("AdminSafeguardingVetting", "Confirm"),
            [("POST", "api/v2/admin/vetting/user/{userid:int}/revoke")] = ("AdminSafeguardingVetting", "Revoke"),
            [("POST", "api/v2/admin/vetting/reviews/{reviewid:long}/resolve")] = ("AdminSafeguardingVetting", "ResolveReview"),
            [("GET", "api/v2/admin/vetting/{id:long}")] = ("AdminSafeguardingVetting", "Show"),
            [("GET", "api/v2/safeguarding/my-preferences")] = ("SafeguardingVettingMember", "MyPreferences"),
            [("GET", "api/v2/safeguarding/my-vetting-status")] = ("SafeguardingVettingMember", "MyVettingStatus"),
            [("POST", "api/v2/safeguarding/confirm-policy-review")] = ("SafeguardingVettingMember", "ConfirmPolicyReview"),
            [("POST", "api/v2/safeguarding/vetting-review-request")] = ("SafeguardingVettingMember", "RequestVettingReview"),
            [("POST", "api/v2/safeguarding/revoke")] = ("SafeguardingVettingMember", "Revoke")
        };

        var routes = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var action = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>();
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                if (action is null || methods is null)
                {
                    return Array.Empty<(string Method, string Template, string Controller, string Action)>();
                }

                var template = (endpoint.RoutePattern.RawText ?? string.Empty)
                    .Trim().TrimStart('/').ToLowerInvariant();
                return methods.Select(method => (
                    Method: method.ToUpperInvariant(),
                    Template: template,
                    Controller: action.ControllerName,
                    Action: action.ActionName));
            })
            .ToArray();

        foreach (var route in expected)
        {
            var matches = routes.Where(candidate =>
                candidate.Method == route.Key.Method
                && candidate.Template == route.Key.Template).ToArray();
            var owner = matches.Should().ContainSingle(
                $"{route.Key.Method} {route.Key.Template} must have one explicit controller owner").Which;
            owner.Controller.Should().Be(route.Value.Controller);
            owner.Action.Should().Be(route.Value.Action);
        }
    }

    [Fact]
    public async Task AdminMutations_RejectEvidenceAndUnknownInputBeforeWritingAnAttestation()
    {
        await AuthenticateAsAdminAsync();
        await ConfigureEnglandAndWalesAsync();

        var evidence = await Client.PostAsJsonAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm",
            new { acknowledgement = true, reference_number = "must-not-persist" });
        evidence.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        AssertV2Headers(evidence);
        await AssertErrorAsync(evidence, "VETTING_EVIDENCE_PROHIBITED", "reference_number");

        var unknown = await Client.PostAsJsonAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm?surprise=1",
            new { acknowledgement = true });
        unknown.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(unknown, "VETTING_EVIDENCE_PROHIBITED", "surprise");

        var mixed = await Client.PostAsJsonAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm?surprise=1",
            new { acknowledgement = true, reference_number = "must-win" });
        mixed.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(mixed, "VETTING_EVIDENCE_PROHIBITED", "reference_number");

        using var multipart = new MultipartFormDataContent();
        multipart.Add(new StringContent("yes"), "acknowledgement");
        multipart.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("not evidence")), "file", "certificate.pdf");
        var file = await Client.PostAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm",
            multipart);
        file.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(file, "VETTING_EVIDENCE_PROHIBITED", "file");

        var missingAcknowledgement = await Client.PostAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm",
            content: null);
        missingAcknowledgement.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(missingAcknowledgement, "VALIDATION_ERROR", "acknowledgement");

        await WithDbAsync(async db =>
            (await db.MemberVettingAttestations.IgnoreQueryFilters().CountAsync()).Should().Be(0));

        using var acceptedForm = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["acknowledgement"] = "yes"
        });
        var accepted = await Client.PostAsync(
            $"/api/v2/admin/vetting/user/{TestData.MemberUser.Id}/confirm",
            acceptedForm);
        accepted.StatusCode.Should().Be(HttpStatusCode.Created);
        AssertV2Headers(accepted);
    }

    [Fact]
    public async Task RemovedDocumentEraRoutes_MatchLaravel404Or405AndCannotMutateVettingState()
    {
        await AuthenticateAsAdminAsync();
        int legacyBefore = 0;
        int currentBefore = 0;
        await WithDbAsync(async db =>
        {
            legacyBefore = await db.VettingRecords.IgnoreQueryFilters().CountAsync();
            currentBefore = await db.MemberVettingAttestations.IgnoreQueryFilters().CountAsync();
        });

        (await Client.PostAsJsonAsync("/api/v2/admin/vetting", new { user_id = TestData.MemberUser.Id }))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.PostAsJsonAsync("/api/v2/admin/vetting/bulk", new { user_ids = new[] { TestData.MemberUser.Id } }))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.PutAsJsonAsync("/api/v2/admin/vetting/1", new { status = "verified" }))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.DeleteAsync("/api/v2/admin/vetting/1"))
            .StatusCode.Should().Be(HttpStatusCode.MethodNotAllowed);
        (await Client.PostAsJsonAsync("/api/v2/admin/vetting/1/verify", new { }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await Client.PostAsJsonAsync("/api/v2/admin/vetting/1/reject", new { notes = "prohibited" }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        using var upload = new MultipartFormDataContent();
        upload.Add(new ByteArrayContent(Encoding.UTF8.GetBytes("prohibited evidence")), "file", "certificate.pdf");
        (await Client.PostAsync("/api/v2/admin/vetting/1/upload", upload))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);

        await WithDbAsync(async db =>
        {
            (await db.VettingRecords.IgnoreQueryFilters().CountAsync()).Should().Be(legacyBefore);
            (await db.MemberVettingAttestations.IgnoreQueryFilters().CountAsync()).Should().Be(currentBefore);
        });
    }

    [Fact]
    public async Task MemberReviewRequest_IsEmptyBodyOnlyAndIdempotent()
    {
        await AuthenticateAsAdminAsync();
        await ConfigureEnglandAndWalesAsync();
        await AuthenticateAsMemberAsync();

        var first = await Client.PostAsync("/api/v2/safeguarding/vetting-review-request", content: null);
        first.StatusCode.Should().Be(HttpStatusCode.Created);
        AssertV2Headers(first);
        var firstId = (await first.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt64();

        var second = await Client.PostAsJsonAsync("/api/v2/safeguarding/vetting-review-request", new { });
        second.StatusCode.Should().Be(HttpStatusCode.Created);
        (await second.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt64().Should().Be(firstId);

        var input = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/vetting-review-request",
            new { notes = "must not be accepted" });
        input.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(input, "VETTING_EVIDENCE_PROHIBITED", "request");

        var query = await Client.PostAsync(
            "/api/v2/safeguarding/vetting-review-request?reference_number=no",
            content: null);
        query.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(query, "VETTING_EVIDENCE_PROHIBITED", "request");

        using var multipart = new MultipartFormDataContent();
        multipart.Add(new ByteArrayContent([1, 2, 3]), "document", "evidence.pdf");
        var file = await Client.PostAsync("/api/v2/safeguarding/vetting-review-request", multipart);
        file.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        await AssertErrorAsync(file, "VETTING_EVIDENCE_PROHIBITED", "request");

        var status = await Client.GetAsync("/api/v2/safeguarding/my-vetting-status");
        status.StatusCode.Should().Be(HttpStatusCode.OK);
        var statusData = (await status.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        statusData.GetProperty("decision").GetString().Should().Be("not_confirmed");
        statusData.GetProperty("review_status").GetString().Should().Be("pending");
    }

    [Fact]
    public async Task MemberStatus_UnconfiguredOmitsNoncanonicalRevokedAtField()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/safeguarding/my-vetting-status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        data.GetProperty("decision").GetString().Should().Be("not_confirmed");
        data.GetProperty("confirmed_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.TryGetProperty("revoked_at", out _).Should().BeFalse();
    }

    [Fact]
    public async Task MemberPreferences_LocalizeManagedCopyAndPreserveReviewAndRevocationAutonomy()
    {
        await AuthenticateAsAdminAsync();
        await ConfigureEnglandAndWalesAsync();

        int optionId = 0;
        await WithDbAsync(async db =>
        {
            var option = await db.SafeguardingOptions.IgnoreQueryFilters().SingleAsync(candidate =>
                candidate.TenantId == TestData.Tenant1.Id
                && candidate.OptionKey == "requires_vetted_partners"
                && candidate.PresetSource == "england_wales");
            optionId = option.Id;
            db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                OptionId = option.Id,
                SelectedValue = "true",
                ConsentGivenAt = DateTime.UtcNow.AddDays(-2),
                ReviewReminderSentAt = DateTime.UtcNow.AddDays(-1),
                PolicyReviewRequiredAt = DateTime.UtcNow.AddHours(-2),
                PolicyReviewReasonCode = "jurisdiction_changed",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            });
            db.UserMonitoringRestrictions.Add(new UserMonitoringRestriction
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                UnderMonitoring = true,
                RequiresBrokerApproval = true,
                Reason = "Safeguarding: self-identified during onboarding",
                CreatedAt = DateTime.UtcNow.AddDays(-2)
            });
            await db.SaveChangesAsync();
        });

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/v2/safeguarding/my-preferences");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var preference = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("preferences").EnumerateArray().Should().ContainSingle().Subject;
        preference.GetProperty("label").GetString().Should()
            .Be("I would prefer to only interact with members who have been appropriately vetted");
        preference.GetProperty("description").GetString().Should().Contain("DBS-checked members");
        preference.GetProperty("policy_review_required").GetBoolean().Should().BeTrue();
        preference.GetProperty("policy_review_reason_code").GetString().Should().Be("jurisdiction_changed");
        var activations = preference.GetProperty("activations");
        activations.GetProperty("requires_vetted_interaction").GetBoolean().Should().BeTrue();
        activations.GetProperty("restricts_matching").GetBoolean().Should().BeTrue();
        activations.GetProperty("vetting_type_required").GetString().Should().Be("dbs_enhanced");

        await WithDbAsync(async db =>
            (await db.UserSafeguardingPreferences.IgnoreQueryFilters()
                .SingleAsync(candidate => candidate.TenantId == TestData.Tenant1.Id
                    && candidate.UserId == TestData.MemberUser.Id
                    && candidate.OptionId == optionId))
                .ReviewConfirmedAt.Should().NotBeNull());

        var confirmed = await Client.PostAsync("/api/v2/safeguarding/confirm-policy-review", content: null);
        confirmed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await confirmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")
            .GetProperty("updated_count").GetInt32().Should().Be(1);

        var revoked = await Client.PostAsJsonAsync("/api/v2/safeguarding/revoke", new { option_id = optionId });
        revoked.StatusCode.Should().Be(HttpStatusCode.OK);
        await WithDbAsync(async db =>
        {
            var audit = await db.AuditLogs.IgnoreQueryFilters().SingleAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == TestData.MemberUser.Id
                && row.Action == "safeguarding_consent_revoked");
            audit.EntityType.Should().Be("user");
            audit.EntityId.Should().Be(TestData.MemberUser.Id);
            audit.Metadata.Should().Contain($"\"option_id\":{optionId}");

            var restriction = await db.UserMonitoringRestrictions.IgnoreQueryFilters().SingleAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == TestData.MemberUser.Id);
            restriction.UnderMonitoring.Should().BeFalse();
            restriction.RequiresBrokerApproval.Should().BeFalse();

            var bell = await db.Notifications.IgnoreQueryFilters().SingleAsync(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.UserId == TestData.AdminUser.Id
                && row.Type == "safeguarding_flag");
            bell.Title.Should().Contain("withdrawn safeguarding consent");
            bell.Title.Should().Contain("appropriately vetted");
            bell.Link.Should().Be($"/broker/safeguarding?user={TestData.MemberUser.Id}");
        });
        var alreadyRevoked = await Client.PostAsJsonAsync("/api/v2/safeguarding/revoke", new { option_id = optionId });
        alreadyRevoked.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(alreadyRevoked, "NOT_FOUND", "option_id");
    }

    [Fact]
    public async Task LocalControllerGuards_DenyCoordinatorDecisionsAndBrokerPolicyMutation()
    {
        await CreateStaffUserAsync("coordinator@test.com", "coordinator");
        await CreateStaffUserAsync("broker@test.com", "broker");

        SetAuthToken(await GetAccessTokenAsync("coordinator@test.com", TestData.Tenant1.Slug));
        var coordinator = await Client.GetAsync("/api/v2/admin/vetting");
        coordinator.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        AssertV2Headers(coordinator);
        var coordinatorJson = await coordinator.Content.ReadFromJsonAsync<JsonElement>();
        coordinatorJson.GetProperty("success").GetBoolean().Should().BeFalse();
        coordinatorJson.GetProperty("code").GetString().Should().Be("AUTH_INSUFFICIENT_PERMISSIONS");
        coordinatorJson.GetProperty("error").GetString().Should()
            .Be("Only an authorised broker or administrator can make vetting decisions.");

        SetAuthToken(await GetAccessTokenAsync("broker@test.com", TestData.Tenant1.Slug));
        var broker = await Client.PutAsJsonAsync(
            "/api/v2/admin/vetting/policy",
            new { jurisdiction = "england_wales" });
        broker.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var brokerJson = await broker.Content.ReadFromJsonAsync<JsonElement>();
        brokerJson.GetProperty("success").GetBoolean().Should().BeFalse();
        brokerJson.GetProperty("code").GetString().Should().Be("AUTH_INSUFFICIENT_PERMISSIONS");
        brokerJson.GetProperty("error").GetString().Should().Be("Admin access required");

        ClearAuthToken();
        (await Client.GetAsync("/api/v2/safeguarding/my-vetting-status"))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task BigintIdentifiers_ReachTheExplicitControllerRoutes()
    {
        await AuthenticateAsAdminAsync();

        var record = await Client.GetAsync("/api/v2/admin/vetting/3000000000");
        record.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(record, "NOT_FOUND", null);
        AssertV2Headers(record);

        var review = await Client.PostAsJsonAsync(
            "/api/v2/admin/vetting/reviews/3000000000/resolve",
            new { resolution_code = "no_change" });
        review.StatusCode.Should().Be(HttpStatusCode.NotFound);
        await AssertErrorAsync(review, "VETTING_REVIEW_REQUEST_NOT_FOUND", null);
        AssertV2Headers(review);
    }

    [Theory]
    [InlineData(null, "The option id field is required.")]
    [InlineData("not-an-integer", "The option id field must be an integer.")]
    [InlineData("0", "The option id field must be at least 1.")]
    public async Task MemberRevoke_UsesLaravelValidationRuleMessages(string? optionId, string expected)
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/revoke",
            new Dictionary<string, object?> { ["option_id"] = optionId });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("field").GetString().Should().Be("option_id");
        error.GetProperty("message").GetString().Should().Be(expected);
    }

    private async Task ConfigureEnglandAndWalesAsync()
    {
        var response = await Client.PutAsJsonAsync(
            "/api/v2/admin/vetting/policy",
            new { jurisdiction = "england_wales" });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    private async Task CreateStaffUserAsync(string email, string role)
    {
        await WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = role,
                LastName = "Controller Test",
                Role = role,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        });
    }

    private async Task WithDbAsync(Func<NexusDbContext, Task> action)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await action(db);
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, string code, string? field)
    {
        var error = (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(code);
        if (field is null)
        {
            error.TryGetProperty("field", out _).Should().BeFalse();
        }
        else
        {
            error.GetProperty("field").GetString().Should().Be(field);
        }
    }

    private void AssertV2Headers(HttpResponseMessage response)
    {
        response.Headers.GetValues("API-Version").Should().ContainSingle().Which.Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Should().ContainSingle().Which
            .Should().Be(TestData.Tenant1.Id.ToString());
    }
}
