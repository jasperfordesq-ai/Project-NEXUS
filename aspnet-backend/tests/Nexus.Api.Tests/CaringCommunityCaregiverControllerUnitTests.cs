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

public class CaringCommunityCaregiverControllerUnitTests
{
    [Fact]
    public void Actions_ExposeLaravelCaregiverLinkRoutes()
    {
        typeof(CaringCommunityCaregiverController)
            .GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community/caregiver");

        typeof(CaringCommunityCaregiverController)
            .GetMethod(nameof(CaringCommunityCaregiverController.MyLinks))
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("links");
        typeof(CaringCommunityCaregiverController)
            .GetMethod(nameof(CaringCommunityCaregiverController.AddLink))
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("links");
        typeof(CaringCommunityCaregiverController)
            .GetMethod(nameof(CaringCommunityCaregiverController.RemoveLink))
            ?.GetCustomAttribute<HttpDeleteAttribute>()?.Template.Should().Be("links/{id:int}");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("CaregiverSchedule")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("schedule/{caredForId:int}");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("BurnoutCheck")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("burnout-check");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("RequestOnBehalf")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("request-on-behalf");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("CoverRequests")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("cover-requests");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("CreateCoverRequest")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("cover-requests");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("CoverCandidates")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template.Should().Be("cover-requests/{id:int}/candidates");
        typeof(CaringCommunityCaregiverController)
            .GetMethod("AssignCoverCandidate")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template.Should().Be("cover-requests/{id:int}/assign");
    }

