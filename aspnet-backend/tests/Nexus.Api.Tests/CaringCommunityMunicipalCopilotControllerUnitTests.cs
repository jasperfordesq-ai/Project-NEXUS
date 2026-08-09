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
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public class CaringCommunityMunicipalCopilotControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelMunicipalCopilotRoutes()
    {
        typeof(AdminCaringCommunityMunicipalCopilotController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/admin/caring-community/copilot/proposals");

        typeof(AdminCaringCommunityMunicipalCopilotController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalCopilotController.Index))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityMunicipalCopilotController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalCopilotController.Generate))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().BeNull();
        typeof(AdminCaringCommunityMunicipalCopilotController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalCopilotController.Accept))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{proposalId}/accept");
        typeof(AdminCaringCommunityMunicipalCopilotController)
            .GetMethod(nameof(AdminCaringCommunityMunicipalCopilotController.Reject))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("{proposalId}/reject");
    }

    [Fact]
    public async Task Index_ReturnsTenantProposalsNewestFirstWithClampedLimit()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedProposals(db, 42,
            Proposal("prop_new", "New draft", "published", "2026-07-03T12:00:00.0000000Z"),
            Proposal("prop_old", "Old draft", "rejected", "2026-07-03T09:00:00.0000000Z"));
        SeedProposals(db, 7, Proposal("prop_other", "Other tenant", "proposed", "2026-07-03T13:00:00.0000000Z"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var result = await controller.Index(limit: 500, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("limit").GetInt32().Should().Be(MunicipalCommunicationCopilotService.MaxProposals);
        var items = data.GetProperty("items").EnumerateArray().ToArray();
        items.Should().HaveCount(2);
        items.Select(item => item.GetProperty("id").GetString())
            .Should().Equal("prop_new", "prop_old");
        items[0].GetProperty("draft_text").GetString().Should().Be("New draft");
    }

    [Fact]
    public async Task Generate_ValidatesDraftAndStoresOfflineProposal()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var missing = await controller.Generate(new MunicipalCopilotGenerateRequest
        {
            Draft = "  "
        }, CancellationToken.None);
        var tooLong = await controller.Generate(new MunicipalCopilotGenerateRequest
        {
            Draft = new string('x', 4001)
        }, CancellationToken.None);
        var created = await controller.Generate(new MunicipalCopilotGenerateRequest
        {
            Draft = " Please join the neighbourhood care meeting. ",
            AudienceHint = " caregivers and volunteers ",
            SubRegionId = " north-cell "
        }, CancellationToken.None);

        AssertSingleError(missing, StatusCodes.Status422UnprocessableEntity, "VALIDATION_REQUIRED", "draft");
        AssertSingleError(tooLong, StatusCodes.Status422UnprocessableEntity, "VALIDATION_LENGTH", "draft");

        var createdResult = created.Should().BeOfType<ObjectResult>().Subject;
        createdResult.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(createdResult.Value));
        var proposal = document.RootElement.GetProperty("data").GetProperty("proposal");
        proposal.GetProperty("id").GetString().Should().MatchRegex("^prop_[a-f0-9]{16}$");
        proposal.GetProperty("draft_text").GetString().Should().Be("Please join the neighbourhood care meeting.");
        proposal.GetProperty("polished_text").GetString().Should().Be("Please join the neighbourhood care meeting.");
        proposal.GetProperty("tone_assessment").GetString().Should().Be("ok");
        proposal.GetProperty("audience_suggestion").GetString().Should().Be("all_members");
        proposal.GetProperty("audience_hint").GetString().Should().Be("caregivers and volunteers");
        proposal.GetProperty("sub_region_id").GetString().Should().Be("north-cell");
        proposal.GetProperty("model_used").GetString().Should().Be("stub");
        proposal.GetProperty("created_by").GetInt32().Should().Be(9001);
        proposal.GetProperty("status").GetString().Should().Be("proposed");

        var stored = await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(c => c.TenantId == 42 && c.Key == MunicipalCommunicationCopilotService.SettingKey);
        stored.Value.Should().Contain("Please join the neighbourhood care meeting.");
    }

    [Fact]
    public async Task Accept_PublishesAnnouncementAndIsIdempotent()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedProposals(db, 42, Proposal("prop_publish", "Draft body", "proposed", "2026-07-03T10:00:00.0000000Z"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var accepted = await controller.Accept("prop_publish", new MunicipalCopilotAcceptRequest
        {
            EditedPolishedText = "Updated announcement text for everyone.",
            EditedAudience = "verified_only"
        }, CancellationToken.None);

        var ok = accepted.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("published").GetBoolean().Should().BeTrue();
            var proposal = data.GetProperty("proposal");
            proposal.GetProperty("status").GetString().Should().Be("published");
            proposal.GetProperty("polished_text").GetString().Should().Be("Updated announcement text for everyone.");
            proposal.GetProperty("audience_suggestion").GetString().Should().Be("verified_only");
            proposal.GetProperty("source_announcement_id").GetInt32().Should().BeGreaterThan(0);
        }

        var alert = await db.CaringEmergencyAlerts.IgnoreQueryFilters().SingleAsync();
        alert.TenantId.Should().Be(42);
        alert.Title.Should().Be("Updated announcement text for everyone.");
        alert.Body.Should().Be("Updated announcement text for everyone.");
        alert.Severity.Should().Be("info");
        alert.CreatedBy.Should().Be(9001);

        var again = await controller.Accept("prop_publish", new MunicipalCopilotAcceptRequest(), CancellationToken.None);

        var againOk = again.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(againOk.Value)))
        {
            document.RootElement.GetProperty("data").GetProperty("published").GetBoolean().Should().BeTrue();
        }

        (await db.CaringEmergencyAlerts.IgnoreQueryFilters().CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Reject_ValidatesReasonAndUpdatesProposal()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        SeedProposals(db, 42, Proposal("prop_reject", "Draft body", "proposed", "2026-07-03T10:00:00.0000000Z"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var missing = await controller.Reject("prop_reject", new MunicipalCopilotRejectRequest
        {
            Reason = " "
        }, CancellationToken.None);
        var tooLong = await controller.Reject("prop_reject", new MunicipalCopilotRejectRequest
        {
            Reason = new string('r', 601)
        }, CancellationToken.None);
        var rejected = await controller.Reject("prop_reject", new MunicipalCopilotRejectRequest
        {
            Reason = "Needs legal review."
        }, CancellationToken.None);

        AssertSingleError(missing, StatusCodes.Status422UnprocessableEntity, "VALIDATION_REQUIRED", "reason");
        AssertSingleError(tooLong, StatusCodes.Status422UnprocessableEntity, "VALIDATION_LENGTH", "reason");

        var ok = rejected.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var proposal = document.RootElement.GetProperty("data").GetProperty("proposal");
        proposal.GetProperty("status").GetString().Should().Be("rejected");
        proposal.GetProperty("rejection_reason").GetString().Should().Be("Needs legal review.");
        proposal.GetProperty("rejected_by").GetInt32().Should().Be(9001);
        proposal.GetProperty("accepted_at").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task MissingProposalAndDisabledFeature_ReturnLaravelErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 9001);

        var missing = await controller.Accept("prop_missing", new MunicipalCopilotAcceptRequest(), CancellationToken.None);

        AssertSingleError(missing, StatusCodes.Status404NotFound, "NOT_FOUND", null);

        await using var disabledDb = CreateDbContext(tenant);
        SeedFeature(disabledDb, 42, false);
        await disabledDb.SaveChangesAsync();
        var disabledController = CreateController(disabledDb, tenant, userId: 9001);

        var disabled = await disabledController.Index(null, CancellationToken.None);

        AssertSingleError(disabled, StatusCodes.Status403Forbidden, "FORBIDDEN", null);
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

    private static Dictionary<string, object?> Proposal(
        string id,
        string draft,
        string status,
        string createdAt)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = id,
            ["draft_text"] = draft,
            ["polished_text"] = draft,
            ["tone_assessment"] = "ok",
            ["clarity_warnings"] = Array.Empty<string>(),
            ["audience_suggestion"] = "all_members",
            ["audience_hint"] = "",
            ["sub_region_id"] = null,
            ["moderation_flags"] = Array.Empty<string>(),
            ["model_used"] = "stub",
            ["created_by"] = 9001,
            ["created_at"] = createdAt,
            ["status"] = status,
            ["accepted_at"] = null,
            ["rejected_at"] = null,
            ["rejection_reason"] = null,
            ["source_announcement_id"] = null,
            ["updated_at"] = createdAt
        };
    }

    private static void SeedProposals(NexusDbContext db, int tenantId, params Dictionary<string, object?>[] proposals)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = MunicipalCommunicationCopilotService.SettingKey,
            Value = JsonSerializer.Serialize(new
            {
                items = proposals,
                updated_at = "2026-07-03T12:00:00.0000000Z"
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = new DateTime(2026, 7, 3, 12, 0, 0, DateTimeKind.Utc)
        });
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

    private static AdminCaringCommunityMunicipalCopilotController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var alerts = new CaringEmergencyAlertService(db, tenant);
        var service = new MunicipalCommunicationCopilotService(db, tenant, alerts);
        return new AdminCaringCommunityMunicipalCopilotController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static ControllerContext ControllerContextFor(int userId, int tenantId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                    new Claim("tenant_id", tenantId.ToString()),
                    new Claim(ClaimTypes.Role, "admin"),
                    new Claim("role", "admin")
                ], "Test"))
            }
        };
    }
}
