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
using Nexus.Api.Support.Exchanges;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the WIRE CONTRACT of every exchange endpoint the unchanged React client calls:
/// the envelope, the party field names, and the exact status strings.
///
/// 🔴 WHY THIS FILE EXISTS, and why it is not folded into ExchangeJourneyContractTests.
/// On 2026-08-21 settlement worked here, proved against real Postgres, and ledger row
/// 1.21 was still dead — because the React app could not display an exchange at all.
/// The detail read returned a BARE object with `initiator`/`listing_owner`/
/// `agreed_hours` and statuses spelled `requested`/`inprogress`/`pendingconfirmation`.
/// The client reads `requester_id`/`provider_id`/`proposed_hours` and
/// `pending_provider`/`in_progress`/`pending_confirmation`. So:
///
///   • `proposed_hours` was undefined and `.toString()` on it threw
///     (ExchangeDetailPage.tsx:186), the catch ran, and the page rendered
///     "exchange not found" — at HTTP 200, with the right row in the payload;
///   • `isProvider` was false, so every action button stayed hidden; and
///   • an unknown status makes EXCHANGE_STATUS_CONFIG[status] undefined, and the very
///     next line reads `statusConfig.color` — a TypeError, not a cosmetic mismatch.
///
/// The lesson worth keeping: the previous suite passed because it asserted the shape
/// the SERVER preferred. Every assertion here is a field name or string literal taken
/// from the client source, so the test fails when the client would.
/// </summary>
[Collection("Integration")]
public class ExchangeClientContractTests : IntegrationTestBase
{
    public ExchangeClientContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ── status vocabulary ───────────────────────────────────────────────────────

    /// <summary>
    /// Every stored status must have a Laravel wire spelling, and it must be one the
    /// clients recognise. Driven off Enum.GetValues on purpose: adding a member to
    /// <see cref="ExchangeStatus"/> without teaching the mapper fails HERE rather than
    /// silently leaking a PascalCase name onto the wire, which is exactly how
    /// `pendingconfirmation` shipped.
    /// </summary>
    [Fact]
    public void WireStatus_CoversEveryStoredStatus_WithAVocabularyTheClientsKnow()
    {
        // react-frontend/src/lib/exchange-status.ts:26-71 (EXCHANGE_STATUS_CONFIG keys)
        // plus `expired` and `scheduled`, which exist in Laravel's column enum
        // (mysql-schema.sql:8904) but have no config entry in the React client.
        var laravelVocabulary = new[]
        {
            "pending_provider", "pending_broker", "accepted", "scheduled", "in_progress",
            "pending_confirmation", "completed", "disputed", "cancelled", "expired"
        };

        foreach (var status in Enum.GetValues<ExchangeStatus>())
        {
            var wire = ExchangeContractMapper.WireStatus(status);
            laravelVocabulary.Should().Contain(wire,
                $"{status} is serialised as '{wire}', which is not one of Laravel's "
                + "exchange_requests.status values, so no client can interpret it");
        }
    }

    [Theory]
    // 🔴 The two non-obvious ones, and the reason each is right:
    //   Declined  -> cancelled: Laravel has no `declined` status; declining writes
    //               `cancelled` (ExchangeWorkflowService.php:249). `declined` is absent
    //               from EXCHANGE_STATUS_CONFIG, so emitting it blanks the page.
    //   Resolved  -> completed: resolveDispute finishes through completeExchange and
    //               lands on `completed` (ExchangeWorkflowService.php:1392-1412).
    [InlineData(ExchangeStatus.Requested, "pending_provider")]
    [InlineData(ExchangeStatus.Accepted, "accepted")]
    [InlineData(ExchangeStatus.InProgress, "in_progress")]
    [InlineData(ExchangeStatus.PendingConfirmation, "pending_confirmation")]
    [InlineData(ExchangeStatus.Completed, "completed")]
    [InlineData(ExchangeStatus.Declined, "cancelled")]
    [InlineData(ExchangeStatus.Cancelled, "cancelled")]
    [InlineData(ExchangeStatus.Disputed, "disputed")]
    [InlineData(ExchangeStatus.Resolved, "completed")]
    [InlineData(ExchangeStatus.Expired, "expired")]
    public void WireStatus_MapsEachStoredStatusToLaravelsSpelling(ExchangeStatus stored, string wire)
    {
        ExchangeContractMapper.WireStatus(stored).Should().Be(wire);
    }

