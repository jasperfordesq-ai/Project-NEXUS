// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Support.Exchanges;

/// <summary>
/// The exchange projection the unchanged clients consume, and the ONLY place the
/// Laravel status vocabulary is spoken.
///
/// 🔴 WHY THIS EXISTS. Settlement worked here from 2026-08-21, and ledger row 1.21
/// was still dead, because the React app could not display an exchange at all.
/// Measured cause, in three parts, all in one response:
///
///   1. ENVELOPE. <c>GET /api/v2/exchanges/{id}</c> returned a BARE object. Laravel
///      returns <c>{data, meta}</c> (BaseApiController.php:92-105) and every other
///      exchange endpoint does too.
///   2. PARTY NAMES. This backend said `initiator` / `listing_owner`; the clients
///      read `requester_id` / `provider_id` and the nested `requester` / `provider`
///      (react-frontend/src/types/api.ts:1655-1699,
///      web-uk/src/routes/exchanges.js:115-116). With those undefined,
///      `isProvider` is false and EVERY action button stays hidden.
///   3. HOURS. This backend said `agreed_hours`; the client reads `proposed_hours`
///      and calls <c>.toString()</c> on it unconditionally
///      (ExchangeDetailPage.tsx:186). <c>undefined.toString()</c> throws, the catch
///      renders "exchange not found", and the page never appears — at HTTP 200,
///      with the right row in the payload under the wrong names.
///
/// 🔴 STATUS VOCABULARY IS THE SUBTLE PART. This backend persists
/// <see cref="ExchangeStatus"/> BY NAME (WalletConfiguration.cs,
/// <c>HasConversion&lt;string&gt;()</c>), so <c>Status.ToString().ToLowerInvariant()</c>
/// put `requested`, `inprogress` and `pendingconfirmation` on the wire. None of
/// those exist in the clients' vocabulary. The React client indexes
/// <c>EXCHANGE_STATUS_CONFIG[status]</c> and immediately reads
/// <c>statusConfig.color</c> (ExchangeDetailPage.tsx:392-395) — an unknown status is
/// not a cosmetic mismatch, it is a TypeError that blanks the page. Map at the
/// BOUNDARY. Do not rename the enum members and do not change how they are stored:
/// that would invalidate migration 20260821164404_AddExchangeTwoPartyConfirmation.
///
/// Laravel's authoritative list is the `exchange_requests.status` column enum
/// (database/schema/mysql-schema.sql:8904) and ExchangeWorkflowService.php:35-43:
///   pending_provider, pending_broker, accepted, scheduled, in_progress,
///   pending_confirmation, completed, disputed, cancelled, expired.
///
/// Two mappings are NOT one-to-one and are deliberate:
///   • <see cref="ExchangeStatus.Declined"/> maps to `cancelled`. Laravel has no
///     `declined` status at all: declining a request writes `cancelled`
///     (ExchangeWorkflowService.php:249). `declined` is absent from
///     EXCHANGE_STATUS_CONFIG, so emitting it crashes the page.
///   • <see cref="ExchangeStatus.Resolved"/> maps to `completed`. Laravel's
///     `resolveDispute` finishes by calling `completeExchange`, which lands on
///     `completed` (ExchangeWorkflowService.php:1392-1412). There is no `resolved`.
///
/// 🔴 ADR-0004 SCOPE. Fields with no client reader are not reproduced. Fields the
/// clients read but this backend has no column for are emitted as HONEST NULLS —
/// the key exists so a reader gets null instead of undefined, and nothing is
/// invented: `prep_time`, `broker_notes`, `broker_id`, `risk_level`. Each is a named
/// gap in the report, not a silent zero.
/// </summary>
public static class ExchangeContractMapper
{
    // ── status: entity → wire ───────────────────────────────────────────────────

