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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Guards the ASP.NET side of ledger row 1.21 — the exchange transaction the React
/// client actually drives: request → accept → start → complete → credits move.
///
/// 🔴 WHY A SEPARATE FILE FROM ExchangesControllerTests. That file drives the
/// lifecycle over PUT, which is the verb the ASP.NET controller happened to declare.
/// The React client sends POST for every one of those actions. So the whole existing
/// suite passed green while the client's accept was answered by an AdminOnly
/// empty-array stub and a member got 403 "Admin access required" on the one action
/// the journey turns on. Testing the verb the server prefers, rather than the verb
/// the client sends, is how a dead journey stays green for months. Every test here
/// uses the CLIENT'S verb and the CLIENT'S field names on purpose.
/// </summary>
[Collection("Integration")]
public class ExchangeJourneyContractTests : IntegrationTestBase
{
    public ExchangeJourneyContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ── GET /api/v2/exchanges/config ────────────────────────────────────────────
    // The four field names below are read by name in react-frontend
    // (types/api.ts:1710-1715). A missing boolean reads as false, and every exchange
    // page then renders its own "workflow not enabled" empty state — HTTP 200, no
    // console error, nothing for a response diff to call a defect. Assert the NAMES.

    [Theory]
    [InlineData("/api/exchanges/config")]
    [InlineData("/api/v2/exchanges/config")]
    public async Task ExchangeConfig_CarriesEveryFieldTheReactClientReads(string path)
    {
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        foreach (var field in new[]
                 {
                     "exchange_workflow_enabled",
                     "direct_messaging_enabled",
                     "require_broker_approval",
                     "confirmation_deadline_hours"
                 })
        {
            data.TryGetProperty(field, out _).Should().BeTrue(
                $"react-frontend reads config.{field} by name; without it the exchange pages render as feature-disabled");
        }
    }

    [Fact]
    public async Task ExchangeConfig_DefaultsMatchLaravel_AndDoNotInventAnEnabledWorkflow()
    {
        await AuthenticateAsMemberAsync();

        var data = (await (await Client.GetAsync("/api/v2/exchanges/config"))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        // Laravel BrokerControlConfigService::DEFAULTS (app/Services/…:40-48).
        // 🔴 `false` here is the correct answer, not a gap: a tenant that never opted
        // in must be told the workflow is off by both engines. Flipping this to true
        // to make a smoke journey reachable would be inventing a capability.
        data.GetProperty("exchange_workflow_enabled").GetBoolean().Should().BeFalse();
        data.GetProperty("direct_messaging_enabled").GetBoolean().Should().BeTrue();
        data.GetProperty("require_broker_approval").GetBoolean().Should().BeFalse();
        data.GetProperty("confirmation_deadline_hours").GetInt32().Should().Be(72);
        data.GetProperty("allow_hour_adjustment").GetBoolean().Should().BeTrue();
        data.GetProperty("max_hour_variance_percent").GetInt32().Should().Be(25);
    }

    [Fact]
    public async Task ExchangeConfig_ReportsTheTenantsStoredSetting_NotAHardcodedDefault()
    {
        await AuthenticateAsMemberAsync();

        int tenantId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            tenantId = TestData.Tenant1.Id;
            var existing = await db.EnterpriseConfigs
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == "broker.configuration");
            const string json = """
                {"exchange_workflow_enabled":true,"confirmation_deadline_hours":36,"broker_approval_required":true}
                """;
            if (existing == null)
            {
                db.EnterpriseConfigs.Add(new EnterpriseConfig
                {
                    TenantId = tenantId,
                    Key = "broker.configuration",
                    Value = json
                });
            }
            else
            {
                existing.Value = json;
            }
            await db.SaveChangesAsync();
        }

