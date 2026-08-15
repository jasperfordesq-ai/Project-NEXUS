// Copyright © 2024–2026 Jasper Ford
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
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Endpoints that WORKED but returned the WRONG ANSWER — arguably worse than a
/// stub, because nothing looks broken. All found by the 2026-08-15 audit and
/// fixed the same day.
/// </summary>
[Collection("Integration")]
public sealed class WrongAnswerRegressionTests : IntegrationTestBase
{
    public WrongAnswerRegressionTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ── 1. A credits ledger that ignored its date filters ──────────────────

    private async Task<long> SeedClaimAsync(DateTime createdAt)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var e = new Event
        {
            TenantId = TestData.Tenant1.Id,
            CreatedById = TestData.AdminUser.Id,
            Title = $"Claim event {Guid.NewGuid():N}"[..24],
            StartsAt = DateTime.UtcNow.AddDays(1),
        };
        db.Events.Add(e);
        await db.SaveChangesAsync();

        var claim = new EventAttendanceCreditClaim
        {
            TenantId = TestData.Tenant1.Id,
            EventId = e.Id,
            UserId = TestData.MemberUser.Id,
            Amount = 1.0m,
            Status = "completed",
            ClaimType = "reward",
            IdempotencyKey = Guid.NewGuid().ToString("N"),
            CreatedAt = createdAt,
        };
        db.EventAttendanceCreditClaims.Add(claim);
        await db.SaveChangesAsync();
        return claim.Id;
    }

    [Fact]
    public async Task AttendanceClaims_HonourTheDateFilters_InsteadOfSilentlyIgnoringThem()
    {
        var oldClaim = await SeedClaimAsync(new DateTime(2020, 1, 15, 12, 0, 0, DateTimeKind.Utc));
        var recentClaim = await SeedClaimAsync(DateTime.UtcNow.AddDays(-1));
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(
            "/api/v2/admin/events/attendance-claims?from=2020-01-01&to=2020-12-31&per_page=100");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("data").GetProperty("claims").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt64()).ToList();

        ids.Should().Contain(oldClaim);
        ids.Should().NotContain(recentClaim,
            "the endpoint ignored from/to entirely and returned the unfiltered ledger");
    }

    [Fact]
    public async Task AttendanceClaims_RefuseAnUnparseableDate_RatherThanDroppingTheFilter()
    {
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync(
            "/api/v2/admin/events/attendance-claims?from=not-a-date");

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "silently dropping a filter on a money report is the failure being fixed");
    }

    // ── 2. Admin badge counters hardcoded to zero ──────────────────────────

    [Fact]
    public async Task BadgeCounts_CountRealPendingExchanges_NotAHardcodedZero()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Exchanges.Add(new Exchange
            {
                TenantId = TestData.Tenant1.Id,
                ListingId = TestData.Listing1.Id,
                InitiatorId = TestData.MemberUser.Id,
                ListingOwnerId = TestData.AdminUser.Id,
                Status = ExchangeStatus.Requested,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.GetAsync("/api/v2/admin/badge-counts");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var counts = body.GetProperty("data");
        counts.GetProperty("pending_exchanges").GetInt32().Should().BeGreaterThan(0,
            "an admin who sees 0 concludes nothing is waiting and moves on");
    }

    // ── 3. Editing a challenge silently rewrote its type ───────────────────

    [Fact]
    public async Task EditingAChallenge_DoesNotSilentlyRewriteALegacyType()
    {
        int challengeId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var challenge = new Challenge
            {
                TenantId = TestData.Tenant1.Id,
                Title = "Legacy typed challenge",
                Description = "Created before the type vocabulary changed",
                ChallengeType = ChallengeType.Community,
                TargetAction = "post",
                TargetCount = 3,
                XpReward = 10,
                IsActive = true,
            };
            db.Challenges.Add(challenge);
            await db.SaveChangesAsync();
            challengeId = challenge.Id;
        }

        await AuthenticateAsAdminAsync();

        // The admin UI renders a Community challenge as "special" and echoes it
        // back when the admin edits an unrelated field.
        var response = await Client.PutAsJsonAsync($"/api/v2/admin/gamification/challenges/{challengeId}", new
        {
            title = "Renamed, nothing else touched",
            challenge_type = "special",
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verify = Factory.Services.CreateScope();
        var verifyDb = verify.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await verifyDb.Challenges.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(c => c.Id == challengeId);

        stored.Title.Should().Be("Renamed, nothing else touched");
        stored.ChallengeType.Should().Be(ChallengeType.Community,
            "the round-trip destroyed the original type with no warning");
    }

    // ── 4. Public events could not page past the first screen ──────────────

    [Fact]
    public async Task PublicEvents_EmitACursor_AndTheCursorAdvancesThePage()
    {
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            for (var i = 0; i < 4; i++)
            {
                db.Events.Add(new Event
                {
                    TenantId = TestData.Tenant1.Id,
                    CreatedById = TestData.AdminUser.Id,
                    Title = $"Paged public event {i}",
                    StartsAt = DateTime.UtcNow.AddDays(10 + i),
                    PublicationStatus = "published",
                });
            }
            // The public listing is gated on features.public_events being
            // explicitly enabled (PublicEventsController.GateAsync).
            foreach (var key in new[] { "features.events", "features.public_events" })
            {
                var existing = await db.TenantConfigs.IgnoreQueryFilters()
                    .FirstOrDefaultAsync(c => c.TenantId == TestData.Tenant1.Id && c.Key == key);
                if (existing is null)
                {
                    db.TenantConfigs.Add(new TenantConfig
                    {
                        TenantId = TestData.Tenant1.Id,
                        Key = key,
                        Value = "true",
                    });
                }
                else
                {
                    existing.Value = "true";
                }
            }
            await db.SaveChangesAsync();
        }

        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-ID", TestData.Tenant1.Id.ToString());

        var first = await client.GetAsync("/api/v2/public/events?per_page=2&when=upcoming");
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var firstIds = firstBody.GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt32()).ToList();

        var cursor = firstBody.GetProperty("meta").GetProperty("cursor").GetString();
        cursor.Should().NotBeNullOrEmpty(
            "web-uk sends ?cursor= and had nothing to send, so the page never advanced");

        var second = await client.GetAsync(
            $"/api/v2/public/events?per_page=2&when=upcoming&cursor={Uri.EscapeDataString(cursor!)}");
        second.StatusCode.Should().Be(HttpStatusCode.OK);
        var secondIds = (await second.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").EnumerateArray()
            .Select(x => x.GetProperty("id").GetInt32()).ToList();

        secondIds.Should().NotBeEmpty();
        secondIds.Should().NotIntersectWith(firstIds,
            "the second page must be new rows, not page one again");
    }
}