    /// <summary>Laravel's snake_case wire spelling for a stored status.</summary>
    public static string WireStatus(ExchangeStatus status) => status switch
    {
        ExchangeStatus.Requested => "pending_provider",
        ExchangeStatus.Accepted => "accepted",
        ExchangeStatus.InProgress => "in_progress",
        ExchangeStatus.PendingConfirmation => "pending_confirmation",
        ExchangeStatus.Completed => "completed",
        // See the class remarks: Laravel has no `declined` and no `resolved`.
        ExchangeStatus.Declined => "cancelled",
        ExchangeStatus.Cancelled => "cancelled",
        ExchangeStatus.Disputed => "disputed",
        ExchangeStatus.Resolved => "completed",
        ExchangeStatus.Expired => "expired",
        // A status added to the enum without being taught to this mapper must be
        // loud, not silently lowercased onto the wire in a vocabulary no client
        // speaks. That silent fallback is exactly how `pendingconfirmation` shipped.
        _ => throw new ArgumentOutOfRangeException(
            nameof(status), status,
            "No Laravel wire spelling for this ExchangeStatus. Add one here; do not "
            + "let ToString() leak a PascalCase name onto the wire.")
    };

    // ── status: wire → entity (the ?status= filter) ─────────────────────────────

    /// <summary>
    /// The stored statuses a client's <c>?status=</c> value selects, or null when the
    /// value is not a filter this backend recognises.
    ///
    /// 🔴 `active` and `needs_confirmation` are BUCKETS, not statuses
    /// (ExchangeService.php:55-68). Before this existed the list endpoint did
    /// <c>Enum.TryParse&lt;ExchangeStatus&gt;("active")</c>, which fails, so the filter
    /// was silently dropped and the React "Active" tab listed completed and
    /// cancelled exchanges as well. A dropped filter looks like a working page.
    /// </summary>
    public static ExchangeStatus[]? StatusFilter(string? wire)
    {
        if (string.IsNullOrWhiteSpace(wire)) return null;

        return wire.Trim().ToLowerInvariant() switch
        {
            // Laravel: pending_provider, accepted, pending_broker, in_progress.
            // `pending_broker` has no counterpart here — this backend has no broker
            // approval step on an exchange — so the bucket is the other three.
            "active" => [ExchangeStatus.Requested, ExchangeStatus.Accepted, ExchangeStatus.InProgress],
            "needs_confirmation" => [ExchangeStatus.PendingConfirmation, ExchangeStatus.Completed],

            "pending_provider" => [ExchangeStatus.Requested],
            "accepted" => [ExchangeStatus.Accepted],
            "in_progress" => [ExchangeStatus.InProgress],
            "pending_confirmation" => [ExchangeStatus.PendingConfirmation],
            // `completed` must also select Resolved, because Resolved is reported as
            // `completed` on the wire; otherwise a resolved exchange is visible in the
            // list but invisible under the tab its own status names.
            "completed" => [ExchangeStatus.Completed, ExchangeStatus.Resolved],
            // Same reasoning in reverse for the two statuses that report `cancelled`.
            "cancelled" => [ExchangeStatus.Cancelled, ExchangeStatus.Declined],
            "disputed" => [ExchangeStatus.Disputed],
            "expired" => [ExchangeStatus.Expired],

            // Laravel statuses with no counterpart here. An explicitly EMPTY match is
            // the honest answer: the tab exists, and this backend has no such rows.
            "pending_broker" => [],
            "scheduled" => [],

            _ => null
        };
    }

    // ── the exchange object ─────────────────────────────────────────────────────

