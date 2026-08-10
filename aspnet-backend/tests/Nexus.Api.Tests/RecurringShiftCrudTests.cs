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
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class RecurringShiftCrudTests : IntegrationTestBase
{
    private const string OpportunityPatternsPath =
        "/api/v2/volunteering/opportunities/{0}/recurring-patterns";
    private const string PatternPath = "/api/v2/volunteering/recurring-patterns/{0}";

    private static readonly string[] CanonicalPatternFields =
    {
        "id",
        "opportunity_id",
        "title",
        "frequency",
        "days_of_week",
        "start_time",
        "end_time",
        "spots_per_shift",
        "capacity",
        "start_date",
        "end_date",
        "max_occurrences",
        "occurrences_generated",
        "is_active",
        "created_by",
        "created_by_name",
        "created_at",
        "updated_at"
    };

    public RecurringShiftCrudTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalCrudRoutes_RequireAuthentication()
    {
        ClearAuthToken();
        var calls = new[]
        {
            new CrudCall(HttpMethod.Get, string.Format(OpportunityPatternsPath, 999_991), null),
            new CrudCall(HttpMethod.Post, string.Format(OpportunityPatternsPath, 999_991), ValidCreatePayload()),
            new CrudCall(HttpMethod.Put, string.Format(PatternPath, 999_991), ValidCreatePayload()),
            new CrudCall(HttpMethod.Delete, string.Format(PatternPath, 999_991), null)
        };

        foreach (var call in calls)
        {
            using var request = CreateRequest(call);
            using var response = await Client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
                $"{call.Method} {call.Path} is an authenticated canonical route");
        }

        for (var attempt = 0; attempt < 12; attempt++)
        {
            using var response = await Client.PostAsJsonAsync(
                string.Format(OpportunityPatternsPath, 999_991),
                ValidCreatePayload());
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
                "authorization must short-circuit before the 10/minute create bucket");
        }
    }

    [Fact]
    public async Task CanonicalCreate_BindsIsoDayArrayAppliesDefaultsAndDoesNotGenerateEagerly()
    {
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            opportunityId = (await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Member recurring opportunity")).Id;
        }

        await AuthenticateAsMemberAsync();
        var before = DateOnly.FromDateTime(DateTime.UtcNow);
        using var response = await Client.PostAsJsonAsync(
            string.Format(OpportunityPatternsPath, opportunityId),
            new Dictionary<string, object?>
            {
                ["title"] = "Weekend welcome rota",
                ["days_of_week"] = new[] { 1, 7 },
                ["start_time"] = "09:00:00",
                ["end_time"] = "11:00:00"
            });
        var after = DateOnly.FromDateTime(DateTime.UtcNow);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await ReadJsonAsync(response);
        AssertBaseMeta(body);
        var data = body.GetProperty("data");
        AssertCanonicalPatternProjection(data);
        data.GetProperty("opportunity_id").GetInt32().Should().Be(opportunityId);
        data.GetProperty("title").GetString().Should().Be("Weekend welcome rota");
        data.GetProperty("frequency").GetString().Should().Be("weekly");
        ReadIntArray(data.GetProperty("days_of_week")).Should().Equal(1, 7);
        data.GetProperty("start_time").GetString().Should().Be("09:00:00");
        data.GetProperty("end_time").GetString().Should().Be("11:00:00");
        data.GetProperty("spots_per_shift").GetInt32().Should().Be(1);
        data.GetProperty("capacity").GetInt32().Should().Be(1);
        var responseStartDate = DateOnly.Parse(data.GetProperty("start_date").GetString()!);
        responseStartDate.Should().BeOneOf(before, after);
        data.GetProperty("end_date").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("max_occurrences").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("occurrences_generated").GetInt32().Should().Be(0);
        data.GetProperty("is_active").GetBoolean().Should().BeTrue();
        data.GetProperty("created_by").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("created_by_name").GetString().Should().Be("Member User");
        data.GetProperty("created_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("updated_at").GetString().Should().NotBeNullOrWhiteSpace();

        var patternId = data.GetProperty("id").GetInt32();
        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == patternId);
        stored.TenantId.Should().Be(TestData.Tenant1.Id);
        stored.OpportunityId.Should().Be(opportunityId);
        stored.Frequency.Should().Be("weekly");
        JsonSerializer.Deserialize<int[]>(stored.DaysOfWeek!).Should().Equal(1, 7);
        stored.StartDate.Should().Be(responseStartDate);
        stored.Capacity.Should().Be(1);
        stored.SpotsPerShift.Should().Be(1);
        stored.OccurrencesGenerated.Should().Be(0);
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .AnyAsync(shift => shift.RecurringPatternId == patternId)).Should().BeFalse();
    }

    [Fact]
    public async Task CanonicalCreate_AllowsDedicatedOrganisationOwnerIndependentOfPublicStatus()
    {
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var organisation = new VolunteerOrganisation
            {
                TenantId = TestData.Tenant1.Id,
                OwnerUserId = TestData.MemberUser.Id,
                Name = $"Recurring Owner Hub {Guid.NewGuid():N}",
                Slug = $"recurring-owner-{Guid.NewGuid():N}",
                Description = "Suspended organisation management policy fixture.",
                ContactEmail = "recurring-owner@example.test",
                Status = "suspended",
                CreatedAt = DateTime.UtcNow
            };
            db.VolunteerOrganisations.Add(organisation);
            await db.SaveChangesAsync();
            var opportunity = await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Organisation-owned recurring opportunity");
            opportunity.VolunteerOrganisationId = organisation.Id;
            await db.SaveChangesAsync();
            opportunityId = opportunity.Id;
        }

        await AuthenticateAsMemberAsync();
        using var response = await Client.PostAsJsonAsync(
            string.Format(OpportunityPatternsPath, opportunityId),
            ValidCreatePayload(title: "Organisation owner rota"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("opportunity_id").GetInt32().Should().Be(opportunityId);
        data.GetProperty("created_by").GetInt32().Should().Be(TestData.MemberUser.Id);
    }

    [Fact]
    public async Task CanonicalCreate_PreservesExplicitZeroCapacityAndUsesLaravelSpotsDefault()
    {
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            opportunityId = (await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Zero-capacity recurring opportunity")).Id;
        }

        await AuthenticateAsMemberAsync();
        var payload = ValidCreatePayload(title: "Zero-capacity pattern");
        payload["capacity"] = 0;
        payload["spots_per_shift"] = 99;
        payload["days_of_week"] = new object[] { "1", 2, true };
        using var response = await Client.PostAsJsonAsync(
            string.Format(OpportunityPatternsPath, opportunityId),
            payload);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("capacity").GetInt32().Should().Be(0);
        data.GetProperty("spots_per_shift").GetInt32().Should().Be(1,
            "the Laravel controller does not pass spots_per_shift on create");
        var days = data.GetProperty("days_of_week");
        days[0].GetString().Should().Be("1");
        days[1].GetInt32().Should().Be(2);
        days[2].GetBoolean().Should().BeTrue();

        var patternId = data.GetProperty("id").GetInt32();
        using var verify = Factory.Services.CreateScope();
        var stored = await verify.ServiceProvider.GetRequiredService<NexusDbContext>()
            .RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == patternId);
        stored.Capacity.Should().Be(0);
        stored.SpotsPerShift.Should().Be(1);
    }

    [Fact]
    public async Task CanonicalCreate_RejectsInvalidFrequencyAndMissingTimesWithoutWriting()
    {
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            opportunityId = (await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Validation opportunity")).Id;
        }

        await AuthenticateAsMemberAsync();
        using (var invalidFrequency = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, opportunityId),
                   ValidCreatePayload(frequency: "WEEKLY")))
        {
            invalidFrequency.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(invalidFrequency, "VALIDATION_ERROR");
        }

        using (var missingTimes = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, opportunityId),
                   new Dictionary<string, object?>
                   {
                       ["title"] = "No working hours",
                       ["frequency"] = "weekly",
                       ["days_of_week"] = new[] { 1 }
                   }))
        {
            missingTimes.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(missingTimes, "VALIDATION_ERROR");
        }

        using (var negativeCapacity = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, opportunityId),
                   new Dictionary<string, object?>(ValidCreatePayload())
                   {
                       ["capacity"] = -1
                   }))
        {
            negativeCapacity.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(negativeCapacity, "SERVER_ERROR");
        }

        using (var negativeMaximum = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, opportunityId),
                   new Dictionary<string, object?>(ValidCreatePayload())
                   {
                       ["max_occurrences"] = -1
                   }))
        {
            negativeMaximum.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(negativeMaximum, "SERVER_ERROR");
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .CountAsync(pattern => pattern.OpportunityId == opportunityId)).Should().Be(0);
    }

    [Fact]
    public async Task CanonicalCrud_HidesCrossTenantResourcesAndForbidsSameTenantNonManager()
    {
        int sameTenantOpportunityId;
        int sameTenantPatternId;
        int otherTenantOpportunityId;
        int otherTenantPatternId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var sameTenantOpportunity = await AddOpportunityAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "Admin-owned opportunity");
            var sameTenantPattern = await AddPatternAsync(
                db,
                sameTenantOpportunity,
                TestData.AdminUser.Id,
                "Admin-owned pattern",
                createdAt: DateTime.UtcNow.AddDays(-2));
            var otherTenantOpportunity = await AddOpportunityAsync(
                db, TestData.Tenant2.Id, TestData.OtherTenantUser.Id, "Other tenant opportunity");
            var otherTenantPattern = await AddPatternAsync(
                db,
                otherTenantOpportunity,
                TestData.OtherTenantUser.Id,
                "Other tenant pattern",
                createdAt: DateTime.UtcNow.AddDays(-1));

            sameTenantOpportunityId = sameTenantOpportunity.Id;
            sameTenantPatternId = sameTenantPattern.Id;
            otherTenantOpportunityId = otherTenantOpportunity.Id;
            otherTenantPatternId = otherTenantPattern.Id;
        }

        await AuthenticateAsMemberAsync();

        using (var create = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, sameTenantOpportunityId),
                   ValidCreatePayload()))
        {
            create.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(create, "FORBIDDEN");
        }

        using (var update = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, sameTenantPatternId),
                   new Dictionary<string, object?> { ["title"] = "Unauthorized edit" }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(update, "FORBIDDEN");
        }

        using (var delete = await Client.DeleteAsync(string.Format(PatternPath, sameTenantPatternId)))
        {
            delete.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            await AssertErrorAsync(delete, "FORBIDDEN");
        }

        using (var list = await Client.GetAsync(
                   string.Format(OpportunityPatternsPath, otherTenantOpportunityId)))
        {
            list.StatusCode.Should().Be(HttpStatusCode.OK);
            var patterns = (await ReadJsonAsync(list)).GetProperty("data").GetProperty("patterns");
            patterns.GetArrayLength().Should().Be(0);
        }

        using (var create = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, otherTenantOpportunityId),
                   ValidCreatePayload()))
        {
            create.StatusCode.Should().Be(HttpStatusCode.NotFound);
            await AssertErrorAsync(create, "NOT_FOUND");
        }

        using (var update = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, otherTenantPatternId),
                   new Dictionary<string, object?> { ["title"] = "Cross-tenant edit" }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.NotFound);
            await AssertErrorAsync(update, "NOT_FOUND");
        }

        using (var delete = await Client.DeleteAsync(string.Format(PatternPath, otherTenantPatternId)))
        {
            delete.StatusCode.Should().Be(HttpStatusCode.NotFound);
            await AssertErrorAsync(delete, "NOT_FOUND");
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedSameTenantPattern = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == sameTenantPatternId);
        storedSameTenantPattern.Title.Should().Be("Admin-owned pattern");
        storedSameTenantPattern.IsActive.Should().BeTrue();
        var storedOtherTenantPattern = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == otherTenantPatternId);
        storedOtherTenantPattern.Title.Should().Be("Other tenant pattern");
        storedOtherTenantPattern.IsActive.Should().BeTrue();
    }

    [Fact]
    public async Task CanonicalCreate_DoesNotBroadenLaravelAdminRolesWithStandalonePrivilegeFlags()
    {
        const int flaggedMemberId = 1_900_001_103;
        const string flaggedMemberEmail = "recurring-flagged-member@test.com";
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Users.Add(new User
            {
                Id = flaggedMemberId,
                TenantId = TestData.Tenant1.Id,
                Email = flaggedMemberEmail,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
                FirstName = "Flagged",
                LastName = "Member",
                Role = "member",
                IsAdmin = true,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
            opportunityId = (await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                "Role-exact authorization opportunity")).Id;
        }

        SetAuthToken(await GetAccessTokenAsync(flaggedMemberEmail, TestData.Tenant1.Slug));
        using var response = await Client.PostAsJsonAsync(
            string.Format(OpportunityPatternsPath, opportunityId),
            ValidCreatePayload());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AssertErrorAsync(response, "FORBIDDEN", "Forbidden");
    }

    [Fact]
    public async Task CanonicalList_IncludesInactivePatternsNewestFirstWithExactTenantSafeProjection()
    {
        int opportunityId;
        int olderPatternId;
        int newerPatternId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = await AddOpportunityAsync(
                db, TestData.Tenant1.Id, TestData.AdminUser.Id, "Listed recurring opportunity");
            var older = await AddPatternAsync(
                db,
                opportunity,
                TestData.AdminUser.Id,
                "Older active pattern",
                daysOfWeek: "[1,5]",
                spotsPerShift: 2,
                capacity: 4,
                isActive: true,
                createdAt: DateTime.UtcNow.AddDays(-3));
            var newer = await AddPatternAsync(
                db,
                opportunity,
                TestData.AdminUser.Id,
                "Newer inactive pattern",
                daysOfWeek: "[2,6]",
                spotsPerShift: 3,
                capacity: 5,
                isActive: false,
                createdAt: DateTime.UtcNow.AddDays(-1));

            // A deliberately inconsistent cross-tenant row sharing the opportunity ID
            // proves the response is tenant-scoped rather than merely FK-scoped.
            var crossTenant = new RecurringShiftPattern
            {
                TenantId = TestData.Tenant2.Id,
                OpportunityId = opportunity.Id,
                CreatedBy = TestData.OtherTenantUser.Id,
                Title = "Cross-tenant pattern",
                Frequency = "weekly",
                DaysOfWeek = "[7]",
                StartTime = TimeSpan.FromHours(9),
                EndTime = TimeSpan.FromHours(10),
                SpotsPerShift = 9,
                Capacity = 9,
                StartDate = DateOnly.FromDateTime(DateTime.UtcNow),
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.RecurringShiftPatterns.Add(crossTenant);
            await db.SaveChangesAsync();

            opportunityId = opportunity.Id;
            olderPatternId = older.Id;
            newerPatternId = newer.Id;
        }

        await AuthenticateAsMemberAsync();
        using var response = await Client.GetAsync(string.Format(OpportunityPatternsPath, opportunityId));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        AssertBaseMeta(body);
        var patterns = body.GetProperty("data").GetProperty("patterns");
        patterns.GetArrayLength().Should().Be(2);
        patterns.EnumerateArray().Select(pattern => pattern.GetProperty("id").GetInt32())
            .Should().Equal(newerPatternId, olderPatternId);

        var newerPayload = patterns[0];
        var olderPayload = patterns[1];
        AssertCanonicalPatternProjection(newerPayload);
        AssertCanonicalPatternProjection(olderPayload);
        newerPayload.GetProperty("is_active").GetBoolean().Should().BeFalse();
        olderPayload.GetProperty("is_active").GetBoolean().Should().BeTrue();
        ReadIntArray(newerPayload.GetProperty("days_of_week")).Should().Equal(2, 6);
        ReadIntArray(olderPayload.GetProperty("days_of_week")).Should().Equal(1, 5);
        newerPayload.GetProperty("spots_per_shift").GetInt32().Should().Be(3);
        newerPayload.GetProperty("capacity").GetInt32().Should().Be(5);
        newerPayload.GetProperty("created_by_name").GetString().Should().Be("Admin User");
    }

    [Fact]
    public async Task CanonicalUpdate_IsPartialSupportsExplicitNullAndAllowsTenantAdmin()
    {
        int patternId;
        var originalStartDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5);
        var originalEndDate = originalStartDate.AddMonths(2);
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = await AddOpportunityAsync(
                db, TestData.Tenant1.Id, TestData.MemberUser.Id, "Member-managed opportunity");
            var pattern = await AddPatternAsync(
                db,
                opportunity,
                TestData.MemberUser.Id,
                "Original pattern",
                frequency: "biweekly",
                daysOfWeek: "[1,3]",
                startTime: TimeSpan.FromHours(8),
                endTime: TimeSpan.FromHours(10),
                spotsPerShift: 2,
                capacity: 4,
                startDate: originalStartDate,
                endDate: originalEndDate,
                maxOccurrences: 12,
                occurrencesGenerated: 3,
                createdAt: DateTime.UtcNow.AddDays(-2));
            patternId = pattern.Id;
        }

        await AuthenticateAsAdminAsync();
        using (var update = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?>
                   {
                       ["title"] = "Updated by tenant admin",
                       ["days_of_week"] = new[] { 2, 4 },
                       ["spots_per_shift"] = 6,
                       ["capacity"] = 8
                   }))
        {
            update.StatusCode.Should().Be(HttpStatusCode.OK);
            var body = await ReadJsonAsync(update);
            AssertBaseMeta(body);
            var data = body.GetProperty("data");
            AssertCanonicalPatternProjection(data);
            data.GetProperty("title").GetString().Should().Be("Updated by tenant admin");
            ReadIntArray(data.GetProperty("days_of_week")).Should().Equal(2, 4);
            data.GetProperty("spots_per_shift").GetInt32().Should().Be(6);
            data.GetProperty("capacity").GetInt32().Should().Be(8);
            data.GetProperty("frequency").GetString().Should().Be("biweekly");
            data.GetProperty("start_time").GetString().Should().Be("08:00:00");
            data.GetProperty("end_time").GetString().Should().Be("10:00:00");
            data.GetProperty("start_date").GetString().Should().Be(originalStartDate.ToString("yyyy-MM-dd"));
            data.GetProperty("end_date").GetString().Should().Be(originalEndDate.ToString("yyyy-MM-dd"));
            data.GetProperty("max_occurrences").GetInt32().Should().Be(12);
            data.GetProperty("occurrences_generated").GetInt32().Should().Be(3);
            data.GetProperty("created_by").GetInt32().Should().Be(TestData.MemberUser.Id);
        }

        using (var clearEndDate = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?> { ["end_date"] = null }))
        {
            clearEndDate.StatusCode.Should().Be(HttpStatusCode.OK);
            var data = (await ReadJsonAsync(clearEndDate)).GetProperty("data");
            data.GetProperty("end_date").ValueKind.Should().Be(JsonValueKind.Null);
            data.GetProperty("title").GetString().Should().Be("Updated by tenant admin");
            data.GetProperty("frequency").GetString().Should().Be("biweekly");
        }

        using (var negativeSpots = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?> { ["spots_per_shift"] = -1 }))
        {
            negativeSpots.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(negativeSpots, "SERVER_ERROR");
        }

        using (var negativeMaximum = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?> { ["max_occurrences"] = -1 }))
        {
            negativeMaximum.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            await AssertErrorAsync(negativeMaximum, "SERVER_ERROR");
        }

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == patternId);
        stored.Title.Should().Be("Updated by tenant admin");
        stored.Frequency.Should().Be("biweekly");
        JsonSerializer.Deserialize<int[]>(stored.DaysOfWeek!).Should().Equal(2, 4);
        stored.StartTime.Should().Be(TimeSpan.FromHours(8));
        stored.EndTime.Should().Be(TimeSpan.FromHours(10));
        stored.SpotsPerShift.Should().Be(6);
        stored.Capacity.Should().Be(8);
        stored.StartDate.Should().Be(originalStartDate);
        stored.EndDate.Should().BeNull();
        stored.MaxOccurrences.Should().Be(12);
        stored.OccurrencesGenerated.Should().Be(3);
        stored.CreatedBy.Should().Be(TestData.MemberUser.Id);
        stored.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task CanonicalUpdate_TouchesTimestampForAllowedSameValueButNotUnknownOnlyBody()
    {
        int patternId;
        var originalUpdatedAt = DateTime.UtcNow.AddDays(-2);
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                TestData.MemberUser.Id,
                "Timestamp semantics opportunity");
            var pattern = await AddPatternAsync(
                db,
                opportunity,
                TestData.MemberUser.Id,
                "Same title",
                createdAt: DateTime.UtcNow.AddDays(-3));
            pattern.UpdatedAt = originalUpdatedAt;
            await db.SaveChangesAsync();
            patternId = pattern.Id;
        }

        await AuthenticateAsMemberAsync();
        using (var sameValue = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?> { ["title"] = "Same title" }))
        {
            sameValue.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        DateTime touchedAt;
        using (var verifyTouch = Factory.Services.CreateScope())
        {
            touchedAt = (await verifyTouch.ServiceProvider.GetRequiredService<NexusDbContext>()
                    .RecurringShiftPatterns.IgnoreQueryFilters()
                    .Where(pattern => pattern.Id == patternId)
                    .Select(pattern => pattern.UpdatedAt)
                    .SingleAsync())!.Value;
            touchedAt.Should().BeAfter(originalUpdatedAt);
        }

        using (var unknownOnly = await Client.PutAsJsonAsync(
                   string.Format(PatternPath, patternId),
                   new Dictionary<string, object?> { ["unknown_field"] = "ignored" }))
        {
            unknownOnly.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var verifyNoOp = Factory.Services.CreateScope();
        var afterUnknown = await verifyNoOp.ServiceProvider.GetRequiredService<NexusDbContext>()
            .RecurringShiftPatterns.IgnoreQueryFilters()
            .Where(pattern => pattern.Id == patternId)
            .Select(pattern => pattern.UpdatedAt)
            .SingleAsync();
        afterUnknown.Should().Be(touchedAt);
    }

    [Fact]
    public async Task CanonicalDelete_DeactivatesRemovesOnlyFutureShiftsAndCancelsTenantAlerts()
    {
        int patternId;
        int pastShiftId;
        int futureShiftId;
        int unrelatedShiftId;
        int crossTenantShiftId;
        int tenantAlertId;
        int crossTenantAlertId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var opportunity = await AddOpportunityAsync(
                db, TestData.Tenant1.Id, TestData.MemberUser.Id, "Delete cleanup opportunity");
            var pattern = await AddPatternAsync(
                db,
                opportunity,
                TestData.MemberUser.Id,
                "Pattern to deactivate",
                createdAt: DateTime.UtcNow.AddDays(-5));
            var unrelatedPattern = await AddPatternAsync(
                db,
                opportunity,
                TestData.MemberUser.Id,
                "Unrelated pattern",
                createdAt: DateTime.UtcNow.AddDays(-4));
            var crossTenantOpportunity = await AddOpportunityAsync(
                db,
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                "Cross-tenant delete cleanup opportunity");
            var crossTenantPattern = await AddPatternAsync(
                db,
                crossTenantOpportunity,
                TestData.OtherTenantUser.Id,
                "Cross-tenant pattern",
                createdAt: DateTime.UtcNow.AddDays(-3));

            var past = await AddShiftAsync(
                db, TestData.Tenant1.Id, opportunity.Id, pattern.Id, DateTime.UtcNow.AddDays(-2));
            var future = await AddShiftAsync(
                db, TestData.Tenant1.Id, opportunity.Id, pattern.Id, DateTime.UtcNow.AddDays(2));
            var unrelated = await AddShiftAsync(
                db, TestData.Tenant1.Id, opportunity.Id, unrelatedPattern.Id, DateTime.UtcNow.AddDays(3));
            var crossTenant = await AddShiftAsync(
                db,
                TestData.Tenant2.Id,
                crossTenantOpportunity.Id,
                crossTenantPattern.Id,
                DateTime.UtcNow.AddDays(4));
            var tenantAlert = await AddAlertAsync(
                db,
                TestData.Tenant1.Id,
                TestData.AdminUser.Id,
                opportunity.Id,
                future.Id,
                "Future shift alert");
            var crossTenantAlert = await AddAlertAsync(
                db,
                TestData.Tenant2.Id,
                TestData.OtherTenantUser.Id,
                crossTenantOpportunity.Id,
                crossTenant.Id,
                "Cross-tenant alert");

            patternId = pattern.Id;
            pastShiftId = past.Id;
            futureShiftId = future.Id;
            unrelatedShiftId = unrelated.Id;
            crossTenantShiftId = crossTenant.Id;
            tenantAlertId = tenantAlert.Id;
            crossTenantAlertId = crossTenantAlert.Id;
        }

        await AuthenticateAsAdminAsync();
        using var response = await Client.DeleteAsync(string.Format(PatternPath, patternId));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        AssertBaseMeta(body);
        var data = body.GetProperty("data");
        data.GetProperty("message").GetString().Should().Be("Recurring pattern deactivated");
        data.GetProperty("future_shifts_removed").GetInt32().Should().Be(1);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var storedPattern = await verifyDb.RecurringShiftPatterns.IgnoreQueryFilters()
            .SingleAsync(pattern => pattern.Id == patternId);
        storedPattern.IsActive.Should().BeFalse();
        storedPattern.UpdatedAt.Should().NotBeNull();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .AnyAsync(shift => shift.Id == futureShiftId)).Should().BeFalse();
        (await verifyDb.VolunteerShifts.IgnoreQueryFilters()
            .Where(shift => shift.Id == pastShiftId
                || shift.Id == unrelatedShiftId
                || shift.Id == crossTenantShiftId)
            .Select(shift => shift.Id)
            .ToListAsync()).Should().BeEquivalentTo(
                new[] { pastShiftId, unrelatedShiftId, crossTenantShiftId });

        var storedTenantAlert = await verifyDb.VolunteerEmergencyAlerts.IgnoreQueryFilters()
            .SingleAsync(alert => alert.Id == tenantAlertId);
        storedTenantAlert.IsActive.Should().BeFalse();
        storedTenantAlert.UpdatedAt.Should().NotBeNull();
        var storedCrossTenantAlert = await verifyDb.VolunteerEmergencyAlerts.IgnoreQueryFilters()
            .SingleAsync(alert => alert.Id == crossTenantAlertId);
        storedCrossTenantAlert.IsActive.Should().BeTrue();
        storedCrossTenantAlert.UpdatedAt.Should().BeNull();
    }

    [Fact]
    public async Task CanonicalCrudRoutes_WhenVolunteeringFeatureDisabled_ReturnBeforeLookup()
    {
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TestData.Tenant1.Id,
                Key = "feature.volunteering",
                Value = "false",
                CreatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        await AssertAllCrudRoutesReturnFeatureErrorAsync(
            "Volunteering module is not enabled for this community");
    }

    [Fact]
    public async Task CanonicalCrudRoutes_WhenRecurringFeatureDisabledViaAdminConfig_ReturnBeforeLookup()
    {
        await AuthenticateAsAdminAsync();
        using (var config = await Client.PutAsJsonAsync(
                   "/api/v2/admin/config/volunteering/bulk",
                   new
                   {
                       settings = new Dictionary<string, object?>
                       {
                           ["volunteering.enable_recurring_shifts"] = false
                       }
                   }))
        {
            config.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        await AssertAllCrudRoutesReturnFeatureErrorAsync(
            "This module is not enabled for this community.");
    }

    [Fact]
    public async Task CanonicalCreate_RateLimitUsesIndependentPerUserBucketAndCanonical429Contract()
    {
        const int organizerId = 1_900_001_101;
        const int secondAdminId = 1_900_001_102;
        const string organizerEmail = "recurring-rate-organizer@test.com";
        const string secondAdminEmail = "recurring-rate-admin@test.com";
        int opportunityId;
        using (var arrange = Factory.Services.CreateScope())
        {
            var db = arrange.ServiceProvider.GetRequiredService<NexusDbContext>();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword);
            var organizer = new User
            {
                Id = organizerId,
                TenantId = TestData.Tenant1.Id,
                Email = organizerEmail,
                PasswordHash = passwordHash,
                FirstName = "Recurring",
                LastName = "Organizer",
                Role = "member",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            var secondAdmin = new User
            {
                Id = secondAdminId,
                TenantId = TestData.Tenant1.Id,
                Email = secondAdminEmail,
                PasswordHash = passwordHash,
                FirstName = "Recurring",
                LastName = "Admin",
                Role = "admin",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            db.Users.AddRange(organizer, secondAdmin);
            await db.SaveChangesAsync();
            opportunityId = (await AddOpportunityAsync(
                db,
                TestData.Tenant1.Id,
                organizerId,
                "Rate limited recurring opportunity")).Id;
        }

        SetAuthToken(await GetAccessTokenAsync(organizerEmail, TestData.Tenant1.Slug));
        for (var attempt = 1; attempt <= 10; attempt++)
        {
            using var accepted = await Client.PostAsJsonAsync(
                string.Format(OpportunityPatternsPath, opportunityId),
                ValidCreatePayload(title: $"Accepted pattern {attempt}"));
            accepted.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using (var limited = await Client.PostAsJsonAsync(
                   string.Format(OpportunityPatternsPath, opportunityId),
                   ValidCreatePayload(title: "Rate limited pattern")))
        {
            limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            limited.Headers.GetValues("X-RateLimit-Limit").Single().Should().Be("10");
            limited.Headers.GetValues("X-RateLimit-Remaining").Single().Should().Be("0");
            limited.Headers.GetValues("Retry-After").Single().Should().NotBeNullOrWhiteSpace();
            long.TryParse(
                limited.Headers.GetValues("X-RateLimit-Reset").Single(),
                out var reset).Should().BeTrue();
            reset.Should().BeGreaterThan(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            var body = await ReadJsonAsync(limited);
            body.GetProperty("success").GetBoolean().Should().BeFalse();
            body.GetProperty("error").GetString().Should()
                .Be("Rate limit exceeded. Please try again later.");
            body.GetProperty("code").GetString().Should().Be("RATE_LIMIT_EXCEEDED");
        }

        SetAuthToken(await GetAccessTokenAsync(secondAdminEmail, TestData.Tenant1.Slug));
        using var independentUser = await Client.PostAsJsonAsync(
            string.Format(OpportunityPatternsPath, opportunityId),
            ValidCreatePayload(title: "Independent admin bucket"));
        independentUser.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    private async Task AssertAllCrudRoutesReturnFeatureErrorAsync(string expectedMessage)
    {
        var calls = new[]
        {
            new CrudCall(HttpMethod.Get, string.Format(OpportunityPatternsPath, 999_993), null),
            new CrudCall(HttpMethod.Post, string.Format(OpportunityPatternsPath, 999_993), ValidCreatePayload()),
            new CrudCall(HttpMethod.Put, string.Format(PatternPath, 999_993), ValidCreatePayload()),
            new CrudCall(HttpMethod.Delete, string.Format(PatternPath, 999_993), null)
        };

        foreach (var call in calls)
        {
            using var request = CreateRequest(call);
            using var response = await Client.SendAsync(request);
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                $"the feature gate must run before lookup for {call.Method} {call.Path}");
            await AssertErrorAsync(response, "FEATURE_DISABLED", expectedMessage);
        }


        for (var attempt = 0; attempt < 12; attempt++)
        {
            using var response = await Client.PostAsJsonAsync(
                string.Format(OpportunityPatternsPath, 999_993),
                ValidCreatePayload());
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "feature gating must short-circuit before the 10/minute create bucket");
            await AssertErrorAsync(response, "FEATURE_DISABLED", expectedMessage);
        }
    }

    private static HttpRequestMessage CreateRequest(CrudCall call)
    {
        var request = new HttpRequestMessage(call.Method, call.Path);
        if (call.Body is not null)
        {
            request.Content = JsonContent.Create(call.Body);
        }

        return request;
    }

    private static Dictionary<string, object?> ValidCreatePayload(
        string title = "Recurring test pattern",
        string frequency = "weekly") =>
        new()
        {
            ["title"] = title,
            ["frequency"] = frequency,
            ["days_of_week"] = new[] { 1, 3 },
            ["start_time"] = "09:00:00",
            ["end_time"] = "11:00:00",
            ["spots_per_shift"] = 2,
            ["capacity"] = 2,
            ["start_date"] = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")
        };

    private static async Task<VolunteerOpportunity> AddOpportunityAsync(
        NexusDbContext db,
        int tenantId,
        int organizerId,
        string title)
    {
        var opportunity = new VolunteerOpportunity
        {
            TenantId = tenantId,
            OrganizerId = organizerId,
            Title = title,
            Description = "Recurring shift CRUD integration test",
            Status = OpportunityStatus.Published,
            RequiredVolunteers = 10,
            IsRecurring = true,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerOpportunities.Add(opportunity);
        await db.SaveChangesAsync();
        return opportunity;
    }

    private static async Task<RecurringShiftPattern> AddPatternAsync(
        NexusDbContext db,
        VolunteerOpportunity opportunity,
        int createdBy,
        string title,
        string frequency = "weekly",
        string? daysOfWeek = "[1,3]",
        TimeSpan? startTime = null,
        TimeSpan? endTime = null,
        int spotsPerShift = 2,
        int capacity = 4,
        DateOnly? startDate = null,
        DateOnly? endDate = null,
        int? maxOccurrences = null,
        int occurrencesGenerated = 0,
        bool isActive = true,
        DateTime? createdAt = null)
    {
        var pattern = new RecurringShiftPattern
        {
            TenantId = opportunity.TenantId,
            OpportunityId = opportunity.Id,
            CreatedBy = createdBy,
            Title = title,
            Frequency = frequency,
            DaysOfWeek = daysOfWeek,
            StartTime = startTime ?? TimeSpan.FromHours(9),
            EndTime = endTime ?? TimeSpan.FromHours(11),
            SpotsPerShift = spotsPerShift,
            Capacity = capacity,
            StartDate = startDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            EndDate = endDate,
            MaxOccurrences = maxOccurrences,
            OccurrencesGenerated = occurrencesGenerated,
            IsActive = isActive,
            CreatedAt = createdAt ?? DateTime.UtcNow
        };
        db.RecurringShiftPatterns.Add(pattern);
        await db.SaveChangesAsync();
        return pattern;
    }

    private static async Task<VolunteerShift> AddShiftAsync(
        NexusDbContext db,
        int tenantId,
        int opportunityId,
        int recurringPatternId,
        DateTime startsAt)
    {
        var shift = new VolunteerShift
        {
            TenantId = tenantId,
            OpportunityId = opportunityId,
            RecurringPatternId = recurringPatternId,
            Title = $"Shift {Guid.NewGuid():N}",
            StartsAt = startsAt,
            EndsAt = startsAt.AddHours(2),
            MaxVolunteers = 4,
            Status = ShiftStatus.Scheduled,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerShifts.Add(shift);
        await db.SaveChangesAsync();
        return shift;
    }

    private static async Task<VolunteerEmergencyAlert> AddAlertAsync(
        NexusDbContext db,
        int tenantId,
        int createdByUserId,
        int opportunityId,
        int shiftId,
        string title)
    {
        var alert = new VolunteerEmergencyAlert
        {
            TenantId = tenantId,
            OpportunityId = opportunityId,
            ShiftId = shiftId,
            Title = title,
            Body = "Recurring shift cleanup alert",
            Severity = VolunteerEmergencyAlertSeverity.Warning,
            CreatedByUserId = createdByUserId,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        db.VolunteerEmergencyAlerts.Add(alert);
        await db.SaveChangesAsync();
        return alert;
    }

    private static void AssertCanonicalPatternProjection(JsonElement pattern)
    {
        pattern.ValueKind.Should().Be(JsonValueKind.Object);
        pattern.EnumerateObject().Select(property => property.Name)
            .Should().BeEquivalentTo(CanonicalPatternFields,
                options => options.WithoutStrictOrdering());
    }

    private static void AssertBaseMeta(JsonElement body)
    {
        body.GetProperty("meta").GetProperty("base_url").GetString()
            .Should().NotBeNullOrWhiteSpace();
    }

    private static int[] ReadIntArray(JsonElement value)
    {
        value.ValueKind.Should().Be(JsonValueKind.Array);
        return value.EnumerateArray().Select(item => item.GetInt32()).ToArray();
    }

    private static async Task AssertErrorAsync(
        HttpResponseMessage response,
        string code,
        string? message = null)
    {
        var body = await ReadJsonAsync(response);
        var error = body.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(code);
        if (message is not null)
        {
            error.GetProperty("message").GetString().Should().Be(message);
        }
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private sealed record CrudCall(HttpMethod Method, string Path, object? Body);
}
