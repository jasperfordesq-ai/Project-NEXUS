// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public sealed class MunicipalSurveyControllerUnitTests
{
    private const string MemberControllerTypeName = "Nexus.Api.Controllers.CaringCommunitySurveysController, Nexus.Api";
    private const string AdminControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunitySurveysController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.MunicipalSurveyService, Nexus.Api";
    private const string SurveyTypeName = "Nexus.Api.Entities.MunicipalitySurvey, Nexus.Api";
    private const string QuestionTypeName = "Nexus.Api.Entities.MunicipalitySurveyQuestion, Nexus.Api";
    private const string ResponseTypeName = "Nexus.Api.Entities.MunicipalitySurveyResponse, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelMunicipalitySurveyRoutes()
    {
        var member = Resolve(MemberControllerTypeName);
        var admin = Resolve(AdminControllerTypeName);

        member.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/surveys");
        admin.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/surveys");

        member.GetMethod("ActiveSurveys")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().BeNull();
        member.GetMethod("GetSurvey")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("{id:int}");
        member.GetMethod("SubmitSurvey")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{id:int}/respond");

        admin.GetMethod("AdminListSurveys")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().BeNull();
        admin.GetMethod("AdminCreateSurvey")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().BeNull();
        admin.GetMethod("AdminGetSurvey")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("{id:int}");
        admin.GetMethod("AdminUpdateSurvey")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("{id:int}");
        admin.GetMethod("AdminPublishSurvey")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{id:int}/publish");
        admin.GetMethod("AdminCloseSurvey")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("{id:int}/close");
        admin.GetMethod("AdminExportCsv")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("{id:int}/export");
    }

    [Fact]
    public async Task MemberReads_ReturnActiveSurveysAndHideDraftsOutsideTenant()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.AddRange(
            // Survey 101 is the open-window case, so its window must straddle
            // now. A literal window silently stops being active once it ends.
            Survey(101, 42, "Community care pulse", "active",
                startsAt: DateTime.UtcNow.AddDays(-30),
                endsAt: DateTime.UtcNow.AddDays(30),
                createdAt: new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)),
            Survey(102, 42, "Fresh survey", "active",
                startsAt: null,
                endsAt: null,
                createdAt: new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)),
            Survey(103, 42, "Expired survey", "active",
                startsAt: null,
                endsAt: new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc),
                createdAt: new DateTime(2026, 7, 5, 9, 0, 0, DateTimeKind.Utc)),
            Survey(104, 42, "Draft survey", "draft",
                startsAt: null,
                endsAt: null,
                createdAt: new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc)),
            Survey(901, 7, "Other tenant", "active",
                startsAt: null,
                endsAt: null,
                createdAt: new DateTime(2026, 7, 7, 9, 0, 0, DateTimeKind.Utc)));
        db.AddRange(
            Question(301, 42, 101, "Overall satisfaction", "likert", """["1","2","3","4","5"]""", true, 2),
            Question(302, 42, 101, "What should improve?", "open_text", null, false, 1),
            Question(903, 7, 901, "Other tenant question", "open_text", null, false, 1));
        await db.SaveChangesAsync();
        var controller = CreateMemberController(db, tenant, userId: 10);

        var list = ReadData(await Invoke(controller, "ActiveSurveys", CancellationToken.None));

        list.ValueKind.Should().Be(JsonValueKind.Array);
        list.EnumerateArray().Select(row => row.GetProperty("id").GetInt64())
            .Should().Equal(102, 101);
        list[0].GetProperty("title").GetString().Should().Be("Fresh survey");
        list[1].GetProperty("response_count").GetInt32().Should().Be(0);

        var detail = ReadData(await Invoke(controller, "GetSurvey", 101, CancellationToken.None));
        detail.GetProperty("id").GetInt64().Should().Be(101);
        var questions = detail.GetProperty("questions").EnumerateArray().ToArray();
        questions.Select(row => row.GetProperty("id").GetInt64()).Should().Equal(302, 301);
        questions[0].GetProperty("question_type").GetString().Should().Be("open_text");

        AssertSingleError(
            await Invoke(controller, "GetSurvey", 104, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");
        AssertSingleError(
            await Invoke(controller, "GetSurvey", 901, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");
    }

    [Fact]
    public async Task SubmitSurvey_ValidatesRequiredAnswersDeduplicatesAndPreservesAnonymousPrivacy()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.AddRange(
            Survey(201, 42, "Named survey", "active", isAnonymous: false, responseCount: 0),
            Survey(202, 42, "Anonymous survey", "active", isAnonymous: true, responseCount: 0),
            Survey(203, 42, "Missing answer survey", "active", isAnonymous: false, responseCount: 0));
        db.AddRange(
            Question(401, 42, 201, "Overall satisfaction", "likert", """["1","2","3","4","5"]""", true, 1),
            Question(402, 42, 202, "Your note", "open_text", null, true, 1),
            Question(403, 42, 203, "Required", "yes_no", null, true, 1));
        await db.SaveChangesAsync();
        var user10 = CreateMemberController(db, tenant, userId: 10);
        var user11 = CreateMemberController(db, tenant, userId: 11);

        var submitted = ReadData(await Invoke(
            user10,
            "SubmitSurvey",
            201,
            new Dictionary<string, object?>
            {
                ["answers"] = new Dictionary<string, object?> { ["401"] = "4" }
            },
            CancellationToken.None));

        submitted.GetProperty("ok").GetBoolean().Should().BeTrue();
        Get<int>(EntityById(db, SurveyTypeName, 201), "ResponseCount").Should().Be(1);
        var namedResponse = EntityById(db, ResponseTypeName, 1);
        Get<int?>(namedResponse, "UserId").Should().Be(10);
        Get<string>(namedResponse, "Answers").Should().Contain("\"401\":\"4\"");

        AssertSingleError(
            await Invoke(
                user10,
                "SubmitSurvey",
                201,
                new Dictionary<string, object?>
                {
                    ["answers"] = new Dictionary<string, object?> { ["401"] = "5" }
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "SUBMIT_ERROR");

        AssertSingleError(
            await Invoke(
                user10,
                "SubmitSurvey",
                203,
                new Dictionary<string, object?>
                {
                    ["answers"] = new Dictionary<string, object?>()
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        var anonymous = ReadData(await Invoke(
            user11,
            "SubmitSurvey",
            202,
            new Dictionary<string, object?>
            {
                ["answers"] = new Dictionary<string, object?> { ["402"] = "+SUM(1,1)" }
            },
            CancellationToken.None));

        anonymous.GetProperty("ok").GetBoolean().Should().BeTrue();
        var anonymousResponse = EntityById(db, ResponseTypeName, 2);
        Get<int?>(anonymousResponse, "UserId").Should().BeNull();
        Get<string>(anonymousResponse, "SessionToken").Should().HaveLength(64);
    }

    [Fact]
    public async Task AdminLifecycle_CreatesUpdatesPublishesShowsAnalyticsAndClosesSurvey()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var admin = CreateAdminController(db, tenant, userId: 9001, role: "municipality_announcer");

        var created = ReadData(await Invoke(
            admin,
            "AdminCreateSurvey",
            new Dictionary<string, object?>
            {
                ["title"] = "Community pulse",
                ["description"] = "Monthly check-in",
                ["is_anonymous"] = false,
                // Relative so the published survey is inside its active window
                // whenever this runs; a literal window expires.
                ["starts_at"] = DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["ends_at"] = DateTime.UtcNow.AddDays(30).ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["questions"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["question_text"] = "Overall satisfaction",
                        ["question_type"] = "likert",
                        ["options"] = new[] { "1", "2", "3", "4", "5" },
                        ["is_required"] = true,
                        ["sort_order"] = 1
                    },
                    new Dictionary<string, object?>
                    {
                        ["question_text"] = "Open feedback",
                        ["question_type"] = "open_text",
                        ["is_required"] = false,
                        ["sort_order"] = 2
                    }
                }
            },
            CancellationToken.None));

        created.GetProperty("status").GetString().Should().Be("draft");
        created.GetProperty("created_by").GetInt32().Should().Be(9001);
        var surveyId = created.GetProperty("id").GetInt32();
        created.GetProperty("questions").GetArrayLength().Should().Be(2);

        var updated = ReadData(await Invoke(
            admin,
            "AdminUpdateSurvey",
            surveyId,
            new Dictionary<string, object?>
            {
                ["title"] = "Updated pulse",
                ["questions"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["question_text"] = "Would you recommend the service?",
                        ["question_type"] = "yes_no",
                        ["is_required"] = true,
                        ["sort_order"] = 1
                    }
                }
            },
            CancellationToken.None));

        updated.GetProperty("title").GetString().Should().Be("Updated pulse");
        updated.GetProperty("questions").GetArrayLength().Should().Be(1);
        var questionId = updated.GetProperty("questions")[0].GetProperty("id").GetInt32();

        var published = ReadData(await Invoke(admin, "AdminPublishSurvey", surveyId, CancellationToken.None));
        published.GetProperty("ok").GetBoolean().Should().BeTrue();
        Get<string>(EntityById(db, SurveyTypeName, surveyId), "Status").Should().Be("active");

        var member = CreateMemberController(db, tenant, userId: 10);
        await Invoke(
            member,
            "SubmitSurvey",
            surveyId,
            new Dictionary<string, object?>
            {
                ["answers"] = new Dictionary<string, object?> { [questionId.ToString()] = "Yes" }
            },
            CancellationToken.None);

        var detail = ReadData(await Invoke(admin, "AdminGetSurvey", surveyId, CancellationToken.None));
        detail.GetProperty("analytics").GetProperty("response_count").GetInt32().Should().Be(1);
        var breakdown = detail.GetProperty("analytics").GetProperty("questions")[0].GetProperty("breakdown");
        breakdown.EnumerateArray().Single(row => row.GetProperty("option").GetString() == "Yes")
            .GetProperty("count").GetInt32().Should().Be(1);

        AssertSingleError(
            await Invoke(
                admin,
                "AdminUpdateSurvey",
                surveyId,
                new Dictionary<string, object?> { ["title"] = "Too late" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_STATE");

        var closed = ReadData(await Invoke(admin, "AdminCloseSurvey", surveyId, CancellationToken.None));
        closed.GetProperty("ok").GetBoolean().Should().BeTrue();
        Get<string>(EntityById(db, SurveyTypeName, surveyId), "Status").Should().Be("closed");
    }

    [Fact]
    public async Task AdminExportCsv_KeepsAnonymousResponsesPrivateAndSanitizesSpreadsheetFormulaCells()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Survey(301, 42, "Anonymous export", "active", isAnonymous: true, responseCount: 1));
        db.AddRange(
            Question(501, 42, 301, "=How should we improve support?", "open_text", null, true, 1),
            Question(502, 42, 301, "Overall satisfaction", "likert", """["1","2","3","4","5"]""", true, 2));
        db.Add(Response(
            701,
            42,
            301,
            userId: null,
            answers: """{"501":"+SUM(1,1)","502":"4"}""",
            submittedAt: new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        var admin = CreateAdminController(db, tenant, userId: 9001, role: "admin");

        var result = await Invoke(admin, "AdminExportCsv", 301, CancellationToken.None);

        var content = result.Should().BeOfType<ContentResult>().Subject;
        content.ContentType.Should().Be("text/csv");
        content.Content.Should().NotBeNull();
        admin.Response.Headers.ContentDisposition.ToString()
            .Should().Contain("survey-301-responses.csv");
        content.Content.Should().Contain("anonymous");
        content.Content.Should().NotContain(",11,");
        content.Content.Should().Contain("'=How should we improve support?");
        content.Content.Should().Contain("'+SUM(1,1)");
    }

    [Fact]
    public async Task SurveyEndpoints_ReturnLaravelFeatureDisabledAndForbiddenErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var member = CreateMemberController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(member, "ActiveSurveys", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");

        db.TenantConfigs.IgnoreQueryFilters().Single().Value = "true";
        await db.SaveChangesAsync();
        var nonAdmin = CreateAdminController(db, tenant, userId: 10, role: "member");

        AssertSingleError(
            await Invoke(nonAdmin, "AdminListSurveys", null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FORBIDDEN");
    }

    private static object CreateMemberController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(MemberControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "member");
        return controller;
    }

    private static ControllerBase CreateAdminController(NexusDbContext db, TenantContext tenant, int userId, string role)
    {
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(AdminControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), role);
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        var info = controller.GetType().GetMethod(method);
        info.Should().NotBeNull();
        args = CoerceArgs(info!, args);
        var result = info!.Invoke(controller, args);
        result.Should().BeAssignableTo<Task<IActionResult>>();
        return await (Task<IActionResult>)result!;
    }

    private static object?[] CoerceArgs(MethodInfo info, object?[] args)
    {
        var parameters = info.GetParameters();
        parameters.Length.Should().Be(args.Length);
        var coerced = new object?[parameters.Length];
        for (var i = 0; i < parameters.Length; i++)
        {
            coerced[i] = CoerceValue(args[i], parameters[i].ParameterType);
        }

        return coerced;
    }

    private static object? CoerceValue(object? raw, Type targetType)
    {
        if (raw is null)
        {
            return null;
        }

        var nullableTarget = Nullable.GetUnderlyingType(targetType) ?? targetType;

        if (raw is Dictionary<string, object?> dictionary
            && nullableTarget != typeof(Dictionary<string, object?>))
        {
            var instance = Activator.CreateInstance(nullableTarget)!;
            foreach (var (key, value) in dictionary)
            {
                var property = nullableTarget.GetProperties()
                    .FirstOrDefault(item =>
                        string.Equals(item.Name, key, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(ToSnakeCase(item.Name), key, StringComparison.OrdinalIgnoreCase));
                if (property is not null)
                {
                    property.SetValue(instance, CoerceValue(value, property.PropertyType));
                }
            }

            return instance;
        }

        if (raw is System.Collections.IEnumerable enumerable
            && raw is not string
            && targetType != typeof(JsonElement))
        {
            var itemType = nullableTarget.IsArray
                ? nullableTarget.GetElementType()
                : nullableTarget.IsGenericType
                    ? nullableTarget.GetGenericArguments()[0]
                    : null;
            if (itemType is not null && nullableTarget != typeof(Dictionary<string, object?>))
            {
                var listType = typeof(List<>).MakeGenericType(itemType);
                var list = (System.Collections.IList)Activator.CreateInstance(listType)!;
                foreach (var item in enumerable)
                {
                    list.Add(CoerceValue(item, itemType));
                }

                return nullableTarget.IsArray
                    ? ToArray(list, itemType)
                    : list;
            }
        }

        if (nullableTarget == typeof(DateTime) && raw is string date)
        {
            return DateTime.Parse(date, null, System.Globalization.DateTimeStyles.RoundtripKind);
        }

        if (nullableTarget.IsEnum)
        {
            return Enum.Parse(nullableTarget, raw.ToString()!, ignoreCase: true);
        }

        return nullableTarget.IsInstanceOfType(raw)
            ? raw
            : Convert.ChangeType(raw, nullableTarget);
    }

    private static Array ToArray(System.Collections.IList list, Type itemType)
    {
        var array = Array.CreateInstance(itemType, list.Count);
        list.CopyTo(array, 0);
        return array;
    }

    private static object Survey(
        int id,
        int tenantId,
        string title,
        string status,
        bool isAnonymous = false,
        int responseCount = 0,
        DateTime? startsAt = null,
        DateTime? endsAt = null,
        DateTime? createdAt = null)
    {
        return Entity(SurveyTypeName, new Dictionary<string, object?>
        {
            ["Id"] = id,
            ["TenantId"] = tenantId,
            ["CreatedBy"] = 9001,
            ["Title"] = title,
            ["Description"] = $"{title} description",
            ["Status"] = status,
            ["IsAnonymous"] = isAnonymous,
            ["TargetAudience"] = null,
            ["StartsAt"] = startsAt,
            ["EndsAt"] = endsAt,
            ["ResponseCount"] = responseCount,
            ["CreatedAt"] = createdAt ?? DateTime.UtcNow,
            ["UpdatedAt"] = createdAt ?? DateTime.UtcNow
        });
    }

    private static object Question(
        int id,
        int tenantId,
        int surveyId,
        string text,
        string type,
        string? options,
        bool required,
        int sortOrder)
    {
        return Entity(QuestionTypeName, new Dictionary<string, object?>
        {
            ["Id"] = id,
            ["TenantId"] = tenantId,
            ["SurveyId"] = surveyId,
            ["QuestionText"] = text,
            ["QuestionType"] = type,
            ["Options"] = options,
            ["IsRequired"] = required,
            ["SortOrder"] = sortOrder,
            ["CreatedAt"] = DateTime.UtcNow,
            ["UpdatedAt"] = DateTime.UtcNow
        });
    }

    private static object Response(
        int id,
        int tenantId,
        int surveyId,
        int? userId,
        string answers,
        DateTime submittedAt)
    {
        return Entity(ResponseTypeName, new Dictionary<string, object?>
        {
            ["Id"] = id,
            ["TenantId"] = tenantId,
            ["SurveyId"] = surveyId,
            ["UserId"] = userId,
            ["SessionToken"] = userId is null ? new string('a', 64) : null,
            ["Answers"] = answers,
            ["SubmittedAt"] = submittedAt,
            ["IpHash"] = new string('b', 64)
        });
    }

    private static object Entity(string typeName, IReadOnlyDictionary<string, object?> values)
    {
        var type = Resolve(typeName);
        var instance = Activator.CreateInstance(type)!;
        foreach (var (propertyName, value) in values)
        {
            Set(instance, propertyName, value);
        }

        return instance;
    }

    private static void Set(object instance, string propertyName, object? value)
    {
        var property = instance.GetType().GetProperty(propertyName);
        property.Should().NotBeNull();
        property!.SetValue(instance, CoerceValue(value, property.PropertyType));
    }

    private static T? Get<T>(object instance, string propertyName)
    {
        var property = instance.GetType().GetProperty(propertyName);
        property.Should().NotBeNull();
        return (T?)property!.GetValue(instance);
    }

    private static object EntityById(NexusDbContext db, string typeName, long id)
    {
        var type = Resolve(typeName);
        var entity = db.ChangeTracker.Entries()
            .Select(entry => entry.Entity)
            .Where(entity => entity.GetType() == type)
            .Single(entity => Convert.ToInt64(entity.GetType().GetProperty("Id")!.GetValue(entity)) == id);
        return entity;
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeAssignableTo<ObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var obj = result.Should().BeAssignableTo<ObjectResult>().Subject;
        obj.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(obj.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be(code);
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName);
        type.Should().NotBeNull($"{typeName} must exist for AG62 municipality survey parity");
        return type!;
    }

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static TenantContext CreateTenantContext(int tenantId)
    {
        var tenant = new TenantContext();
        tenant.SetTenant(tenantId);
        return tenant;
    }

    private static NexusDbContext CreateDbContext(TenantContext tenant)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenant);
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId, string role)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, role),
                    new Claim("role", role)
                ], "Test"))
            }
        };
    }

    private static string ToSnakeCase(string value)
    {
        return string.Concat(value.Select((character, index) =>
            index > 0 && char.IsUpper(character)
                ? "_" + char.ToLowerInvariant(character)
                : char.ToLowerInvariant(character).ToString()));
    }
}