    [Fact]
    public void StatusFilter_UnderstandsLaravelsBuckets_NotJustEnumNames()
    {
        // `active` is the React client's DEFAULT tab (ExchangesPage.tsx:83) and it is a
        // bucket, not a status. Enum.TryParse fails on it, which is why the filter used
        // to be dropped entirely and the Active tab listed completed exchanges.
        ExchangeContractMapper.StatusFilter("active").Should().BeEquivalentTo(new[]
        {
            ExchangeStatus.Requested, ExchangeStatus.Accepted, ExchangeStatus.InProgress
        });
        ExchangeContractMapper.StatusFilter("needs_confirmation").Should().BeEquivalentTo(new[]
        {
            ExchangeStatus.PendingConfirmation, ExchangeStatus.Completed
        });

        // `completed` must also select Resolved, and `cancelled` must also select
        // Declined, because those statuses REPORT as completed/cancelled on the wire.
        // Otherwise a row is visible in the list but missing from the tab its own
        // status names.
        ExchangeContractMapper.StatusFilter("completed").Should().Contain(ExchangeStatus.Resolved);
        ExchangeContractMapper.StatusFilter("cancelled").Should().Contain(ExchangeStatus.Declined);

        // Laravel statuses this backend has no rows for: an explicit empty match.
        ExchangeContractMapper.StatusFilter("pending_broker").Should().BeEmpty();

        // Unrecognised: null, so the caller can refuse rather than silently return
        // everything. A dropped filter looks exactly like a working page.
        ExchangeContractMapper.StatusFilter("not_a_status").Should().BeNull();
    }

    // ── the detail read: every field ExchangeDetailPage.tsx touches ──────────────

    /// <summary>
    /// The enumerated list below is read off react-frontend/src/pages/exchanges/
    /// ExchangeDetailPage.tsx, not guessed. A missing key here is not a cosmetic
    /// difference: `proposed_hours` alone takes the whole page down, and each of
    /// `requester_id`/`provider_id` silently hides every action button.
    /// </summary>
    [Theory]
    [InlineData("/api/exchanges")]
    [InlineData("/api/v2/exchanges")]
    public async Task GetExchange_CarriesEveryFieldTheDetailPageReads(string prefix)
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        var response = await Client.GetAsync($"{prefix}/{exchangeId}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        // 1. THE ENVELOPE. Laravel: BaseApiController::respondWithData (…:92-105).
        body.TryGetProperty("data", out var data).Should().BeTrue(
            "the client's api helper unwraps `data`; a bare object is handed to the page whole");

        foreach (var field in new[]
                 {
                     // core identity + the hours the page prints and calls .toString() on
                     "id", "listing_id", "proposed_hours", "status", "created_at",
                     // the two ids isProvider / isRequester are computed from
                     "requester_id", "provider_id",
                     // two-party confirmation gating (canConfirm, the confirmed-hours line)
                     "requester_confirmed_at", "requester_confirmed_hours",
                     "provider_confirmed_at", "provider_confirmed_hours",
                     // rendered when present
                     "final_hours", "message", "prep_time", "broker_notes",
                     // the timeline card
                     "status_history",
                 })
        {
            data.TryGetProperty(field, out _).Should().BeTrue(
                $"ExchangeDetailPage.tsx reads exchange.{field} by name");
        }

        // The nested parties, with the keys the avatar and name lines read.
        foreach (var party in new[] { "requester", "provider" })
        {
            data.TryGetProperty(party, out var person).Should().BeTrue(
                $"ExchangeDetailPage.tsx reads exchange.{party}?.name and ?.avatar");
            person.TryGetProperty("id", out _).Should().BeTrue();
            person.TryGetProperty("name", out _).Should().BeTrue();
            person.TryGetProperty("avatar", out _).Should().BeTrue();
        }

        data.GetProperty("listing").TryGetProperty("title", out _).Should().BeTrue(
            "the breadcrumb and the sr-only <h1> read exchange.listing?.title");
    }

