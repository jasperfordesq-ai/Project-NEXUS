// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class NationalKissDashboardContractTests : IntegrationTestBase
{
    public NationalKissDashboardContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task LaravelReactNationalKissDashboard_EndpointsUsePrivacyPreservingPayloads()
    {
        await SeedNationalKissDataAsync();
        await AuthenticateAsAdminAsync();

        var summary = await GetDataAsync("/api/v2/admin/national/kiss/summary?period_from=2026-01-01&period_to=2026-12-31");
        summary.GetProperty("cooperatives_count").GetInt32().Should().Be(2);
        summary.GetProperty("active_cooperatives_count").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        summary.GetProperty("total_approved_hours_national").GetDouble().Should().BeGreaterThan(0);
        summary.GetProperty("total_active_members_bucket").GetString().Should().NotBeNullOrWhiteSpace();
        summary.GetProperty("total_recipients_reached_bucket").GetString().Should().NotBeNullOrWhiteSpace();
        summary.GetProperty("top_5_cooperatives_by_hours").ValueKind.Should().Be(JsonValueKind.Array);
        summary.GetProperty("bottom_5_active_cooperatives_by_hours").ValueKind.Should().Be(JsonValueKind.Array);
        summary.GetProperty("active_tandems_total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        summary.GetProperty("safeguarding_reports_total").GetInt32().Should().BeGreaterThanOrEqualTo(1);
        summary.GetProperty("generated_at").GetString().Should().NotBeNullOrWhiteSpace();
        summary.GetProperty("period").GetProperty("from").GetString().Should().Be("2026-01-01");

        var comparative = await GetDataAsync("/api/v2/admin/national/kiss/comparative?period_from=2026-01-01&period_to=2026-12-31");
        var rows = comparative.GetProperty("rows");
        rows.GetArrayLength().Should().Be(2);
        rows.EnumerateArray().Should().OnlyContain(row => HasProperties(row,
            "tenant_id", "slug", "name", "hours", "members_bracket", "recipients_bracket",
            "active_tandems", "retention_rate_pct", "reciprocity_pct", "status"));

        var trend = await GetDataAsync("/api/v2/admin/national/kiss/trend");
        var trendRows = trend.GetProperty("trend");
        trendRows.GetArrayLength().Should().Be(12);
        trendRows.EnumerateArray().Should().OnlyContain(row =>
            HasProperties(row, "month", "total_hours_all_cooperatives", "active_cooperatives"));

        var cooperatives = await GetDataAsync("/api/v2/admin/national/kiss/cooperatives");
        var coopRows = cooperatives.GetProperty("cooperatives");
        coopRows.GetArrayLength().Should().Be(2);
        coopRows.EnumerateArray().Should().OnlyContain(row =>
            HasProperties(row, "tenant_id", "slug", "name", "locale", "member_count_bracket"));
    }

    private async Task SeedNationalKissDataAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var passwordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword);
        var now = DateTime.UtcNow;

        var zug = new Tenant
        {
            Slug = "kiss-zug",
            Name = "KISS Zug",
            IsActive = true,
            CreatedAt = now.AddYears(-1)
        };
        var bern = new Tenant
        {
            Slug = "kiss-bern",
            Name = "KISS Bern",
            IsActive = true,
            CreatedAt = now.AddYears(-1)
        };
        var ordinary = new Tenant
        {
            Slug = "ordinary-community",
            Name = "Ordinary Community",
            IsActive = true,
            CreatedAt = now.AddYears(-1)
        };

        db.Tenants.AddRange(zug, bern, ordinary);
        await db.SaveChangesAsync();

        var supporter = new User
        {
            TenantId = zug.Id,
            Email = "zug-supporter@test.com",
            PasswordHash = passwordHash,
            FirstName = "Zug",
            LastName = "Supporter",
            Role = "member",
            IsActive = true,
            CreatedAt = now.AddMonths(-6)
        };
        var recipient = new User
        {
            TenantId = zug.Id,
            Email = "zug-recipient@test.com",
            PasswordHash = passwordHash,
            FirstName = "Zug",
            LastName = "Recipient",
            Role = "member",
            IsActive = true,
            CreatedAt = now.AddMonths(-6)
        };
        var bernMember = new User
        {
            TenantId = bern.Id,
            Email = "bern-member@test.com",
            PasswordHash = passwordHash,
            FirstName = "Bern",
            LastName = "Member",
            Role = "member",
            IsActive = true,
            CreatedAt = now.AddMonths(-4)
        };

        db.Users.AddRange(supporter, recipient, bernMember);
        await db.SaveChangesAsync();

        db.VolunteerLogs.AddRange(
            new VolunteerLog
            {
                TenantId = zug.Id,
                UserId = supporter.Id,
                SupportRecipientId = recipient.Id,
                DateLogged = new DateOnly(2026, 5, 10),
                Hours = 5.5m,
                Status = "approved",
                CreatedAt = now.AddDays(-10)
            },
            new VolunteerLog
            {
                TenantId = bern.Id,
                UserId = bernMember.Id,
                DateLogged = new DateOnly(2026, 6, 12),
                Hours = 2.0m,
                Status = "approved",
                CreatedAt = now.AddDays(-7)
            });

        db.Transactions.Add(new Transaction
        {
            TenantId = zug.Id,
            SenderId = supporter.Id,
            ReceiverId = recipient.Id,
            Amount = 1.5m,
            Status = TransactionStatus.Completed,
            CreatedAt = new DateTime(2026, 5, 15, 12, 0, 0, DateTimeKind.Utc)
        });

        db.CaringSupportRelationships.Add(new CaringSupportRelationship
        {
            TenantId = zug.Id,
            SupporterId = supporter.Id,
            RecipientId = recipient.Id,
            Title = "Weekly visit",
            StartDate = new DateOnly(2026, 1, 1),
            Status = "active",
            CreatedAt = now.AddMonths(-5)
        });

        db.SafeguardingReports.Add(new SafeguardingReport
        {
            TenantId = zug.Id,
            ReporterUserId = supporter.Id,
            SubjectUserId = recipient.Id,
            Category = "wellbeing",
            Severity = "medium",
            Description = "Contract test report",
            Status = "submitted",
            CreatedAt = new DateTime(2026, 5, 20, 12, 0, 0, DateTimeKind.Utc)
        });

        await db.SaveChangesAsync();
    }

    private async Task<JsonElement> GetDataAsync(string path)
    {
        var response = await Client.GetAsync(path);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.TryGetProperty("compatibility", out _).Should().BeFalse();
        return json.GetProperty("data");
    }

    private static bool HasProperties(JsonElement row, params string[] names) =>
        names.All(name => row.TryGetProperty(name, out _));
}
