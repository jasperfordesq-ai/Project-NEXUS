// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Middleware;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerAttendanceParityTests : IntegrationTestBase
{
    private const string VolunteeringFeatureKey = "feature.volunteering";
    private const string QrCheckinConfigKey = "volunteering.enable_qr_checkin";
    private const string FakeToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private readonly Dictionary<string, TenantConfigSnapshot> _configSnapshots = [];
    private string? _tenant2DomainSnapshot;
    private bool _isolationSnapshotCaptured;

    public VolunteerAttendanceParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    public override async Task InitializeAsync()
    {
        await base.InitializeAsync();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedConfigs = await db.TenantConfigs.IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config =>
                config.TenantId == TestData.Tenant1.Id
                && (config.Key == VolunteeringFeatureKey || config.Key == QrCheckinConfigKey))
            .ToDictionaryAsync(config => config.Key);
        foreach (var key in new[] { VolunteeringFeatureKey, QrCheckinConfigKey })
        {
            _configSnapshots[key] = storedConfigs.TryGetValue(key, out var config)
                ? new(true, config.Value, config.CreatedAt, config.UpdatedAt)
                : new(false, string.Empty, default, null);
        }

        _tenant2DomainSnapshot = await db.Tenants.IgnoreQueryFilters()
            .Where(tenant => tenant.Id == TestData.Tenant2.Id)
            .Select(tenant => tenant.Domain)
            .SingleAsync();
        _isolationSnapshotCaptured = true;
    }

    public override async Task DisposeAsync()
    {
        try
        {
            if (_isolationSnapshotCaptured)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
                await db.TenantConfigs.IgnoreQueryFilters()
                    .Where(config =>
                        config.TenantId == TestData.Tenant1.Id
                        && (config.Key == VolunteeringFeatureKey || config.Key == QrCheckinConfigKey))
                    .ExecuteDeleteAsync();
                foreach (var (key, snapshot) in _configSnapshots.Where(entry => entry.Value.Exists))
                {
                    db.TenantConfigs.Add(new TenantConfig
                    {
                        TenantId = TestData.Tenant1.Id,
                        Key = key,
                        Value = snapshot.Value,
                        CreatedAt = snapshot.CreatedAt,
                        UpdatedAt = snapshot.UpdatedAt
                    });
                }

                await db.Tenants.IgnoreQueryFilters()
                    .Where(tenant => tenant.Id == TestData.Tenant2.Id)
                    .ExecuteUpdateAsync(setters => setters.SetProperty(
                        tenant => tenant.Domain,
                        _tenant2DomainSnapshot));
                await db.SaveChangesAsync();
            }
        }
        finally
        {
            await base.DisposeAsync();
        }
    }

    [Fact]
    public void V2AttendanceRoutes_HaveOneAuthorizedOwnerAndIndependentRatePolicies()
    {
        var endpoints = Factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .SelectMany(endpoint =>
            {
                var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods
                    ?? Array.Empty<string>();
                return methods.Select(method => new
                {
                    Method = method.ToUpperInvariant(),
                    Template = (endpoint.RoutePattern.RawText ?? string.Empty).Trim().TrimStart('/'),
                    Endpoint = endpoint
                });
            })
            .ToList();

        var expected = new Dictionary<(string Method, string Template), (string Action, string Policy)>
        {
            [("GET", "api/v2/volunteering/shifts/{shiftId:int}/checkin")] =
                ("MyCheckin", RateLimitingExtensions.VolunteerAttendanceTokenPolicy),
            [("GET", "api/v2/volunteering/shifts/{shiftId:int}/checkins")] =
                ("ShiftCheckins", RateLimitingExtensions.VolunteerAttendanceRosterPolicy),
            [("POST", "api/v2/volunteering/checkin/verify/{token}")] =
                ("VerifyCheckin", RateLimitingExtensions.VolunteerAttendanceVerifyPolicy),
            [("POST", "api/v2/volunteering/checkin/checkout/{token}")] =
                ("Checkout", RateLimitingExtensions.VolunteerAttendanceCheckoutPolicy)
        };

        foreach (var (route, owner) in expected)
        {
            var match = endpoints.Should().ContainSingle(
                candidate => candidate.Method == route.Method
                    && candidate.Template == route.Template,
                $"{route.Method} {route.Template} must have one focused owner").Which;
            var action = match.Endpoint.Metadata.GetRequiredMetadata<ControllerActionDescriptor>();

            action.ControllerName.Should().Be("VolunteeringParity");
            action.ActionName.Should().Be(owner.Action);
            match.Endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Should().NotBeEmpty();
            match.Endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull();
            match.Endpoint.Metadata.GetRequiredMetadata<EnableRateLimitingAttribute>()
                .PolicyName.Should().Be(owner.Policy);
        }
    }

    [Theory]
    [InlineData("GET", "/api/v2/volunteering/shifts/1/checkin")]
    [InlineData("GET", "/api/v2/volunteering/shifts/1/checkins")]
    [InlineData("POST", "/api/v2/volunteering/checkin/verify/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("POST", "/api/v2/volunteering/checkin/checkout/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public async Task V2AttendanceRoutes_RequireAuthenticationAndAcceptHexTokenShape(
        string method,
        string path)
    {
        ClearAuthToken();

        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        var response = await Client.SendAsync(request);

        var responseBody = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "the exact attendance route {0} must be auth-owned; response body was: {1}",
            path,
            responseBody);
    }

    public static IEnumerable<object[]> InvalidAttendanceTokens()
    {
        yield return ["abc123"];
        yield return [FakeToken.ToUpperInvariant()];
        yield return ["g" + FakeToken[1..]];
        yield return [$"%20{FakeToken}%20"];
    }

    [Theory]
    [MemberData(nameof(InvalidAttendanceTokens))]
    public async Task VerifyAndCheckout_RejectTokensThatAreNotExactLowercase64Hex(
        string routeToken)
    {
        await AuthenticateAsAdminAsync();

        await AssertLaravelErrorAsync(
            await Client.PostAsync(VerifyPath(routeToken), null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
        await AssertLaravelErrorAsync(
            await Client.PostAsync(CheckoutPath(routeToken), null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
    }

    [Fact]
    public async Task AttendanceRoutes_WhenVolunteeringFeatureDisabled_ReturnFeatureErrorWithoutRows()
    {
        var scenario = await SeedScenarioAsync();
        await SetConfigAsync(VolunteeringFeatureKey, "false");
        await AuthenticateAsMemberAsync();

        await AssertEveryRouteFeatureDisabledAsync(scenario.ShiftId);
        await AssertCheckinCountAsync(scenario.ShiftId, 0);
    }

    [Fact]
    public async Task AttendanceRoutes_WhenQrCheckinDisabled_ReturnFeatureErrorWithoutRows()
    {
        var scenario = await SeedScenarioAsync();
        await SetConfigAsync(QrCheckinConfigKey, "false");
        await AuthenticateAsMemberAsync();

        await AssertEveryRouteFeatureDisabledAsync(scenario.ShiftId);
        await AssertCheckinCountAsync(scenario.ShiftId, 0);
    }

    [Fact]
    public async Task GetCheckin_RequiresExactApprovedAssignmentThenReturnsOneLaravelToken()
    {
        var scenario = await SeedScenarioAsync(
            applicationStatus: ApplicationStatus.Pending,
            assignApplicationToShift: true);
        await AuthenticateAsMemberAsync();

        var pending = await Client.GetAsync(PersonalPath(scenario.ShiftId));
        await AssertLaravelErrorAsync(pending, HttpStatusCode.NotFound, "NOT_FOUND");
        await AssertCheckinCountAsync(scenario.ShiftId, 0);

        await UpdateApplicationAsync(scenario.ApplicationId, ApplicationStatus.Approved, shiftId: null);
        var unassigned = await Client.GetAsync(PersonalPath(scenario.ShiftId));
        await AssertLaravelErrorAsync(unassigned, HttpStatusCode.NotFound, "NOT_FOUND");
        await AssertCheckinCountAsync(scenario.ShiftId, 0);

        await UpdateApplicationAsync(
            scenario.ApplicationId,
            ApplicationStatus.Approved,
            scenario.ShiftId);
        var first = await Client.GetAsync(PersonalPath(scenario.ShiftId));
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstBody = await ReadJsonAsync(first);
        AssertLaravelDataEnvelope(firstBody);
        var firstData = firstBody.GetProperty("data");
        var token = firstData.GetProperty("qr_token").GetString();
        token.Should().MatchRegex("^[0-9a-f]{64}$");
        firstData.GetProperty("qr_url").GetString().Should().EndWith($"/volunteering/checkin/{token}");
        firstData.GetProperty("status").GetString().Should().Be("pending");
        firstData.GetProperty("checked_in_at").ValueKind.Should().Be(JsonValueKind.Null);
        firstData.GetProperty("checked_out_at").ValueKind.Should().Be(JsonValueKind.Null);

        var retry = await Client.GetAsync(PersonalPath(scenario.ShiftId));
        retry.StatusCode.Should().Be(HttpStatusCode.OK);
        var retryBody = await ReadJsonAsync(retry);
        AssertLaravelDataEnvelope(retryBody);
        retryBody.GetProperty("data").GetProperty("qr_token").GetString().Should().Be(token);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await db.VolunteerCheckIns.IgnoreQueryFilters()
            .Where(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.ShiftId == scenario.ShiftId
                && row.UserId == TestData.MemberUser.Id)
            .ToListAsync();
        rows.Should().ContainSingle();
        rows[0].QrToken.Should().Be(token);
        rows[0].Status.Should().Be("pending");
        rows[0].CheckedInAt.Should().BeNull();
        rows[0].CheckedOutAt.Should().BeNull();
        rows[0].TransactionId.Should().BeNull();
    }

    [Fact]
    public async Task QrUrl_UsesSharedTenantSlugAndCustomDomainWithoutSlugPrefix()
    {
        var sharedScenario = await SeedScenarioAsync();
        await AuthenticateAsMemberAsync();

        var sharedResponse = await Client.GetAsync(PersonalPath(sharedScenario.ShiftId));
        sharedResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var sharedBody = await ReadJsonAsync(sharedResponse);
        var sharedData = sharedBody.GetProperty("data");
        var sharedToken = sharedData.GetProperty("qr_token").GetString();
        string sharedFrontendOrigin;
        using (var configScope = Factory.Services.CreateScope())
        {
            var configuredOrigin = configScope.ServiceProvider
                .GetRequiredService<IConfiguration>()["App:FrontendUrl"];
            sharedFrontendOrigin = (configuredOrigin
                ?? Client.BaseAddress!.GetLeftPart(UriPartial.Authority))
                .TrimEnd('/');
        }
        sharedData.GetProperty("qr_url").GetString().Should().Be(
            $"{sharedFrontendOrigin}/{TestData.Tenant1.Slug}/volunteering/checkin/{sharedToken}");

        const string customDomain = "attendance-custom.example.test";
        var customShiftId = await SeedCustomDomainScenarioAsync(customDomain);
        await AuthenticateAsOtherTenantUserAsync();

        var customResponse = await Client.GetAsync(PersonalPath(customShiftId));
        customResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var customBody = await ReadJsonAsync(customResponse);
        var customData = customBody.GetProperty("data");
        var customToken = customData.GetProperty("qr_token").GetString();
        var customUrl = customData.GetProperty("qr_url").GetString();
        customUrl.Should().Be(
            $"https://{customDomain}/volunteering/checkin/{customToken}");
        customUrl.Should().NotContain($"/{TestData.Tenant2.Slug}/");
    }

    [Fact]
    public async Task ConcurrentGetCheckinRetries_ReturnOnePersistentToken()
    {
        var scenario = await SeedScenarioAsync();
        var memberToken = await GetAccessTokenAsync(TestData.MemberUser.Email, TestData.Tenant1.Slug);
        using var firstClient = AuthorizedClient(memberToken);
        using var secondClient = AuthorizedClient(memberToken);

        var responses = await Task.WhenAll(
            firstClient.GetAsync(PersonalPath(scenario.ShiftId)),
            secondClient.GetAsync(PersonalPath(scenario.ShiftId)));

        responses[0].StatusCode.Should().Be(HttpStatusCode.OK);
        responses[1].StatusCode.Should().Be(HttpStatusCode.OK);
        var firstToken = (await ReadJsonAsync(responses[0]))
            .GetProperty("data").GetProperty("qr_token").GetString();
        var secondToken = (await ReadJsonAsync(responses[1]))
            .GetProperty("data").GetProperty("qr_token").GetString();
        firstToken.Should().MatchRegex("^[0-9a-f]{64}$");
        secondToken.Should().Be(firstToken);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var rows = await db.VolunteerCheckIns.IgnoreQueryFilters()
            .Where(row =>
                row.TenantId == TestData.Tenant1.Id
                && row.ShiftId == scenario.ShiftId
                && row.UserId == TestData.MemberUser.Id)
            .ToListAsync();
        rows.Should().ContainSingle();
        rows[0].QrToken.Should().Be(firstToken);
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("org_admin")]
    [InlineData("org_manager")]
    [InlineData("org_coordinator")]
    [InlineData("platform_admin")]
    public async Task ManagerActor_CanVerifyAndReadSanitizedRoster(string actorKind)
    {
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);
        var expectedVolunteerName = actorKind == "platform_admin"
            ? await GetPersistedMemberDisplayNameAsync()
            : TestData.MemberUser.FirstName;
        await AuthenticateActorAsync(scenario, actorKind);

        var verify = await Client.PostAsync(VerifyPath(token), null);
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        var verifyBody = await ReadJsonAsync(verify);
        AssertLaravelDataEnvelope(verifyBody);
        verifyBody.GetProperty("data").GetProperty("status").GetString().Should().Be("checked_in");

        var roster = await Client.GetAsync(RosterPath(scenario.ShiftId));
        roster.StatusCode.Should().Be(HttpStatusCode.OK);
        var rosterBody = await ReadJsonAsync(roster);
        AssertLaravelDataEnvelope(rosterBody);
        var rows = rosterBody.GetProperty("data").GetProperty("checkins").EnumerateArray().ToArray();
        rows.Should().ContainSingle();
        var row = rows[0];
        row.GetProperty("status").GetString().Should().Be("checked_in");
        row.TryGetProperty("qr_token", out _).Should().BeFalse();
        row.TryGetProperty("transaction_id", out _).Should().BeFalse();
        row.TryGetProperty("notes", out _).Should().BeFalse();
        var user = row.GetProperty("user");
        user.GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        user.GetProperty("name").GetString().Should().Be(expectedVolunteerName);
        user.TryGetProperty("email", out _).Should().BeFalse();
        user.TryGetProperty("password_hash", out _).Should().BeFalse();

        var checkout = await Client.PostAsync(CheckoutPath(token), null);
        checkout.StatusCode.Should().Be(HttpStatusCode.OK);
        var checkoutBody = await ReadJsonAsync(checkout);
        AssertLaravelDataEnvelope(checkoutBody);
        checkoutBody.GetProperty("data").GetProperty("message").GetString()
            .Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Roster_RetainsAttendanceAfterApplicationIsNoLongerApproved()
    {
        var scenario = await SeedScenarioAsync();
        await CreateTokenAsync(scenario.ShiftId);
        await UpdateApplicationAsync(
            scenario.ApplicationId,
            ApplicationStatus.Declined,
            scenario.ShiftId);
        SetAuthToken(await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug));

        var response = await Client.GetAsync(RosterPath(scenario.ShiftId));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        AssertLaravelDataEnvelope(body);
        var rows = body.GetProperty("data").GetProperty("checkins").EnumerateArray().ToArray();
        rows.Should().ContainSingle();
        rows[0].GetProperty("status").GetString().Should().Be("pending");
        rows[0].GetProperty("user").GetProperty("id").GetInt32()
            .Should().Be(TestData.MemberUser.Id);
        rows[0].TryGetProperty("qr_token", out _).Should().BeFalse();
    }

    [Fact]
    public async Task PendingQrToken_IsAbsentFromLegacyActiveAttendanceAndCaringSupportLogs()
    {
        var scenario = await SeedScenarioAsync();
        await CreateTokenAsync(scenario.ShiftId);

        var myVolunteering = await Client.GetAsync("/api/volunteering/my");
        myVolunteering.StatusCode.Should().Be(HttpStatusCode.OK);
        var myBody = await ReadJsonAsync(myVolunteering);
        myBody.GetProperty("active_check_ins").EnumerateArray().Should().BeEmpty();

        var stats = await Client.GetAsync("/api/volunteering/stats");
        stats.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(stats)).GetProperty("active_check_ins").GetInt32().Should().Be(0);

        var legacyHours = await Client.GetAsync("/api/volunteering/my-hours");
        legacyHours.StatusCode.Should().Be(HttpStatusCode.OK);
        var legacyRows = (await ReadJsonAsync(legacyHours)).GetProperty("data")
            .EnumerateArray().ToArray();
        legacyRows.Should().NotContain(row =>
            row.GetProperty("shift_id").GetInt32() == scenario.ShiftId);

        var shifts = await Client.GetAsync(
            $"/api/volunteering/opportunities/{scenario.OpportunityId}/shifts");
        shifts.StatusCode.Should().Be(HttpStatusCode.OK);
        var shiftRows = (await ReadJsonAsync(shifts)).GetProperty("data")
            .EnumerateArray().ToArray();
        var shift = shiftRows.Single(row =>
            row.GetProperty("id").GetInt32() == scenario.ShiftId);
        shift.GetProperty("checked_in_count").GetInt32().Should().Be(0);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var statement = await new CaringCommunityMemberStatementService(db).StatementAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            new CaringMemberStatementFilters(null, null),
            CancellationToken.None);
        statement.Should().NotBeNull();
        statement!.SupportLogs.Should().BeEmpty();
    }

    [Fact]
    public async Task OutsiderAndCrossTenantCallers_CannotManageOrReadAttendance()
    {
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);

        SetAuthToken(await GetAccessTokenAsync(scenario.OutsiderEmail, TestData.Tenant1.Slug));
        await AssertLaravelErrorAsync(
            await Client.PostAsync(VerifyPath(token), null),
            HttpStatusCode.Forbidden,
            "FORBIDDEN");
        await AssertLaravelErrorAsync(
            await Client.PostAsync(CheckoutPath(token), null),
            HttpStatusCode.Forbidden,
            "FORBIDDEN");
        await AssertLaravelErrorAsync(
            await Client.GetAsync(RosterPath(scenario.ShiftId)),
            HttpStatusCode.Forbidden,
            "FORBIDDEN");

        await AuthenticateAsOtherTenantUserAsync();
        await AssertLaravelErrorAsync(
            await Client.PostAsync(VerifyPath(token), null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
        await AssertLaravelErrorAsync(
            await Client.PostAsync(CheckoutPath(token), null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");
        await AssertLaravelErrorAsync(
            await Client.GetAsync(RosterPath(scenario.ShiftId)),
            HttpStatusCode.Forbidden,
            "FORBIDDEN");

        await AssertCheckinStateAsync(scenario.ShiftId, "pending", checkedIn: false, checkedOut: false);
    }

    [Theory]
    [InlineData(29, 90, true)]
    [InlineData(31, 90, false)]
    [InlineData(-360, -235, true)]
    [InlineData(-360, -245, false)]
    public async Task Verify_EnforcesLaravelEarlyAndStaleTimeBoundaries(
        int startsInMinutes,
        int endsInMinutes,
        bool expectedSuccess)
    {
        var now = DateTime.UtcNow;
        var scenario = await SeedScenarioAsync(
            startsAt: now.AddMinutes(startsInMinutes),
            endsAt: now.AddMinutes(endsInMinutes));
        var token = await CreateTokenAsync(scenario.ShiftId);
        var before = await CaptureSideEffectsAsync(scenario);
        SetAuthToken(await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug));

        var response = await Client.PostAsync(VerifyPath(token), null);

        if (expectedSuccess)
        {
            response.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await ReadJsonAsync(response);
            AssertLaravelDataEnvelope(body);
            body.GetProperty("data").GetProperty("status").GetString().Should().Be("checked_in");
            await AssertCheckinStateAsync(scenario.ShiftId, "checked_in", checkedIn: true, checkedOut: false);
        }
        else
        {
            await AssertLaravelErrorAsync(response, HttpStatusCode.NotFound, "NOT_FOUND");
            await AssertCheckinStateAsync(scenario.ShiftId, "pending", checkedIn: false, checkedOut: false);
        }

        await AssertSideEffectsUnchangedAsync(scenario, before);
    }

    [Theory]
    [InlineData("cancelled")]
    [InlineData("completed")]
    [InlineData("reassigned")]
    public async Task ExistingToken_VerifiesAndChecksOutAfterShiftOrAssignmentLifecycleChanges(
        string invalidation)
    {
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);
        var before = await CaptureSideEffectsAsync(scenario);
        await InvalidateAttendanceAsync(scenario, invalidation);
        SetAuthToken(await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug));

        var verify = await Client.PostAsync(VerifyPath(token), null);
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(verify)).GetProperty("data").GetProperty("status").GetString()
            .Should().Be("checked_in");

        var checkout = await Client.PostAsync(CheckoutPath(token), null);
        checkout.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertLaravelDataEnvelope(await ReadJsonAsync(checkout));
        await AssertCheckinStateAsync(scenario.ShiftId, "checked_out", checkedIn: true, checkedOut: true);
        await AssertSideEffectsUnchangedAsync(scenario, before);
    }

    [Fact]
    public async Task Checkout_AlreadyCheckedInVolunteerSucceedsAfterVerificationWindowCloses()
    {
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);
        SetAuthToken(await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug));
        (await Client.PostAsync(VerifyPath(token), null)).StatusCode.Should().Be(HttpStatusCode.OK);
        var before = await CaptureSideEffectsAsync(scenario);
        await MoveShiftOutsideVerificationWindowAsync(scenario.ShiftId);

        var checkout = await Client.PostAsync(CheckoutPath(token), null);

        checkout.StatusCode.Should().Be(HttpStatusCode.OK);
        AssertLaravelDataEnvelope(await ReadJsonAsync(checkout));
        await AssertCheckinStateAsync(scenario.ShiftId, "checked_out", checkedIn: true, checkedOut: true);
        await AssertSideEffectsUnchangedAsync(scenario, before);
    }

    [Fact]
    public async Task AttendanceLifecycle_IsIdempotentAndNeverMintsRewards()
    {
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);
        var before = await CaptureSideEffectsAsync(scenario);
        SetAuthToken(await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug));

        var verify = await Client.PostAsync(VerifyPath(token), null);
        verify.StatusCode.Should().Be(HttpStatusCode.OK);
        var verifyBody = await ReadJsonAsync(verify);
        AssertLaravelDataEnvelope(verifyBody);
        var verifyData = verifyBody.GetProperty("data");
        verifyData.GetProperty("status").GetString().Should().Be("checked_in");
        verifyData.GetProperty("checked_in_at").GetString().Should().NotBeNullOrWhiteSpace();
        verifyData.GetProperty("user").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        verifyData.GetProperty("shift").GetProperty("id").GetInt32().Should().Be(scenario.ShiftId);
        var firstCheckedInAt = await GetCheckedInAtAsync(scenario.ShiftId);

        var retry = await Client.PostAsync(VerifyPath(token), null);
        retry.StatusCode.Should().Be(HttpStatusCode.OK);
        var retryBody = await ReadJsonAsync(retry);
        AssertLaravelDataEnvelope(retryBody);
        retryBody.GetProperty("data").GetProperty("status").GetString()
            .Should().Be("already_checked_in");
        (await GetCheckedInAtAsync(scenario.ShiftId)).Should().Be(firstCheckedInAt);

        var checkout = await Client.PostAsync(CheckoutPath(token), null);
        checkout.StatusCode.Should().Be(HttpStatusCode.OK);
        var checkoutBody = await ReadJsonAsync(checkout);
        AssertLaravelDataEnvelope(checkoutBody);
        checkoutBody.GetProperty("data").GetProperty("message").GetString()
            .Should().NotBeNullOrWhiteSpace();

        await AssertLaravelErrorAsync(
            await Client.PostAsync(VerifyPath(token), null),
            HttpStatusCode.NotFound,
            "NOT_FOUND");

        var checkoutRetry = await Client.PostAsync(CheckoutPath(token), null);
        await AssertLaravelErrorAsync(checkoutRetry, HttpStatusCode.BadRequest, "VALIDATION_ERROR");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.VolunteerCheckIns.IgnoreQueryFilters().SingleAsync(checkin =>
                checkin.TenantId == TestData.Tenant1.Id
                && checkin.ShiftId == scenario.ShiftId
                && checkin.UserId == TestData.MemberUser.Id);
            row.Status.Should().Be("checked_out");
            row.CheckedInAt.Should().NotBeNull();
            row.CheckedOutAt.Should().NotBeNull();
            row.CheckedInById.Should().Be(scenario.OwnerId);
            row.CheckedOutById.Should().Be(scenario.OwnerId);
            row.TransactionId.Should().BeNull();
            row.HoursLogged.Should().BeNull();
        }

        await AssertSideEffectsUnchangedAsync(scenario, before);
    }

    [Fact]
    public async Task ConcurrentCheckout_HasSingleWinnerAndNoRewardMutation()
    {
        // Deliberate safer .NET divergence: the shift lock makes concurrent
        // checkout single-winner even though Laravel's legacy update is looser.
        var scenario = await SeedScenarioAsync();
        var token = await CreateTokenAsync(scenario.ShiftId);
        var ownerToken = await GetAccessTokenAsync(scenario.OwnerEmail, TestData.Tenant1.Slug);
        SetAuthToken(ownerToken);
        (await Client.PostAsync(VerifyPath(token), null)).StatusCode.Should().Be(HttpStatusCode.OK);
        var before = await CaptureSideEffectsAsync(scenario);
        using var firstClient = AuthorizedClient(ownerToken);
        using var secondClient = AuthorizedClient(ownerToken);

        var responses = await Task.WhenAll(
            firstClient.PostAsync(CheckoutPath(token), null),
            secondClient.PostAsync(CheckoutPath(token), null));
        responses.Count(response => response.StatusCode == HttpStatusCode.OK).Should().Be(1);
        responses.Count(response => response.StatusCode == HttpStatusCode.BadRequest).Should().Be(1);
        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.BadRequest);
        (await ReadJsonAsync(loser)).GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("VALIDATION_ERROR");
        await AssertCheckinStateAsync(scenario.ShiftId, "checked_out", checkedIn: true, checkedOut: true);
        await AssertSideEffectsUnchangedAsync(scenario, before);
    }

    private async Task<AttendanceScenario> SeedScenarioAsync(
        DateTime? startsAt = null,
        DateTime? endsAt = null,
        ShiftStatus shiftStatus = ShiftStatus.Scheduled,
        ApplicationStatus applicationStatus = ApplicationStatus.Approved,
        bool assignApplicationToShift = true)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var suffix = Guid.NewGuid().ToString("N");
        var owner = NewUser("owner", suffix, TestData.MemberUser.PasswordHash);
        var orgAdmin = NewUser("org-admin", suffix, TestData.MemberUser.PasswordHash);
        var orgManager = NewUser("org-manager", suffix, TestData.MemberUser.PasswordHash);
        var orgCoordinator = NewUser("org-coordinator", suffix, TestData.MemberUser.PasswordHash);
        var outsider = NewUser("outsider", suffix, TestData.MemberUser.PasswordHash);
        db.Users.AddRange(owner, orgAdmin, orgManager, orgCoordinator, outsider);
        await db.SaveChangesAsync();

        var organisation = new VolunteerOrganisation
        {
            TenantId = TestData.Tenant1.Id,
            OwnerUserId = owner.Id,
            Name = $"Attendance organisation {suffix}",
            Slug = $"attendance-{suffix}",
            Description = "Volunteer attendance parity fixture",
            Status = "active",
            OrgType = "organisation",
            Balance = 37.5m,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        db.VolunteerOrganisationMembers.AddRange(
            NewOrganisationMember(organisation.Id, orgAdmin.Id, "admin"),
            NewOrganisationMember(organisation.Id, orgManager.Id, "manager"),
            NewOrganisationMember(organisation.Id, orgCoordinator.Id, "coordinator"));

        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant1.Id,
            OrganizerId = owner.Id,
            VolunteerOrganisationId = organisation.Id,
            Title = $"Attendance opportunity {suffix}",
            Description = "QR attendance parity fixture",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 1,
            CreditReward = 9.5m,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        var shift = new VolunteerShift
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            Title = "Attendance shift",
            StartsAt = startsAt ?? DateTime.UtcNow.AddMinutes(-5),
            EndsAt = endsAt ?? DateTime.UtcNow.AddHours(1),
            MaxVolunteers = 5,
            Status = shiftStatus,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();

        var application = new VolunteerApplication
        {
            TenantId = TestData.Tenant1.Id,
            OpportunityId = opportunity.Id,
            ShiftId = assignApplicationToShift ? shift.Id : null,
            UserId = TestData.MemberUser.Id,
            Status = applicationStatus,
            Message = "Approved attendance volunteer",
            ReviewedById = applicationStatus == ApplicationStatus.Approved ? owner.Id : null,
            ReviewedAt = applicationStatus == ApplicationStatus.Approved ? DateTime.UtcNow : null,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerApplications.Add(application);
        await db.SaveChangesAsync();

        return new AttendanceScenario(
            organisation.Id,
            opportunity.Id,
            shift.Id,
            application.Id,
            owner.Id,
            owner.Email,
            orgAdmin.Email,
            orgManager.Email,
            orgCoordinator.Email,
            outsider.Email);
    }

    private async Task<int> SeedCustomDomainScenarioAsync(string domain)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await db.Tenants.IgnoreQueryFilters()
            .Where(tenant => tenant.Id == TestData.Tenant2.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(tenant => tenant.Domain, domain));

        var suffix = Guid.NewGuid().ToString("N");
        var organisation = new VolunteerOrganisation
        {
            TenantId = TestData.Tenant2.Id,
            OwnerUserId = TestData.OtherTenantUser.Id,
            Name = $"Custom-domain attendance organisation {suffix}",
            Slug = $"custom-attendance-{suffix}",
            Description = "Custom-domain QR URL fixture",
            Status = "active",
            OrgType = "organisation",
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOrganisations.Add(organisation);
        await db.SaveChangesAsync();

        var opportunity = new VolunteerOpportunity
        {
            TenantId = TestData.Tenant2.Id,
            OrganizerId = TestData.OtherTenantUser.Id,
            VolunteerOrganisationId = organisation.Id,
            Title = $"Custom-domain attendance opportunity {suffix}",
            Description = "Custom-domain QR URL fixture",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 1,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();

        var shift = new VolunteerShift
        {
            TenantId = TestData.Tenant2.Id,
            OpportunityId = opportunity.Id,
            Title = "Custom-domain attendance shift",
            StartsAt = DateTime.UtcNow.AddMinutes(-5),
            EndsAt = DateTime.UtcNow.AddHours(1),
            MaxVolunteers = 1,
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();

        db.VolunteerApplications.Add(new VolunteerApplication
        {
            TenantId = TestData.Tenant2.Id,
            OpportunityId = opportunity.Id,
            ShiftId = shift.Id,
            UserId = TestData.OtherTenantUser.Id,
            Status = ApplicationStatus.Approved,
            ReviewedById = TestData.OtherTenantUser.Id,
            ReviewedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        return shift.Id;
    }

    private User NewUser(string label, string suffix, string passwordHash) => new()
    {
        TenantId = TestData.Tenant1.Id,
        Email = $"{label}-{suffix}@attendance.test",
        PasswordHash = passwordHash,
        FirstName = label,
        LastName = "Attendance",
        Role = "member",
        IsActive = true,
        TotalXp = 77,
        Level = 1,
        CreatedAt = DateTime.UtcNow
    };

    private VolunteerOrganisationMember NewOrganisationMember(
        int organisationId,
        int userId,
        string role) => new()
    {
        TenantId = TestData.Tenant1.Id,
        VolunteerOrganisationId = organisationId,
        OrgType = "volunteer",
        UserId = userId,
        Role = role,
        Status = "active",
        CreatedAt = DateTime.UtcNow
    };

    private async Task<string> CreateTokenAsync(int shiftId)
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync(PersonalPath(shiftId));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        AssertLaravelDataEnvelope(body);
        var token = body.GetProperty("data").GetProperty("qr_token").GetString();
        token.Should().MatchRegex("^[0-9a-f]{64}$");
        return token!;
    }

    private async Task AuthenticateActorAsync(AttendanceScenario scenario, string actorKind)
    {
        var email = actorKind switch
        {
            "owner" => scenario.OwnerEmail,
            "org_admin" => scenario.OrgAdminEmail,
            "org_manager" => scenario.OrgManagerEmail,
            "org_coordinator" => scenario.OrgCoordinatorEmail,
            "platform_admin" => TestData.AdminUser.Email,
            _ => throw new ArgumentOutOfRangeException(nameof(actorKind), actorKind, null)
        };
        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant1.Slug));
    }

    private HttpClient AuthorizedClient(string token)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task AssertEveryRouteFeatureDisabledAsync(int shiftId)
    {
        var routes = new[]
        {
            (HttpMethod.Get, PersonalPath(shiftId)),
            (HttpMethod.Get, RosterPath(shiftId)),
            (HttpMethod.Post, VerifyPath(FakeToken)),
            (HttpMethod.Post, CheckoutPath(FakeToken))
        };

        foreach (var (method, path) in routes)
        {
            using var request = new HttpRequestMessage(method, path);
            var response = await Client.SendAsync(request);
            await AssertLaravelErrorAsync(response, HttpStatusCode.Forbidden, "FEATURE_DISABLED");
        }
    }

    private async Task SetConfigAsync(string key, string value)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var config = await db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(candidate =>
            candidate.TenantId == TestData.Tenant1.Id && candidate.Key == key);
        if (config is null)
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
            config.Value = value;
            config.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
    }

    private async Task<string> GetPersistedMemberDisplayNameAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Users.IgnoreQueryFilters()
            .Where(user => user.TenantId == TestData.Tenant1.Id
                && user.Id == TestData.MemberUser.Id)
            .Select(user => (user.FirstName + " " + user.LastName).Trim())
            .SingleAsync();
    }

    private async Task UpdateApplicationAsync(
        int applicationId,
        ApplicationStatus status,
        int? shiftId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        await db.VolunteerApplications.IgnoreQueryFilters()
            .Where(application => application.Id == applicationId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(application => application.Status, status)
                .SetProperty(application => application.ShiftId, shiftId)
                .SetProperty(application => application.UpdatedAt, DateTime.UtcNow));
    }

    private async Task InvalidateAttendanceAsync(AttendanceScenario scenario, string invalidation)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        switch (invalidation)
        {
            case "cancelled":
                await db.VolunteerShifts.IgnoreQueryFilters()
                    .Where(shift => shift.Id == scenario.ShiftId)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(shift => shift.Status, ShiftStatus.Cancelled)
                        .SetProperty(shift => shift.UpdatedAt, DateTime.UtcNow));
                break;
            case "completed":
                await db.VolunteerShifts.IgnoreQueryFilters()
                    .Where(shift => shift.Id == scenario.ShiftId)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(shift => shift.Status, ShiftStatus.Completed)
                        .SetProperty(shift => shift.UpdatedAt, DateTime.UtcNow));
                break;
            case "reassigned":
                await db.VolunteerApplications.IgnoreQueryFilters()
                    .Where(application => application.Id == scenario.ApplicationId)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(application => application.ShiftId, (int?)null)
                        .SetProperty(application => application.UpdatedAt, DateTime.UtcNow));
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(invalidation), invalidation, null);
        }
    }

    private async Task MoveShiftOutsideVerificationWindowAsync(int shiftId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        await db.VolunteerShifts.IgnoreQueryFilters()
            .Where(shift => shift.Id == shiftId && shift.TenantId == TestData.Tenant1.Id)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(shift => shift.StartsAt, now.AddHours(-10))
                .SetProperty(shift => shift.EndsAt, now.AddHours(-9))
                .SetProperty(shift => shift.UpdatedAt, now));
    }

    private async Task<DateTime?> GetCheckedInAtAsync(int shiftId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.VolunteerCheckIns.IgnoreQueryFilters()
            .Where(checkin =>
                checkin.TenantId == TestData.Tenant1.Id
                && checkin.ShiftId == shiftId
                && checkin.UserId == TestData.MemberUser.Id)
            .Select(checkin => checkin.CheckedInAt)
            .SingleAsync();
    }

    private async Task AssertCheckinCountAsync(int shiftId, int expected)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var count = await db.VolunteerCheckIns.IgnoreQueryFilters().CountAsync(checkin =>
            checkin.TenantId == TestData.Tenant1.Id
            && checkin.ShiftId == shiftId);
        count.Should().Be(expected);
    }

    private async Task AssertCheckinStateAsync(
        int shiftId,
        string expectedStatus,
        bool checkedIn,
        bool checkedOut)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.VolunteerCheckIns.IgnoreQueryFilters().SingleAsync(checkin =>
            checkin.TenantId == TestData.Tenant1.Id
            && checkin.ShiftId == shiftId
            && checkin.UserId == TestData.MemberUser.Id);
        row.Status.Should().Be(expectedStatus);
        (row.CheckedInAt is not null).Should().Be(checkedIn);
        (row.CheckedOutAt is not null).Should().Be(checkedOut);
        row.TransactionId.Should().BeNull();
        row.HoursLogged.Should().BeNull();
    }

    private async Task<RewardSnapshot> CaptureSideEffectsAsync(AttendanceScenario scenario)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var user = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleAsync(candidate =>
            candidate.Id == TestData.MemberUser.Id
            && candidate.TenantId == TestData.Tenant1.Id);
        var incoming = await db.Transactions.IgnoreQueryFilters()
            .Where(transaction =>
                transaction.TenantId == TestData.Tenant1.Id
                && transaction.ReceiverId == TestData.MemberUser.Id
                && transaction.Status == TransactionStatus.Completed)
            .SumAsync(transaction => (decimal?)transaction.Amount) ?? 0m;
        var outgoing = await db.Transactions.IgnoreQueryFilters()
            .Where(transaction =>
                transaction.TenantId == TestData.Tenant1.Id
                && transaction.SenderId == TestData.MemberUser.Id
                && transaction.Status == TransactionStatus.Completed)
            .SumAsync(transaction => (decimal?)transaction.Amount) ?? 0m;
        var checkinTransactionId = await db.VolunteerCheckIns.IgnoreQueryFilters()
            .Where(checkin =>
                checkin.TenantId == TestData.Tenant1.Id
                && checkin.ShiftId == scenario.ShiftId
                && checkin.UserId == TestData.MemberUser.Id)
            .Select(checkin => checkin.TransactionId)
            .SingleAsync();

        return new RewardSnapshot(
            await db.VolunteerLogs.IgnoreQueryFilters().CountAsync(log =>
                log.TenantId == TestData.Tenant1.Id
                && log.UserId == TestData.MemberUser.Id
                && log.OpportunityId == scenario.OpportunityId),
            await db.Transactions.IgnoreQueryFilters().CountAsync(transaction =>
                transaction.TenantId == TestData.Tenant1.Id
                && (transaction.SenderId == TestData.MemberUser.Id
                    || transaction.ReceiverId == TestData.MemberUser.Id)),
            await db.XpLogs.IgnoreQueryFilters().CountAsync(log =>
                log.TenantId == TestData.Tenant1.Id
                && log.UserId == TestData.MemberUser.Id),
            await db.VolunteerOrganisationTransactions.IgnoreQueryFilters().CountAsync(transaction =>
                transaction.TenantId == TestData.Tenant1.Id
                && transaction.VolunteerOrganisationId == scenario.OrganisationId),
            await db.VolunteerOrganisations.IgnoreQueryFilters()
                .Where(organisation =>
                    organisation.TenantId == TestData.Tenant1.Id
                    && organisation.Id == scenario.OrganisationId)
                .Select(organisation => organisation.Balance)
                .SingleAsync(),
            incoming - outgoing,
            user.TotalXp,
            user.Level,
            checkinTransactionId);
    }

    private async Task AssertSideEffectsUnchangedAsync(
        AttendanceScenario scenario,
        RewardSnapshot before)
    {
        var after = await CaptureSideEffectsAsync(scenario);
        after.Should().Be(before);
        after.CheckinTransactionId.Should().BeNull();
    }

    private static void AssertLaravelDataEnvelope(JsonElement body)
    {
        body.TryGetProperty("data", out _).Should().BeTrue();
        body.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();
    }

    private static async Task AssertLaravelErrorAsync(
        HttpResponseMessage response,
        HttpStatusCode status,
        string code)
    {
        response.StatusCode.Should().Be(status);
        var body = await ReadJsonAsync(response);
        var errors = body.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().ContainSingle();
        errors[0].GetProperty("code").GetString().Should().Be(code);
        errors[0].GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static string PersonalPath(int shiftId) =>
        $"/api/v2/volunteering/shifts/{shiftId}/checkin";

    private static string RosterPath(int shiftId) =>
        $"/api/v2/volunteering/shifts/{shiftId}/checkins";

    private static string VerifyPath(string token) =>
        $"/api/v2/volunteering/checkin/verify/{token}";

    private static string CheckoutPath(string token) =>
        $"/api/v2/volunteering/checkin/checkout/{token}";

    private sealed record AttendanceScenario(
        int OrganisationId,
        int OpportunityId,
        int ShiftId,
        int ApplicationId,
        int OwnerId,
        string OwnerEmail,
        string OrgAdminEmail,
        string OrgManagerEmail,
        string OrgCoordinatorEmail,
        string OutsiderEmail);

    private sealed record TenantConfigSnapshot(
        bool Exists,
        string Value,
        DateTime CreatedAt,
        DateTime? UpdatedAt);

    private sealed record RewardSnapshot(
        int VolunteerLogCount,
        int TransactionCount,
        int XpLogCount,
        int VolunteerOrganisationTransactionCount,
        decimal OrganisationBalance,
        decimal PersonalLedgerBalance,
        int TotalXp,
        int Level,
        int? CheckinTransactionId);
}