    /// <summary>
    /// Laravel's <c>ExchangesController::formatExchange</c>
    /// (app/Http/Controllers/Api/ExchangesController.php:384-419), plus the fields
    /// the clients read that Laravel happens not to send, plus this backend's own
    /// existing names kept for its existing readers.
    /// </summary>
    /// <param name="e">The exchange, with Listing/Initiator/ListingOwner included.</param>
    /// <param name="viewerId">
    /// The signed-in user, used only for the viewer-relative <c>role</c> field.
    /// </param>
    public static Dictionary<string, object?> Exchange(Entities.Exchange e, int? viewerId = null)
    {
        // 🔴 PARTY AXIS. Laravel's `requester_id` is whoever opened the request and
        // `provider_id` is the LISTING OWNER, whatever the listing's type
        // (schema comment, mysql-schema.sql:8897-8898). Here that is InitiatorId and
        // ListingOwnerId.
        //
        // It is NOT the same axis as this entity's ProviderId/ReceiverId, which record
        // who performs the work and therefore who pays — and that axis FLIPS for a
        // Request-type listing. Because `provider` can only mean one thing in one
        // payload, it means Laravel's: the listing owner. The old ASP.NET-only
        // `provider` (Exchange.Provider) is deliberately gone from this projection
        // rather than left to collide with it.
        var requester = e.Initiator;
        var provider = e.ListingOwner;

        return new Dictionary<string, object?>
        {
            ["id"] = e.Id,
            ["listing_id"] = e.ListingId,
            ["requester_id"] = e.InitiatorId,
            ["provider_id"] = e.ListingOwnerId,

            ["listing"] = new Dictionary<string, object?>
            {
                ["id"] = e.ListingId,
                ["title"] = NullIfBlank(e.Listing?.Title),
                ["type"] = e.Listing is null ? null : e.Listing.Type.ToString().ToLowerInvariant(),
                // Read by the React Exchange type but not by the exchange pages; free
                // of a second query because callers already Include the listing.
                ["description"] = NullIfBlank(e.Listing?.Description),
                ["hours"] = e.Listing?.EstimatedHours,
            },
            ["requester"] = Party(requester, e.InitiatorId),
            ["provider"] = Party(provider, e.ListingOwnerId),

            // This backend's own older names for the same two people, kept so nothing
            // that already read them breaks. Same values, not a second axis.
            ["initiator"] = Party(requester, e.InitiatorId),
            ["listing_owner"] = Party(provider, e.ListingOwnerId),

            // web-uk reads these flat spellings first and falls back to the nested
            // objects (web-uk/src/routes/exchanges.js:139-141).
            ["listing_title"] = NullIfBlank(e.Listing?.Title),
            ["requester_name"] = FullName(requester),
            ["provider_name"] = FullName(provider),
            ["requester_avatar"] = NullIfBlank(requester?.AvatarUrl),
            ["provider_avatar"] = NullIfBlank(provider?.AvatarUrl),

            // 🔴 `proposed_hours` is the name both clients read, and `.toString()` is
            // called on it without a guard. `agreed_hours` is this backend's own
            // spelling and is KEPT — additive, per ADR-0004; removing it is a
            // subtractive change that needs its own evidence.
            ["proposed_hours"] = e.AgreedHours,
            ["agreed_hours"] = e.AgreedHours,
            ["actual_hours"] = e.ActualHours,
            ["final_hours"] = e.FinalHours,

            ["status"] = WireStatus(e.Status),

            // Viewer-relative. Laravel's own `role` (on /exchanges/check) is
            // requester|provider, so this uses that vocabulary rather than this
            // backend's older initiator|owner.
            ["role"] = viewerId is null
                ? null
                : e.InitiatorId == viewerId.Value ? "requester" : "provider",

            ["message"] = NullIfBlank(e.RequestMessage),
            // Laravel's underlying column name, which web-uk accepts as a fallback.
            ["requester_notes"] = NullIfBlank(e.RequestMessage),
            ["request_message"] = NullIfBlank(e.RequestMessage),
            ["decline_reason"] = NullIfBlank(e.DeclineReason),
            ["notes"] = NullIfBlank(e.Notes),

            ["requester_confirmed_at"] = Iso(e.RequesterConfirmedAt),
            ["requester_confirmed_hours"] = e.RequesterConfirmedHours,
            ["provider_confirmed_at"] = Iso(e.ProviderConfirmedAt),
            ["provider_confirmed_hours"] = e.ProviderConfirmedHours,

            ["transaction_id"] = e.TransactionId,
            ["group_id"] = e.GroupId,
            ["scheduled_at"] = Iso(e.ScheduledAt),
            ["started_at"] = Iso(e.StartedAt),
            ["completed_at"] = Iso(e.CompletedAt),
            ["cancelled_at"] = Iso(e.CancelledAt),
            ["created_at"] = Iso(e.CreatedAt),
            ["updated_at"] = Iso(e.UpdatedAt),

            // 🔴 HONEST NULLS — no column on this backend's Exchange entity. The key
            // exists so a client reading it gets null instead of undefined, and
            // nothing is derived from an adjacent value.
            //   prep_time    the client SENDS it on create and renders a "Prep Time"
            //                block when it is > 0 (ExchangeDetailPage.tsx:557). There
            //                is nowhere to store it, so it is accepted-and-dropped and
            //                always reads back null. Named gap: it needs a column,
            //                which is an EF migration and so the Schema agent's work.
            //   broker_notes Laravel writes this on broker approval. This backend has a
            //                separate `broker_notes` TABLE keyed by exchange, but its
            //                rows carry an is_private flag, so surfacing them to a
            //                member here could leak a staff note. Left null on purpose.
            //   broker_id    no broker-approval step on an exchange here.
            //   risk_level   read by web-uk (routes/exchanges.js:131), which falls back
            //                to "unknown"; no risk-tag join exists here.
            ["prep_time"] = null,
            ["broker_notes"] = null,
            ["broker_id"] = null,
            ["risk_level"] = null,
        };
    }

