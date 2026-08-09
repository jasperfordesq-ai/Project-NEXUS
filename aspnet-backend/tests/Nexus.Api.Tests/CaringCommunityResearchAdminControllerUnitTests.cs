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

public class CaringCommunityResearchAdminControllerUnitTests
{
    private const string ResearchControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityResearchController, Nexus.Api";
    private const string ResearchServiceTypeName = "Nexus.Api.Services.CaringResearchPartnershipService, Nexus.Api";
    private const string TemplateServiceTypeName = "Nexus.Api.Services.ResearchAgreementTemplateService, Nexus.Api";
    private const string RolePresetControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityRolePresetsController, Nexus.Api";
    private const string RolePresetServiceTypeName = "Nexus.Api.Services.CaringCommunityRolePresetService, Nexus.Api";
    private const string PartnerTypeName = "Nexus.Api.Entities.CaringResearchPartner, Nexus.Api";
    private const string ExportTypeName = "Nexus.Api.Entities.CaringResearchDatasetExport, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelAdminResearchAndRolePresetReadRoutes()
    {
        var researchController = Resolve(ResearchControllerTypeName);
        researchController.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/research");

        researchController.GetMethod("AgreementTemplates")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("agreement-templates");
        researchController.GetMethod("RenderAgreementTemplate")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("agreement-templates/{key}/render");
        researchController.GetMethod("Partners")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("partners");
        researchController.GetMethod("CreatePartner")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("partners");
        researchController.GetMethod("DatasetExports")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("dataset-exports");
        researchController.GetMethod("GenerateDatasetExport")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("partners/{partnerId}/dataset-exports");
        researchController.GetMethod("RevokeDatasetExport")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("dataset-exports/{exportId}/revoke");

        var rolePresetController = Resolve(RolePresetControllerTypeName);
        rolePresetController.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community");
        rolePresetController.GetMethod("RolePresets")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("role-presets");
        rolePresetController.GetMethod("InstallRolePresets")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("role-presets/install");
    }

