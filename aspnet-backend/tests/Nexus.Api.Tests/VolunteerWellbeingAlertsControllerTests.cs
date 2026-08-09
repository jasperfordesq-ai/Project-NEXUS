// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class VolunteerWellbeingAlertsControllerTests : IntegrationTestBase
{
    private const string Path = "/api/v2/admin/volunteering/wellbeing/alerts";
    private readonly HashSet<int> _createdAlertIds = [];
    private readonly HashSet<int> _createdConfigIds = [];
    private readonly HashSet<int> _createdUserIds = [];

    public VolunteerWellbeingAlertsControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task Index_RequiresAuthentication()
    {
        ClearAuthToken();

        var response = await Client.GetAsync(Path);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Index_RejectsRegularMemberWithLaravelEnvelope()
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(Path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("FORBIDDEN");
        body.GetProperty("errors")[0].GetProperty("message").GetString().Should().Be("Admin access required");
    }

    [Fact]
    public async Task Index_DefaultsToActive_OrdersByRisk_AndUsesExactCollectionShape()
    {
        var lowId = await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 35.25m, "{\"long_hours\":true}");
        var highId = await InsertAlertAsync(TestData.Tenant1.Id, TestData.AdminUser.Id, "active", 92.5m, "{\"missed_breaks\":2}");
        await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "resolved", 99m, "{}");
        await InsertAlertAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "active", 100m, "{}");

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync(Path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.GetValues("API-Version").Single().Should().Be("2.0");
        response.Headers.GetValues("X-Tenant-ID").Single().Should().Be(TestData.Tenant1.Id.ToString());

        var data = body.GetProperty("data");
        data.GetArrayLength().Should().Be(2);
        data[0].GetProperty("id").GetInt32().Should().Be(highId);
        data[1].GetProperty("id").GetInt32().Should().Be(lowId);
        data[0].GetProperty("user_name").GetString().Should().Be("Admin User");
        data[0].GetProperty("risk_score").GetDecimal().Should().Be(92.5m);
        data[0].GetProperty("indicators").GetProperty("missed_breaks").GetInt32().Should().Be(2);
        data.EnumerateArray().Should().OnlyContain(item => item.GetProperty("status").GetString() == "active");

        var meta = body.GetProperty("meta");
        meta.GetProperty("base_url").GetString().Should().Be("http://localhost");
        meta.GetProperty("per_page").GetInt32().Should().Be(2);
        meta.GetProperty("has_more").GetBoolean().Should().BeFalse();
        meta.TryGetProperty("total", out _).Should().BeFalse();
        meta.TryGetProperty("cursor", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Index_FiltersStatus_AndRejectsInvalidCaseExactly()
    {
        var resolvedId = await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "resolved", 40m, "{}");
        await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 80m, "{}");
        await AuthenticateAsAdminAsync();

        var filtered = await Client.GetAsync(Path + "?status=resolved");
        var filteredBody = await filtered.Content.ReadFromJsonAsync<JsonElement>();
        filtered.StatusCode.Should().Be(HttpStatusCode.OK);
        filteredBody.GetProperty("data").GetArrayLength().Should().Be(1);
        filteredBody.GetProperty("data")[0].GetProperty("id").GetInt32().Should().Be(resolvedId);

        var invalid = await Client.GetAsync(Path + "?status=Resolved");
        var invalidBody = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = invalidBody.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be(
            "Invalid status. Must be one of: active, acknowledged, resolved, dismissed");
        error.GetProperty("field").GetString().Should().Be("status");
    }

    [Fact]
    public async Task Index_ExcludesAlertWhoseUserBelongsToAnotherTenant()
    {
        await InsertAlertAsync(TestData.Tenant1.Id, TestData.OtherTenantUser.Id, "active", 95m, "{}");
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(Path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        body.GetProperty("data").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Index_EmptyOrZeroStatusDefaultsActive_AndPaginationParamsAreIgnored()
    {
        await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 70m, "null");
        await InsertAlertAsync(TestData.Tenant1.Id, TestData.AdminUser.Id, "active", 65m, "{}");
        await AuthenticateAsAdminAsync();

        var emptyStatus = await Client.GetAsync(Path + "?status=&limit=1&offset=99&page=50");
        var emptyBody = await emptyStatus.Content.ReadFromJsonAsync<JsonElement>();
        emptyStatus.StatusCode.Should().Be(HttpStatusCode.OK);
        emptyBody.GetProperty("data").GetArrayLength().Should().Be(2);
        emptyBody.GetProperty("data")[0].GetProperty("indicators").ValueKind.Should().Be(JsonValueKind.Array);
        emptyBody.GetProperty("data")[0].GetProperty("indicators").GetArrayLength().Should().Be(0);

        var zeroStatus = await Client.GetAsync(Path + "?status=0&per_page=1");
        var zeroBody = await zeroStatus.Content.ReadFromJsonAsync<JsonElement>();
        zeroStatus.StatusCode.Should().Be(HttpStatusCode.OK);
        zeroBody.GetProperty("data").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task Service_MalformedIndicatorsFallbackToEmptyArray()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(919);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase($"wellbeing-malformed-{Guid.NewGuid():N}")
            .Options;

        await using var db = new NexusDbContext(options, tenantContext);
        db.Users.Add(new User
        {
            Id = 929,
            TenantId = 919,
            Email = "malformed@test.com",
            PasswordHash = "test",
            FirstName = "Malformed",
            LastName = "Indicators",
            Role = "member",
            IsActive = true
        });
        db.VolunteerWellbeingAlerts.Add(new VolunteerWellbeingAlert
        {
            Id = 939,
            TenantId = 919,
            UserId = 929,
            RiskLevel = "high",
            RiskScore = 70m,
            Indicators = "not-json",
            Status = "active"
        });
        await db.SaveChangesAsync();

        var service = new VolunteerWellbeingAlertService(db, NullLogger<VolunteerWellbeingAlertService>.Instance);
        var alerts = await service.ListAsync(919, "active", CancellationToken.None);

        alerts.Should().ContainSingle();
        JsonSerializer.Serialize(alerts[0].Indicators).Should().Be("[]");
    }

    [Fact]
    public async Task Service_QueryFailureReturnsEmptyCollection()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(949);
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase($"wellbeing-query-failure-{Guid.NewGuid():N}")
            .Options;
        var db = new NexusDbContext(options, tenantContext);
        var service = new VolunteerWellbeingAlertService(db, NullLogger<VolunteerWellbeingAlertService>.Instance);
        await db.DisposeAsync();

        var alerts = await service.ListAsync(949, "active", CancellationToken.None);

        alerts.Should().BeEmpty();
    }

    [Fact]
    public async Task Update_TransitionsStatus_PersistsNoteAndResolvedTimestamp()
    {
        var id = await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 82.5m, "{}");
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(Path + $"/{id}", new
        {
            status = "resolved",
            note = "  Reached out to the volunteer.  "
        });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        body.GetProperty("data").GetProperty("id").GetInt32().Should().Be(id);
        body.GetProperty("data").GetProperty("status").GetString().Should().Be("resolved");
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().Be("http://localhost");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerWellbeingAlerts.IgnoreQueryFilters().SingleAsync(alert => alert.Id == id);
        stored.Status.Should().Be("resolved");
        stored.CoordinatorNotified.Should().BeTrue();
        stored.CoordinatorNotes.Should().Be("Reached out to the volunteer.");
        stored.ResolvedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Update_BlankNoteDoesNotOverwrite_AndLaterStatusRetainsResolvedAt()
    {
        var id = await InsertAlertAsync(
            TestData.Tenant1.Id,
            TestData.MemberUser.Id,
            "resolved",
            60m,
            "{}",
            coordinatorNotes: "Existing note",
            resolvedAt: DateTime.UtcNow.AddDays(-1));
        await AuthenticateAsAdminAsync();

        var omitted = await Client.PutAsJsonAsync(Path + $"/{id}", new { status = "acknowledged" });
        omitted.StatusCode.Should().Be(HttpStatusCode.OK);

        var explicitNull = await Client.PutAsJsonAsync(Path + $"/{id}", new { status = "resolved", note = (string?)null });
        explicitNull.StatusCode.Should().Be(HttpStatusCode.OK);

        var blank = await Client.PutAsJsonAsync(Path + $"/{id}", new { status = "dismissed", note = "   " });
        blank.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerWellbeingAlerts.IgnoreQueryFilters().SingleAsync(alert => alert.Id == id);
        stored.Status.Should().Be("dismissed");
        stored.CoordinatorNotes.Should().Be("Existing note");
        stored.ResolvedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Update_TruncatesCoordinatorNoteToTwoThousandUnicodeScalars()
    {
        var id = await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 60m, "{}");
        var longNote = string.Concat(Enumerable.Repeat("😀", 2001));
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(Path + $"/{id}", new { status = "acknowledged", note = longNote });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.VolunteerWellbeingAlerts.IgnoreQueryFilters().SingleAsync(alert => alert.Id == id);
        stored.CoordinatorNotes.Should().NotBeNull();
        stored.CoordinatorNotes!.EnumerateRunes().Count().Should().Be(2000);
        stored.CoordinatorNotes.Should().Be(string.Concat(Enumerable.Repeat("😀", 2000)));
    }

    [Fact]
    public async Task Update_RejectsInvalidOrMissingStatusWithExactValidationError()
    {
        var id = await InsertAlertAsync(TestData.Tenant1.Id, TestData.MemberUser.Id, "active", 55m, "{}");
        await AuthenticateAsAdminAsync();

        var invalid = await Client.PutAsJsonAsync(Path + $"/{id}", new { status = "active" });
        var body = await invalid.Content.ReadFromJsonAsync<JsonElement>();

        invalid.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = body.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be(
            "Invalid status. Must be one of: acknowledged, resolved, dismissed");
        error.GetProperty("field").GetString().Should().Be("status");

        var missing = await Client.PutAsJsonAsync(Path + $"/{id}", new { note = "No status" });
        missing.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Update_IsTenantScopedAndReturnsCanonicalNotFoundEnvelope()
    {
        var otherTenantId = await InsertAlertAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "active", 75m, "{}");
        await AuthenticateAsAdminAsync();

        var response = await Client.PutAsJsonAsync(Path + $"/{otherTenantId}", new { status = "acknowledged" });
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("NOT_FOUND");
        body.GetProperty("errors")[0].GetProperty("message").GetString().Should().Be("Alert not found");
    }

    [Fact]
    public async Task ExplicitlyDisabledFeatureReturnsCanonicalForbiddenEnvelope()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = VolunteerWellbeingAlertService.FeatureConfigKey,
                Value = "false",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            _createdConfigIds.Add(await db.TenantConfigs
                .Where(config => config.TenantId == TestData.Tenant1.Id && config.Key == VolunteerWellbeingAlertService.FeatureConfigKey)
                .Select(config => config.Id)
                .SingleAsync());
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync(Path);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        body.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be("FEATURE_DISABLED");
        body.GetProperty("errors")[0].GetProperty("message").GetString().Should().Be(
            "Volunteering module is not enabled for this community");
    }

    [Fact]
    public async Task Index_RateLimitUsesPerUserBucketAndCanonical429Contract()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var rateLimitAdmin = new User
            {
                TenantId = TestData.Tenant1.Id,
                Email = "wellbeing-rate-admin@test.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Rate",
                LastName = "Admin",
                Role = "admin",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.Add(rateLimitAdmin);
            await db.SaveChangesAsync();
            _createdUserIds.Add(rateLimitAdmin.Id);
        }

        var token = await GetAccessTokenAsync("wellbeing-rate-admin@test.com", "test-tenant");
        SetAuthToken(token);

        HttpResponseMessage response = null!;
        for (var attempt = 1; attempt <= 31; attempt++)
        {
            response = await Client.GetAsync(Path);
            if (attempt <= 30)
            {
                response.StatusCode.Should().Be(HttpStatusCode.OK);
            }
        }

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.GetValues("X-RateLimit-Limit").Single().Should().Be("30");
        response.Headers.GetValues("X-RateLimit-Remaining").Single().Should().Be("0");
        response.Headers.GetValues("Retry-After").Single().Should().NotBeNullOrWhiteSpace();
        long.TryParse(response.Headers.GetValues("X-RateLimit-Reset").Single(), out var reset).Should().BeTrue();
        reset.Should().BeGreaterThan(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        body.GetProperty("success").GetBoolean().Should().BeFalse();
        body.GetProperty("error").GetString().Should().Be("Rate limit exceeded. Please try again later.");
        body.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
    }

    private async Task<int> InsertAlertAsync(
        int tenantId,
        int userId,
        string status,
        decimal riskScore,
        string indicators,
        string? coordinatorNotes = null,
        DateTime? resolvedAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var alert = new VolunteerWellbeingAlert
        {
            TenantId = tenantId,
            UserId = userId,
            RiskLevel = riskScore >= 80m ? "critical" : riskScore >= 60m ? "high" : "moderate",
            RiskScore = riskScore,
            Indicators = indicators,
            CoordinatorNotified = coordinatorNotes is not null,
            CoordinatorNotes = coordinatorNotes,
            Status = status,
            ResolvedAt = resolvedAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        db.VolunteerWellbeingAlerts.Add(alert);
        await db.SaveChangesAsync();
        _createdAlertIds.Add(alert.Id);
        return alert.Id;
    }

    public override async Task DisposeAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        if (_createdAlertIds.Count > 0)
        {
            await db.VolunteerWellbeingAlerts.IgnoreQueryFilters()
                .Where(alert => _createdAlertIds.Contains(alert.Id))
                .ExecuteDeleteAsync();
        }

        if (_createdConfigIds.Count > 0)
        {
            await db.TenantConfigs.IgnoreQueryFilters()
                .Where(config => _createdConfigIds.Contains(config.Id))
                .ExecuteDeleteAsync();
        }

        if (_createdUserIds.Count > 0)
        {
            await db.Users.IgnoreQueryFilters()
                .Where(user => _createdUserIds.Contains(user.Id))
                .ExecuteDeleteAsync();
        }

        await base.DisposeAsync();
    }
}
