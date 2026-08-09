// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class CaringCommunityMemberReadControllerUnitTests
{
    private const string ControllerTypeName = "Nexus.Api.Controllers.CaringCommunityMemberController, Nexus.Api";
    private const string ResearchConsentTypeName = "Nexus.Api.Entities.CaringResearchConsent, Nexus.Api";

    [Fact]
    public void Actions_ExposeLaravelMemberReadRoutes()
    {
        var controller = Resolve(ControllerTypeName);

        controller.GetCustomAttribute<RouteAttribute>()?.Template
            .Should().Be("api/caring-community");

        controller.GetMethod("MyRelationships")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("my-relationships");

        controller.GetMethod("SetOnboardingChoice")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("me/onboarding-choice");

        controller.GetMethod("SafeguardingMyReports")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("safeguarding/my-reports");

        controller.GetMethod("SafeguardingReport")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("safeguarding/report");

        controller.GetMethod("MyDataExport")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("me/data-export");

        controller.GetMethod("MyAhvPensionExport")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("my-ahv-pension-export");

        controller.GetMethod("MyFutureCareFund")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("my-future-care-fund");

        controller.GetMethod("ResearchConsent")
            ?.GetCustomAttribute<HttpGetAttribute>()?.Template
            .Should().Be("research/consent");

        controller.GetMethod("UpdateResearchConsent")
            ?.GetCustomAttribute<HttpPutAttribute>()?.Template
            .Should().Be("research/consent");

        controller.GetMethod("PauseRelationship")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("my-relationships/{id:int}/pause");

        controller.GetMethod("EndRelationship")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("my-relationships/{id:int}/end");

        controller.GetMethod("ResumeRelationship")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("my-relationships/{id:int}/resume");

        controller.GetMethod("RequestHelp")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("request-help");

        controller.GetMethod("RequestHelpVoice")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("request-help/voice");

        controller.GetMethod("PreviewVereinMemberImport")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("vereine/{organizationId}/members/import/preview");

        controller.GetMethod("ImportVereinMembers")
            ?.GetCustomAttribute<HttpPostAttribute>()?.Template
            .Should().Be("vereine/{organizationId}/members/import");
    }

    [Fact]
    public async Task SetOnboardingChoice_PersistsChoiceInLaravelCompatibleUserPreferenceBag()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var user = User(10, 42, "Ada", "Member");
        SetNotificationPreferences(user, """
            {"email":true,"caring_community":{"existing":"keep"}}
            """);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(
            controller,
            "SetOnboardingChoice",
            new Dictionary<string, object?> { ["choice"] = "helper" },
            CancellationToken.None));

        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("choice").GetString().Should().Be("helper");

        var stored = await db.Users.IgnoreQueryFilters().SingleAsync(row => row.Id == 10);
        using var document = JsonDocument.Parse(GetNotificationPreferences(stored).Should().NotBeNull().And.Subject!);
        var root = document.RootElement;
        root.GetProperty("email").GetBoolean().Should().BeTrue();
        var caring = root.GetProperty("caring_community");
        caring.GetProperty("existing").GetString().Should().Be("keep");
        caring.GetProperty("onboarding_choice").GetString().Should().Be("helper");
        stored.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task SetOnboardingChoice_RejectsInvalidChoiceWithLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.Add(User(10, 42, "Ada", "Member"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(
                controller,
                "SetOnboardingChoice",
                new Dictionary<string, object?> { ["choice"] = "coordinator" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR",
            "choice");
    }

    [Fact]
    public async Task SetOnboardingChoice_ReplacesNonObjectPreferenceJsonWithCaringCommunityBag()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var user = User(10, 42, "Ada", "Member");
        SetNotificationPreferences(user, "[]");
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(
            controller,
            "SetOnboardingChoice",
            new Dictionary<string, object?> { ["choice"] = "browse" },
            CancellationToken.None));

        data.GetProperty("choice").GetString().Should().Be("browse");
        var stored = await db.Users.IgnoreQueryFilters().SingleAsync(row => row.Id == 10);
        using var document = JsonDocument.Parse(GetNotificationPreferences(stored).Should().NotBeNull().And.Subject!);
        document.RootElement.GetProperty("caring_community")
            .GetProperty("onboarding_choice")
            .GetString()
            .Should().Be("browse");
    }

    [Fact]
    public async Task MyDataExport_StreamsTenantScopedPortableJsonWithoutCredentialFields()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var exporter = User(10, 42, "Ada", "Exporter", "/avatars/ada.png");
        exporter.Bio = "Can help with forms";
        exporter.TrustTier = 3;
        exporter.UpdatedAt = new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc);
        db.Users.AddRange(
            exporter,
            User(11, 42, "Grace", "Neighbour"),
            User(70, 7, "Other", "Tenant"),
            User(71, 7, "Remote", "Neighbour"));

        db.VolunteerLogs.AddRange(
            Log(801, 42, 10, 301, 11, new DateOnly(2026, 7, 2), 2.5m, "approved"),
            Log(802, 42, 11, 301, 10, new DateOnly(2026, 7, 3), 9m, "approved"),
            Log(803, 7, 70, 303, 71, new DateOnly(2026, 7, 4), 7m, "approved"));
        db.CaringSupportRelationships.AddRange(
            Relationship(301, 42, supporterId: 10, recipientId: 11, "Forms", "Benefits paperwork",
                "weekly", 2m, "active", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-3)),
            Relationship(302, 42, supporterId: 11, recipientId: 10, "Shopping", null,
                "monthly", 1m, "paused", new DateOnly(2026, 6, 1), null, DateTime.UtcNow.AddDays(-2)),
            Relationship(303, 7, supporterId: 70, recipientId: 71, "Other tenant", null,
                "weekly", 1m, "active", new DateOnly(2026, 6, 1), null, DateTime.UtcNow.AddDays(-1)));
        db.CaringHelpRequests.AddRange(
            new CaringHelpRequest
            {
                Id = 401,
                TenantId = 42,
                UserId = 10,
                What = "Need lift",
                WhenNeeded = "tomorrow",
                Status = "pending",
                CreatedAt = new DateTime(2026, 7, 2, 8, 0, 0, DateTimeKind.Utc)
            },
            new CaringHelpRequest
            {
                Id = 402,
                TenantId = 42,
                UserId = 11,
                What = "Other member",
                WhenNeeded = "today",
                Status = "pending"
            });
        db.CaringFavours.AddRange(
            new CaringFavour
            {
                Id = 501,
                TenantId = 42,
                OfferedByUserId = 10,
                ReceivedByUserId = 11,
                Category = "shopping",
                Description = "Picked up medicine",
                FavourDate = new DateOnly(2026, 7, 1)
            },
            new CaringFavour
            {
                Id = 502,
                TenantId = 42,
                OfferedByUserId = 11,
                ReceivedByUserId = 10,
                Category = "admin",
                Description = "Translated letter",
                FavourDate = new DateOnly(2026, 7, 2)
            });
        db.CaringHourGifts.AddRange(
            new CaringHourGift
            {
                Id = 601,
                TenantId = 42,
                SenderUserId = 10,
                RecipientUserId = 11,
                Hours = 1.5m,
                Status = "accepted",
                AcceptedAt = new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc)
            },
            new CaringHourGift
            {
                Id = 602,
                TenantId = 7,
                SenderUserId = 10,
                RecipientUserId = 70,
                Hours = 4m,
                Status = "pending"
            });
        db.CaringHourTransfers.AddRange(
            new CaringHourTransfer
            {
                Id = 701,
                TenantId = 42,
                MemberUserId = 10,
                CounterpartTenantSlug = "zurich-west",
                CounterpartMemberEmail = "remote@example.test",
                HoursTransferred = 3m,
                Status = "approved"
            },
            new CaringHourTransfer
            {
                Id = 702,
                TenantId = 42,
                MemberUserId = 11,
                CounterpartTenantSlug = "other",
                CounterpartMemberEmail = "other@example.test",
                HoursTransferred = 9m,
                Status = "approved"
            });
        db.CaringLoyaltyRedemptions.AddRange(
            new CaringLoyaltyRedemption
            {
                Id = 901,
                TenantId = 42,
                MemberUserId = 10,
                MerchantUserId = 11,
                CreditsUsed = 2m,
                ExchangeRateChf = 25m,
                DiscountChf = 50m,
                OrderTotalChf = 100m,
                Status = "applied"
            },
            new CaringLoyaltyRedemption
            {
                Id = 902,
                TenantId = 42,
                MemberUserId = 11,
                MerchantUserId = 10,
                CreditsUsed = 8m,
                ExchangeRateChf = 25m,
                DiscountChf = 200m,
                OrderTotalChf = 300m,
                Status = "applied"
            });
        db.CaringRegionalPointAccounts.Add(new CaringRegionalPointAccount
        {
            Id = 1001,
            TenantId = 42,
            UserId = 10,
            Balance = 120m,
            LifetimeEarned = 150m,
            LifetimeSpent = 30m
        });
        db.CaringRegionalPointTransactions.AddRange(
            new CaringRegionalPointTransaction
            {
                Id = 1102,
                TenantId = 42,
                AccountId = 1001,
                UserId = 10,
                Type = "admin_issue",
                Direction = "credit",
                Points = 25m,
                BalanceAfter = 120m,
                Description = "Pilot credit"
            },
            new CaringRegionalPointTransaction
            {
                Id = 1101,
                TenantId = 42,
                AccountId = 1001,
                UserId = 10,
                Type = "marketplace_redeem",
                Direction = "debit",
                Points = 10m,
                BalanceAfter = 95m
            },
            new CaringRegionalPointTransaction
            {
                Id = 1103,
                TenantId = 42,
                AccountId = 1001,
                UserId = 11,
                Type = "admin_issue",
                Direction = "credit",
                Points = 999m,
                BalanceAfter = 999m
            });
        db.SafeguardingReports.AddRange(
            Report(1201, 42, reporterId: 10, "other", "medium", "My report", "submitted",
                dueAt: null,
                createdAt: new DateTime(2026, 7, 4, 8, 0, 0, DateTimeKind.Utc)),
            Report(1202, 42, reporterId: 11, "other", "medium", "Other report", "submitted",
                dueAt: null,
                createdAt: new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc)));
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = "caring.civic_digest.user_prefs.10",
            Value = "{\"enabled\":true,\"cadence\":\"daily\"}",
            CreatedAt = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc)
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var result = await Invoke(controller, "MyDataExport", CancellationToken.None);

        var file = result.Should().BeOfType<FileContentResult>().Subject;
        var controllerBase = controller.Should().BeAssignableTo<ControllerBase>().Subject;
        file.ContentType.Should().Be("application/json; charset=utf-8");
        file.FileDownloadName.Should().StartWith("my-data-10-");
        controllerBase.HttpContext.Response.Headers["X-Content-Type-Options"].ToString().Should().Be("nosniff");
        controllerBase.HttpContext.Response.Headers["Cache-Control"].ToString().Should()
            .Be("no-store, no-cache, must-revalidate, private");
        controllerBase.HttpContext.Response.Headers["Pragma"].ToString().Should().Be("no-cache");

        using var document = JsonDocument.Parse(Encoding.UTF8.GetString(file.FileContents));
        var root = document.RootElement;
        root.GetProperty("tenant_id").GetInt32().Should().Be(42);
        root.GetProperty("user_id").GetInt32().Should().Be(10);
        root.GetProperty("exported_at").GetString().Should().NotBeNullOrWhiteSpace();

        var data = root.GetProperty("data");
        var profile = data.GetProperty("profile");
        profile.GetProperty("id").GetInt32().Should().Be(10);
        profile.GetProperty("tenant_id").GetInt32().Should().Be(42);
        profile.GetProperty("email").GetString().Should().Be("user10@example.test");
        profile.GetProperty("first_name").GetString().Should().Be("Ada");
        profile.GetProperty("trust_tier").GetInt32().Should().Be(3);
        profile.TryGetProperty("password_hash", out _).Should().BeFalse();
        profile.TryGetProperty("role", out _).Should().BeFalse();
        profile.TryGetProperty("is_active", out _).Should().BeFalse();

        data.GetProperty("vol_logs").EnumerateArray().Select(row => row.GetProperty("id").GetInt32())
            .Should().Equal(801);
        data.GetProperty("caring_support_relationships").EnumerateArray().Select(row => row.GetProperty("id").GetInt32())
            .Should().Equal(302, 301);
        data.GetProperty("caring_help_requests").EnumerateArray().Select(row => row.GetProperty("id").GetInt32())
            .Should().Equal(401);
        data.GetProperty("caring_favours").EnumerateArray().Select(row => row.GetProperty("id").GetInt32())
            .Should().Equal(502, 501);
        data.GetProperty("caring_hour_gifts").EnumerateArray().Select(row => row.GetProperty("id").GetInt64())
            .Should().Equal(601);
        data.GetProperty("caring_hour_transfers").EnumerateArray().Select(row => row.GetProperty("id").GetInt64())
            .Should().Equal(701);
        data.GetProperty("caring_loyalty_redemptions").EnumerateArray().Select(row => row.GetProperty("id").GetInt32())
            .Should().Equal(901);
        data.GetProperty("caring_regional_point_transactions").EnumerateArray()
            .Select(row => row.GetProperty("id").GetInt64())
            .Should().Equal(1102, 1101);
        data.GetProperty("caring_regional_point_account").GetProperty("id").GetInt64().Should().Be(1001);
        data.GetProperty("safeguarding_reports").EnumerateArray().Select(row => row.GetProperty("id").GetInt64())
            .Should().Equal(1201);
        data.GetProperty("civic_digest_preferences").GetProperty("tenant_config").EnumerateArray()
            .Select(row => row.GetProperty("key").GetString())
            .Should().Equal("caring.civic_digest.user_prefs.10");
    }

    [Fact]
    public async Task MyAhvPensionExport_ReturnsApprovedTenantScopedEvidencePackForRequestedPeriod()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Tenants.Add(new Tenant { Id = 42, Slug = "kiss-basel", Name = "KISS Basel" });
        db.Users.AddRange(
            User(10, 42, "Ada", "Exporter"),
            User(11, 42, "Grace", "Neighbour"),
            User(70, 7, "Other", "Tenant"),
            User(71, 7, "Remote", "Neighbour"));
        db.CaringSupportRelationships.AddRange(
            Relationship(301, 42, supporterId: 10, recipientId: 11, "Pension evidence", null,
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null,
                new DateTime(2025, 12, 1, 9, 0, 0, DateTimeKind.Utc)),
            Relationship(306, 7, supporterId: 70, recipientId: 71, "Other tenant", null,
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null,
                new DateTime(2025, 12, 1, 9, 0, 0, DateTimeKind.Utc)));
        db.VolunteerLogs.AddRange(
            Log(901, 42, 10, 301, 11, new DateOnly(2025, 12, 31), 4m, "approved"),
            Log(902, 42, 10, 301, 11, new DateOnly(2026, 1, 15), 1.257m, "approved"),
            Log(903, 42, 10, 301, 11, new DateOnly(2026, 2, 5), 2.5m, "pending"),
            Log(904, 42, 10, 301, 11, new DateOnly(2026, 3, 1), 3.2m, "approved"),
            Log(905, 42, 11, 301, 10, new DateOnly(2026, 3, 2), 8m, "approved"),
            Log(906, 7, 70, 306, 71, new DateOnly(2026, 3, 3), 9m, "approved"),
            Log(907, 42, 10, 301, 11, new DateOnly(2027, 1, 1), 6m, "approved"));
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(
            controller,
            "MyAhvPensionExport",
            "2026-01-01",
            "2026-12-31",
            CancellationToken.None));

        data.GetProperty("format_version").GetString().Should().Be("0.1-provisional");
        data.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();
        data.GetProperty("official_interface").GetProperty("status").GetString()
            .Should().Be("pending_official_ahv_specification");
        data.GetProperty("official_interface").GetProperty("official_submission_supported").GetBoolean()
            .Should().BeFalse();
        data.GetProperty("official_interface").GetProperty("export_type").GetString()
            .Should().Be("evidence_pack");
        data.GetProperty("tenant").GetProperty("id").GetInt32().Should().Be(42);
        data.GetProperty("tenant").GetProperty("slug").GetString().Should().Be("kiss-basel");
        data.GetProperty("tenant").GetProperty("name").GetString().Should().Be("KISS Basel");
        data.GetProperty("member").GetProperty("id").GetInt32().Should().Be(10);
        data.GetProperty("member").GetProperty("name").GetString().Should().Be("Ada Exporter");
        data.GetProperty("period").GetProperty("from").GetString().Should().Be("2026-01-01");
        data.GetProperty("period").GetProperty("to").GetString().Should().Be("2026-12-31");
        data.GetProperty("summary").GetProperty("approved_hours").GetDecimal().Should().Be(4.46m);
        data.GetProperty("summary").GetProperty("row_count").GetInt32().Should().Be(2);
        data.GetProperty("summary").GetProperty("years")[0].GetProperty("year").GetInt32().Should().Be(2026);
        data.GetProperty("summary").GetProperty("years")[0].GetProperty("approved_hours").GetDecimal().Should().Be(4.46m);
        data.GetProperty("summary").GetProperty("years")[0].GetProperty("row_count").GetInt32().Should().Be(2);

        var rows = data.GetProperty("contribution_rows").EnumerateArray().ToArray();
        rows.Select(row => row.GetProperty("record_id").GetInt32()).Should().Equal(902, 904);
        rows[0].GetProperty("source").GetString().Should().Be("vol_log");
        rows[0].GetProperty("date").GetString().Should().Be("2026-01-15");
        rows[0].GetProperty("year").GetInt32().Should().Be(2026);
        rows[0].GetProperty("hours").GetDecimal().Should().Be(1.26m);
        rows[0].GetProperty("status").GetString().Should().Be("approved");
        rows[0].GetProperty("organization_id").ValueKind.Should().Be(JsonValueKind.Null);
        rows[0].GetProperty("opportunity_id").ValueKind.Should().Be(JsonValueKind.Null);
        rows[0].GetProperty("caring_support_relationship_id").GetInt32().Should().Be(301);
        rows[0].GetProperty("support_recipient_id").GetInt32().Should().Be(11);
        rows[0].GetProperty("recorded_at").GetDateTime().Should().Be(new DateTime(2026, 1, 15, 12, 0, 0));
        rows[0].GetProperty("verified_at").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task MyFutureCareFund_ReturnsLaravelZeitvorsorgeSummaryForMember()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = 42,
            Key = "caring_community.workflow.default_hour_value_chf",
            Value = "40"
        });
        db.Users.AddRange(
            User(10, 42, "Ada", "Member"),
            User(11, 42, "Grace", "Helper"),
            User(12, 42, "Linus", "Neighbour"),
            User(70, 7, "Other", "Tenant"),
            User(71, 7, "Remote", "Neighbour"));

        var currentMonthStart = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var currentMonthLogDate = currentMonthStart.AddDays(1);
        var currentMonthReceiveDate = currentMonthStart.AddDays(2);
        var currentMonthTransactionDate = currentMonthStart.AddDays(3);

        db.CaringSupportRelationships.AddRange(
            Relationship(100, 42, supporterId: 11, recipientId: 10, "Care received", "Recipient relationship",
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null, new DateTime(2025, 12, 1, 9, 0, 0)),
            Relationship(102, 42, supporterId: 10, recipientId: 11, "Care given", "Supporter relationship",
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null, new DateTime(2025, 12, 1, 9, 0, 0)),
            Relationship(101, 42, supporterId: 11, recipientId: 12, "Other recipient", null,
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null, new DateTime(2025, 12, 1, 9, 0, 0)),
            Relationship(107, 7, supporterId: 70, recipientId: 71, "Other tenant", null,
                "weekly", 2m, "active", new DateOnly(2025, 12, 1), null, new DateTime(2025, 12, 1, 9, 0, 0)));
        db.VolunteerOrganisations.AddRange(
            VolunteerOrg(501, 42, ownerUserId: 10),
            VolunteerOrg(502, 42, ownerUserId: 10),
            VolunteerOrg(503, 42, ownerUserId: 10));
        db.VolunteerLogs.AddRange(
            Log(1001, 42, 10, 102, 11, new DateOnly(2025, 12, 20), 1.25m, "approved", organizationId: 501),
            Log(1002, 42, 10, 102, 11, currentMonthLogDate, 2.50m, "approved", organizationId: 502),
            Log(1003, 42, 10, 102, 11, currentMonthLogDate.AddDays(1), 24m, "pending", organizationId: 503),
            Log(1004, 42, 11, 100, 10, new DateOnly(2025, 12, 22), 2.00m, "approved"),
            Log(1005, 42, 11, 100, 10, currentMonthReceiveDate, 3.75m, "approved"),
            Log(1006, 42, 11, 101, 12, currentMonthReceiveDate, 8.00m, "approved"),
            Log(1007, 7, 70, 107, 71, currentMonthReceiveDate, 7.00m, "approved"));
        db.Transactions.AddRange(
            Transaction(2001, 42, senderId: 10, receiverId: 11, 4.00m, TransactionStatus.Completed,
                currentMonthTransactionDate.ToDateTime(new TimeOnly(9, 0))),
            Transaction(2002, 42, senderId: 10, receiverId: 11, 9.00m, TransactionStatus.Pending,
                currentMonthTransactionDate.ToDateTime(new TimeOnly(10, 0))),
            Transaction(2003, 7, senderId: 10, receiverId: 70, 12.00m, TransactionStatus.Completed,
                currentMonthTransactionDate.ToDateTime(new TimeOnly(11, 0))));
        await db.SaveChangesAsync();

        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(controller, "MyFutureCareFund", CancellationToken.None));

        data.GetProperty("total_banked_hours").GetDecimal().Should().Be(3.75m);
        data.GetProperty("hours_received").GetDecimal().Should().Be(9.75m);
        data.GetProperty("net_balance").GetDecimal().Should().Be(-6.00m);
        data.GetProperty("chf_value_estimate").GetDecimal().Should().Be(-240.00m);
        data.GetProperty("hour_value_chf").GetInt32().Should().Be(40);
        data.GetProperty("lifetime_given").GetDecimal().Should().Be(3.75m);
        data.GetProperty("lifetime_received").GetDecimal().Should().Be(9.75m);
        data.GetProperty("reciprocity_ratio").GetDecimal().Should().Be(2.0m);
        data.GetProperty("first_contribution_date").GetString().Should().Be("2025-12-20");
        data.GetProperty("active_months").GetInt32().Should().Be(ExpectedActiveMonths(new DateOnly(2025, 12, 20)));
        data.GetProperty("partner_organisations_helped").GetInt32().Should().Be(2);
        data.GetProperty("this_month_hours_given").GetDecimal().Should().Be(2.50m);
        data.GetProperty("this_month_hours_received").GetDecimal().Should().Be(7.75m);

        var byYear = data.GetProperty("by_year").EnumerateArray().ToArray();
        byYear.Select(row => row.GetProperty("year").GetInt32())
            .Should().Equal(DateTime.UtcNow.Year, 2025);
        byYear[0].GetProperty("hours_given").GetDecimal().Should().Be(2.50m);
        byYear[0].GetProperty("hours_received").GetDecimal().Should().Be(7.75m);
        byYear[1].GetProperty("hours_given").GetDecimal().Should().Be(1.25m);
        byYear[1].GetProperty("hours_received").GetDecimal().Should().Be(2.00m);
    }

    [Fact]
    public async Task ResearchConsent_ReturnsDefaultOptedOutLaravelShapeWhenNoRecordExists()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(controller, "ResearchConsent", CancellationToken.None));

        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("user_id").GetInt32().Should().Be(10);
        data.GetProperty("consent_status").GetString().Should().Be("opted_out");
        data.GetProperty("consent_version").GetString().Should().Be("research-v1");
        data.GetProperty("consented_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("revoked_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task ResearchConsent_ReturnsTenantScopedStoredConsent()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Add(Entity(ResearchConsentTypeName,
            ("Id", 1001L), ("TenantId", 42), ("UserId", 10), ("ConsentStatus", "opted_in"),
            ("ConsentVersion", "research-v1"),
            ("ConsentedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            ("RevokedAt", null), ("Notes", "Share aggregate outcomes only"),
            ("CreatedAt", new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc)),
            ("UpdatedAt", new DateTime(2026, 7, 1, 10, 0, 0, DateTimeKind.Utc))));
        db.Add(Entity(ResearchConsentTypeName,
            ("Id", 9001L), ("TenantId", 7), ("UserId", 10), ("ConsentStatus", "revoked"),
            ("ConsentVersion", "research-v1"), ("ConsentedAt", null),
            ("RevokedAt", new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc)),
            ("Notes", "Other tenant"), ("CreatedAt", DateTime.UtcNow), ("UpdatedAt", null)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(controller, "ResearchConsent", CancellationToken.None));

        data.GetProperty("tenant_id").GetInt32().Should().Be(42);
        data.GetProperty("user_id").GetInt32().Should().Be(10);
        data.GetProperty("consent_status").GetString().Should().Be("opted_in");
        data.GetProperty("consent_version").GetString().Should().Be("research-v1");
        data.GetProperty("consented_at").GetDateTime().Should().Be(new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc));
        data.GetProperty("revoked_at").ValueKind.Should().Be(JsonValueKind.Null);
        data.GetProperty("notes").GetString().Should().Be("Share aggregate outcomes only");
    }

    [Fact]
    public async Task UpdateResearchConsent_UpsertsLaravelConsentStatusAndNotes()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var optedIn = ReadData(await Invoke(
            controller,
            "UpdateResearchConsent",
            new Dictionary<string, object?>
            {
                ["consent_status"] = "opted_in",
                ["notes"] = "Aggregate research is OK"
            },
            CancellationToken.None));

        optedIn.GetProperty("consent_status").GetString().Should().Be("opted_in");
        optedIn.GetProperty("consent_version").GetString().Should().Be("research-v1");
        optedIn.GetProperty("consented_at").ValueKind.Should().NotBe(JsonValueKind.Null);
        optedIn.GetProperty("revoked_at").ValueKind.Should().Be(JsonValueKind.Null);
        optedIn.GetProperty("notes").GetString().Should().Be("Aggregate research is OK");

        var revoked = ReadData(await Invoke(
            controller,
            "UpdateResearchConsent",
            new Dictionary<string, object?>
            {
                ["consent_status"] = "revoked",
                ["notes"] = null
            },
            CancellationToken.None));

        revoked.GetProperty("consent_status").GetString().Should().Be("revoked");
        revoked.GetProperty("consented_at").ValueKind.Should().Be(JsonValueKind.Null);
        revoked.GetProperty("revoked_at").ValueKind.Should().NotBe(JsonValueKind.Null);
        revoked.GetProperty("notes").ValueKind.Should().Be(JsonValueKind.Null);

        var rows = db.CaringResearchConsents.IgnoreQueryFilters().ToArray();
        rows.Should().ContainSingle();
        rows[0].TenantId.Should().Be(42);
        rows[0].UserId.Should().Be(10);
        rows[0].ConsentStatus.Should().Be("revoked");
    }

    [Fact]
    public async Task UpdateResearchConsent_WithInvalidStatus_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(
                controller,
                "UpdateResearchConsent",
                new Dictionary<string, object?> { ["consent_status"] = "maybe" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
    }

    [Fact]
    public async Task RequestHelp_CreatesPendingHelpRequestAndReturnsLaravelCreatedEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Member"),
            User(70, 7, "Other", "Tenant"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadDataObject(await Invoke(
            controller,
            "RequestHelp",
            Json("""
            {
              "what": "  Need help collecting medicine  ",
              "when": "  Friday morning  ",
              "contact_preference": "fax"
            }
            """),
            CancellationToken.None), StatusCodes.Status201Created);

        data.GetProperty("success").GetBoolean().Should().BeTrue();
        data.GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();

        var stored = await db.CaringHelpRequests.IgnoreQueryFilters().SingleAsync();
        stored.TenantId.Should().Be(42);
        stored.UserId.Should().Be(10);
        stored.What.Should().Be("Need help collecting medicine");
        stored.WhenNeeded.Should().Be("Friday morning");
        stored.ContactPreference.Should().Be("either");
        stored.Status.Should().Be("pending");
        stored.IsOnBehalf.Should().BeFalse();
        stored.RequestedById.Should().BeNull();
        stored.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(1));
        stored.UpdatedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task RequestHelp_WithMissingFields_ReturnsLaravelValidationErrors()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var result = await Invoke(
            controller,
            "RequestHelp",
            Json("""{ "contact_preference": "phone" }"""),
            CancellationToken.None);

        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.Should().Be(StatusCodes.Status422UnprocessableEntity);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        var errors = document.RootElement.GetProperty("errors").EnumerateArray().ToArray();
        errors.Should().HaveCount(2);
        errors.Select(error => error.GetProperty("field").GetString())
            .Should().BeEquivalentTo("what", "when");
        errors.Should().OnlyContain(error => error.GetProperty("code").GetString() == "VALIDATION_ERROR");
        db.CaringHelpRequests.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task RequestHelpVoice_WithMissingAudio_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(controller, "RequestHelpVoice", null, "de-CH!!", CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
    }

    [Fact]
    public async Task RequestHelpVoice_WithAudio_ReturnsLaravelSuggestionsEnvelope()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        await db.SaveChangesAsync();
        var voice = new StubVoiceProcessor(MemberHelpRequestVoiceResult.Success(
            "I need help shopping tomorrow morning.",
            "en",
            "shopping",
            "2026-07-06T08:00:00.0000000+00:00",
            "phone",
            "I need help shopping tomorrow morning."));
        var controller = CreateController(db, tenant, userId: 10, voice);

        var data = ReadData(await Invoke(
            controller,
            "RequestHelpVoice",
            FormFile("voice.webm", "audio/webm", [1, 2, 3, 4]),
            "de_CH!!",
            CancellationToken.None));

        data.GetProperty("transcript").GetString().Should().Be("I need help shopping tomorrow morning.");
        data.GetProperty("detected_language").GetString().Should().Be("en");
        data.GetProperty("suggested_category").GetString().Should().Be("shopping");
        data.GetProperty("suggested_when").GetString().Should().Be("2026-07-06T08:00:00.0000000+00:00");
        data.GetProperty("suggested_contact_preference").GetString().Should().Be("phone");
        data.GetProperty("raw_text").GetString().Should().Be("I need help shopping tomorrow morning.");
        voice.LastTenantId.Should().Be(42);
        voice.LastUserId.Should().Be(10);
        voice.LastFileName.Should().Be("voice.webm");
        voice.LastContentType.Should().Be("audio/webm");
        voice.LastLocale.Should().Be("deCH");
    }

    [Fact]
    public async Task SafeguardingReport_CreatesSubmittedReportWithAuditTrail()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Reporter"),
            User(11, 42, "Grace", "Subject"),
            User(12, 42, "Org", "Owner"),
            User(70, 7, "Other", "Tenant"));
        db.Organisations.Add(new Organisation
        {
            Id = 201,
            TenantId = 42,
            Name = "Community Care",
            Slug = "community-care",
            OwnerId = 12,
            Status = "verified"
        });
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadDataObject(await Invoke(
            controller,
            "SafeguardingReport",
            Json("""
            {
              "category": "neglect",
              "severity": "high",
              "description": "  A concerning pattern was observed.  ",
              "subject_user_id": 11,
              "subject_organisation_id": 201,
              "evidence_url": "  https://example.test/evidence  "
            }
            """),
            CancellationToken.None), StatusCodes.Status201Created);

        data.GetProperty("success").GetBoolean().Should().BeTrue();
        var reportId = data.GetProperty("report_id").GetInt64();
        var stored = await db.SafeguardingReports.IgnoreQueryFilters().SingleAsync();
        stored.Id.Should().Be(reportId);
        stored.TenantId.Should().Be(42);
        stored.ReporterUserId.Should().Be(10);
        stored.SubjectUserId.Should().Be(11);
        stored.SubjectOrganisationId.Should().Be(201);
        stored.Category.Should().Be("neglect");
        stored.Severity.Should().Be("high");
        stored.Description.Should().Be("A concerning pattern was observed.");
        stored.EvidenceUrl.Should().Be("https://example.test/evidence");
        stored.Status.Should().Be("submitted");
        stored.ReviewDueAt.Should().NotBeNull();
        (stored.ReviewDueAt!.Value - stored.CreatedAt).Should().BeCloseTo(TimeSpan.FromHours(24), TimeSpan.FromMinutes(1));

        var action = await db.SafeguardingReportActions.IgnoreQueryFilters().SingleAsync();
        action.TenantId.Should().Be(42);
        action.ReportId.Should().Be(reportId);
        action.ActorUserId.Should().Be(10);
        action.Action.Should().Be("created");
        action.Notes.Should().BeNull();
    }

    [Fact]
    public async Task SafeguardingReport_WithInvalidCategory_ReturnsLaravelValidationError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.Add(User(10, 42, "Ada", "Reporter"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(
                controller,
                "SafeguardingReport",
                Json("""{ "category": "bad", "severity": "medium", "description": "Concern" }"""),
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");
        db.SafeguardingReports.IgnoreQueryFilters().Should().BeEmpty();
    }

    [Fact]
    public async Task ResearchConsent_WhenCaringCommunityDisabled_ReturnsLaravelFeatureDisabledError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(await Invoke(controller, "ResearchConsent", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(controller, "RequestHelp", Json("{}"), CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(controller, "RequestHelpVoice", null, null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(controller, "SafeguardingReport", Json("{}"), CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(
                controller,
                "UpdateResearchConsent",
                new Dictionary<string, object?> { ["consent_status"] = "opted_in" },
                CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task PreviewVereinMemberImport_AllowsMemberRouteAndReturnsLaravelSummary()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var existing = User(11, 42, "Eve", "Existing");
        existing.Email = "existing@example.test";
        db.Users.AddRange(
            User(10, 42, "Ada", "Member"),
            existing);
        db.Organisations.Add(Organisation(101, 42, 10, "Quartier Verein", "club"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadDataObject(await Invoke(
            controller,
            "PreviewVereinMemberImport",
            101,
            Json("""
            {
              "csv": "email,first_name,last_name,role\nnew@example.test,Nina,New,member\nexisting@example.test,Eve,Existing,admin"
            }
            """),
            CancellationToken.None));

        data.GetProperty("organization").GetProperty("id").GetInt32().Should().Be(101);
        data.GetProperty("summary").GetProperty("total_rows").GetInt32().Should().Be(2);
        data.GetProperty("summary").GetProperty("ready_to_create").GetInt32().Should().Be(1);
        data.GetProperty("summary").GetProperty("ready_to_link").GetInt32().Should().Be(1);
        var items = data.GetProperty("items").EnumerateArray().ToList();
        items.Select(item => item.GetProperty("action").GetString()).Should().Equal("create", "link_existing");
    }

    [Fact]
    public async Task ImportVereinMembers_AllowsMemberRouteAndCreatesMemberships()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var existing = User(11, 42, "Eve", "Existing");
        existing.Email = "existing@example.test";
        db.Users.AddRange(
            User(10, 42, "Ada", "Member"),
            existing);
        db.Organisations.Add(Organisation(101, 42, 10, "Quartier Verein", "club"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadDataObject(
            await Invoke(
                controller,
                "ImportVereinMembers",
                101,
                Json("""
                {
                  "csv": "email,first_name,last_name,role\nnew@example.test,Nina,New,member\nexisting@example.test,Eve,Existing,admin"
                }
                """),
                CancellationToken.None),
            StatusCodes.Status201Created);

        data.GetProperty("created").GetInt32().Should().Be(1);
        data.GetProperty("linked").GetInt32().Should().Be(1);
        data.GetProperty("skipped").GetInt32().Should().Be(0);
        data.GetProperty("imported_by").GetInt32().Should().Be(10);

        var createdUser = await db.Users.IgnoreQueryFilters().SingleAsync(user => user.Email == "new@example.test");
        var members = await db.OrganisationMembers.IgnoreQueryFilters()
            .Where(row => row.OrganisationId == 101)
            .OrderBy(row => row.UserId)
            .ToListAsync();
        members.Should().HaveCount(2);
        members.Single(row => row.UserId == existing.Id).Role.Should().Be("admin");
        members.Single(row => row.UserId == createdUser.Id).Role.Should().Be("member");
    }

    [Fact]
    public async Task MyRelationships_ReturnsLaravelMemberRowsWithRecentLogs()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Supporter", "/avatars/ada.png"),
            User(11, 42, "Grace", "Recipient", "/avatars/grace.png"),
            User(12, 42, "Linus", "Helper", "/avatars/linus.png"),
            User(70, 7, "Other", "Supporter", "/avatars/other.png"),
            User(71, 7, "Other", "Recipient", "/avatars/recipient.png"));

        var now = DateTime.UtcNow;
        db.CaringSupportRelationships.AddRange(
            Relationship(201, 42, supporterId: 10, recipientId: 11, "Weekly shop", "Shopping and tea",
                "weekly", 2.5m, "active", new DateOnly(2026, 7, 1), now.AddDays(1), now.AddDays(-10)),
            Relationship(202, 42, supporterId: 12, recipientId: 10, "Call check-in", null,
                "fortnightly", 1.25m, "paused", new DateOnly(2026, 6, 1), now.AddDays(3), now.AddDays(-9)),
            Relationship(203, 42, supporterId: 10, recipientId: 11, "Completed", null,
                "monthly", 1m, "completed", new DateOnly(2026, 5, 1), now.AddDays(4), now.AddDays(-8)),
            Relationship(901, 7, supporterId: 70, recipientId: 71, "Other tenant", null,
                "weekly", 99m, "active", new DateOnly(2026, 5, 1), now.AddDays(-2), now.AddDays(-7)));
        db.VolunteerLogs.AddRange(
            Log(701, 42, 10, 201, 11, new DateOnly(2026, 7, 3), 1.5m, "approved"),
            Log(702, 42, 10, 201, 11, new DateOnly(2026, 7, 4), 2.0m, "pending"),
            Log(703, 42, 10, 201, 11, new DateOnly(2026, 7, 5), 2.25m, "approved"),
            Log(704, 42, 10, 201, 11, new DateOnly(2026, 7, 6), 3.0m, "approved"),
            Log(799, 7, 70, 901, 71, new DateOnly(2026, 7, 7), 9.0m, "approved"));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(controller, "MyRelationships", CancellationToken.None));

        data.ValueKind.Should().Be(JsonValueKind.Array);
        data.GetArrayLength().Should().Be(2);

        data[0].GetProperty("id").GetInt32().Should().Be(201);
        data[0].GetProperty("role").GetString().Should().Be("supporter");
        data[0].GetProperty("partner").GetProperty("id").GetInt32().Should().Be(11);
        data[0].GetProperty("partner").GetProperty("name").GetString().Should().Be("Grace Recipient");
        data[0].GetProperty("partner").GetProperty("avatar_url").GetString().Should().Be("/avatars/grace.png");
        data[0].GetProperty("intergenerational").GetBoolean().Should().BeFalse();
        data[0].GetProperty("expected_hours").GetDecimal().Should().Be(2.5m);
        data[0].GetProperty("start_date").GetString().Should().Be("2026-07-01");

        var logs = data[0].GetProperty("recent_logs");
        logs.GetArrayLength().Should().Be(3);
        logs[0].GetProperty("date").GetString().Should().Be("2026-07-06");
        logs[0].GetProperty("hours").GetDecimal().Should().Be(3.0m);
        logs[0].GetProperty("status").GetString().Should().Be("approved");
        logs[2].GetProperty("date").GetString().Should().Be("2026-07-04");

        data[1].GetProperty("id").GetInt32().Should().Be(202);
        data[1].GetProperty("role").GetString().Should().Be("recipient");
        data[1].GetProperty("partner").GetProperty("id").GetInt32().Should().Be(12);
        data[1].GetProperty("partner").GetProperty("name").GetString().Should().Be("Linus Helper");
    }

    [Fact]
    public async Task SafeguardingMyReports_ReturnsReporterScopedPreviewRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        var longDescription = new string('x', 205);
        db.SafeguardingReports.AddRange(
            Report(301, 42, reporterId: 10, "neglect", "high", longDescription, "triaged",
                dueAt: new DateTime(2026, 7, 10, 9, 0, 0, DateTimeKind.Utc),
                createdAt: new DateTime(2026, 7, 4, 9, 0, 0, DateTimeKind.Utc),
                escalated: true),
            Report(302, 42, reporterId: 10, "other", "low", "Short report", "resolved",
                dueAt: null,
                createdAt: new DateTime(2026, 7, 3, 9, 0, 0, DateTimeKind.Utc),
                resolvedAt: new DateTime(2026, 7, 4, 10, 0, 0, DateTimeKind.Utc)),
            Report(303, 42, reporterId: 11, "other", "critical", "Other reporter", "submitted",
                dueAt: null,
                createdAt: new DateTime(2026, 7, 5, 9, 0, 0, DateTimeKind.Utc)),
            Report(901, 7, reporterId: 10, "other", "critical", "Other tenant", "submitted",
                dueAt: null,
                createdAt: new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        var data = ReadData(await Invoke(controller, "SafeguardingMyReports", CancellationToken.None));

        var items = data.GetProperty("items");
        items.GetArrayLength().Should().Be(2);
        items[0].GetProperty("id").GetInt64().Should().Be(301);
        items[0].GetProperty("category").GetString().Should().Be("neglect");
        items[0].GetProperty("severity").GetString().Should().Be("high");
        items[0].GetProperty("description_preview").GetString().Should().HaveLength(201);
        items[0].GetProperty("description_preview").GetString().Should().EndWith("\u2026");
        items[0].GetProperty("status").GetString().Should().Be("triaged");
        items[0].GetProperty("review_due_at").GetString().Should().Be("2026-07-10 09:00:00");
        items[0].GetProperty("escalated").GetBoolean().Should().BeTrue();
        items[0].GetProperty("resolved_at").ValueKind.Should().Be(JsonValueKind.Null);

        items[1].GetProperty("id").GetInt64().Should().Be(302);
        items[1].GetProperty("description_preview").GetString().Should().Be("Short report");
        items[1].GetProperty("resolved_at").GetString().Should().Be("2026-07-04 10:00:00");
    }

    [Fact]
    public async Task MemberReads_WhenFeatureDisabled_ReturnLaravelForbiddenError()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: false);
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(await Invoke(controller, "MyRelationships", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await Invoke(controller, "SafeguardingMyReports", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await Invoke(controller, "MyDataExport", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(
            await Invoke(controller, "MyAhvPensionExport", null, null, CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
        AssertSingleError(await Invoke(controller, "MyFutureCareFund", CancellationToken.None),
            StatusCodes.Status403Forbidden,
            "FEATURE_DISABLED");
    }

    [Fact]
    public async Task RelationshipLifecycle_PauseEndAndResumeOwnedTenantScopedRelationships()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Supporter"),
            User(11, 42, "Grace", "Recipient"),
            User(12, 42, "Linus", "Other"));
        db.CaringSupportRelationships.AddRange(
            Relationship(401, 42, supporterId: 10, recipientId: 11, "Active", null,
                "weekly", 1m, "active", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-3)),
            Relationship(402, 42, supporterId: 12, recipientId: 11, "Paused", null,
                "weekly", 1m, "paused", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-2)),
            Relationship(901, 7, supporterId: 10, recipientId: 70, "Other tenant", null,
                "weekly", 1m, "active", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var supporterController = CreateController(db, tenant, userId: 10);
        var recipientController = CreateController(db, tenant, userId: 11);

        var paused = ReadData(await Invoke(
            supporterController,
            "PauseRelationship",
            401,
            new Dictionary<string, object?> { ["reason"] = "Holiday", ["resume_at"] = "2026-08-01" },
            CancellationToken.None));

        paused.GetProperty("success").GetBoolean().Should().BeTrue();
        paused.GetProperty("status").GetString().Should().Be("paused");
        (await db.CaringSupportRelationships.IgnoreQueryFilters().SingleAsync(row => row.Id == 401))
            .Status.Should().Be("paused");

        var resumed = ReadData(await Invoke(recipientController, "ResumeRelationship", 401, null, CancellationToken.None));

        resumed.GetProperty("success").GetBoolean().Should().BeTrue();
        resumed.GetProperty("status").GetString().Should().Be("active");
        (await db.CaringSupportRelationships.IgnoreQueryFilters().SingleAsync(row => row.Id == 401))
            .Status.Should().Be("active");

        var ended = ReadData(await Invoke(
            recipientController,
            "EndRelationship",
            402,
            new Dictionary<string, object?> { ["reason"] = "Support completed" },
            CancellationToken.None));

        ended.GetProperty("success").GetBoolean().Should().BeTrue();
        ended.GetProperty("status").GetString().Should().Be("cancelled");
        var cancelled = await db.CaringSupportRelationships.IgnoreQueryFilters().SingleAsync(row => row.Id == 402);
        cancelled.Status.Should().Be("cancelled");
        cancelled.EndDate.Should().Be(DateOnly.FromDateTime(DateTime.UtcNow));
    }

    [Fact]
    public async Task RelationshipLifecycle_RejectsInvalidStateInvalidDateAndUnownedRows()
    {
        var tenant = CreateTenantContext(42);
        await using var db = CreateDbContext(tenant);
        SeedFeature(db, 42, enabled: true);
        db.Users.AddRange(
            User(10, 42, "Ada", "Supporter"),
            User(11, 42, "Grace", "Recipient"),
            User(12, 42, "Linus", "Other"));
        db.CaringSupportRelationships.AddRange(
            Relationship(501, 42, supporterId: 10, recipientId: 11, "Active", null,
                "weekly", 1m, "active", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-3)),
            Relationship(502, 42, supporterId: 10, recipientId: 11, "Completed", null,
                "weekly", 1m, "completed", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-2)),
            Relationship(503, 42, supporterId: 12, recipientId: 11, "Unowned", null,
                "weekly", 1m, "active", new DateOnly(2026, 7, 1), null, DateTime.UtcNow.AddDays(-1)));
        await db.SaveChangesAsync();
        var controller = CreateController(db, tenant, userId: 10);

        AssertSingleError(
            await Invoke(
                controller,
                "PauseRelationship",
                501,
                new Dictionary<string, object?> { ["resume_at"] = "not-a-date" },
                CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "VALIDATION_ERROR");

        AssertSingleError(
            await Invoke(controller, "PauseRelationship", 502, null, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_STATE");

        AssertSingleError(
            await Invoke(controller, "ResumeRelationship", 501, null, CancellationToken.None),
            StatusCodes.Status422UnprocessableEntity,
            "INVALID_STATE");

        AssertSingleError(
            await Invoke(controller, "EndRelationship", 503, null, CancellationToken.None),
            StatusCodes.Status404NotFound,
            "NOT_FOUND");
    }

    private static object CreateController(
        NexusDbContext db,
        TenantContext tenant,
        int userId,
        ICaringHelpRequestVoiceProcessor? voiceProcessor = null)
    {
        var relationships = new CaringSupportRelationshipService(db, voiceProcessor);
        var safeguarding = new CaringSafeguardingService(db);
        var dataExport = new CaringCommunityDataExportService(db);
        var ahvPensionExport = new CaringCommunityAhvPensionExportService(db);
        var futureCareFund = new CaringCommunityFutureCareFundService(db);
        var regionalPoints = new CaringRegionalPointService(db);
        var research = new CaringResearchPartnershipService(db);
        var vereine = new CaringCommunityVereineAdminService(db);
        var controller = (ControllerBase)Activator.CreateInstance(
            Resolve(ControllerTypeName),
            relationships,
            safeguarding,
            dataExport,
            ahvPensionExport,
            futureCareFund,
            regionalPoints,
            research,
            vereine,
            tenant,
            db)!;
        controller.ControllerContext = ControllerContextFor(userId, tenant.GetTenantIdOrThrow());
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
        var coerced = new object?[parameters.Length];
        for (var index = 0; index < parameters.Length; index++)
        {
            var value = args[index];
            var parameterType = parameters[index].ParameterType;
            if (value is Dictionary<string, object?> dictionary
                && parameterType != typeof(Dictionary<string, object?>))
            {
                var body = Activator.CreateInstance(parameterType)!;
                foreach (var (key, raw) in dictionary)
                {
                    var property = parameterType.GetProperties()
                        .FirstOrDefault(item =>
                            string.Equals(item.Name, key, StringComparison.OrdinalIgnoreCase)
                            || string.Equals(ToSnakeCase(item.Name), key, StringComparison.OrdinalIgnoreCase));
                    property?.SetValue(body, raw);
                }

                coerced[index] = body;
            }
            else
            {
                coerced[index] = value;
            }
        }

        return coerced;
    }

    private static string ToSnakeCase(string value)
    {
        return string.Concat(value.Select((character, index) =>
            index > 0 && char.IsUpper(character)
                ? "_" + char.ToLowerInvariant(character)
                : char.ToLowerInvariant(character).ToString()));
    }

    private static JsonElement ReadData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static JsonElement ReadDataObject(IActionResult result, int expectedStatus = StatusCodes.Status200OK)
    {
        var objectResult = result.Should().BeAssignableTo<ObjectResult>().Subject;
        objectResult.StatusCode.GetValueOrDefault(StatusCodes.Status200OK).Should().Be(expectedStatus);
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(objectResult.Value));
        return document.RootElement.GetProperty("data").Clone();
    }

    private static JsonElement Json(string raw)
    {
        using var document = JsonDocument.Parse(raw);
        return document.RootElement.Clone();
    }

    private static IFormFile FormFile(string fileName, string contentType, byte[] bytes)
    {
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "audio", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };
    }

    private static void AssertSingleError(
        IActionResult result,
        int statusCode,
        string code,
        string? field = null)
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

    private static string? GetNotificationPreferences(User user)
    {
        return Resolve(ControllerTypeName).Assembly
            .GetType("Nexus.Api.Entities.User", throwOnError: true)!
            .GetProperty("NotificationPreferences")
            .Should().NotBeNull("Laravel stores caring-community onboarding choice in users.notification_preferences")
            .And.Subject!
            .GetValue(user) as string;
    }

    private static void SetNotificationPreferences(User user, string value)
    {
        Resolve(ControllerTypeName).Assembly
            .GetType("Nexus.Api.Entities.User", throwOnError: true)!
            .GetProperty("NotificationPreferences")
            .Should().NotBeNull("Laravel stores caring-community onboarding choice in users.notification_preferences")
            .And.Subject!
            .SetValue(user, value);
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

    private static CaringSupportRelationship Relationship(
        int id,
        int tenantId,
        int supporterId,
        int recipientId,
        string title,
        string? description,
        string frequency,
        decimal expectedHours,
        string status,
        DateOnly startDate,
        DateTime? nextCheckInAt,
        DateTime createdAt)
    {
        return new CaringSupportRelationship
        {
            Id = id,
            TenantId = tenantId,
            SupporterId = supporterId,
            RecipientId = recipientId,
            Title = title,
            Description = description,
            Frequency = frequency,
            ExpectedHours = expectedHours,
            Status = status,
            StartDate = startDate,
            NextCheckInAt = nextCheckInAt,
            CreatedAt = createdAt,
            UpdatedAt = createdAt.AddHours(1)
        };
    }

    private static VolunteerLog Log(
        int id,
        int tenantId,
        int userId,
        int relationshipId,
        int recipientId,
        DateOnly date,
        decimal hours,
        string status,
        int? organizationId = null)
    {
        return new VolunteerLog
        {
            Id = id,
            TenantId = tenantId,
            UserId = userId,
            OrganizationId = organizationId,
            CaringSupportRelationshipId = relationshipId,
            SupportRecipientId = recipientId,
            DateLogged = date,
            Hours = hours,
            Status = status,
            CreatedAt = date.ToDateTime(TimeOnly.FromTimeSpan(TimeSpan.FromHours(12)))
        };
    }

    private static Transaction Transaction(
        int id,
        int tenantId,
        int senderId,
        int receiverId,
        decimal amount,
        TransactionStatus status,
        DateTime createdAt)
    {
        return new Transaction
        {
            Id = id,
            TenantId = tenantId,
            SenderId = senderId,
            ReceiverId = receiverId,
            Amount = amount,
            Status = status,
            CreatedAt = createdAt
        };
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

    private static int ExpectedActiveMonths(DateOnly firstContribution)
    {
        var start = firstContribution.ToDateTime(TimeOnly.MinValue);
        var months = (int)Math.Floor((DateTime.UtcNow - start).TotalDays / 30.4375);
        return Math.Max(0, months);
    }

    private static SafeguardingReport Report(
        long id,
        int tenantId,
        int reporterId,
        string category,
        string severity,
        string description,
        string status,
        DateTime? dueAt,
        DateTime createdAt,
        bool escalated = false,
        DateTime? resolvedAt = null)
    {
        return new SafeguardingReport
        {
            Id = id,
            TenantId = tenantId,
            ReporterUserId = reporterId,
            Category = category,
            Severity = severity,
            Description = description,
            Status = status,
            ReviewDueAt = dueAt,
            Escalated = escalated,
            ResolvedAt = resolvedAt,
            CreatedAt = createdAt,
            UpdatedAt = createdAt.AddHours(1)
        };
    }

    private static User User(int id, int tenantId, string firstName, string lastName, string? avatarUrl = null)
    {
        return new User
        {
            Id = id,
            TenantId = tenantId,
            Email = $"user{id}@example.test",
            PasswordHash = "hash",
            FirstName = firstName,
            LastName = lastName,
            Role = Role.Names.Member,
            AvatarUrl = avatarUrl,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    private static Organisation Organisation(int id, int tenantId, int ownerId, string name, string type)
    {
        return new Organisation
        {
            Id = id,
            TenantId = tenantId,
            OwnerId = ownerId,
            Name = name,
            Slug = $"org-{id}",
            Type = type,
            Status = "verified",
            IsPublic = true,
            CreatedAt = DateTime.UtcNow
        };
    }

    private static VolunteerOrganisation VolunteerOrg(int id, int tenantId, int ownerUserId)
    {
        return new VolunteerOrganisation
        {
            Id = id,
            TenantId = tenantId,
            OwnerUserId = ownerUserId,
            Name = $"Volunteer organisation {id}",
            Slug = $"volunteer-org-{id}",
            Status = "approved",
            CreatedAt = DateTime.UtcNow
        };
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
                        new Claim(ClaimTypes.Role, Role.Names.Member),
                        new Claim("role", Role.Names.Member)
                    },
                    "TestAuth"))
            }
        };
    }

    private sealed class StubVoiceProcessor : ICaringHelpRequestVoiceProcessor
    {
        private readonly MemberHelpRequestVoiceResult _result;

        public StubVoiceProcessor(MemberHelpRequestVoiceResult result)
        {
            _result = result;
        }

        public int? LastTenantId { get; private set; }
        public int? LastUserId { get; private set; }
        public string? LastFileName { get; private set; }
        public string? LastContentType { get; private set; }
        public string? LastLocale { get; private set; }

        public Task<MemberHelpRequestVoiceResult> ProcessAsync(
            int tenantId,
            int userId,
            Stream audio,
            string? fileName,
            string contentType,
            string locale,
            CancellationToken ct)
        {
            LastTenantId = tenantId;
            LastUserId = userId;
            LastFileName = fileName;
            LastContentType = contentType;
            LastLocale = locale;
            return Task.FromResult(_result);
        }
    }

    private static Type Resolve(string typeName)
    {
        var type = Type.GetType(typeName, throwOnError: false);
        type.Should().NotBeNull($"{typeName} should exist for Laravel parity");
        return type!;
    }
}