    [Fact]
    public async Task MyLinks_ReturnsActiveCurrentTenantLinksForAuthenticatedCaregiver()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver", "/avatars/cara.png"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"),
            User(2002, 42, "Robin", "Recipient", "/avatars/robin.png"),
            User(3001, 7, "Other", "Tenant", "/avatars/other.png"));
        db.CaringCaregiverLinks.AddRange(
            Link(42, 1001, 2001, "family", isPrimary: false, startDate: new DateOnly(2026, 7, 10)),
            Link(42, 1001, 2002, "friend", isPrimary: true, startDate: new DateOnly(2026, 7, 5)),
            Link(42, 1001, 2001, "family", status: "inactive", startDate: new DateOnly(2026, 7, 1)),
            Link(7, 1001, 3001, "family", isPrimary: true, startDate: new DateOnly(2026, 7, 1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.MyLinks(CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("cared_for_id").GetInt32().Should().Be(2002);
        rows[0].GetProperty("is_primary").GetBoolean().Should().BeTrue();
        rows[0].GetProperty("cared_for_name").GetString().Should().Be("Robin Recipient");
        rows[0].GetProperty("cared_for_avatar_url").GetString().Should().Be("/avatars/robin.png");
        rows[1].GetProperty("cared_for_id").GetInt32().Should().Be(2001);
    }

    [Fact]
    public async Task BurnoutCheck_ReturnsLaravelRiskEnvelopeFromRecentTenantScopedLogs()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(7001, 7, "Other", "Tenant"));
        db.VolunteerLogs.AddRange(
            VolunteerLog(42, 1001, 7.5m, "approved", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1))),
            VolunteerLog(42, 1001, 5m, "pending", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-3))),
            VolunteerLog(42, 1001, 24m, "rejected", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2))),
            VolunteerLog(42, 1001, 24m, "approved", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-12))),
            VolunteerLog(7, 7001, 24m, "approved", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1))));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(controller, "BurnoutCheck", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("weekly_hours").GetDecimal().Should().Be(12.5m);
        data.GetProperty("threshold").GetDecimal().Should().Be(20m);
        data.GetProperty("at_risk").GetBoolean().Should().BeTrue();
        data.GetProperty("risk_level").GetString().Should().Be("moderate");
    }

    [Fact]
    public async Task RequestOnBehalf_CreatesHelpRequestForLinkedCaredForUser()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(
            controller,
            "RequestOnBehalf",
            new Dictionary<string, object?>
            {
                ["cared_for_id"] = 2001,
                ["title"] = "Needs groceries",
                ["description"] = "Milk, bread, and a short check-in.",
                ["when_needed"] = "tomorrow morning",
                ["contact_preference"] = "phone"
            },
            CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("user_id").GetInt32().Should().Be(2001);
        data.GetProperty("requested_by_id").GetInt32().Should().Be(1001);
        data.GetProperty("is_on_behalf").GetBoolean().Should().BeTrue();
        data.GetProperty("what").GetString().Should().Be("Needs groceries\n\nMilk, bread, and a short check-in.");
        data.GetProperty("when_needed").GetString().Should().Be("tomorrow morning");
        data.GetProperty("contact_preference").GetString().Should().Be("phone");
        data.GetProperty("status").GetString().Should().Be("pending");

        var stored = await db.CaringHelpRequests.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.UserId.Should().Be(2001);
        stored.RequestedById.Should().Be(1001);
        stored.IsOnBehalf.Should().BeTrue();
        stored.What.Should().Be("Needs groceries\n\nMilk, bread, and a short check-in.");
        stored.WhenNeeded.Should().Be("tomorrow morning");
        stored.ContactPreference.Should().Be("phone");
        stored.Status.Should().Be("pending");
    }

    [Fact]
    public async Task RequestOnBehalf_ValidatesInputAndActiveLink()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient"),
            User(2002, 42, "No", "Link"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        AssertSingleError(
            await Invoke(
                controller,
                "RequestOnBehalf",
                new Dictionary<string, object?> { ["title"] = "Missing cared-for" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "RequestOnBehalf",
                new Dictionary<string, object?> { ["cared_for_id"] = 2001 },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "RequestOnBehalf",
                new Dictionary<string, object?>
                {
                    ["cared_for_id"] = 2002,
                    ["title"] = "No active link"
                },
                CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FORBIDDEN");

        var defaulted = await Invoke(
            controller,
            "RequestOnBehalf",
            new Dictionary<string, object?>
            {
                ["cared_for_id"] = 2001,
                ["title"] = "Default fields",
                ["contact_preference"] = "fax"
            },
            CancellationToken.None);
        var created = defaulted.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("what").GetString().Should().Be("Default fields");
        data.GetProperty("when_needed").GetString().Should().Be("As soon as practical");
        data.GetProperty("contact_preference").GetString().Should().Be("either");

        db.CaringHelpRequests.IgnoreQueryFilters().Should().ContainSingle();
    }

    [Fact]
    public async Task CaregiverSchedule_RequiresActiveLinkAndReturnsRelationshipsAndRecentLogs()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver", "/avatars/cara.png"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"),
            User(3001, 42, "Sam", "Supporter", "/avatars/sam.png"),
            User(3002, 42, "Noor", "Supporter", "/avatars/noor.png"),
            User(9001, 7, "Other", "Tenant", "/avatars/other.png"),
            User(9002, 7, "Remote", "Recipient"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        db.CaringSupportRelationships.AddRange(
            SupportRelationship(
                42,
                supporterId: 3001,
                recipientId: 2001,
                title: "Morning check-in",
                nextCheckInAt: new DateTime(2026, 7, 5, 9, 0, 0, DateTimeKind.Utc)),
            SupportRelationship(
                42,
                supporterId: 3002,
                recipientId: 2001,
                title: "Inactive errand",
                status: "paused",
                nextCheckInAt: new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)),
            SupportRelationship(
                7,
                supporterId: 9001,
                recipientId: 9002,
                title: "Other tenant",
                nextCheckInAt: new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)));
        db.VolunteerLogs.AddRange(
            VolunteerLog(
                42,
                userId: 3001,
                hours: 1.5m,
                status: "approved",
                dateLogged: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2)),
                supportRecipientId: 2001),
            VolunteerLog(
                42,
                userId: 3002,
                hours: 2m,
                status: "pending",
                dateLogged: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-4)),
                supportRecipientId: 2001),
            VolunteerLog(
                42,
                userId: 3001,
                hours: 8m,
                status: "approved",
                dateLogged: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-40)),
                supportRecipientId: 2001),
            VolunteerLog(
                7,
                userId: 9001,
                hours: 9m,
                status: "approved",
                dateLogged: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
                supportRecipientId: 9002));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(controller, "CaregiverSchedule", 2001, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        var relationships = data.GetProperty("support_relationships").EnumerateArray().ToArray();
        relationships.Should().HaveCount(1);
        relationships[0].GetProperty("title").GetString().Should().Be("Morning check-in");
        relationships[0].GetProperty("supporter_id").GetInt32().Should().Be(3001);
        relationships[0].GetProperty("supporter_name").GetString().Should().Be("Sam Supporter");
        relationships[0].GetProperty("supporter_avatar_url").GetString().Should().Be("/avatars/sam.png");

        var logs = data.GetProperty("recent_logs").EnumerateArray().ToArray();
        logs.Should().HaveCount(2);
        logs[0].GetProperty("supporter_id").GetInt32().Should().Be(3001);
        logs[0].GetProperty("hours").GetDecimal().Should().Be(1.5m);
        logs[1].GetProperty("supporter_id").GetInt32().Should().Be(3002);

        var missingLink = await Invoke(controller, "CaregiverSchedule", 3001, CancellationToken.None);
        var forbidden = missingLink.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var forbiddenDocument = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        forbiddenDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FORBIDDEN");
    }

    [Fact]
    public async Task CoverRequests_ReturnsOwnedTenantScopedRequestsInLaravelOrder()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"),
            User(3001, 42, "Sam", "Supporter", "/avatars/sam.png"),
            User(9001, 7, "Other", "Tenant"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var linkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        db.Add(CoverRequest(
            id: 501,
            tenantId: 42,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Holiday cover",
            startsAt: new DateTime(2026, 7, 20, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc),
            status: "matched",
            matchedSupporterId: 3001,
            matchedAt: new DateTime(2026, 7, 10, 8, 0, 0, DateTimeKind.Utc)));
        db.Add(CoverRequest(
            id: 502,
            tenantId: 42,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Morning respite",
            startsAt: new DateTime(2026, 7, 18, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 18, 11, 0, 0, DateTimeKind.Utc),
            status: "open",
            urgency: "urgent",
            requiredSkillsJson: "[\"driving\",\"mobility\"]"));
        db.Add(CoverRequest(
            id: 503,
            tenantId: 7,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 9001,
            title: "Other tenant",
            startsAt: new DateTime(2026, 7, 17, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 17, 11, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(controller, "CoverRequests", CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Should().HaveCount(2);
        rows[0].GetProperty("id").GetInt64().Should().Be(502);
        rows[0].GetProperty("cared_for_name").GetString().Should().Be("Pat Recipient");
        rows[0].GetProperty("required_skills").EnumerateArray().Select(item => item.GetString())
            .Should().Equal("driving", "mobility");
        rows[0].GetProperty("status").GetString().Should().Be("open");
        rows[1].GetProperty("id").GetInt64().Should().Be(501);
        rows[1].GetProperty("matched_supporter_id").GetInt32().Should().Be(3001);
        rows[1].GetProperty("matched_supporter_name").GetString().Should().Be("Sam Supporter");
        rows[1].GetProperty("matched_supporter_avatar_url").GetString().Should().Be("/avatars/sam.png");
    }

    [Fact]
    public async Task CreateCoverRequest_RequiresActiveLinkAndReturnsLaravelRow()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"),
            User(3001, 42, "Sam", "Supporter"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        db.CaringSupportRelationships.Add(SupportRelationship(
            42,
            supporterId: 3001,
            recipientId: 2001,
            title: "Weekly relief"));
        await db.SaveChangesAsync();
        var linkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        var supportRelationshipId = await db.CaringSupportRelationships.IgnoreQueryFilters()
            .Where(row => row.TenantId == 42 && row.RecipientId == 2001)
            .Select(row => row.Id)
            .SingleAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(
            controller,
            "CreateCoverRequest",
            new Dictionary<string, object?>
            {
                ["cared_for_id"] = 2001,
                ["support_relationship_id"] = supportRelationshipId,
                ["title"] = "Holiday cover",
                ["briefing"] = "Medication reminder and lunch.",
                ["required_skills"] = "driving, mobility",
                ["starts_at"] = "2026-07-20T09:00:00Z",
                ["ends_at"] = "2026-07-20T12:30:00Z",
                ["expected_hours"] = 3.5m,
                ["minimum_trust_tier"] = 3,
                ["urgency"] = "urgent"
            },
            CancellationToken.None);

        var created = result.Should().BeOfType<ObjectResult>().Subject;
        created.StatusCode.Should().Be(StatusCodes.Status201Created);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(created.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("caregiver_link_id").GetInt32().Should().Be(linkId);
        data.GetProperty("caregiver_id").GetInt32().Should().Be(1001);
        data.GetProperty("cared_for_id").GetInt32().Should().Be(2001);
        data.GetProperty("cared_for_name").GetString().Should().Be("Pat Recipient");
        data.GetProperty("cared_for_avatar_url").GetString().Should().Be("/avatars/pat.png");
        data.GetProperty("support_relationship_id").GetInt32().Should().Be(supportRelationshipId);
        data.GetProperty("title").GetString().Should().Be("Holiday cover");
        data.GetProperty("briefing").GetString().Should().Be("Medication reminder and lunch.");
        data.GetProperty("required_skills").EnumerateArray().Select(skill => skill.GetString())
            .Should().Equal("driving", "mobility");
        data.GetProperty("expected_hours").GetDecimal().Should().Be(3.5m);
        data.GetProperty("minimum_trust_tier").GetInt32().Should().Be(3);
        data.GetProperty("urgency").GetString().Should().Be("urgent");
        data.GetProperty("status").GetString().Should().Be("open");
        data.GetProperty("matched_at").ValueKind.Should().Be(JsonValueKind.Null);

        var stored = await db.CaringCoverRequests.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.CaregiverLinkId.Should().Be(linkId);
        stored.CaregiverId.Should().Be(1001);
        stored.CaredForId.Should().Be(2001);
        stored.SupportRelationshipId.Should().Be(supportRelationshipId);
        stored.RequiredSkillsJson.Should().Be("[\"driving\",\"mobility\"]");
        stored.Status.Should().Be("open");
    }

    [Fact]
    public async Task CreateCoverRequest_ValidatesInputAndActiveLink()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient"),
            User(2002, 42, "No", "Link"));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        AssertSingleError(
            await Invoke(
                controller,
                "CreateCoverRequest",
                new Dictionary<string, object?> { ["title"] = "Missing recipient" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "CreateCoverRequest",
                new Dictionary<string, object?>
                {
                    ["cared_for_id"] = 2001,
                    ["title"] = "",
                    ["starts_at"] = "2026-07-20T09:00:00Z",
                    ["ends_at"] = "2026-07-20T12:00:00Z"
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "CreateCoverRequest",
                new Dictionary<string, object?>
                {
                    ["cared_for_id"] = 2001,
                    ["title"] = "Bad dates",
                    ["starts_at"] = "2026-07-20T12:00:00Z",
                    ["ends_at"] = "2026-07-20T09:00:00Z"
                },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "CreateCoverRequest",
                new Dictionary<string, object?>
                {
                    ["cared_for_id"] = 2002,
                    ["title"] = "No active link",
                    ["starts_at"] = "2026-07-20T09:00:00Z",
                    ["ends_at"] = "2026-07-20T12:00:00Z"
                },
                CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FORBIDDEN");

        db.CaringCoverRequests.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task CoverCandidates_ReturnsEligibleCandidatesAndNotFoundForUnownedRequest()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient"),
            User(3001, 42, "Sam", "Supporter", "/avatars/sam.png", trustTier: 3),
            User(3002, 42, "Noor", "Helper", "/avatars/noor.png", trustTier: 5),
            User(3003, 42, "Busy", "Supporter", trustTier: 5),
            User(3004, 42, "Inactive", "Member", trustTier: 5, isActive: false),
            User(9001, 7, "Other", "Tenant", trustTier: 5));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var linkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        db.Add(CoverRequest(
            id: 601,
            tenantId: 42,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Respite cover",
            startsAt: new DateTime(2026, 7, 20, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc),
            requiredSkillsJson: "[\"driving\"]",
            minimumTrustTier: 3));
        db.Add(CoverRequest(
            id: 602,
            tenantId: 42,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Busy overlap",
            startsAt: new DateTime(2026, 7, 20, 10, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 11, 0, 0, DateTimeKind.Utc),
            status: "matched",
            matchedSupporterId: 3003,
            minimumTrustTier: 1));
        db.Add(CoverRequest(
            id: 603,
            tenantId: 7,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 9001,
            title: "Other tenant",
            startsAt: new DateTime(2026, 7, 20, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc),
            minimumTrustTier: 1));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(controller, "CoverCandidates", 601, CancellationToken.None);
        var missing = await Invoke(controller, "CoverCandidates", 603, CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var rows = document.RootElement.GetProperty("data").EnumerateArray().ToArray();
        rows.Select(row => row.GetProperty("id").GetInt32()).Should().Equal(3002, 3001);
        rows[0].GetProperty("trust_tier").GetInt32().Should().Be(5);
        rows[0].GetProperty("match_score").GetInt32().Should().BeGreaterThan(rows[1].GetProperty("match_score").GetInt32());
        rows[0].GetProperty("skills").EnumerateArray().Should().BeEmpty();
        rows[0].GetProperty("skill_matches").GetInt32().Should().Be(0);
        rows[0].GetProperty("verification_status").GetString().Should().Be("unknown");

        var notFound = missing.Should().BeOfType<NotFoundObjectResult>().Subject;
        using var notFoundDocument = JsonDocument.Parse(JsonSerializer.Serialize(notFound.Value));
        notFoundDocument.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("NOT_FOUND");
    }

    [Fact]
    public async Task AssignCoverCandidate_MatchesEligibleSupporterAndReturnsLaravelRow()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient", "/avatars/pat.png"),
            User(3001, 42, "Sam", "Supporter", "/avatars/sam.png", trustTier: 3),
            User(9001, 7, "Other", "Tenant", trustTier: 5));
        db.CaringCaregiverLinks.Add(Link(42, 1001, 2001, "family", status: "active"));
        await db.SaveChangesAsync();
        var linkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        db.Add(CoverRequest(
            id: 701,
            tenantId: 42,
            caregiverLinkId: linkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Respite cover",
            startsAt: new DateTime(2026, 7, 20, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc),
            requiredSkillsJson: "[\"driving\"]",
            minimumTrustTier: 3));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await Invoke(
            controller,
            "AssignCoverCandidate",
            701,
            new Dictionary<string, object?> { ["supporter_id"] = 3001 },
            CancellationToken.None);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");
        data.GetProperty("id").GetInt64().Should().Be(701);
        data.GetProperty("matched_supporter_id").GetInt32().Should().Be(3001);
        data.GetProperty("matched_supporter_name").GetString().Should().Be("Sam Supporter");
        data.GetProperty("matched_supporter_avatar_url").GetString().Should().Be("/avatars/sam.png");
        data.GetProperty("status").GetString().Should().Be("matched");
        data.GetProperty("matched_at").ValueKind.Should().NotBe(JsonValueKind.Null);

        var stored = await db.CaringCoverRequests.IgnoreQueryFilters().SingleAsync(row => row.Id == 701);
        stored.MatchedSupporterId.Should().Be(3001);
        stored.Status.Should().Be("matched");
        stored.MatchedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task AssignCoverCandidate_ValidatesSupporterAndOwnership()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(1002, 42, "Other", "Caregiver"),
            User(2001, 42, "Pat", "Recipient"),
            User(3001, 42, "Sam", "Supporter", trustTier: 1),
            User(3002, 42, "Noor", "Helper", trustTier: 5),
            User(9001, 7, "Other", "Tenant", trustTier: 5));
        db.CaringCaregiverLinks.AddRange(
            Link(42, 1001, 2001, "family", status: "active"),
            Link(42, 1002, 2001, "friend", status: "active"));
        await db.SaveChangesAsync();
        var caregiverLinkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        var otherCaregiverLinkId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1002)
            .Select(link => link.Id)
            .SingleAsync();
        db.Add(CoverRequest(
            id: 711,
            tenantId: 42,
            caregiverLinkId: caregiverLinkId,
            caregiverId: 1001,
            caredForId: 2001,
            title: "Needs tier five",
            startsAt: new DateTime(2026, 7, 20, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 20, 12, 0, 0, DateTimeKind.Utc),
            minimumTrustTier: 5));
        db.Add(CoverRequest(
            id: 712,
            tenantId: 42,
            caregiverLinkId: otherCaregiverLinkId,
            caregiverId: 1002,
            caredForId: 2001,
            title: "Other caregiver",
            startsAt: new DateTime(2026, 7, 21, 9, 0, 0, DateTimeKind.Utc),
            endsAt: new DateTime(2026, 7, 21, 12, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        AssertSingleError(
            await Invoke(
                controller,
                "AssignCoverCandidate",
                711,
                new Dictionary<string, object?>(),
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "AssignCoverCandidate",
                711,
                new Dictionary<string, object?> { ["supporter_id"] = 3001 },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(
                controller,
                "AssignCoverCandidate",
                712,
                new Dictionary<string, object?> { ["supporter_id"] = 3002 },
                CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");

        (await db.CaringCoverRequests.IgnoreQueryFilters().SingleAsync(row => row.Id == 711))
            .MatchedSupporterId.Should().BeNull();
        (await db.CaringCoverRequests.IgnoreQueryFilters().SingleAsync(row => row.Id == 712))
            .MatchedSupporterId.Should().BeNull();
    }

    [Fact]
    public async Task AddLink_ValidatesAndCreatesPendingTenantScopedLink()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(2001, 42, "Pat", "Recipient"),
            User(3001, 7, "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var missingRecipient = await controller.AddLink(new CaregiverLinkRequest
        {
            RelationshipType = "family",
            StartDate = "2026-07-03"
        }, CancellationToken.None);

        var missing = missingRecipient.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var missingDocument = JsonDocument.Parse(JsonSerializer.Serialize(missing.Value)))
        {
            var error = missingDocument.RootElement.GetProperty("errors")[0];
            error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
            error.GetProperty("field").GetString().Should().Be("cared_for_id");
        }

        var invalidRelationship = await controller.AddLink(new CaregiverLinkRequest
        {
            CaredForId = 2001,
            RelationshipType = "colleague",
            StartDate = "2026-07-03"
        }, CancellationToken.None);

        var invalid = invalidRelationship.Should().BeOfType<UnprocessableEntityObjectResult>().Subject;
        using (var invalidDocument = JsonDocument.Parse(JsonSerializer.Serialize(invalid.Value)))
        {
            invalidDocument.RootElement.GetProperty("errors")[0].GetProperty("field").GetString()
                .Should().Be("relationship_type");
        }

        var created = await controller.AddLink(new CaregiverLinkRequest
        {
            CaredForId = 2001,
            RelationshipType = "family",
            StartDate = "2026-07-03",
            Notes = "Daughter coordinates errands",
            IsPrimary = true
        }, CancellationToken.None);

        var createdObject = created.Should().BeOfType<ObjectResult>().Subject;
        createdObject.StatusCode.Should().Be(StatusCodes.Status202Accepted);
        using var createdDocument = JsonDocument.Parse(JsonSerializer.Serialize(createdObject.Value));
        var row = createdDocument.RootElement.GetProperty("data");
        row.GetProperty("tenant_id").GetInt32().Should().Be(42);
        row.GetProperty("caregiver_id").GetInt32().Should().Be(1001);
        row.GetProperty("cared_for_id").GetInt32().Should().Be(2001);
        row.GetProperty("relationship_type").GetString().Should().Be("family");
        row.GetProperty("status").GetString().Should().Be("pending");
        row.GetProperty("is_primary").GetBoolean().Should().BeTrue();

        var stored = await db.CaringCaregiverLinks.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.CaregiverId.Should().Be(1001);
        stored.CaredForId.Should().Be(2001);
        stored.Status.Should().Be("pending");
    }

    [Fact]
    public async Task RemoveLink_DeactivatesOnlyOwnedCurrentTenantLinkAndReturnsNoContent()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, true);
        db.Users.AddRange(
            User(1001, 42, "Cara", "Giver"),
            User(1002, 42, "Other", "Caregiver"),
            User(2001, 42, "Pat", "Recipient"));
        db.CaringCaregiverLinks.AddRange(
            Link(42, 1001, 2001, "family", status: "active"),
            Link(42, 1002, 2001, "friend", status: "active"));
        await db.SaveChangesAsync();
        var ownedId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1001)
            .Select(link => link.Id)
            .SingleAsync();
        var otherId = await db.CaringCaregiverLinks.IgnoreQueryFilters()
            .Where(link => link.TenantId == 42 && link.CaregiverId == 1002)
            .Select(link => link.Id)
            .SingleAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var removed = await controller.RemoveLink(ownedId, CancellationToken.None);
        var missing = await controller.RemoveLink(otherId, CancellationToken.None);

        removed.Should().BeOfType<NoContentResult>();
        missing.Should().BeOfType<NotFoundObjectResult>();

        var owned = await db.CaringCaregiverLinks.IgnoreQueryFilters().SingleAsync(link => link.Id == ownedId);
        var other = await db.CaringCaregiverLinks.IgnoreQueryFilters().SingleAsync(link => link.Id == otherId);
        owned.Status.Should().Be("inactive");
        other.Status.Should().Be("active");
    }

    [Fact]
    public async Task MyLinks_WhenFeatureDisabled_ReturnsLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 1001);

        var result = await controller.MyLinks(CancellationToken.None);

        var forbidden = result.Should().BeOfType<ObjectResult>().Subject;
        forbidden.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(forbidden.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("FEATURE_DISABLED");
    }

    private static CaringCaregiverLink Link(
        int tenantId,
        int caregiverId,
        int caredForId,
        string relationshipType,
        bool isPrimary = false,
        string status = "active",
        DateOnly? startDate = null)
    {
        return new CaringCaregiverLink
        {
            TenantId = tenantId,
            CaregiverId = caregiverId,
            CaredForId = caredForId,
            RelationshipType = relationshipType,
            IsPrimary = isPrimary,
            StartDate = startDate ?? new DateOnly(2026, 7, 3),
            Notes = "Seed note",
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    private static CaringSupportRelationship SupportRelationship(
        int tenantId,
        int supporterId,
        int recipientId,
        string title,
        string status = "active",
        DateTime? nextCheckInAt = null)
    {
        return new CaringSupportRelationship
        {
            TenantId = tenantId,
            SupporterId = supporterId,
            RecipientId = recipientId,
            Title = title,
            Frequency = "weekly",
            ExpectedHours = 2m,
            StartDate = new DateOnly(2026, 7, 1),
            Status = status,
            NextCheckInAt = nextCheckInAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    private static VolunteerLog VolunteerLog(
        int tenantId,
        int userId,
        decimal hours,
        string status,
        DateOnly dateLogged,
        int? supportRecipientId = null)
    {
        return new VolunteerLog
        {
            TenantId = tenantId,
            UserId = userId,
            DateLogged = dateLogged,
            Hours = hours,
            Status = status,
            SupportRecipientId = supportRecipientId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
    }

    private static object CoverRequest(
        long id,
        int tenantId,
        int caregiverLinkId,
        int caregiverId,
        int caredForId,
        string title,
        DateTime startsAt,
        DateTime endsAt,
        string status = "open",
        string? requiredSkillsJson = null,
        int? matchedSupporterId = null,
        DateTime? matchedAt = null,
        int? supportRelationshipId = null,
        decimal? expectedHours = 2m,
        int minimumTrustTier = 1,
        string urgency = "planned",
        string? briefing = "Cover briefing")
    {
        var type = Type.GetType("Nexus.Api.Entities.CaringCoverRequest, Nexus.Api", throwOnError: false);
        type.Should().NotBeNull("Laravel caring cover request parity entity should exist");
        var entity = Activator.CreateInstance(type!)!;
        Set(entity, "Id", id);
        Set(entity, "TenantId", tenantId);
        Set(entity, "CaregiverLinkId", caregiverLinkId);
        Set(entity, "CaregiverId", caregiverId);
        Set(entity, "CaredForId", caredForId);
        Set(entity, "SupportRelationshipId", supportRelationshipId);
        Set(entity, "MatchedSupporterId", matchedSupporterId);
        Set(entity, "Title", title);
        Set(entity, "Briefing", briefing);
        Set(entity, "RequiredSkillsJson", requiredSkillsJson);
        Set(entity, "StartsAt", startsAt);
        Set(entity, "EndsAt", endsAt);
        Set(entity, "ExpectedHours", expectedHours);
        Set(entity, "MinimumTrustTier", minimumTrustTier);
        Set(entity, "Urgency", urgency);
        Set(entity, "Status", status);
        Set(entity, "MatchedAt", matchedAt);
        Set(entity, "CreatedAt", DateTime.UtcNow);
        Set(entity, "UpdatedAt", DateTime.UtcNow);
        return entity;
    }

    private static void Set(object entity, string propertyName, object? value)
    {
        var property = entity.GetType().GetProperty(propertyName);
        property.Should().NotBeNull($"CaringCoverRequest.{propertyName} should exist");
        property!.SetValue(entity, value);
    }

    private static void AssertSingleError(IActionResult result, int statusCode, string code)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(statusCode);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        document.RootElement.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be(code);
    }

    private static User User(
        int id,
        int tenantId,
        string firstName,
        string lastName,
        string? avatarUrl = null,
        int trustTier = 0,
        bool isActive = true)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = "member",
            AvatarUrl = avatarUrl,
            IsActive = isActive,
            TrustTier = trustTier,
            CreatedAt = DateTime.UtcNow
        };
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

    private static CaringCommunityCaregiverController CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId)
    {
        var service = new CaregiverSupportService(db, tenant);
        return new CaringCommunityCaregiverController(service, tenant)
        {
            ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow())
        };
    }

    private static async Task<IActionResult> Invoke(
        CaringCommunityCaregiverController controller,
        string method,
        params object?[] args)
    {
        var action = typeof(CaringCommunityCaregiverController).GetMethod(method);
        action.Should().NotBeNull($"Laravel AG68 caregiver action {method} should exist");
        var result = action!.Invoke(controller, args);
        if (result is Task<IActionResult> task)
        {
            return await task;
        }

        return result.Should().BeAssignableTo<IActionResult>().Subject;
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
                    new Claim(ClaimTypes.Role, "member"),
                    new Claim("role", "member")
                ], "Test"))
            }
        };
    }
}
