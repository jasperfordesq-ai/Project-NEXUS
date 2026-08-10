// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class MarketplaceReportAppealParityTests : IntegrationTestBase
{
    public MarketplaceReportAppealParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SellerAppeal_RedactsReporterAndRestoresMarkedEnforcementOnly()
    {
        var (listingId, untouchedId, profileId) = await SeedSellerAsync();
        await AuthenticateAsMemberAsync();
        var created = await Client.PostAsJsonAsync($"/api/v2/marketplace/listings/{listingId}/report", new
        {
            reason = "unsafe",
            description = "The electrical insulation is visibly damaged and unsafe.",
            evidence_urls = new[] { "https://evidence.example.test/report-1" }
        });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var reportId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();

        foreach (var prefix in new[] { "/api/marketplace/reports", "/api/v2/marketplace/reports" })
        {
            var mine = await Client.GetAsync(prefix);
            mine.StatusCode.Should().Be(HttpStatusCode.OK);
            mine.Headers.CacheControl!.NoStore.Should().BeTrue();
            var item = (await mine.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data")[0];
            item.GetProperty("viewer_role").GetString().Should().Be("reporter");
            item.GetProperty("description").GetString().Should().Contain("insulation");
            item.GetProperty("evidence_urls")[0].GetString().Should().StartWith("https://");
        }

        await AuthenticateAsAdminAsync();
        var sellerView = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/marketplace/reports/{reportId}");
        var sellerData = sellerView.GetProperty("data");
        sellerData.GetProperty("viewer_role").GetString().Should().Be("seller");
        sellerData.GetProperty("description").ValueKind.Should().Be(JsonValueKind.Null);
        sellerData.GetProperty("evidence_urls").ValueKind.Should().Be(JsonValueKind.Null);
        sellerData.TryGetProperty("reporter", out _).Should().BeFalse();

        var resolved = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/reports/{reportId}/resolve", new
        {
            action_taken = "seller_suspended",
            resolution_reason = "The evidence supports immediate seller suspension."
        });
        resolved.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var listings = await db.MarketplaceListings.IgnoreQueryFilters().Where(x => x.Id == listingId || x.Id == untouchedId).OrderBy(x => x.Id).ToListAsync();
            listings.Should().OnlyContain(x => x.Status == "removed" && x.ModerationStatus == "rejected" && x.MarketplaceEnforcementReportId == reportId);
            var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().SingleAsync(x => x.Id == profileId);
            profile.IsSuspended.Should().BeTrue(); profile.MarketplaceSuspensionReportId.Should().Be(reportId);
        }

        var appeal = await Client.PostAsJsonAsync($"/api/v2/marketplace/reports/{reportId}/appeal", new
        {
            appeal_text = "The evidence identifies a different product and should be reconsidered."
        });
        appeal.StatusCode.Should().Be(HttpStatusCode.OK);
        var final = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/reports/{reportId}/resolve-appeal", new
        {
            action_taken = "none",
            resolution_reason = "The appeal confirms that the original enforcement was mistaken."
        });
        final.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var first = await db.MarketplaceListings.IgnoreQueryFilters().SingleAsync(x => x.Id == listingId);
            var second = await db.MarketplaceListings.IgnoreQueryFilters().SingleAsync(x => x.Id == untouchedId);
            (first.Status, first.ModerationStatus, first.MarketplaceEnforcementReportId).Should().Be(("active", "approved", null));
            (second.Status, second.ModerationStatus, second.MarketplaceEnforcementReportId).Should().Be(("draft", "pending", null));
            var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().SingleAsync(x => x.Id == profileId);
            profile.IsSuspended.Should().BeFalse(); profile.MarketplaceSuspensionReportId.Should().BeNull();
            var report = await db.MarketplaceReports.IgnoreQueryFilters().SingleAsync(x => x.Id == reportId);
            report.Status.Should().Be("appeal_resolved"); report.ActionTaken.Should().Be("none"); report.EnforcementSnapshotJson.Should().NotBeNullOrWhiteSpace();
        }
    }

    [Fact]
    public async Task AdminQueue_StateAndTenantBoundariesAreStrict()
    {
        var (listingId, _, _) = await SeedSellerAsync();
        await AuthenticateAsMemberAsync();
        var unsafeUrl = await Client.PostAsJsonAsync($"/api/v2/marketplace/listings/{listingId}/report", new { reason = "unsafe", description = "Valid description for an unsafe URL.", evidence_urls = new[] { "javascript:alert(1)" } });
        unsafeUrl.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var created = await Client.PostAsJsonAsync($"/api/v2/marketplace/listings/{listingId}/report", new { reason = "misleading", description = "The listing description materially misstates the product." });
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var reportId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetInt32();

        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/marketplace/reports/{reportId}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        await AuthenticateAsAdminAsync();
        var queue = await Client.GetFromJsonAsync<JsonElement>("/api/v2/admin/marketplace/reports?page=1&per_page=1");
        queue.GetProperty("data").GetProperty("items").GetArrayLength().Should().Be(1);
        queue.GetProperty("data").GetProperty("total").GetInt32().Should().Be(1);
        (await Client.PostAsync($"/api/v2/admin/marketplace/reports/{reportId}/acknowledge", null)).StatusCode.Should().Be(HttpStatusCode.OK);
        var resolved = await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/reports/{reportId}/resolve", new { action_taken = "none", resolution_reason = "The report does not justify enforcement." });
        resolved.StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PutAsJsonAsync($"/api/v2/admin/marketplace/reports/{reportId}/resolve", new { action_taken = "warning", resolution_reason = "A different outcome." })).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        await AuthenticateAsMemberAsync();
        var view = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/marketplace/reports/{reportId}");
        view.GetProperty("data").GetProperty("can_appeal").GetBoolean().Should().BeTrue();
        (await Client.PostAsJsonAsync($"/api/v2/marketplace/reports/{reportId}/appeal", new { appeal_text = "This short" })).StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    private async Task<(int ListingId, int UntouchedId, int ProfileId)> SeedSellerAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var first = new MarketplaceListing { TenantId = TestData.Tenant1.Id, UserId = TestData.AdminUser.Id, Title = "Safety report target", Description = "Target", Status = "active", ModerationStatus = "approved" };
        var second = new MarketplaceListing { TenantId = TestData.Tenant1.Id, UserId = TestData.AdminUser.Id, Title = "Other seller listing", Description = "Other", Status = "draft", ModerationStatus = "pending" };
        var profile = new MarketplaceSellerProfile { TenantId = TestData.Tenant1.Id, UserId = TestData.AdminUser.Id, DisplayName = "Admin seller", IsSuspended = false };
        db.AddRange(first, second, profile); await db.SaveChangesAsync();
        return (first.Id, second.Id, profile.Id);
    }
}
