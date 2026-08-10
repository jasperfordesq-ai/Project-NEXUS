// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityLeadNurtureControllerUnitTests
{
    private const string SettingKey = "caring.lead_nurture.contacts";

    [Fact]
    public void Actions_ExposeLaravelLeadNurtureRoutes()
    {
        typeof(CaringCommunityLeadCaptureController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/leads");

        typeof(CaringCommunityLeadCaptureController)
            .GetMethod(nameof(CaringCommunityLeadCaptureController.Capture))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("capture");

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/leads");

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetMethod(nameof(AdminCaringCommunityLeadNurtureController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetMethod(nameof(AdminCaringCommunityLeadNurtureController.Summary))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("summary");

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetMethod(nameof(AdminCaringCommunityLeadNurtureController.ExportCsv))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("export.csv");

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetMethod(nameof(AdminCaringCommunityLeadNurtureController.Update))
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template.Should().Be("{contactId}");

        typeof(AdminCaringCommunityLeadNurtureController)
            .GetMethod(nameof(AdminCaringCommunityLeadNurtureController.Unsubscribe))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{contactId}/unsubscribe");
    }

    [Fact]
    public async Task PublicCapture_ValidatesStoresSourceIpAndDeduplicatesByEmail()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreatePublicController(db, tenant, IPAddress.Parse("203.0.113.9"));

        var invalid = await controller.Capture(new LeadCaptureRequest
        {
            Email = "not-an-email",
            Segment = "bad",
            Consent = false
        }, CancellationToken.None);
        AssertErrors(invalid, StatusCodes.Status422UnprocessableEntity,
            ("VALIDATION_ERROR", "email"),
            ("VALIDATION_ERROR", "segment"),
            ("VALIDATION_ERROR", "consent"));

        var created = ReadData(await controller.Capture(new LeadCaptureRequest
        {
            Name = "  Ada Lovelace  ",
            Email = "Ada@example.test",
            Phone = " +44 20 0000 0000 ",
            Organisation = "  Helpful Borough  ",
            Segment = "municipality",
            Source = " launch-page ",
            Locale = " en-GB ",
            Interests = ["care", " pilot ", ""],
            Consent = true
        }, CancellationToken.None));

        var contactId = created.GetProperty("contact_id").GetString();
        contactId.Should().StartWith("lead_");
        created.GetProperty("duplicate").GetBoolean().Should().BeFalse();
        created.GetProperty("segment").GetString().Should().Be("municipality");
        created.GetProperty("stage").GetString().Should().Be("captured");

        var duplicate = ReadData(await controller.Capture(new LeadCaptureRequest
        {
            Email = "ada@EXAMPLE.test",
            Segment = "resident",
            Consent = true
        }, CancellationToken.None));
        duplicate.GetProperty("contact_id").GetString().Should().Be(contactId);
        duplicate.GetProperty("duplicate").GetBoolean().Should().BeTrue();

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == SettingKey);
        using var document = JsonDocument.Parse(stored.Value);
        var item = document.RootElement.GetProperty("items")[0];
        item.GetProperty("name").GetString().Should().Be("Ada Lovelace");
        item.GetProperty("email").GetString().Should().Be("Ada@example.test");
        item.GetProperty("organisation").GetString().Should().Be("Helpful Borough");
        item.GetProperty("source").GetString().Should().Be("launch-page");
        item.GetProperty("locale").GetString().Should().Be("en-GB");
        item.GetProperty("consent_ip").GetString().Should().Be("203.0.113.9");
        item.GetProperty("interests").EnumerateArray().Select(x => x.GetString())
            .Should().Equal("care", "pilot");
        document.RootElement.GetProperty("items").GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task AdminIndexAndSummary_FilterTenantContactsAndReturnLaravelShapes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedEnvelope(db, 42, [
            Contact("lead_old", "Older", "old@example.test", "resident", "captured", "2026-07-01T09:00:00Z"),
            Contact("lead_new", "Newer", "new@example.test", "municipality", "qualified", "2026-07-04T09:00:00Z"),
            Contact("lead_mid", "Middle", "mid@example.test", "municipality", "contacted", "2026-07-03T09:00:00Z")
        ], "2026-07-04T10:00:00Z");
        SeedEnvelope(db, 7, [
            Contact("lead_other", "Other", "other@example.test", "municipality", "qualified", "2026-07-05T09:00:00Z")
        ], "2026-07-05T10:00:00Z");
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, 9001);

        var index = ReadData(await controller.Index(
            segment: "municipality",
            stage: null,
            limit: 1,
            CancellationToken.None));
        index.GetProperty("total").GetInt32().Should().Be(2);
        index.GetProperty("last_updated_at").GetString().Should().Be("2026-07-04T10:00:00Z");
        var items = index.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(1);
        items[0].GetProperty("id").GetString().Should().Be("lead_new");
        items[0].GetProperty("email").GetString().Should().Be("new@example.test");

        var byStage = ReadData(await controller.Index(
            segment: null,
            stage: "contacted",
            limit: 200,
            CancellationToken.None));
        byStage.GetProperty("items").EnumerateArray().Single()
            .GetProperty("id").GetString().Should().Be("lead_mid");

        var summary = ReadData(await controller.Summary(CancellationToken.None));
        summary.GetProperty("total").GetInt32().Should().Be(3);
        summary.GetProperty("by_segment").GetProperty("municipality").GetInt32().Should().Be(2);
        summary.GetProperty("by_segment").GetProperty("resident").GetInt32().Should().Be(1);
        summary.GetProperty("by_stage").GetProperty("qualified").GetInt32().Should().Be(1);
        summary.GetProperty("last_updated_at").GetString().Should().Be("2026-07-04T10:00:00Z");
    }

    [Fact]
    public async Task AdminUpdateAndUnsubscribe_MutateStoredContactWithLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedEnvelope(db, 42, [
            Contact("lead_123", "Ada", "ada@example.test", "partner", "captured", "2026-07-04T09:00:00Z")
        ], "2026-07-04T09:00:00Z");
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, 9001);

        AssertSingleError(
            await controller.Update("missing", Payload("""{"stage":"contacted"}"""), CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND",
            null);

        AssertSingleError(
            await controller.Update("lead_123", Payload("""{"stage":"bad"}"""), CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "stage");

        var updated = ReadData(await controller.Update(
            "lead_123",
            Payload("""{"stage":"engaged","notes":"  follow next week\nwith council  ","follow_up_at":" 2026-07-10 ","last_contacted_at":" 2026-07-04 "}"""),
            CancellationToken.None));
        updated.GetProperty("stage").GetString().Should().Be("engaged");
        updated.GetProperty("notes").GetString().Should().Be("follow next week\nwith council");
        updated.GetProperty("follow_up_at").GetString().Should().Be("2026-07-10");
        updated.GetProperty("last_contacted_at").GetString().Should().Be("2026-07-04");

        var unsubscribed = ReadData(await controller.Unsubscribe("lead_123", CancellationToken.None));
        unsubscribed.GetProperty("stage").GetString().Should().Be("unsubscribed");

        AssertSingleError(
            await controller.Unsubscribe("missing", CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND",
            null);
    }

    [Fact]
    public async Task AdminExportCsv_FiltersSegmentAndSanitizesSpreadsheetFormulaCells()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedEnvelope(db, 42, [
            Contact("lead_a", "=Ada", "ada@example.test", "municipality", "contacted", "2026-07-04T09:00:00Z",
                notes: "line one\nline two",
                interests: ["care", "pilot"]),
            Contact("lead_b", "Ben", "ben@example.test", "resident", "captured", "2026-07-03T09:00:00Z")
        ], "2026-07-04T10:00:00Z");
        await db.SaveChangesAsync();
        var controller = CreateAdminController(db, tenant, 9001);

        var export = (ContentResult) await controller.ExportCsv("municipality", CancellationToken.None);

        export.ContentType.Should().Be("text/csv; charset=UTF-8");
        controller.Response.Headers.ContentDisposition.ToString()
            .Should().Be("attachment; filename=\"lead-nurture-export.csv\"");
        export.Content.Should().StartWith("id,name,email,phone,organisation,segment,source,locale,stage,interests,consent_at");
        export.Content.Should().Contain("lead_a,'=Ada,ada@example.test");
        export.Content.Should().Contain("care|pilot");
        export.Content.Should().Contain("line one line two");
        export.Content.Should().NotContain("lead_b");
    }

    [Fact]
    public async Task Controllers_WhenFeatureDisabled_ReturnLaravelFeatureDisabledResponses()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        AssertSingleError(
            await CreatePublicController(db, tenant, IPAddress.Parse("203.0.113.9"))
                .Capture(new LeadCaptureRequest { Email = "ada@example.test", Consent = true }, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        AssertSingleError(
            await CreateAdminController(db, tenant, 9001).Index(null, null, null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED",
            null);

        var export = (ContentResult) await CreateAdminController(db, tenant, 9001)
            .ExportCsv(null, CancellationToken.None);
        export.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        export.ContentType.Should().Be("text/plain");
        export.Content.Should().Be("feature disabled");
    }

    private static JsonElement Payload(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static Dictionary<string, object?> Contact(
        string id,
        string name,
        string email,
        string segment,
        string stage,
        string createdAt,
        string? notes = null,
        IReadOnlyList<string>? interests = null)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["name"] = name,
            ["email"] = email,
            ["phone"] = "",
            ["organisation"] = "",
            ["segment"] = segment,
            ["source"] = "seed",
            ["locale"] = "en",
            ["interests"] = interests ?? [],
            ["stage"] = stage,
            ["consent"] = true,
            ["consent_at"] = createdAt,
            ["consent_ip"] = "198.51.100.10",
            ["follow_up_at"] = null,
            ["last_contacted_at"] = null,
            ["notes"] = notes,
            ["created_at"] = createdAt,
            ["updated_at"] = createdAt
        };
    }

    private static void SeedEnvelope(
        NexusDbContext db,
        int tenantId,
        IReadOnlyList<Dictionary<string, object?>> contacts,
        string updatedAt)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = SettingKey,
            Value = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["items"] = contacts,
                ["updated_at"] = updatedAt
            })
        });
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertErrors(
        IActionResult result,
        int statusCode,
        params (string Code, string Field)[] expected)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var actual = document.RootElement.GetProperty("errors")
            .EnumerateArray()
            .Select(error => (
                error.GetProperty("code").GetString(),
                error.TryGetProperty("field", out var field) ? field.GetString() : null))
            .ToArray();
        actual.Should().Contain(expected.Select(e => ((string?) e.Code, (string?) e.Field)));
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code, string? field)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var error = document.RootElement.GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be(code);
        if (field is not null)
        {
            error.GetProperty("field").GetString().Should().Be(field);
        }
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

    private static CaringCommunityLeadCaptureController CreatePublicController(
        NexusDbContext db,
        TenantContext tenant,
        IPAddress remoteIp)
    {
        var service = new LeadNurtureService(db);
        return new CaringCommunityLeadCaptureController(service, tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    Connection = { RemoteIpAddress = remoteIp }
                }
            }
        };
    }

    private static AdminCaringCommunityLeadNurtureController CreateAdminController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new LeadNurtureService(db);
        return new AdminCaringCommunityLeadNurtureController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow(), "admin")
        };
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
}
