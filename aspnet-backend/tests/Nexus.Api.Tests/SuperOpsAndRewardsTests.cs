// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins platform capabilities (allowlist boundary, override-vs-environment
/// sourcing, tenant-super refusal), the federation external-status shape,
/// the pinned performance-summary contract with its honest recording_off
/// state, and the attendance-reward ledger (config round-trip, kill-switch
/// blocking retries, ledger surviving the feature flag, reversal semantics).
/// </summary>
[Collection("Integration")]
public class SuperOpsAndRewardsTests : IntegrationTestBase
{
    public SuperOpsAndRewardsTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    // ─── Platform capabilities ──────────────────────────────────────

    [Fact]
    public async Task Capabilities_OrdinaryAdminRefused_PlatformSuperReadsAndWrites()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/v2/admin/super/platform-capabilities"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden,
                "ordinary tenant admins are not platform super admins");

        await AuthenticateAsPlatformSuperAdminAsync();
        var list = await Client.GetAsync("/api/v2/admin/super/platform-capabilities");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var capabilities = (await ReadJsonAsync(list)).GetProperty("data").GetProperty("capabilities");
        var attendance = capabilities.EnumerateArray()
            .Single(c => c.GetProperty("capability").GetString() == "attendance_credits");
        attendance.GetProperty("source").GetString().Should().Be("environment");
        attendance.GetProperty("value").GetString().Should().Be("off",
            "the platform kill switch defaults off");

        var set = await Client.PutAsJsonAsync("/api/v2/admin/super/platform-capabilities",
            new { capability = "attendance_credits", value = "treasury", reason = "pilot" });
        set.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = (await ReadJsonAsync(set)).GetProperty("data").GetProperty("capabilities")
            .EnumerateArray()
            .Single(c => c.GetProperty("capability").GetString() == "attendance_credits");
        updated.GetProperty("value").GetString().Should().Be("treasury");
        updated.GetProperty("source").GetString().Should().Be("platform_override");

        var invalidValue = await Client.PutAsJsonAsync("/api/v2/admin/super/platform-capabilities",
            new { capability = "attendance_credits", value = "banana" });
        invalidValue.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "the allowlist is the security boundary");
        var unknown = await Client.PutAsJsonAsync("/api/v2/admin/super/platform-capabilities",
            new { capability = "made_up", value = "1" });
        unknown.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var clear = await Client.PutAsJsonAsync("/api/v2/admin/super/platform-capabilities",
            new { capability = "attendance_credits", clear = true });
        clear.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(clear)).GetProperty("data").GetProperty("capabilities")
            .EnumerateArray()
            .Single(c => c.GetProperty("capability").GetString() == "attendance_credits")
            .GetProperty("source").GetString().Should().Be("environment");
    }

    [Fact]
    public async Task FederationExternalStatus_ReportsEverySwitchHonestlyOff()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var response = await Client.GetAsync("/api/v2/admin/super/federation/external-status");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("effective").GetBoolean().Should().BeFalse();
        data.GetProperty("emergency_lockdown_active").GetBoolean().Should().BeFalse();
        var protocols = data.GetProperty("protocols");
        foreach (var key in new[]
                 { "nexus", "komunitin", "credit_commons", "legacy_v1", "webhooks", "hour_transfer", "aggregates" })
        {
            protocols.GetProperty(key).GetBoolean().Should().BeFalse();
        }

        data.GetProperty("partner_api").GetProperty("enabled").GetBoolean().Should().BeFalse();
    }

    // ─── Performance summary ────────────────────────────────────────

    [Fact]
    public async Task PerformanceSummary_ServesThePinnedShape_WithRecordingHonestlyOff()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/v2/admin/performance/summary"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/v2/admin/performance/summary?hours=999999");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await ReadJsonAsync(response);
        var data = json.GetProperty("data");
        foreach (var arrayKey in new[] { "slowest_requests", "slowest_queries", "memory_spikes" })
        {
            data.GetProperty(arrayKey).ValueKind.Should().Be(JsonValueKind.Array,
                $"{arrayKey} must be an array even when empty — the page maps it unguarded");
        }

        data.GetProperty("total_requests").GetInt32().Should().Be(0);
        data.GetProperty("window_hours").GetInt32().Should().Be(720, "hours is clamped, never a 422");
        json.GetProperty("meta").GetProperty("recording_enabled").GetBoolean().Should().BeFalse(
            "no recorder exists here yet; the page renders its honest recording-off state");
    }

    // ─── Attendance rewards ─────────────────────────────────────────

    private async Task EnableRewardFeatureAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = TestData.Tenant1.Id,
            Key = "features.event_attendance_credits",
            Value = "true",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private async Task<int> SeedEventAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var eventRow = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.AdminUser.Id,
            Title = "Repair Cafe",
            StartsAt = DateTime.UtcNow.AddDays(2),
            Status = "active",
            PublicationStatus = "published",
            CreatedAt = DateTime.UtcNow
        };
        db.Events.Add(eventRow);
        await db.SaveChangesAsync();
        return eventRow.Id;
    }

    private async Task<long> SeedClaimAsync(int eventId, string status, decimal amount = 1.5m)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var claim = new EventAttendanceCreditClaim
        {
            TenantId = TestData.Tenant1.Id,
            EventId = eventId,
            AttendanceId = 1,
            UserId = TestData.MemberUser.Id,
            ClaimType = EventCreditService.TypeReward,
            IdempotencyKey = $"event_credit:{TestData.Tenant1.Id}:{eventId}:{TestData.MemberUser.Id}:attendance_reward",
            FundingSourceType = EventCreditService.FundingSource,
            PayeeUserId = TestData.MemberUser.Id,
            Amount = amount,
            Status = status,
            FailureCode = status == "failed" ? "mint_failed" : null,
            CompletedAt = status == "completed" ? DateTime.UtcNow : null,
            Metadata = "{}",
            CreatedAt = DateTime.UtcNow
        };
        db.EventAttendanceCreditClaims.Add(claim);
        await db.SaveChangesAsync();
        return claim.Id;
    }

    [Fact]
    public async Task RewardConfig_RoundTrips_AndValidatesTheCeiling()
    {
        await EnableRewardFeatureAsync();
        var eventId = await SeedEventAsync();
        await AuthenticateAsAdminAsync();

        var overCeiling = await Client.PutAsJsonAsync(
            $"/api/v2/admin/events/{eventId}/attendance-reward", new { amount = 99.0 });
        overCeiling.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var set = await Client.PutAsJsonAsync(
            $"/api/v2/admin/events/{eventId}/attendance-reward", new { amount = 1.5 });
        set.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(set)).GetProperty("data").GetProperty("attendance_credit_amount")
            .GetDouble().Should().Be(1.5);

        var show = await Client.GetAsync($"/api/v2/admin/events/{eventId}/attendance-reward");
        show.StatusCode.Should().Be(HttpStatusCode.OK);
        var showData = (await ReadJsonAsync(show)).GetProperty("data");
        showData.GetProperty("mode").GetString().Should().Be("off",
            "the platform kill switch is off by default");
        showData.GetProperty("claims").ValueKind.Should().Be(JsonValueKind.Array);

        var clear = await Client.PutAsJsonAsync(
            $"/api/v2/admin/events/{eventId}/attendance-reward", new { amount = (double?)null });
        clear.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(clear)).GetProperty("data").GetProperty("attendance_credit_amount")
            .ValueKind.Should().Be(JsonValueKind.Null, "null clears the reward");
    }

    [Fact]
    public async Task Ledger_SurvivesTheFeatureFlag_ButRetryNeedsTheKillSwitchOn()
    {
        var eventId = await SeedEventAsync();
        var failedClaimId = await SeedClaimAsync(eventId, "failed");
        await AuthenticateAsAdminAsync();

        // The claims ledger is deliberately readable with the feature OFF.
        var ledger = await Client.GetAsync("/api/v2/admin/events/attendance-claims");
        ledger.StatusCode.Should().Be(HttpStatusCode.OK);
        var ledgerData = (await ReadJsonAsync(ledger)).GetProperty("data");
        ledgerData.GetProperty("claims")[0].GetProperty("status").GetString().Should().Be("failed");
        ledgerData.GetProperty("pagination").GetProperty("total").GetInt32().Should().Be(1);

        // Retry requires the feature AND the platform kill switch.
        await EnableRewardFeatureAsync();
        var blocked = await Client.PostAsJsonAsync(
            $"/api/v2/admin/events/attendance-claims/{failedClaimId}/retry", new { });
        blocked.StatusCode.Should().Be(HttpStatusCode.Conflict,
            "mode=off blocks admin retries too");

        await AuthenticateAsPlatformSuperAdminAsync();
        (await Client.PutAsJsonAsync("/api/v2/admin/super/platform-capabilities",
            new { capability = "attendance_credits", value = "treasury" }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await AuthenticateAsAdminAsync();
        var retry = await Client.PostAsJsonAsync(
            $"/api/v2/admin/events/attendance-claims/{failedClaimId}/retry", new { });
        retry.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(retry)).GetProperty("data").GetProperty("status")
            .GetString().Should().Be("settled");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var claim = await db.EventAttendanceCreditClaims.IgnoreQueryFilters()
            .SingleAsync(c => c.Id == failedClaimId);
        claim.Status.Should().Be("completed");
        var mint = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Id == claim.TransactionId);
        mint.SenderId.Should().BeNull("credits are minted from the community, not moved");
        mint.ReceiverId.Should().Be(TestData.MemberUser.Id);
    }

    [Fact]
    public async Task Reverse_ReclaimsOnce_WithReasonRequired_AndNeverTwice()
    {
        var eventId = await SeedEventAsync();
        var completedClaimId = await SeedClaimAsync(eventId, "completed");
        await AuthenticateAsAdminAsync();

        var noReason = await Client.PostAsJsonAsync(
            $"/api/v2/admin/events/attendance-claims/{completedClaimId}/reverse", new { });
        noReason.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var reverse = await Client.PostAsJsonAsync(
            $"/api/v2/admin/events/attendance-claims/{completedClaimId}/reverse",
            new { reason = "Recorded against the wrong event" });
        reverse.StatusCode.Should().Be(HttpStatusCode.OK);
        var reverseData = (await ReadJsonAsync(reverse)).GetProperty("data");
        reverseData.GetProperty("status").GetString().Should().Be("reversed");
        var childClaimId = reverseData.GetProperty("claim_id").GetInt64();
        childClaimId.Should().NotBe(completedClaimId, "the response carries the CHILD claim id");

        var again = await Client.PostAsJsonAsync(
            $"/api/v2/admin/events/attendance-claims/{completedClaimId}/reverse",
            new { reason = "Trying twice" });
        again.StatusCode.Should().Be(HttpStatusCode.Conflict, "one reversal per reward");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var child = await db.EventAttendanceCreditClaims.IgnoreQueryFilters()
            .SingleAsync(c => c.Id == childClaimId);
        child.ClaimType.Should().Be(EventCreditService.TypeReversal);
        child.ParentClaimId.Should().Be(completedClaimId);
        var reclaim = await db.Transactions.IgnoreQueryFilters()
            .SingleAsync(t => t.Id == child.TransactionId);
        reclaim.SenderId.Should().Be(TestData.MemberUser.Id,
            "the reversal moves credits member → community");
        reclaim.ReceiverId.Should().BeNull();

        var unknown = await Client.PostAsJsonAsync(
            "/api/v2/admin/events/attendance-claims/999999/reverse", new { reason = "ghost claim" });
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