    [Fact]
    public async Task AgreementTemplates_ReturnsLaravelCatalogShape()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller, "AgreementTemplates", CancellationToken.None));

        var templates = data.GetProperty("templates");
        templates.GetArrayLength().Should().Be(4);
        templates.EnumerateArray().Select(item => item.GetProperty("key").GetString())
            .Should().Contain(new[]
            {
                "aggregate_dataset_v1",
                "longitudinal_cohort_v1",
                "pilot_evaluation_v1",
                "cross_node_federation_v1"
            });

        var aggregate = templates.EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "aggregate_dataset_v1");
        aggregate.GetProperty("title").GetString()
            .Should().Be("Anonymised Aggregate Dataset Agreement (FADP/nDSG)");
        aggregate.GetProperty("summary").GetString()
            .Should().Contain("Tenant-scoped aggregate metrics only");
        aggregate.GetProperty("suitable_for").GetArrayLength().Should().Be(3);
        aggregate.GetProperty("placeholders").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain("partner_name");
    }

    [Fact]
    public async Task RenderAgreementTemplate_ReturnsLaravelRenderedShape()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller,
            "RenderAgreementTemplate",
            "aggregate_dataset_v1",
            new Dictionary<string, object?>
            {
                ["values"] = new Dictionary<string, object?>
                {
                    ["partner_name"] = "Ageing Futures Lab",
                    ["partner_institution"] = "FHNW",
                    ["tenant_name"] = "KISS Zurich",
                    ["jurisdiction"] = "Switzerland",
                    ["dpo_name"] = "  ",
                    ["period_start"] = "2026-01-01",
                    ["ignored_array"] = new[] { "must", "be", "ignored" }
                }
            },
            CancellationToken.None));

        data.GetProperty("key").GetString().Should().Be("aggregate_dataset_v1");
        data.GetProperty("title").GetString()
            .Should().Be("Anonymised Aggregate Dataset Agreement (FADP/nDSG)");
        data.GetProperty("markdown").GetString().Should()
            .Contain("Ageing Futures Lab")
            .And.Contain("FHNW")
            .And.Contain("KISS Zurich")
            .And.Contain("Switzerland")
            .And.Contain("2026-01-01")
            .And.Contain("{{dpo_name}}");
        data.GetProperty("placeholders_used").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain(new[] { "partner_name", "partner_institution", "tenant_name", "jurisdiction", "period_start" })
            .And.NotContain("ignored_array");
        data.GetProperty("placeholders_missing").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain(new[] { "dpo_name", "dpo_email", "period_end" })
            .And.NotContain("partner_name");
    }

    [Fact]
    public async Task RenderAgreementTemplate_WhenUnknown_ReturnsLaravelTemplateNotFoundError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(controller,
                "RenderAgreementTemplate",
                "missing_template",
                new Dictionary<string, object?> { ["values"] = new Dictionary<string, object?>() },
                CancellationToken.None),
            StatusCodes.Status404NotFound,
            "TEMPLATE_NOT_FOUND");
    }

    [Fact]
    public async Task Partners_ReturnsTenantScopedNewestLaravelRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(PartnerTypeName,
            ("Id", 100L), ("TenantId", 42), ("Name", "Ageing Futures Lab"), ("Institution", "FHNW"),
            ("ContactEmail", "research@example.test"), ("AgreementReference", "aggregate_dataset_v1"),
            ("MethodologyUrl", "https://example.test/methodology"), ("Status", "active"),
            ("DataScope", """{"datasets":["caring_community_aggregate_v1"]}"""),
            ("StartsAt", new DateOnly(2026, 1, 1)), ("EndsAt", new DateOnly(2026, 12, 31)),
            ("CreatedBy", 9001), ("CreatedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            ("UpdatedAt", new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(PartnerTypeName,
            ("Id", 101L), ("TenantId", 42), ("Name", "Cantonal Evaluation Team"), ("Institution", "Canton ZH"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "draft"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", null),
            ("CreatedAt", new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc)),
            ("UpdatedAt", new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(PartnerTypeName,
            ("Id", 900L), ("TenantId", 7), ("Name", "Other Tenant"), ("Institution", "Hidden"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "active"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", null),
            ("CreatedAt", new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)),
            ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller, "Partners", CancellationToken.None));

        var partners = data.GetProperty("partners");
        partners.GetArrayLength().Should().Be(2);
        partners[0].GetProperty("id").GetInt64().Should().Be(101);
        partners[0].GetProperty("tenant_id").GetInt32().Should().Be(42);
        partners[0].GetProperty("name").GetString().Should().Be("Cantonal Evaluation Team");
        partners[0].GetProperty("institution").GetString().Should().Be("Canton ZH");
        partners[0].GetProperty("status").GetString().Should().Be("draft");
        partners[0].GetProperty("data_scope").ValueKind.Should().Be(JsonValueKind.Array);

        partners[1].GetProperty("id").GetInt64().Should().Be(100);
        partners[1].GetProperty("data_scope").GetProperty("datasets")[0].GetString()
            .Should().Be("caring_community_aggregate_v1");
        partners[1].GetProperty("starts_at").GetString().Should().Be("2026-01-01");
        partners[1].GetProperty("ends_at").GetString().Should().Be("2026-12-31");
    }

    [Fact]
    public async Task CreatePartner_PersistsTenantScopedLaravelPartnerShape()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller,
            "CreatePartner",
            new Dictionary<string, object?>
            {
                ["name"] = "  Ageing Futures Lab  ",
                ["institution"] = "  FHNW  ",
                ["contact_email"] = "research@example.test",
                ["agreement_reference"] = "aggregate_dataset_v1",
                ["methodology_url"] = "https://example.test/methodology",
                ["status"] = "active",
                ["data_scope"] = new Dictionary<string, object?>
                {
                    ["datasets"] = new[] { "caring_community_aggregate_v1", "pilot_scoreboard_v1" }
                },
                ["starts_at"] = "2026-01-01",
                ["ends_at"] = "2026-12-31"
            },
            CancellationToken.None),
            StatusCodes.Status201Created);

        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("name").GetString().Should().Be("Ageing Futures Lab");
        data.GetProperty("institution").GetString().Should().Be("FHNW");
        data.GetProperty("contact_email").GetString().Should().Be("research@example.test");
        data.GetProperty("agreement_reference").GetString().Should().Be("aggregate_dataset_v1");
        data.GetProperty("methodology_url").GetString().Should().Be("https://example.test/methodology");
        data.GetProperty("status").GetString().Should().Be("active");
        data.GetProperty("data_scope").GetProperty("datasets").EnumerateArray()
            .Select(item => item.GetString())
            .Should().Contain(new[] { "caring_community_aggregate_v1", "pilot_scoreboard_v1" });
        data.GetProperty("starts_at").GetString().Should().Be("2026-01-01");
        data.GetProperty("ends_at").GetString().Should().Be("2026-12-31");
        data.GetProperty("created_by").GetInt32().Should().Be(9001);

        var stored = await db.CaringResearchPartners.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.Name.Should().Be("Ageing Futures Lab");
        stored.Institution.Should().Be("FHNW");
        stored.CreatedBy.Should().Be(9001);
        stored.Status.Should().Be("active");
        stored.DataScope.Should().Contain("pilot_scoreboard_v1");
    }

    [Fact]
    public async Task CreatePartner_WhenInvalid_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(controller,
                "CreatePartner",
                new Dictionary<string, object?>
                {
                    ["name"] = "No Institution",
                    ["status"] = "unknown"
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        db.CaringResearchPartners.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task DatasetExports_FiltersByPartnerAndIncludesPartnerMetadata()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(PartnerTypeName,
            ("Id", 100L), ("TenantId", 42), ("Name", "Ageing Futures Lab"), ("Institution", "FHNW"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "active"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", null),
            ("CreatedAt", new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        db.Add(Entity(PartnerTypeName,
            ("Id", 101L), ("TenantId", 42), ("Name", "Pilot Review"), ("Institution", "Canton ZH"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "active"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", null),
            ("CreatedAt", new DateTime(2026, 6, 2, 9, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        db.Add(Entity(ExportTypeName,
            ("Id", 500L), ("TenantId", 42), ("PartnerId", 100L), ("RequestedBy", 9001),
            ("DatasetKey", "caring_community_aggregate_v1"), ("PeriodStart", new DateOnly(2026, 1, 1)),
            ("PeriodEnd", new DateOnly(2026, 1, 31)), ("Status", "generated"), ("RowCount", 6),
            ("AnonymizationVersion", "aggregate-v1"), ("DataHash", new string('a', 64)),
            ("GeneratedAt", new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)),
            ("Metadata", """{"partner_name":"Ageing Futures Lab","suppression_threshold":5}"""),
            ("CreatedAt", new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        db.Add(Entity(ExportTypeName,
            ("Id", 501L), ("TenantId", 42), ("PartnerId", 101L), ("RequestedBy", null),
            ("DatasetKey", "caring_community_aggregate_v1"), ("PeriodStart", new DateOnly(2026, 2, 1)),
            ("PeriodEnd", new DateOnly(2026, 2, 28)), ("Status", "generated"), ("RowCount", 0),
            ("AnonymizationVersion", "aggregate-v1"), ("DataHash", new string('b', 64)),
            ("GeneratedAt", new DateTime(2026, 7, 2, 8, 0, 0, DateTimeKind.Utc)),
            ("Metadata", null), ("CreatedAt", new DateTime(2026, 7, 2, 8, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        db.Add(Entity(ExportTypeName,
            ("Id", 900L), ("TenantId", 7), ("PartnerId", 100L), ("RequestedBy", null),
            ("DatasetKey", "hidden"), ("PeriodStart", new DateOnly(2026, 3, 1)),
            ("PeriodEnd", new DateOnly(2026, 3, 31)), ("Status", "generated"), ("RowCount", 99),
            ("AnonymizationVersion", "aggregate-v1"), ("DataHash", new string('c', 64)),
            ("GeneratedAt", new DateTime(2026, 7, 3, 8, 0, 0, DateTimeKind.Utc)),
            ("Metadata", null), ("CreatedAt", new DateTime(2026, 7, 3, 8, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller, "DatasetExports", 100, CancellationToken.None));

        var exports = data.GetProperty("exports");
        exports.GetArrayLength().Should().Be(1);
        var export = exports[0];
        export.GetProperty("id").GetInt64().Should().Be(500);
        export.GetProperty("tenant_id").GetInt32().Should().Be(42);
        export.GetProperty("partner_id").GetInt64().Should().Be(100);
        export.GetProperty("requested_by").GetInt32().Should().Be(9001);
        export.GetProperty("dataset_key").GetString().Should().Be("caring_community_aggregate_v1");
        export.GetProperty("period_start").GetString().Should().Be("2026-01-01");
        export.GetProperty("period_end").GetString().Should().Be("2026-01-31");
        export.GetProperty("row_count").GetInt32().Should().Be(6);
        export.GetProperty("metadata").GetProperty("suppression_threshold").GetInt32().Should().Be(5);
        export.GetProperty("partner_name").GetString().Should().Be("Ageing Futures Lab");
        export.GetProperty("partner_institution").GetString().Should().Be("FHNW");
    }

    [Fact]
    public async Task GenerateDatasetExport_ForActivePartnerCreatesLaravelAggregateDataset()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(PartnerTypeName,
            ("Id", 100L), ("TenantId", 42), ("Name", "Ageing Futures Lab"), ("Institution", "FHNW"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "active"),
            ("DataScope", """{"datasets":["caring_community_aggregate_v1"]}"""), ("StartsAt", null), ("EndsAt", null),
            ("CreatedBy", 9001), ("CreatedAt", new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        for (var userId = 1001; userId <= 1005; userId++)
        {
            db.Users.Add(new User
            {
                Id = userId,
                TenantId = 42,
                Email = $"research-member-{userId}@example.test",
                PasswordHash = "hash",
                FirstName = "Research",
                LastName = $"Member {userId}",
                IsActive = true
            });
            db.CaringResearchConsents.Add(new CaringResearchConsent
            {
                TenantId = 42,
                UserId = userId,
                ConsentStatus = "opted_in",
                ConsentVersion = "research-v1",
                ConsentedAt = new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc),
                CreatedAt = new DateTime(2026, 1, 1, 8, 0, 0, DateTimeKind.Utc)
            });
            db.VolunteerLogs.Add(new VolunteerLog
            {
                TenantId = 42,
                UserId = userId,
                DateLogged = new DateOnly(2026, 1, userId - 1000),
                Hours = userId - 1000,
                Status = "approved",
                CreatedAt = new DateTime(2026, 1, userId - 1000, 8, 0, 0, DateTimeKind.Utc)
            });
        }
        db.Users.Add(new User
        {
            Id = 2001,
            TenantId = 42,
            Email = "research-pending@example.test",
            PasswordHash = "hash",
            FirstName = "Pending",
            LastName = "Member",
            IsActive = true
        });
        db.VolunteerLogs.Add(new VolunteerLog
        {
            TenantId = 42,
            UserId = 2001,
            DateLogged = new DateOnly(2026, 1, 9),
            Hours = 8,
            Status = "pending",
            CreatedAt = new DateTime(2026, 1, 9, 8, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller,
            "GenerateDatasetExport",
            100L,
            new Dictionary<string, object?>
            {
                ["period_start"] = "2026-01-01",
                ["period_end"] = "2026-01-31"
            },
            CancellationToken.None),
            StatusCodes.Status201Created);

        var export = data.GetProperty("export");
        export.GetProperty("tenant_id").GetInt32().Should().Be(42);
        export.GetProperty("partner_id").GetInt64().Should().Be(100);
        export.GetProperty("requested_by").GetInt32().Should().Be(9001);
        export.GetProperty("dataset_key").GetString().Should().Be("caring_community_aggregate_v1");
        export.GetProperty("period_start").GetString().Should().Be("2026-01-01");
        export.GetProperty("period_end").GetString().Should().Be("2026-01-31");
        export.GetProperty("status").GetString().Should().Be("generated");
        export.GetProperty("row_count").GetInt32().Should().Be(1);
        export.GetProperty("anonymization_version").GetString().Should().Be("aggregate-v1");
        export.GetProperty("data_hash").GetString().Should().HaveLength(64);
        export.GetProperty("metadata").GetProperty("partner_name").GetString().Should().Be("Ageing Futures Lab");
        export.GetProperty("metadata").GetProperty("suppression_threshold").GetInt32().Should().Be(5);

        var dataset = data.GetProperty("dataset");
        dataset.GetProperty("dataset_key").GetString().Should().Be("caring_community_aggregate_v1");
        dataset.GetProperty("period").GetProperty("start").GetString().Should().Be("2026-01-01");
        dataset.GetProperty("period").GetProperty("end").GetString().Should().Be("2026-01-31");
        dataset.GetProperty("anonymization").GetProperty("suppression_threshold").GetInt32().Should().Be(5);
        var row = dataset.GetProperty("rows")[0];
        row.GetProperty("period").GetString().Should().Be("2026-01");
        row.GetProperty("metric_family").GetString().Should().Be("volunteering");
        row.GetProperty("activity_count").GetInt32().Should().Be(5);
        row.GetProperty("participant_count").GetInt32().Should().Be(5);
        row.GetProperty("approved_hours").GetDecimal().Should().Be(15m);
        row.GetProperty("suppressed").GetBoolean().Should().BeFalse();

        var stored = await db.CaringResearchDatasetExports.IgnoreQueryFilters().SingleAsync();
        stored.Status.Should().Be("generated");
        stored.RowCount.Should().Be(1);
        stored.Metadata.Should().Contain("Ageing Futures Lab");
    }

    [Fact]
    public async Task GenerateDatasetExport_WhenInvalidDates_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(controller,
                "GenerateDatasetExport",
                100L,
                new Dictionary<string, object?>
                {
                    ["period_start"] = "2026-02-01",
                    ["period_end"] = "2026-01-01"
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        db.CaringResearchDatasetExports.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task GenerateDatasetExport_WhenPartnerInactive_ReturnsLaravelExportFailedError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(PartnerTypeName,
            ("Id", 100L), ("TenantId", 42), ("Name", "Paused Lab"), ("Institution", "FHNW"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "paused"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", 9001),
            ("CreatedAt", new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(controller,
                "GenerateDatasetExport",
                100L,
                new Dictionary<string, object?>
                {
                    ["period_start"] = "2026-01-01",
                    ["period_end"] = "2026-01-31"
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "RESEARCH_EXPORT_FAILED");
    }

    [Fact]
    public async Task RevokeDatasetExport_MarksTenantExportRevokedAndMergesAuditMetadata()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(PartnerTypeName,
            ("Id", 100L), ("TenantId", 42), ("Name", "Ageing Futures Lab"), ("Institution", "FHNW"),
            ("ContactEmail", null), ("AgreementReference", null), ("MethodologyUrl", null), ("Status", "active"),
            ("DataScope", null), ("StartsAt", null), ("EndsAt", null), ("CreatedBy", null),
            ("CreatedAt", new DateTime(2026, 6, 1, 9, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        db.Add(Entity(ExportTypeName,
            ("Id", 500L), ("TenantId", 42), ("PartnerId", 100L), ("RequestedBy", 9001),
            ("DatasetKey", "caring_community_aggregate_v1"), ("PeriodStart", new DateOnly(2026, 1, 1)),
            ("PeriodEnd", new DateOnly(2026, 1, 31)), ("Status", "generated"), ("RowCount", 6),
            ("AnonymizationVersion", "aggregate-v1"), ("DataHash", new string('a', 64)),
            ("GeneratedAt", new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)),
            ("Metadata", """{"partner_name":"Ageing Futures Lab","suppression_threshold":5}"""),
            ("CreatedAt", new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller, "RevokeDatasetExport", 500L, CancellationToken.None));

        data.GetProperty("id").GetInt64().Should().Be(500);
        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("status").GetString().Should().Be("revoked");
        data.GetProperty("metadata").GetProperty("partner_name").GetString().Should().Be("Ageing Futures Lab");
        data.GetProperty("metadata").GetProperty("suppression_threshold").GetInt32().Should().Be(5);
        data.GetProperty("metadata").GetProperty("revoked_by").GetInt32().Should().Be(9001);
        data.GetProperty("metadata").GetProperty("revoked_at").GetString().Should().NotBeNullOrWhiteSpace();

        var stored = await db.CaringResearchDatasetExports.IgnoreQueryFilters()
            .SingleAsync(export => export.Id == 500);
        stored.Status.Should().Be("revoked");
        stored.UpdatedAt.Should().NotBeNull();
        stored.Metadata.Should().Contain("\"revoked_by\":9001");
    }

    [Fact]
    public async Task RevokeDatasetExport_WhenMissingOrOtherTenant_ReturnsLaravelNotFoundError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(ExportTypeName,
            ("Id", 900L), ("TenantId", 7), ("PartnerId", 100L), ("RequestedBy", null),
            ("DatasetKey", "hidden"), ("PeriodStart", new DateOnly(2026, 3, 1)),
            ("PeriodEnd", new DateOnly(2026, 3, 31)), ("Status", "generated"), ("RowCount", 99),
            ("AnonymizationVersion", "aggregate-v1"), ("DataHash", new string('c', 64)),
            ("GeneratedAt", new DateTime(2026, 7, 3, 8, 0, 0, DateTimeKind.Utc)),
            ("Metadata", null), ("CreatedAt", new DateTime(2026, 7, 3, 8, 0, 0, DateTimeKind.Utc)), ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateResearchController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(controller, "RevokeDatasetExport", 900L, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "RESEARCH_EXPORT_NOT_FOUND");
    }

    [Fact]
    public async Task RolePresets_ReturnsLaravelStatusShapeAgainstDotNetRoles()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Roles.Add(new Role
        {
            Id = 71,
            TenantId = 42,
            Name = "kiss_canton_admin_t42",
            Description = "Regional operating view, municipal coordination, reporting, and trusted partner oversight.",
            Permissions = JsonSerializer.Serialize(new[]
            {
                "caring.view",
                "caring.workflow.review",
                "caring.workflow.assign",
                "caring.reports.view",
                "caring.reports.export",
                "volunteering.hours.review",
                "volunteering.organisations.manage",
                "members.assisted_onboarding",
                "federation.nodes.view"
            })
        });
        db.Roles.Add(new Role
        {
            Id = 72,
            TenantId = 7,
            Name = "kiss_canton_admin_t7",
            Permissions = JsonSerializer.Serialize(new[] { "caring.view" })
        });
        await db.SaveChangesAsync();
        var controller = CreateRolePresetController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller, "RolePresets", CancellationToken.None));

        data.GetProperty("available").GetBoolean().Should().BeTrue();
        data.GetProperty("total_count").GetInt32().Should().Be(6);
        data.GetProperty("installed_count").GetInt32().Should().Be(1);
        var presets = data.GetProperty("presets");
        presets.GetArrayLength().Should().Be(6);

        var canton = presets.EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "canton_admin");
        canton.GetProperty("role_name").GetString().Should().Be("kiss_canton_admin_t42");
        canton.GetProperty("role_id").GetInt32().Should().Be(71);
        canton.GetProperty("installed").GetBoolean().Should().BeTrue();
        canton.GetProperty("permission_count").GetInt32().Should().Be(9);
        canton.GetProperty("installed_permissions").GetInt32().Should().Be(9);

        var national = presets.EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "national_admin");
        national.GetProperty("installed").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task InstallRolePresets_WithNamedPresetCreatesOnlyThatLaravelRole()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateRolePresetController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller,
            "InstallRolePresets",
            new Dictionary<string, object?>
            {
                ["preset"] = "trusted_reviewer"
            },
            CancellationToken.None));

        data.GetProperty("available").GetBoolean().Should().BeTrue();
        data.GetProperty("installed_count").GetInt32().Should().Be(1);
        data.GetProperty("total_count").GetInt32().Should().Be(6);

        var presets = data.GetProperty("presets");
        var trustedReviewer = presets.EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "trusted_reviewer");
        trustedReviewer.GetProperty("role_name").GetString().Should().Be("kiss_trusted_reviewer_t42");
        trustedReviewer.GetProperty("role_id").GetInt32().Should().BePositive();
        trustedReviewer.GetProperty("installed").GetBoolean().Should().BeTrue();
        trustedReviewer.GetProperty("permission_count").GetInt32().Should().Be(3);
        trustedReviewer.GetProperty("installed_permissions").GetInt32().Should().Be(3);

        var national = presets.EnumerateArray()
            .Single(item => item.GetProperty("key").GetString() == "national_admin");
        national.GetProperty("installed").GetBoolean().Should().BeFalse();

        var role = await db.Roles.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == 42 && row.Name == "kiss_trusted_reviewer_t42");
        role.Description.Should().Be("Limited review authority for approved hour logs and community trust signals.");
        role.IsSystem.Should().BeFalse();
        JsonSerializer.Deserialize<string[]>(role.Permissions).Should()
            .Contain(new[] { "caring.view", "caring.workflow.review", "volunteering.hours.review" });

        db.Roles.IgnoreQueryFilters()
            .Where(row => row.TenantId == 7 || row.Name.StartsWith("kiss_national_admin"))
            .Should().BeEmpty();
    }

    [Fact]
    public async Task InstallRolePresets_WithUnknownPresetFallsBackToAllLaravelPresets()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Roles.Add(new Role
        {
            TenantId = 42,
            Name = "kiss_canton_admin_t42",
            Description = "Old description",
            Permissions = JsonSerializer.Serialize(new[] { "caring.view" }),
            IsSystem = true
        });
        await db.SaveChangesAsync();
        var controller = CreateRolePresetController(db, tenant, userId: 9001);

        var data = ReadDataObject(await Invoke(controller,
            "InstallRolePresets",
            new Dictionary<string, object?>
            {
                ["preset"] = "not-a-laravel-preset"
            },
            CancellationToken.None));

        data.GetProperty("installed_count").GetInt32().Should().Be(6);
        data.GetProperty("total_count").GetInt32().Should().Be(6);
        var presets = data.GetProperty("presets");
        presets.EnumerateArray().Should().AllSatisfy(item =>
        {
            item.GetProperty("installed").GetBoolean().Should().BeTrue();
            item.GetProperty("installed_permissions").GetInt32()
                .Should().Be(item.GetProperty("permission_count").GetInt32());
        });

        var canton = await db.Roles.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == 42 && row.Name == "kiss_canton_admin_t42");
        canton.Description.Should().Be("Regional operating view, municipal coordination, reporting, and trusted partner oversight.");
        canton.IsSystem.Should().BeTrue();
        JsonSerializer.Deserialize<string[]>(canton.Permissions).Should()
            .Contain(new[] { "caring.workflow.assign", "federation.nodes.view" });

        (await db.Roles.IgnoreQueryFilters()
            .CountAsync(row => row.TenantId == 42 && row.Name.StartsWith("kiss_")))
            .Should().Be(6);
    }

    [Fact]
    public async Task AdminReads_WhenCaringCommunityDisabled_ReturnLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();

        var researchController = CreateResearchController(db, tenant, userId: 9001);
        var rolePresetController = CreateRolePresetController(db, tenant, userId: 9001);

        AssertSingleError(await Invoke(researchController, "AgreementTemplates", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await Invoke(rolePresetController, "RolePresets", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await Invoke(rolePresetController,
                "InstallRolePresets",
                new Dictionary<string, object?>(),
                CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    private static object CreateResearchController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(ResearchServiceTypeName), db)!;
        var templates = Activator.CreateInstance(Resolve(TemplateServiceTypeName))!;
        var controller = Activator.CreateInstance(Resolve(ResearchControllerTypeName), service, templates, tenant)!;
        ((ControllerBase)controller).ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static object CreateRolePresetController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var service = Activator.CreateInstance(Resolve(RolePresetServiceTypeName), db)!;
        var controller = Activator.CreateInstance(Resolve(RolePresetControllerTypeName), service, tenant)!;
        ((ControllerBase)controller).ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        controller.GetType().GetMethod(method).Should().NotBeNull();
        var result = controller.GetType().GetMethod(method)!.Invoke(controller, args);
        result.Should().BeAssignableTo<Task<IActionResult>>();
        return await (Task<IActionResult>)result!;
    }

    private static JsonElement ReadDataObject(IActionResult result)
    {
        result.Should().BeOfType<OkObjectResult>();
        var document = JsonSerializer.SerializeToDocument(((OkObjectResult)result).Value);
        return document.RootElement.GetProperty("data").Clone();
    }

    private static JsonElement ReadDataObject(IActionResult result, int statusCode)
    {
        result.Should().BeOfType<ObjectResult>();
        var objectResult = (ObjectResult)result;
        objectResult.StatusCode.Should().Be(statusCode);
        var document = JsonSerializer.SerializeToDocument(objectResult.Value);
        return document.RootElement.GetProperty("data").Clone();
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        result.Should().BeOfType<ObjectResult>();
        var objectResult = (ObjectResult)result;
        objectResult.StatusCode.Should().Be(statusCode);
        var document = JsonSerializer.SerializeToDocument(objectResult.Value);
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString().Should().Be(code);
    }

    private static object Entity(string typeName, params (string Name, object? Value)[] values)
    {
        var type = Resolve(typeName);
        var entity = Activator.CreateInstance(type)!;
        foreach (var (name, value) in values)
        {
            type.GetProperty(name).Should().NotBeNull($"property {name} should exist on {typeName}");
            type.GetProperty(name)!.SetValue(entity, value);
        }

        return entity;
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

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim("tenant_id", tenantId.ToString()),
                        new Claim(ClaimTypes.Role, Role.Names.Admin)
                    },
                    "TestAuth"))
            }
        };
    }

    private static Type Resolve(string name)
    {
        var type = Type.GetType(name, throwOnError: false);
        type.Should().NotBeNull($"{name} should exist for Laravel parity");
        return type!;
    }
}