    /// <summary>
    /// The party fields must name the RIGHT people. Laravel's `requester_id` is whoever
    /// opened the request and `provider_id` is the LISTING OWNER
    /// (mysql-schema.sql:8897-8898). Getting this backwards would hand the accept
    /// button to the wrong member — a 200 with plausible ids is not evidence.
    /// </summary>
    [Fact]
    public async Task GetExchange_MapsRequesterToTheOpenerAndProviderToTheListingOwner()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        var data = (await (await Client.GetAsync($"/api/v2/exchanges/{exchangeId}"))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        // The member requested; Listing1 belongs to the admin.
        data.GetProperty("requester_id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("provider_id").GetInt32().Should().Be(TestData.AdminUser.Id);
        data.GetProperty("requester").GetProperty("id").GetInt32().Should().Be(TestData.MemberUser.Id);
        data.GetProperty("provider").GetProperty("id").GetInt32().Should().Be(TestData.AdminUser.Id);

        // Viewer-relative role, in Laravel's vocabulary, for the member who asked.
        data.GetProperty("role").GetString().Should().Be("requester");

        // 🔴 `provider` here means Laravel's provider (the listing owner), NOT this
        // entity's ProviderId (who performs the work — a different axis that FLIPS for
        // a Request-type listing). One name cannot mean both; this pins which it means.
        data.GetProperty("provider_id").GetInt32().Should().NotBe(TestData.MemberUser.Id);
    }

    [Fact]
    public async Task GetExchange_ReportsProposedHours_AsTheNumberTheMemberTyped()
    {
        // 🔴 The client sends `proposed_hours` (RequestExchangePage.tsx:147). Binding
        // only `agreed_hours` meant the member's hours were dropped and the exchange
        // was created at the listing's estimate — HTTP 201, plausible number, wrong.
        await AuthenticateAsMemberAsync();
        var create = await Client.PostAsJsonAsync("/api/v2/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            proposed_hours = 3.5,
            message = "proposed_hours must survive the round trip"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        created.GetProperty("proposed_hours").GetDecimal().Should().Be(3.5m);

        // And it is PERSISTED, not merely echoed.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == created.GetProperty("id").GetInt32()))
            .AgreedHours.Should().Be(3.5m);
    }

    // ── the state machine, as the client sees it ────────────────────────────────

    /// <summary>
    /// Walks the journey with the client's verb and asserts the wire status at each
    /// step, because the status is what decides which button the member is offered
    /// (canAccept / canStart / canComplete / canConfirm, ExchangeDetailPage.tsx:395-405).
    /// A status the client cannot interpret is a blank page, not a wrong label.
    /// </summary>
    [Fact]
    public async Task LifecycleStatuses_AreSpelledTheWayTheClientSwitchesOnThem()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        (await StatusOfAsync(exchangeId)).Should().Be("pending_provider");

        await AuthenticateAsAdminAsync();
        (await WireStatusOfResponseAsync(
            await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/accept", new { })))
            .Should().Be("accepted");

        (await WireStatusOfResponseAsync(
            await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/start", new { })))
            .Should().Be("in_progress");

        (await WireStatusOfResponseAsync(
            await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/complete", new { })))
            .Should().Be("pending_confirmation");

        // One party's confirmation records and settles nothing.
        (await WireStatusOfResponseAsync(
            await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/confirm", new { hours = 2.0 })))
            .Should().Be("pending_confirmation");

        // The counterparty agrees; now it settles.
        await AuthenticateAsMemberAsync();
        var settled = await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/confirm", new { hours = 2.0 });
        (await WireStatusOfResponseAsync(settled)).Should().Be("completed");

        // Assert the EFFECT, not the status string: the exchange really settled.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId);
        row.Status.Should().Be(ExchangeStatus.Completed);
        row.TransactionId.Should().NotBeNull();
    }

    [Fact]
    public async Task DeclineExchange_ReportsCancelled_BecauseLaravelHasNoDeclinedStatus()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/decline",
            new { reason = "not this week" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await WireStatusOfResponseAsync(response)).Should().Be("cancelled",
            "EXCHANGE_STATUS_CONFIG has no `declined` key, so `declined` throws on statusConfig.color");

        // The STORED value is still Declined. The mapping is at the boundary only —
        // renaming the enum member would invalidate the settlement migration.
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.Declined);
    }

    [Fact]
    public async Task CancelExchange_OverDelete_IsTheClientsCancelButton()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        // ExchangeDetailPage.tsx:351 sends DELETE, not PUT .../cancel.
        var response = await Client.DeleteAsync($"/api/v2/exchanges/{exchangeId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.TryGetProperty("data", out _).Should().BeTrue("Laravel replies {data:{message}}");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Exchanges.AsNoTracking().FirstAsync(e => e.Id == exchangeId))
            .Status.Should().Be(ExchangeStatus.Cancelled);
    }

    // ── the list ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListExchanges_CarriesTheEnvelopeAndTheMetaTheListPageReads()
    {
        await CreateExchangeAsMemberAsync();

        var body = await (await Client.GetAsync("/api/v2/exchanges?status=active&limit=20&offset=0"))
            .Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Array);
        // ExchangesPage.tsx:145 reads response.meta.has_more to decide whether to show
        // "Load More"; web-uk pages with meta.cursor (web-uk/src/lib/api.js:1968-1971).
        var meta = body.GetProperty("meta");
        meta.TryGetProperty("has_more", out _).Should().BeTrue();
        meta.TryGetProperty("per_page", out _).Should().BeTrue();

        var first = body.GetProperty("data").EnumerateArray().First();
        foreach (var field in new[]
                 {
                     // ExchangesPage.tsx card: status chip, hours, date, party, role
                     "id", "status", "proposed_hours", "created_at",
                     "requester_id", "provider_id", "requester", "provider",
                     "requester_confirmed_at", "provider_confirmed_at",
                 })
        {
            first.TryGetProperty(field, out _).Should().BeTrue(
                $"ExchangesPage.tsx reads exchange.{field} on every card");
        }
        first.GetProperty("status").GetString().Should().Be("pending_provider");
    }

    [Fact]
    public async Task ListExchanges_ActiveFilter_ExcludesASettledExchange()
    {
        var openId = await CreateExchangeAsMemberAsync();

        // A second exchange, forced terminal directly so this test does not depend on
        // the settlement path (which has its own suite).
        int cancelledId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var extra = new Exchange
            {
                TenantId = TestData.Tenant1.Id,
                ListingId = TestData.Listing1.Id,
                InitiatorId = TestData.MemberUser.Id,
                ListingOwnerId = TestData.AdminUser.Id,
                Status = ExchangeStatus.Completed,
                AgreedHours = 1m
            };
            db.Exchanges.Add(extra);
            await db.SaveChangesAsync();
            cancelledId = extra.Id;
        }

        var active = await IdsOfAsync("/api/v2/exchanges?status=active");
        active.Should().Contain(openId);
        // 🔴 This is the assertion that would have caught the dropped filter: before the
        // fix, Enum.TryParse("active") failed, the whole filter was skipped, and the
        // completed exchange came back under the Active tab.
        active.Should().NotContain(cancelledId);

        var completed = await IdsOfAsync("/api/v2/exchanges?status=completed");
        completed.Should().Contain(cancelledId);
        completed.Should().NotContain(openId);
    }

    [Fact]
    public async Task ListExchanges_RefusesAStatusItCannotHonour()
    {
        await AuthenticateAsMemberAsync();

        // Silently ignoring it is the failure mode this replaces: the caller believes it
        // filtered and gets the unfiltered list.
        (await Client.GetAsync("/api/v2/exchanges?status=not_a_status"))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── /exchanges/check — the journey's entry point ─────────────────────────────

    /// <summary>
    /// 🔴 THE WORST OF THE SET, because it broke a page the exchange feature is only
    /// reached through. This endpoint answered a bare <c>{can_exchange, reason}</c>. The
    /// client's helper finds no `data` key and hands the page the whole body — a TRUTHY
    /// object — and ListingDetailPage.tsx:807 reads any truthy value as "you already
    /// have an exchange on this listing". On every listing in the community: the
    /// "Request Exchange" button was replaced by a link to `/exchanges/undefined`, and
    /// the chip called `.status.replace(...)` on undefined and threw, taking the listing
    /// page down. Laravel's answer is <c>{data: null}</c> — and null is what lets the
    /// member start one.
    /// </summary>
    [Fact]
    public async Task CheckExchange_WithNoLiveExchange_AnswersDataNull()
    {
        await AuthenticateAsMemberAsync();

        var body = await (await Client.GetAsync($"/api/v2/exchanges/check?listing_id={TestData.Listing2.Id}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        body.TryGetProperty("data", out var data).Should().BeTrue();
        data.ValueKind.Should().Be(JsonValueKind.Null,
            "a truthy body here replaces the Request Exchange button with a link to /exchanges/undefined");
    }

    [Fact]
    public async Task CheckExchange_WithALiveExchange_AnswersTheFieldsTheListingPageReads()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        var body = await (await Client.GetAsync($"/api/v2/exchanges/check?listing_id={TestData.Listing1.Id}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        var data = body.GetProperty("data");
        data.ValueKind.Should().Be(JsonValueKind.Object);
        data.GetProperty("id").GetInt32().Should().Be(exchangeId);
        // ListingDetailPage.tsx:813-824 switches on this string and calls .replace on it.
        data.GetProperty("status").GetString().Should().Be("pending_provider");
        data.GetProperty("role").GetString().Should().Be("requester");
        data.TryGetProperty("proposed_hours", out _).Should().BeTrue();
    }

    [Fact]
    public async Task CheckExchange_AfterCancelling_GoesBackToNull()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        (await Client.DeleteAsync($"/api/v2/exchanges/{exchangeId}")).StatusCode.Should().Be(HttpStatusCode.OK);

        // Terminal statuses are not "live": the member must be able to request again.
        var body = await (await Client.GetAsync($"/api/v2/exchanges/check?listing_id={TestData.Listing1.Id}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        body.GetProperty("data").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // ── ratings ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ExchangeRatings_CarryTheNestedRaterTheListRenders()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.ExchangeRatings.Add(new ExchangeRating
            {
                TenantId = TestData.Tenant1.Id,
                ExchangeId = exchangeId,
                RaterId = TestData.MemberUser.Id,
                RatedUserId = TestData.AdminUser.Id,
                Rating = 4,
                Comment = "nested rater required"
            });
            await db.SaveChangesAsync();
        }

        var data = (await (await Client.GetAsync($"/api/v2/exchanges/{exchangeId}/ratings"))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        var row = data.GetProperty("ratings").EnumerateArray().First();

        // 🔴 ExchangeDetailPage.tsx:589 renders `r.rater.name`. Without the nested
        // object that line throws and the whole completed-exchange page goes down,
        // which is worse than an empty list.
        row.GetProperty("rater").GetProperty("name").GetString().Should().NotBeNullOrWhiteSpace();
        // 🔴 And Laravel does NOT send `rater` — it sends flat rater_first_name /
        // rater_last_name (ExchangeRatingService.php:135-145), so this page crashes
        // against LARAVEL too. Both shapes are emitted: Laravel's because it is the
        // contract, the nested one because it is what the client reads. The Laravel
        // defect is raised separately; it is not fixed from this side.
        row.TryGetProperty("rater_first_name", out _).Should().BeTrue();
        row.TryGetProperty("rated_id", out _).Should().BeTrue("Laravel's column name");
    }

    // ── the dashboard entry point ───────────────────────────────────────────────

    [Fact]
    public async Task NeedsAttentionCount_OffersConfirm_WhenAConfirmationIsOutstanding()
    {
        var exchangeId = await CreateExchangeAsMemberAsync();
        await AuthenticateAsAdminAsync();
        await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/accept", new { });
        await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/start", new { });
        await Client.PostAsJsonAsync($"/api/v2/exchanges/{exchangeId}/complete", new { });

        await AuthenticateAsMemberAsync();
        var data = (await (await Client.GetAsync("/api/v2/exchanges/needs-attention-count"))
            .Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");

        var item = data.GetProperty("items").EnumerateArray()
            .FirstOrDefault(i => i.GetProperty("id").GetInt32() == exchangeId);
        item.ValueKind.Should().Be(JsonValueKind.Object,
            "PendingConfirmation was missing from the query, so the `confirm` branch of "
            + "the action switch was unreachable and a member's turn to confirm never "
            + "appeared on the dashboard");

        // DashboardPage.tsx:897 keys a translation off `action`; `confirm` is one of the
        // five values it has copy for.
        item.GetProperty("action").GetString().Should().Be("confirm");
        item.GetProperty("status").GetString().Should().Be("pending_confirmation");
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private async Task<int> CreateExchangeAsMemberAsync()
    {
        await AuthenticateAsMemberAsync();
        var create = await Client.PostAsJsonAsync("/api/v2/exchanges", new
        {
            listing_id = TestData.Listing1.Id,
            proposed_hours = 2.0,
            message = "exchange wire-contract guard"
        });
        create.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();
    }

    private async Task<string?> StatusOfAsync(int exchangeId) =>
        (await (await Client.GetAsync($"/api/v2/exchanges/{exchangeId}"))
            .Content.ReadFromJsonAsync<JsonElement>())
        .GetProperty("data").GetProperty("status").GetString();

    private static async Task<string?> WireStatusOfResponseAsync(HttpResponseMessage response)
    {
        response.StatusCode.Should().Be(HttpStatusCode.OK,
            await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("status").GetString();
    }

    private async Task<List<int>> IdsOfAsync(string url)
    {
        await AuthenticateAsMemberAsync();
        var body = await (await Client.GetAsync(url)).Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("data").EnumerateArray()
            .Select(e => e.GetProperty("id").GetInt32())
            .ToList();
    }
}
