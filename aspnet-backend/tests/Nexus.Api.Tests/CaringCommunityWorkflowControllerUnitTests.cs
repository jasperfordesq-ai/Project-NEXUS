// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityWorkflowControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.AdminCaringCommunityWorkflowController, Nexus.Api";
    private const string ServiceTypeName = "Nexus.Api.Services.CaringCommunityWorkflowService, Nexus.Api";

    [Fact]
    public void Workflow_ExposesLaravelAdminRoute()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template.Should().Be("api/admin/caring-community");
        controller.GetCustomAttribute<AuthorizeAttribute>()?.Policy.Should().Be("AdminOnly");
        controller.GetMethod("Workflow")?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("workflow");
        controller.GetMethod("UpdatePolicy")?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("workflow/policy");
        controller.GetMethod("AssignReview")?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("workflow/reviews/{id}/assign");
        controller.GetMethod("DecideReview")?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("workflow/reviews/{id}/decision");
        controller.GetMethod("EscalateReview")?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("workflow/reviews/{id}/escalate");
    }

    [Fact]
    public async Task Workflow_ReturnsLaravelSummaryWithTenantScopedStatsReviewsSignalsAndPolicy()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(1, 42, "Ava", "Admin", Role.Names.Admin),
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(11, 42, "Ben", "Broker", Role.Names.Admin),
            User(99, 7, "Other", "Tenant", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2.4m, DateTime.UtcNow.AddDays(-4), assignedTo: 11),
            Log(101, 42, 10, "pending", 1.0m, DateTime.UtcNow.AddDays(-1), escalatedAt: DateTime.UtcNow.AddHours(-2)),
            Log(102, 42, 10, "approved", 1.5m, DateTime.UtcNow.AddDays(-2), updatedAt: DateTime.UtcNow.AddHours(-3)),
            Log(103, 42, 10, "declined", 0.5m, DateTime.UtcNow.AddDays(-3), updatedAt: DateTime.UtcNow.AddHours(-5)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-10)));
        db.Listings.AddRange(
            Listing(500, 42, 10, ListingType.Request, ListingStatus.Active),
            Listing(501, 42, 10, ListingType.Offer, ListingStatus.Active),
            Listing(502, 42, 10, ListingType.Offer, ListingStatus.Draft),
            Listing(900, 7, 99, ListingType.Request, ListingStatus.Active));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "Workflow", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");

        var stats = data.GetProperty("stats");
        stats.GetProperty("pending_count").GetInt32().Should().Be(2);
        stats.GetProperty("pending_hours").GetDecimal().Should().Be(3.4m);
        stats.GetProperty("overdue_count").GetInt32().Should().Be(1);
        stats.GetProperty("escalated_count").GetInt32().Should().Be(1);
        stats.GetProperty("approved_30d_hours").GetDecimal().Should().Be(1.5m);
        stats.GetProperty("declined_30d_count").GetInt32().Should().Be(1);
        stats.GetProperty("coordinator_count").GetInt32().Should().Be(2);
        stats.GetProperty("intergenerational_tandem_count").GetInt32().Should().Be(0);

        var pending = data.GetProperty("pending_reviews").EnumerateArray().ToArray();
        pending.Should().HaveCount(2);
        pending[0].GetProperty("id").GetInt32().Should().Be(100);
        pending[0].GetProperty("member_name").GetString().Should().Be("Mia Member");
        pending[0].GetProperty("assigned_to").GetInt32().Should().Be(11);
        pending[0].GetProperty("assigned_name").GetString().Should().Be("Ben Broker");
        pending[0].GetProperty("hours").GetDecimal().Should().Be(2.4m);
        pending[0].GetProperty("is_overdue").GetBoolean().Should().BeTrue();
        pending[0].GetProperty("is_escalated").GetBoolean().Should().BeFalse();
        pending[1].GetProperty("is_escalated").GetBoolean().Should().BeTrue();

        var recent = data.GetProperty("recent_decisions").EnumerateArray().ToArray();
        recent.Should().HaveCount(2);
        recent[0].GetProperty("id").GetInt32().Should().Be(102);
        recent[0].GetProperty("status").GetString().Should().Be("approved");
        recent[1].GetProperty("status").GetString().Should().Be("declined");

        var signals = data.GetProperty("coordinator_signals");
        signals.GetProperty("active_requests").GetInt32().Should().Be(1);
        signals.GetProperty("active_offers").GetInt32().Should().Be(1);
        signals.GetProperty("trusted_organisations").GetInt32().Should().Be(0);

        var coordinators = data.GetProperty("coordinators").EnumerateArray().ToArray();
        coordinators.Select(item => item.GetProperty("name").GetString())
            .Should().Equal("Ava Admin", "Ben Broker");

        var rolePack = data.GetProperty("role_pack");
        rolePack.GetProperty("available").GetBoolean().Should().BeTrue();
        rolePack.GetProperty("total_count").GetInt32().Should().Be(6);

        var policy = data.GetProperty("policy");
        policy.GetProperty("approval_required").GetBoolean().Should().BeTrue();
        policy.GetProperty("review_sla_days").GetInt32().Should().Be(3);
        policy.GetProperty("escalation_sla_days").GetInt32().Should().Be(5);
        policy.GetProperty("municipal_report_default_period").GetString().Should().Be("previous_quarter");
        policy.GetProperty("default_hour_value_chf").GetInt32().Should().Be(50);
    }

    [Fact]
    public async Task EscalateReview_EscalatesPendingReviewAndNormalizesNote()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(11, 42, "Ben", "Broker", Role.Names.Admin),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2.4m, DateTime.UtcNow.AddDays(-1), assignedTo: 11),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);
        var note = "  " + new string('x', 1005) + "  ";

        var result = await Invoke(controller, "EscalateReview", 100, new Dictionary<string, object?>
        {
            ["note"] = note
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("message").GetString().Should().Be("Review escalated.");
        var review = data.GetProperty("review");
        review.GetProperty("id").GetInt32().Should().Be(100);
        review.GetProperty("assigned_to").GetInt32().Should().Be(11);
        review.GetProperty("assigned_name").GetString().Should().Be("Ben Broker");
        review.GetProperty("escalated_at").ValueKind.Should().Be(JsonValueKind.String);
        review.GetProperty("escalation_note").GetString().Should().Be(new string('x', 1000));
        review.GetProperty("is_escalated").GetBoolean().Should().BeTrue();

        var stored = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100);
        stored.EscalatedAt.Should().NotBeNull();
        stored.EscalationNote.Should().Be(new string('x', 1000));
        stored.UpdatedAt.Should().NotBeNull();

        var otherTenant = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200);
        otherTenant.EscalatedAt.Should().BeNull();
        otherTenant.EscalationNote.Should().BeNull();
    }

    [Fact]
    public async Task EscalateReview_ReturnsNotFoundForOtherTenantOrNonPendingAndNullsBlankNote()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2m, DateTime.UtcNow.AddDays(-1)),
            Log(101, 42, 10, "approved", 1m, DateTime.UtcNow.AddDays(-1)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var escalated = await Invoke(controller, "EscalateReview", 100, new Dictionary<string, object?>
        {
            ["note"] = "   "
        }, CancellationToken.None);
        var nonPending = await Invoke(controller, "EscalateReview", 101, new Dictionary<string, object?>
        {
            ["note"] = "should not store"
        }, CancellationToken.None);
        var crossTenant = await Invoke(controller, "EscalateReview", 200, new Dictionary<string, object?>
        {
            ["note"] = "should not store"
        }, CancellationToken.None);

        var ok = escalated.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            var review = document.RootElement.GetProperty("data").GetProperty("review");
            review.GetProperty("escalation_note").ValueKind.Should().Be(JsonValueKind.Null);
            review.GetProperty("is_escalated").GetBoolean().Should().BeTrue();
        }

        foreach (var result in new[] { nonPending, crossTenant })
        {
            var notFound = result.Should().BeOfType<ObjectResult>().Subject;
            notFound.StatusCode.Should().Be(StatusCodes.Status404NotFound);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
            var error = document.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
            error.GetProperty("message").GetString().Should().Be("Review could not be escalated.");
        }

        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100)).EscalationNote.Should().BeNull();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 101)).EscalatedAt.Should().BeNull();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200)).EscalatedAt.Should().BeNull();
    }

    [Fact]
    public async Task DecideReview_ApprovesPendingReviewAndReturnsLaravelSummary()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.TenantConfigs.AddRange(
            new TenantConfig
            {
                TenantId = 42,
                Key = CaringRegionalPointService.KeyPrefix + "enabled",
                Value = "true"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = CaringRegionalPointService.KeyPrefix + "auto_issue_enabled",
                Value = "true"
            },
            new TenantConfig
            {
                TenantId = 42,
                Key = CaringRegionalPointService.KeyPrefix + "points_per_approved_hour",
                Value = "2"
            });
        db.Users.AddRange(
            User(1, 42, "Ava", "Admin", Role.Names.Admin),
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2.4m, DateTime.UtcNow.AddDays(-4)),
            Log(101, 42, 10, "pending", 1.0m, DateTime.UtcNow.AddDays(-1)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-4)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "DecideReview", 100, new Dictionary<string, object?>
        {
            ["action"] = "approve"
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("message").GetString().Should().Be("Review approved.");
        var review = data.GetProperty("review");
        review.GetProperty("id").GetInt32().Should().Be(100);
        review.GetProperty("status").GetString().Should().Be("approved");
        review.GetProperty("payment_result").ValueKind.Should().Be(JsonValueKind.Null);
        var regionalAward = review.GetProperty("regional_points_result");
        regionalAward.GetProperty("points").GetDecimal().Should().Be(4.8m);
        regionalAward.GetProperty("already_awarded").GetBoolean().Should().BeFalse();

        var summary = review.GetProperty("summary");
        summary.GetProperty("stats").GetProperty("pending_count").GetInt32().Should().Be(1);
        summary.GetProperty("stats").GetProperty("approved_30d_hours").GetDecimal().Should().Be(2.4m);
        summary.GetProperty("pending_reviews").EnumerateArray().Select(item => item.GetProperty("id").GetInt32())
            .Should().Equal(101);

        var stored = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100);
        stored.Status.Should().Be("approved");
        stored.UpdatedAt.Should().NotBeNull();
        (await db.CaringRegionalPointTransactions.IgnoreQueryFilters().SingleAsync(row =>
            row.TenantId == 42
            && row.ReferenceType == "vol_log"
            && row.ReferenceId == 100
            && row.Type == "earned_for_hours")).Points.Should().Be(4.8m);

        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200)).Status.Should().Be("pending");
    }

    [Fact]
    public async Task DecideReview_DeclinesPendingReviewAndRejectsInvalidOrUnavailableDecisions()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(1, 42, "Ava", "Admin", Role.Names.Admin),
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2m, DateTime.UtcNow.AddDays(-1)),
            Log(101, 42, 10, "approved", 1m, DateTime.UtcNow.AddDays(-1)),
            Log(102, 42, 1, "pending", 1m, DateTime.UtcNow.AddDays(-1)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var declined = await Invoke(controller, "DecideReview", 100, new Dictionary<string, object?>
        {
            ["action"] = "decline"
        }, CancellationToken.None);
        var invalidAction = await Invoke(controller, "DecideReview", 101, new Dictionary<string, object?>
        {
            ["action"] = "maybe"
        }, CancellationToken.None);
        var nonPending = await Invoke(controller, "DecideReview", 101, new Dictionary<string, object?>
        {
            ["action"] = "approve"
        }, CancellationToken.None);
        var selfReview = await Invoke(controller, "DecideReview", 102, new Dictionary<string, object?>
        {
            ["action"] = "approve"
        }, CancellationToken.None);
        var crossTenant = await Invoke(controller, "DecideReview", 200, new Dictionary<string, object?>
        {
            ["action"] = "approve"
        }, CancellationToken.None);

        var ok = declined.Should().BeOfType<OkObjectResult>().Subject;
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value)))
        {
            var data = document.RootElement.GetProperty("data");
            data.GetProperty("message").GetString().Should().Be("Review declined.");
            data.GetProperty("review").GetProperty("status").GetString().Should().Be("declined");
            data.GetProperty("review").GetProperty("summary").GetProperty("stats").GetProperty("declined_30d_count").GetInt32().Should().Be(1);
        }

        var validation = invalidAction.Should().BeOfType<ObjectResult>().Subject;
        validation.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
        using (var document = JsonDocument.Parse(JsonSerializer.Serialize(validation.Value)))
        {
            var error = document.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("action");
        }

        foreach (var result in new[] { nonPending, selfReview, crossTenant })
        {
            var notFound = result.Should().BeOfType<ObjectResult>().Subject;
            notFound.StatusCode.Should().Be(StatusCodes.Status404NotFound);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
            var error = document.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
            error.GetProperty("message").GetString().Should().Be("Review decision failed.");
        }

        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100)).Status.Should().Be("declined");
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 101)).Status.Should().Be("approved");
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 102)).Status.Should().Be("pending");
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200)).Status.Should().Be("pending");
    }

    [Fact]
    public async Task AssignReview_AssignsPendingReviewToTenantCoordinator()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(11, 42, "Ben", "Broker", Role.Names.Admin),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2.4m, DateTime.UtcNow.AddDays(-4)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-4)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "AssignReview", 100, new Dictionary<string, object?>
        {
            ["assigned_to"] = 11
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("message").GetString().Should().Be("Review assignment updated.");
        var review = data.GetProperty("review");
        review.GetProperty("id").GetInt32().Should().Be(100);
        review.GetProperty("member_name").GetString().Should().Be("Mia Member");
        review.GetProperty("assigned_to").GetInt32().Should().Be(11);
        review.GetProperty("assigned_name").GetString().Should().Be("Ben Broker");
        review.GetProperty("assigned_at").ValueKind.Should().Be(JsonValueKind.String);
        review.GetProperty("hours").GetDecimal().Should().Be(2.4m);
        review.GetProperty("is_overdue").GetBoolean().Should().BeTrue();

        var stored = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100);
        stored.AssignedTo.Should().Be(11);
        stored.AssignedAt.Should().NotBeNull();
        stored.UpdatedAt.Should().NotBeNull();

        var otherTenant = await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200);
        otherTenant.AssignedTo.Should().BeNull();
    }

    [Fact]
    public async Task AssignReview_ReturnsNotFoundForInvalidAssigneeOtherTenantOrNonPendingReview()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.Users.AddRange(
            User(10, 42, "Mia", "Member", Role.Names.Member),
            User(11, 42, "Ben", "Broker", Role.Names.Member),
            User(12, 42, "Ava", "Admin", Role.Names.Admin),
            User(99, 7, "Other", "Admin", Role.Names.Admin));
        db.VolunteerLogs.AddRange(
            Log(100, 42, 10, "pending", 2m, DateTime.UtcNow.AddDays(-1)),
            Log(101, 42, 10, "approved", 2m, DateTime.UtcNow.AddDays(-1)),
            Log(200, 7, 99, "pending", 9m, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var invalidAssignee = await Invoke(controller, "AssignReview", 100, new Dictionary<string, object?>
        {
            ["assigned_to"] = 11
        }, CancellationToken.None);
        var crossTenant = await Invoke(controller, "AssignReview", 200, new Dictionary<string, object?>
        {
            ["assigned_to"] = 12
        }, CancellationToken.None);
        var nonPending = await Invoke(controller, "AssignReview", 101, new Dictionary<string, object?>
        {
            ["assigned_to"] = 12
        }, CancellationToken.None);

        foreach (var result in new[] { invalidAssignee, crossTenant, nonPending })
        {
            var notFound = result.Should().BeOfType<ObjectResult>().Subject;
            notFound.StatusCode.Should().Be(StatusCodes.Status404NotFound);
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
            var error = document.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("NOT_FOUND");
            error.GetProperty("message").GetString().Should().Be("Review could not be assigned.");
        }

        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 100)).AssignedTo.Should().BeNull();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 101)).AssignedTo.Should().BeNull();
        (await db.VolunteerLogs.IgnoreQueryFilters().SingleAsync(log => log.Id == 200)).AssignedTo.Should().BeNull();
    }

    [Fact]
    public async Task UpdatePolicy_NormalizesAndPersistsLaravelWorkflowPolicy()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        SeedPolicy(db, 42);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 7,
            Key = "caring_community.workflow.default_hour_value_chf",
            Value = "77"
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "UpdatePolicy", new Dictionary<string, object?>
        {
            ["approval_required"] = false,
            ["auto_approve_trusted_reviewers"] = true,
            ["review_sla_days"] = 0,
            ["escalation_sla_days"] = 99,
            ["allow_member_self_log"] = false,
            ["require_organisation_for_partner_hours"] = false,
            ["monthly_statement_day"] = 31,
            ["municipal_report_default_period"] = "unsupported_period",
            ["include_social_value_estimate"] = false,
            ["default_hour_value_chf"] = 999
        }, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("approval_required").GetBoolean().Should().BeFalse();
        data.GetProperty("auto_approve_trusted_reviewers").GetBoolean().Should().BeTrue();
        data.GetProperty("review_sla_days").GetInt32().Should().Be(1);
        data.GetProperty("escalation_sla_days").GetInt32().Should().Be(60);
        data.GetProperty("allow_member_self_log").GetBoolean().Should().BeFalse();
        data.GetProperty("require_organisation_for_partner_hours").GetBoolean().Should().BeFalse();
        data.GetProperty("monthly_statement_day").GetInt32().Should().Be(28);
        data.GetProperty("municipal_report_default_period").GetString().Should().Be("last_90_days");
        data.GetProperty("include_social_value_estimate").GetBoolean().Should().BeFalse();
        data.GetProperty("default_hour_value_chf").GetInt32().Should().Be(500);

        var rows = await db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == 42 && config.Key.StartsWith("caring_community.workflow."))
            .ToDictionaryAsync(config => config.Key, config => config.Value);

        rows["caring_community.workflow.approval_required"].Should().Be("0");
        rows["caring_community.workflow.auto_approve_trusted_reviewers"].Should().Be("1");
        rows["caring_community.workflow.review_sla_days"].Should().Be("1");
        rows["caring_community.workflow.escalation_sla_days"].Should().Be("60");
        rows["caring_community.workflow.municipal_report_default_period"].Should().Be("last_90_days");
        rows["caring_community.workflow.default_hour_value_chf"].Should().Be("500");

        (await db.TenantConfigs.IgnoreQueryFilters()
            .SingleAsync(config => config.TenantId == 7 && config.Key == "caring_community.workflow.default_hour_value_chf"))
            .Value.Should().Be("77");
    }

    [Fact]
    public async Task UpdatePolicy_WhenFeatureDisabled_ReturnsLaravelForbidden()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "UpdatePolicy", new Dictionary<string, object?>(), CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    [Fact]
    public async Task Workflow_WhenFeatureDisabled_ReturnsLaravelForbidden()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1);

        var result = await Invoke(controller, "Workflow", CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static object CreateController(NexusDbContext db, TenantContext tenant, int userId)
    {
        var rolePresetService = new CaringCommunityRolePresetService(db);
        var service = Activator.CreateInstance(Resolve(ServiceTypeName), db, rolePresetService)!;
        var controller = (ControllerBase)Activator.CreateInstance(Resolve(ControllerTypeName), service, tenant)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
        return controller;
    }

    private static async Task<IActionResult> Invoke(object controller, string method, params object?[] args)
    {
        var action = controller.GetType().GetMethod(method);
        action.Should().NotBeNull();
        var result = action!.Invoke(controller, args);
        if (result is Task<IActionResult> task)
        {
            return await task;
        }

        return result.Should().BeAssignableTo<IActionResult>().Subject;
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"Laravel caring workflow parity type {typeName} should exist");
        return type!;
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

    private static void SeedFeature(NexusDbContext db, int tenantId, bool enabled)
    {
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = "features.caring_community",
            Value = enabled ? "true" : "false"
        });
    }

    private static void SeedPolicy(NexusDbContext db, int tenantId)
    {
        foreach (var (key, value) in new[]
                 {
                     ("approval_required", "1"),
                     ("review_sla_days", "3"),
                     ("escalation_sla_days", "5"),
                     ("municipal_report_default_period", "previous_quarter"),
                     ("default_hour_value_chf", "50")
                 })
        {
            db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = "caring_community.workflow." + key,
                Value = value
            });
        }
    }

    private static User User(int id, int tenantId, string firstName, string lastName, string role)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = role,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    private static VolunteerLog Log(
        int id,
        int tenantId,
        int userId,
        string status,
        decimal hours,
        DateTime createdAt,
        int? assignedTo = null,
        DateTime? escalatedAt = null,
        DateTime? updatedAt = null)
    {
        return new VolunteerLog
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            Status = status,
            Hours = hours,
            Description = $"Log {id}",
            DateLogged = DateOnly.FromDateTime(createdAt),
            AssignedTo = assignedTo,
            AssignedAt = assignedTo is null ? null : createdAt.AddHours(1),
            EscalatedAt = escalatedAt,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt
        };
    }

    private static Listing Listing(int id, int tenantId, int userId, ListingType type, ListingStatus status)
    {
        return new Listing
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            Title = $"Listing {id}",
            Type = type,
            Status = status,
            CreatedAt = DateTime.UtcNow
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
                    new Claim(ClaimTypes.Role, Role.Names.Admin),
                    new Claim("role", Role.Names.Admin)
                ], "Test"))
            }
        };
    }
}