    /// <summary>
    /// The <c>status_history</c> the React timeline card is built from
    /// (ExchangeDetailPage.tsx:124-135, 480). Laravel serves it from a dedicated
    /// `exchange_history` audit table.
    ///
    /// 🔴 THIS BACKEND HAS NO SUCH TABLE, and creating one is an EF migration this
    /// role does not own. So the list is DERIVED, and only ever from a timestamp that
    /// is actually stored — every entry corresponds to a column with a value in it.
    /// Nothing is inferred from a status alone.
    ///
    /// What that costs, stated rather than hidden: there is no AcceptedAt or
    /// DeclinedAt column, so `accepted` and `declined` entries cannot appear; there is
    /// no per-event actor or note column, so `notes` is always null and `actor_name`
    /// is only filled where the state machine leaves exactly one possible actor. A
    /// member therefore sees a shorter timeline here than against Laravel. Named gap.
    /// </summary>
    public static List<Dictionary<string, object?>> StatusHistory(Entities.Exchange e)
    {
        var entries = new List<(DateTime At, Dictionary<string, object?> Entry)>();

        void Add(DateTime? at, string action, string? newStatus, string? actorName, string? actorRole)
        {
            if (at is null) return;
            entries.Add((at.Value, new Dictionary<string, object?>
            {
                ["action"] = action,
                ["actor_role"] = actorRole,
                ["actor_name"] = actorName,
                ["old_status"] = null,
                ["new_status"] = newStatus,
                ["notes"] = null,
                ["created_at"] = Iso(at),
            }));
        }

        var requesterName = FullName(e.Initiator);
        var providerName = FullName(e.ListingOwner);

        Add(e.CreatedAt, "created", "pending_provider", requesterName, "requester");
        Add(e.StartedAt, "started", "in_progress", providerName, "provider");
        // Each party's own confirmation, attributable with certainty because the
        // column records which side confirmed.
        Add(e.RequesterConfirmedAt, "confirmed", "pending_confirmation", requesterName, "requester");
        Add(e.ProviderConfirmedAt, "confirmed", "pending_confirmation", providerName, "provider");
        // No column records who settled or who cancelled, so no actor is claimed.
        Add(e.CompletedAt, "completed", "completed", null, null);
        Add(e.CancelledAt, "cancelled", "cancelled", null, null);

        return entries.OrderBy(x => x.At).Select(x => x.Entry).ToList();
    }

    private static Dictionary<string, object?> Party(User? user, int id) => new()
    {
        ["id"] = id,
        // Laravel's `users.name` is a single column; this backend stores the two
        // halves, so `name` is composed. Both halves are also sent because the React
        // Exchange type declares them.
        ["name"] = FullName(user),
        ["first_name"] = NullIfBlank(user?.FirstName),
        ["last_name"] = NullIfBlank(user?.LastName),
        ["avatar"] = NullIfBlank(user?.AvatarUrl),
        ["avatar_url"] = NullIfBlank(user?.AvatarUrl),
    };

    private static string? FullName(User? user) => user is null
        ? null
        : NullIfBlank($"{user.FirstName} {user.LastName}".Trim());

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string? Iso(DateTime? value) => value is null
        ? null
        : new DateTimeOffset(DateTime.SpecifyKind(value.Value, DateTimeKind.Utc))
            .ToString("yyyy-MM-ddTHH:mm:sszzz");
}
