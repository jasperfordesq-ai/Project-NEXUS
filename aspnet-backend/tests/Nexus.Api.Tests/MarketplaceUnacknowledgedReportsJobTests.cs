// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// MarketplaceUnacknowledgedReportsJob (R-6, Laravel
/// <c>marketplace:process-unacknowledged-reports</c>).
///
/// 🔴 With nothing running, a member who reported a harmful listing was never
/// told anything and the seller never learned their listing was under review.
/// Acknowledging a report inside 24 hours is a Digital Services Act obligation
/// with a clock on it.
///
/// The negative cases matter as much as the positive one: acknowledging a report
/// that is only an hour old would consume the deadline a real moderator still
/// has, and re-acknowledging an already-handled report would send a member a
/// second notice about something already dealt with.
/// </summary>
[Collection("Integration")]
public sealed class MarketplaceUnacknowledgedReportsJobTests : IntegrationTestBase
{
    public MarketplaceUnacknowledgedReportsJobTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static T ResolveJob<T>(IServiceProvider services) where T : ScheduledHostedService
        => services.GetServices<IHostedService>().OfType<T>().Single();

    private static async Task RunAsync(ScheduledHostedService job, IServiceProvider services, int tenantId)
    {
        var method = typeof(ScheduledHostedService).GetMethod(
            "RunForTenantAsync",
            System.Reflection.BindingFlags.Instance
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Public)!;
        await (Task)method.Invoke(job, [services, tenantId, CancellationToken.None])!;
    }

    private async Task<(int ReportId, int SellerId, int ReporterId)> SeedReportAsync(
        int ageInHours,
        string status = "received",
        DateTime? acknowledgedAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var seller = NewUser();
        var reporter = NewUser();
        db.Users.AddRange(seller, reporter);
        await db.SaveChangesAsync();

        var listing = new MarketplaceListing
        {
            TenantId = TestData.Tenant1.Id,
            UserId = seller.Id,
            Title = "Reported item",
            Description = "fixture",
            CreatedAt = DateTime.UtcNow.AddDays(-30),
        };
        db.Set<MarketplaceListing>().Add(listing);
        await db.SaveChangesAsync();

        var report = new MarketplaceReport
        {
            TenantId = TestData.Tenant1.Id,
            MarketplaceListingId = listing.Id,
            ReporterUserId = reporter.Id,
            // Must be one of chk_marketplace_report_reason's values.
            Reason = "illegal",
            Status = status,
            AcknowledgedAt = acknowledgedAt,
            CreatedAt = DateTime.UtcNow.AddHours(-ageInHours),
        };
        db.Set<MarketplaceReport>().Add(report);
        await db.SaveChangesAsync();

        return (report.Id, seller.Id, reporter.Id);
    }

    private User NewUser() => new()
    {
        TenantId = TestData.Tenant1.Id,
        Email = $"dsa-report-{Guid.NewGuid():N}@test.com",
        PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
        FirstName = "Report",
        LastName = "Party",
        Role = "member",
        IsActive = true,
        RegistrationStatus = RegistrationStatus.Active,
        CreatedAt = DateTime.UtcNow,
    };

    private async Task RunJobAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var job = ResolveJob<MarketplaceUnacknowledgedReportsJob>(Factory.Services);
        await RunAsync(job, scope.ServiceProvider, TestData.Tenant1.Id);
    }

    private async Task<MarketplaceReport> GetReportAsync(int id)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<MarketplaceReport>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(r => r.Id == id);
    }

    private async Task<int> CountNotificationsAsync(int userId, string type)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Set<Notification>().IgnoreQueryFilters().AsNoTracking()
            .CountAsync(n => n.UserId == userId && n.Type == type);
    }

    [Fact]
    public async Task AReportNobodyAnsweredIn24Hours_IsAcknowledged_AndBothPartiesAreTold()
    {
        var (reportId, sellerId, reporterId) = await SeedReportAsync(ageInHours: 30);

        await RunJobAsync();

        var report = await GetReportAsync(reportId);
        report.Status.Should().Be("acknowledged");
        report.AcknowledgedAt.Should().NotBeNull("the DSA deadline is met by recording it, not by intending to");

        (await CountNotificationsAsync(reporterId, "marketplace_report_acknowledged"))
            .Should().Be(1, "a report that vanishes into silence is why people stop reporting");
        (await CountNotificationsAsync(sellerId, "marketplace_listing_under_review"))
            .Should().Be(1, "DSA transparency: someone whose listing is under review must know");
    }

    [Fact]
    public async Task AReportStillInsideTheDeadline_IsLeftForAHuman()
    {
        var (reportId, sellerId, reporterId) = await SeedReportAsync(ageInHours: 2);

        await RunJobAsync();

        var report = await GetReportAsync(reportId);
        report.Status.Should().Be("received", "a moderator still has 22 hours");
        report.AcknowledgedAt.Should().BeNull();
        (await CountNotificationsAsync(reporterId, "marketplace_report_acknowledged")).Should().Be(0);
        (await CountNotificationsAsync(sellerId, "marketplace_listing_under_review")).Should().Be(0);
    }

    [Fact]
    public async Task AnAlreadyHandledReport_IsNotAcknowledgedAgain()
    {
        var acknowledgedAt = DateTime.UtcNow.AddHours(-40);
        var (reportId, _, reporterId) = await SeedReportAsync(
            ageInHours: 60, status: "acknowledged", acknowledgedAt: acknowledgedAt);

        await RunJobAsync();

        var report = await GetReportAsync(reportId);
        report.AcknowledgedAt.Should().BeCloseTo(acknowledgedAt, TimeSpan.FromSeconds(5),
            "re-stamping it would misreport when the platform actually responded");
        (await CountNotificationsAsync(reporterId, "marketplace_report_acknowledged"))
            .Should().Be(0, "a second notice about something already dealt with");
    }

    [Fact]
    public async Task RunningTwice_DoesNotNotifyTwice()
    {
        var (_, sellerId, reporterId) = await SeedReportAsync(ageInHours: 30);

        await RunJobAsync();
        await RunJobAsync();

        (await CountNotificationsAsync(reporterId, "marketplace_report_acknowledged")).Should().Be(1);
        (await CountNotificationsAsync(sellerId, "marketplace_listing_under_review")).Should().Be(1);
    }
}