        try
        {
            var data = (await (await Client.GetAsync("/api/v2/exchanges/config"))
                .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

            data.GetProperty("exchange_workflow_enabled").GetBoolean().Should().BeTrue();
            data.GetProperty("confirmation_deadline_hours").GetInt32().Should().Be(36);
            // 🔴 Saved under ASP.NET's admin spelling `broker_approval_required`, read
            // back under Laravel's contract name `require_broker_approval`. One
            // setting, two spellings; an admin who toggled approval on must not be
            // told it is off here.
            data.GetProperty("require_broker_approval").GetBoolean().Should().BeTrue();
        }
        finally
        {
            using var scope = Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.EnterpriseConfigs
                .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == "broker.configuration");
            if (row != null)
            {
                db.EnterpriseConfigs.Remove(row);
                await db.SaveChangesAsync();
            }
        }
    }

    // ── the client's verb reaches the real owner ────────────────────────────────

    [Fact]
    public async Task AcceptExchange_OverPost_ReachesTheRealOwner_NotAnAdminOnlyStub()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        await AuthenticateAsAdminAsync();
        // The client's verb. Until 2026-08-21 this returned 403 "Admin access
        // required" from an eight-route empty-array method, for the LISTING OWNER.
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        content.GetProperty("status").GetString().Should().Be("accepted");

        // Assert the EFFECT, not the 200: the row moved.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.Accepted);
    }

    [Fact]
    public async Task StartExchange_OverPost_IsRefusedForANonParticipant()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        // 🔴 The regression this pins. The removed alias
        // (CompatibilityAliasController POST .../start) wrote Status = InProgress for
        // ANY signed-in caller with no participant check at all. Same for its confirm
        // and decline siblings; confirm reopened settled, completed exchanges.
        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        response.StatusCode.Should().NotBe(HttpStatusCode.OK);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.Accepted, "an outsider must not be able to move the state machine");
    }

    [Fact]
    public async Task StartExchange_OverPost_MovesTheStateForTheProvider()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });

        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId);
        exchange.Status.Should().Be(ExchangeStatus.InProgress);
        exchange.StartedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task DeclineExchange_OverPost_IsRefusedForANonParticipant()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/decline", new { reason = "not mine" });

        response.StatusCode.Should().NotBe(HttpStatusCode.OK);
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.Requested);
    }

    // ── the wall: settlement ────────────────────────────────────────────────────

    [Fact]
    public async Task ConfirmHours_RefusesHonestly_AndChangesNothing()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        ExchangeStatus before;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            before = (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId)).Status;
        }

        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        // 🔴 501, not 200. The removed alias answered 200 {"status":"confirmed"} and
        // set Status = Accepted — measured live reopening a COMPLETED exchange that
        // already carried a settled TransactionId. An honest refusal beats a fake
        // success that corrupts state.
        response.StatusCode.Should().Be(HttpStatusCode.NotImplemented);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("EXCHANGE_CONFIRMATION_UNAVAILABLE");

        using var after = Factory.Services.CreateScope();
        var afterDb = after.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await afterDb.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId);
        exchange.Status.Should().Be(before, "a refused confirmation must not move the state machine");
        exchange.TransactionId.Should().BeNull("no settlement may occur on a refused confirmation");
    }

    [Fact]
    public async Task ConfirmHours_MissingHours_ValidatesBeforeReportingUnavailability()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        // Laravel checks `hours` first (ExchangesController.php:318-321), so a client
        // sending the wrong body learns that rather than blaming the missing feature.
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("VALIDATION_REQUIRED_FIELD");
    }

    [Fact]
    public async Task ConfirmHours_ForANonParticipant_Is404_AndLeaksNothing()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        await AuthenticateAsOtherTenantUserAsync();
        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/confirm", new { hours = 2.0 });

        // 404 rather than 403, matching Laravel's exchange reads, so an outsider
        // cannot use the status code to discover which ids exist.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CompleteExchange_OverPost_StillFailsClosedWithoutMovingCredits()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/accept", new { });
        await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/start", new { });

        var response = await Client.PostAsJsonAsync($"/api/exchanges/{exchangeId}/complete", new { });

        // Reaching the real fail-closed service IS the improvement: previously this
        // was a 403 from an AdminOnly stub, which told the caller nothing true.
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var exchange = await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId);
        exchange.Status.Should().Be(ExchangeStatus.InProgress);
        exchange.TransactionId.Should().BeNull();
        exchange.CompletedAt.Should().BeNull();
    }

    // ── ratings read the ratings table ──────────────────────────────────────────

    [Fact]
    public async Task ExchangeRatings_ReadsExchangeRatings_NotReviewsByListingId()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            // A review whose TargetListingId happens to equal the EXCHANGE id. The old
            // implementation returned this row — real data, right shape, wrong owner,
            // which is far harder to notice than an empty list.
            db.Reviews.Add(new Review
            {
                TenantId = TestData.Tenant1.Id,
                ReviewerId = TestData.MemberUser.Id,
                TargetListingId = exchangeId,
                Rating = 1,
                Comment = "belongs to a listing, not to this exchange"
            });
            db.ExchangeRatings.Add(new ExchangeRating
            {
                TenantId = TestData.Tenant1.Id,
                ExchangeId = exchangeId,
                RaterId = TestData.MemberUser.Id,
                RatedUserId = TestData.AdminUser.Id,
                Rating = 5,
                Comment = "belongs to this exchange"
            });
            await db.SaveChangesAsync();
        }

        var response = await Client.GetAsync($"/api/v2/exchanges/{exchangeId}/ratings");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var content = await response.Content.ReadFromJsonAsync<JsonElement>();
        // 🔴 The nesting is the contract. The client reads `data.ratings` and
        // `data.has_rated` after its api helper unwraps `data`, so a flat
        // `data: [...]` array renders an empty list at HTTP 200 with the right rows
        // present one level too shallow. Laravel: WalletFeaturesController.php:303-306.
        var data = content.GetProperty("data");
        var rows = data.GetProperty("ratings").EnumerateArray().ToList();
        rows.Should().HaveCount(1);
        rows[0].GetProperty("comment").GetString().Should().Be("belongs to this exchange");
        // has_rated drives the "Rate This Exchange" button (ExchangeDetailPage.tsx:209).
        data.GetProperty("has_rated").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task RateExchange_OverV2Path_DoesNotReturnAnAmbiguousMatch500()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        // 🔴 This returned HTTP 500 AmbiguousMatchException before 2026-08-21, because
        // V15MemberParityController declared the same v2 path the alias convention
        // generates for the real ExchangesController. A 500 loses its CORS headers, so
        // the browser reports a CORS error and the hunt starts in the wrong place.
        // The exchange is not completed here, so a 4xx is the correct outcome — what
        // must never come back is a routing 500.
        var response = await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/rate", new { rating = 5 });

        ((int)response.StatusCode).Should().BeLessThan(500);
    }

    private async Task<int> CreateExchangeAsMemberAsync()
    {
        await AuthenticateAsMemberAsync();
        var create = await Client.PostAsJsonAsync("/api/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            agreed_hours = 2.0,
            message = "row 1.21 journey guard"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }
}
