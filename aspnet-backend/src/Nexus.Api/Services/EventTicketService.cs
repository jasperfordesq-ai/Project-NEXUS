// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
namespace Nexus.Api.Services;

public sealed record EventTicketError(string Code, string Message, int Status, string? Field = null); public sealed record EventTicketResult(object? Data, EventTicketError? Error = null, int Status = 200) { public bool Succeeded => Error is null; }
public sealed class EventTicketService(NexusDbContext db)
{
    private static readonly HashSet<string> Kinds = ["free", "time_credit"], Actions = ["activate", "pause", "archive"];
    public async Task<EventTicketResult> Catalogue(int t, int e, int u, CancellationToken ct) { var c = await Context(t, e, u, false, ct); if (!c.Ok) return c.Error!; var types = await db.EventTicketTypes.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && (c.Manage || x.Status != "draft")).OrderBy(x => x.Id).ToListAsync(ct); var own = await db.EventTicketEntitlements.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e && x.UserId == u).OrderByDescending(x => x.Id).ToListAsync(ct); var projected = new List<object>(); foreach (var x in types) projected.Add(await Type(t, x, u, ct)); return new(new { contract_version = 1, event_id = e, currency = "time_credit", payment_gateway = new { free_supported = true, time_credit_supported = false, money_supported = false }, permissions = new { manage = c.Manage, reconcile = c.Manage, allocate_self = true }, ticket_types = projected, own_entitlements = own.Select(Entitlement) }); }
    public async Task<EventTicketResult> Quote(int t, int e, long id, int u, int units, CancellationToken ct) { if (units < 1 || units > 1000) return Validation("units"); var c = await Context(t, e, u, false, ct); if (!c.Ok) return c.Error!; var x = await db.EventTicketTypes.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(y => y.TenantId == t && y.EventId == e && y.Id == id, ct); if (x is null) return Missing(); return new(await QuoteProjection(t, x, u, units, ct)); }
    public async Task<EventTicketResult> Create(int t, int e, int u, JsonElement b, string key, CancellationToken ct) { if (!ValidKey(key)) return Validation("idempotency_key"); var p = Parse(b); if (p is null) return Validation("ticket_type"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var c = await Context(t, e, u, true, ct); if (!c.Ok) return c.Error!; if (p.Closes > c.Event!.StartsAt || p.Refund > c.Event.StartsAt) return Validation("sales_closes_at"); var kh = Hash(key); var replay = await db.EventTicketTypeHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.EventId != e || replay.Action != "created") return Conflict(); var old = await db.EventTicketTypes.IgnoreQueryFilters().SingleAsync(x => x.Id == replay.TicketTypeId, ct); await tx.CommitAsync(ct); return Mutation(await Type(t, old, u, ct), false, true, 200); } var x = New(t, c.Event, u, p); db.Add(x); await db.SaveChangesAsync(ct); db.Add(History(x, "created", u, kh, Hash(b.GetRawText()), null)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation(await Type(t, x, u, ct), true, false, 201); }
    public async Task<EventTicketResult> Update(int t, int e, long id, int u, long expected, JsonElement b, string key, CancellationToken ct) { if (!ValidKey(key) || expected < 1) return Validation("expected_version"); var p = Parse(b); if (p is null) return Validation("ticket_type"); await using var tx = await db.Database.BeginTransactionAsync(ct); await Lock(t, e, ct); var c = await Context(t, e, u, true, ct); if (!c.Ok) return c.Error!; var kh = Hash(key); var replay = await db.EventTicketTypeHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct); if (replay is not null) { if (replay.EventId != e || replay.TicketTypeId != id || replay.Action != "updated") return Conflict(); var old = await db.EventTicketTypes.IgnoreQueryFilters().SingleAsync(x => x.Id == id, ct); await tx.CommitAsync(ct); return Mutation(await Type(t, old, u, ct), false, true); } var x = await db.EventTicketTypes.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct); if (x is null) return Missing(); if (x.Version != expected || x.Status == "archived") return Conflict(); Apply(x, p, u); x.Version++; db.Add(History(x, "updated", u, kh, Hash(b.GetRawText()), null)); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return Mutation(await Type(t, x, u, ct), true, false); }
    public async Task<EventTicketResult> Transition(int t, int e, long id, int u, string action, long expected, string? reason, string key, CancellationToken ct)
    {
        if (!ValidKey(key) || !Actions.Contains(action) || expected < 1 || action is "pause" or "archive" && string.IsNullOrWhiteSpace(reason)) return Validation("transition");
        var historyAction = action switch { "activate" => "activated", "pause" => "paused", _ => "archived" };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var context = await Context(t, e, u, true, ct);
        if (!context.Ok) return context.Error!;
        var keyHash = Hash(key);
        var replay = await db.EventTicketTypeHistory.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.IdempotencyHash == keyHash, ct);
        if (replay is not null)
        {
            if (replay.TicketTypeId != id || replay.Action != historyAction) return Conflict();
            var old = await db.EventTicketTypes.IgnoreQueryFilters().SingleAsync(x => x.Id == id, ct);
            await tx.CommitAsync(ct);
            return Mutation(await Type(t, old, u, ct), false, true);
        }
        var type = await db.EventTicketTypes.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct);
        if (type is null) return Missing();
        if (type.Version != expected || type.Status == "archived" || action == "activate" && type.Status is not ("draft" or "paused") || action == "pause" && type.Status != "active") return Conflict();
        type.Version++;
        type.Status = action switch { "activate" => "active", "pause" => "paused", _ => "archived" };
        type.UpdatedBy = u;
        type.UpdatedAt = DateTime.UtcNow;
        if (action == "activate") { type.ActivatedBy ??= u; type.ActivatedAt ??= DateTime.UtcNow; }
        if (action == "pause") { type.PausedBy = u; type.PausedAt = DateTime.UtcNow; }
        if (action == "archive") { type.ArchivedBy = u; type.ArchivedAt = DateTime.UtcNow; }
        db.Add(History(type, historyAction, u, keyHash, Hash(new { action, expected, reason }), Clean(reason)));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Mutation(await Type(t, type, u, ct), true, false);
    }
    public Task<EventTicketResult> AllocateSelf(int t, int e, long type, int u, int units, string key, CancellationToken ct) => Allocate(t, e, type, u, u, units, key, false, ct); public Task<EventTicketResult> AllocateMember(int t, int e, long type, int target, int actor, int units, string key, CancellationToken ct) => Allocate(t, e, type, target, actor, units, key, true, ct);
    private async Task<EventTicketResult> Allocate(int t, int e, long typeId, int target, int actor, int units, string key, bool manager, CancellationToken ct)
    {
        if (!ValidKey(key) || units < 1 || units > 1000) return Validation("units");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var c = await Context(t, e, actor, manager, ct);
        if (!c.Ok) return c.Error!;
        var kh = Hash(key);
        var replay = await db.EventTicketEntitlements.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.AllocationIdempotencyHash == kh, ct);
        if (replay is not null)
        {
            if (replay.EventId != e || replay.TicketTypeId != typeId || replay.UserId != target || replay.Units != units) return Conflict();
            await tx.CommitAsync(ct);
            return EntitlementMutation(replay, await Confirmed(t, typeId, ct), false, true, 200);
        }
        var type = await db.EventTicketTypes.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == typeId, ct);
        if (type is null) return Missing();
        if (type.Kind == "time_credit") return Unavailable();
        if (type.Status != "active" || DateTime.UtcNow < type.SalesOpensAt || DateTime.UtcNow >= type.SalesClosesAt) return Conflict();
        var registration = await db.EventRegistrations.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.UserId == target && x.RegistrationState == "confirmed", ct);
        if (registration is null) return Conflict();
        var total = await Confirmed(t, typeId, ct);
        var member = await db.EventTicketEntitlements.IgnoreQueryFilters().Where(x => x.TenantId == t && x.TicketTypeId == typeId && x.UserId == target && x.Status == "confirmed").SumAsync(x => (int?)x.Units, ct) ?? 0;
        if (total + units > type.AllocationLimit || member + units > type.PerMemberLimit) return Conflict();
        var requestHash = Hash(new { typeId, target, units });
        var entitlement = new EventTicketEntitlement { TenantId = t, EventId = e, TicketTypeId = typeId, RegistrationId = registration.Id, UserId = target, Units = units, TicketKindSnapshot = type.Kind, UnitPriceCreditsSnapshot = type.UnitPriceCredits, TotalPriceCreditsSnapshot = type.UnitPriceCredits * units, CreatedBy = actor, AllocationIdempotencyHash = kh, AllocationRequestHash = requestHash };
        db.Add(entitlement);
        await db.SaveChangesAsync(ct);
        db.Add(EntHistory(entitlement, "confirmed", actor, kh, requestHash, null));
        db.Add(new EventTicketInventoryHistory { TenantId = t, EventId = e, TicketTypeId = typeId, EntitlementId = entitlement.Id, EntitlementVersion = 1, Action = "allocated", QuantityDelta = units, ConfirmedUnitsAfter = total + units, ActorUserId = actor, IdempotencyHash = Hash("inventory:" + key), RequestHash = requestHash });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return EntitlementMutation(entitlement, total + units, true, false, 201);
    }
    public async Task<EventTicketResult> Cancel(int t, int e, long id, int u, long expected, string? reason, string key, CancellationToken ct)
    {
        reason = Clean(reason);
        if (!ValidKey(key) || expected < 1 || reason is null) return Validation("reason");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Lock(t, e, ct);
        var c = await Context(t, e, u, false, ct);
        if (!c.Ok) return c.Error!;
        var entitlement = await db.EventTicketEntitlements.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.EventId == e && x.Id == id, ct);
        if (entitlement is null) return Missing();
        if (entitlement.UserId != u && !c.Manage) return Forbidden();
        var kh = Hash(key);
        var replay = await db.EventTicketEntitlementHistory.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.IdempotencyHash == kh, ct);
        if (!replay)
        {
            if (entitlement.Version != expected || entitlement.Status != "confirmed") return Conflict();
            var before = await Confirmed(t, entitlement.TicketTypeId, ct);
            entitlement.Status = "cancelled";
            entitlement.Version++;
            entitlement.CancelledBy = u;
            entitlement.CancellationReason = reason;
            entitlement.CancelledAt = DateTime.UtcNow;
            entitlement.UpdatedAt = DateTime.UtcNow;
            var requestHash = Hash(new { expected, reason });
            db.Add(EntHistory(entitlement, "cancelled", u, kh, requestHash, reason));
            db.Add(new EventTicketInventoryHistory { TenantId = t, EventId = e, TicketTypeId = entitlement.TicketTypeId, EntitlementId = entitlement.Id, EntitlementVersion = entitlement.Version, Action = "released", QuantityDelta = -entitlement.Units, ConfirmedUnitsAfter = Math.Max(0, before - entitlement.Units), ActorUserId = u, IdempotencyHash = Hash("inventory:" + key), RequestHash = requestHash });
            await db.SaveChangesAsync(ct);
        }
        await tx.CommitAsync(ct);
        return EntitlementMutation(entitlement, await Confirmed(t, entitlement.TicketTypeId, ct), !replay, replay);
    }
    public async Task<EventTicketResult> Reconcile(int t, int e, int u, CancellationToken ct) { var c = await Context(t, e, u, true, ct); if (!c.Ok) return c.Error!; var types = await db.EventTicketTypes.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == t && x.EventId == e).ToListAsync(ct); var rows = new List<object>(); foreach (var x in types) { var ents = await db.EventTicketEntitlements.IgnoreQueryFilters().AsNoTracking().Where(y => y.TenantId == t && y.TicketTypeId == x.Id).ToListAsync(ct); var confirmed = ents.Where(y => y.Status == "confirmed").Sum(y => y.Units); var cancelled = ents.Where(y => y.Status == "cancelled").Sum(y => y.Units); var latest = await db.EventTicketInventoryHistory.IgnoreQueryFilters().Where(y => y.TenantId == t && y.TicketTypeId == x.Id).OrderByDescending(y => y.Id).Select(y => (int?)y.ConfirmedUnitsAfter).FirstOrDefaultAsync(ct) ?? 0; var regIds = ents.Select(y => y.RegistrationId).ToArray(); var valid = await db.EventRegistrations.IgnoreQueryFilters().CountAsync(y => y.TenantId == t && y.EventId == e && regIds.Contains(y.Id), ct); var price = ents.Count(y => y.TicketKindSnapshot != "free" || y.UnitPriceCreditsSnapshot != 0 || y.TotalPriceCreditsSnapshot != 0); rows.Add(new { ticket_type_id = x.Id, kind = x.Kind, status = x.Status, allocation_limit = x.AllocationLimit, confirmed_units = confirmed, cancelled_units = cancelled, confirmed_entitlements = ents.Count(y => y.Status == "confirmed"), cancelled_entitlements = ents.Count(y => y.Status == "cancelled"), registration_mismatches = ents.Count - valid, price_snapshot_violations = price, inventory_delta = latest - confirmed, latest_inventory_after = latest, allocation_overrun = confirmed > x.AllocationLimit, inventory_mismatch = latest != confirmed }); } return new(new { event_id = e, read_only = true, ticket_types = rows }); }
    private async Task<object> Type(int t, EventTicketType x, int u, CancellationToken ct) => new { id = x.Id, version = x.Version, name = x.Name, description = x.Description, kind = x.Kind, unit_price_credits = Money(x.UnitPriceCredits), allocation_limit = x.AllocationLimit, sales_opens_at = IsoN(x.SalesOpensAt), sales_closes_at = IsoN(x.SalesClosesAt), per_member_limit = x.PerMemberLimit, refund_cutoff_at = IsoN(x.RefundCutoffAt), organizer_cancel_refundable = x.OrganizerCancelRefundable, status = x.Status, availability = await Availability(t, x, u, ct), eligibility_policy = JsonSerializer.Deserialize<object>(x.EligibilityPolicy) }; private async Task<object> QuoteProjection(int t, EventTicketType x, int u, int units, CancellationToken ct) => new { ticket_type_id = x.Id, kind = x.Kind, units, unit_price_credits = Money(x.UnitPriceCredits), total_price_credits = Money(x.UnitPriceCredits * units), status = x.Status, eligibility = new { eligible = true, reasons = Array.Empty<string>() }, allocation_remaining = Math.Max(0, x.AllocationLimit - await Confirmed(t, x.Id, ct)), member_remaining = Math.Max(0, x.PerMemberLimit - (await db.EventTicketEntitlements.IgnoreQueryFilters().Where(y => y.TenantId == t && y.TicketTypeId == x.Id && y.UserId == u && y.Status == "confirmed").SumAsync(y => (int?)y.Units, ct) ?? 0)), sales_window_open = DateTime.UtcNow >= x.SalesOpensAt && DateTime.UtcNow < x.SalesClosesAt, materialization_supported = x.Kind == "free", gateway_status = x.Kind == "free" ? "available" : "unavailable", attendance_reward_included = false, refund_policy = new { cutoff_at = IsoN(x.RefundCutoffAt), organizer_cancel_refundable = x.OrganizerCancelRefundable, execution_status = "manual" } }; private async Task<object> Availability(int t, EventTicketType x, int u, CancellationToken ct) { var q = await QuoteProjection(t, x, u, 1, ct); var json = JsonSerializer.SerializeToElement(q); return new { eligibility = json.GetProperty("eligibility"), allocation_remaining = json.GetProperty("allocation_remaining").GetInt32(), member_remaining = json.GetProperty("member_remaining").GetInt32(), sales_window_open = json.GetProperty("sales_window_open").GetBoolean(), materialization_supported = json.GetProperty("materialization_supported").GetBoolean(), gateway_status = json.GetProperty("gateway_status").GetString()!, attendance_reward_included = false, refund_policy = json.GetProperty("refund_policy") }; }
    private async Task<int> Confirmed(int t, long id, CancellationToken ct) => await db.EventTicketEntitlements.IgnoreQueryFilters().Where(x => x.TenantId == t && x.TicketTypeId == id && x.Status == "confirmed").SumAsync(x => (int?)x.Units, ct) ?? 0; private async Task<(bool Ok, Event? Event, User? Actor, bool Manage, EventTicketResult? Error)> Context(int t, int e, int u, bool manage, CancellationToken ct) { var evt = await db.Events.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == t && x.Id == e, ct); if (evt is null) return (false, null, null, false, Missing()); var actor = await db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(x => x.TenantId == t && x.Id == u && x.IsActive, ct); if (actor is null) return (false, evt, null, false, Missing()); var can = IsAdmin(actor) || evt.CreatedById == u || await db.EventStaffAssignments.IgnoreQueryFilters().AnyAsync(x => x.TenantId == t && x.EventId == e && x.UserId == u && x.Status == "active" && (x.Role == "event_manager" || x.Role == "finance" || x.Role == "co_organizer"), ct); if (manage && !can) return (false, evt, actor, false, Forbidden()); return (true, evt, actor, can, null); }
    private sealed record Input(string Name, string? Description, string Kind, decimal Price, int Allocation, DateTime Opens, DateTime Closes, int PerMember, string Policy, DateTime? Refund, bool Refundable); private static Input? Parse(JsonElement b) { var name = Clean(Text(b, "name"), 191); var kind = Text(b, "kind") ?? ""; if (name is null || !Kinds.Contains(kind) || !decimal.TryParse(Text(b, "unit_price_credits"), out var price) || kind == "free" && price != 0 || kind == "time_credit" && (price <= 0 || price > 100000) || !Int(b, "allocation_limit", out var allocation) || allocation < 1 || allocation > 1000000 || !Int(b, "per_member_limit", out var per) || per < 1 || per > 1000 || per > allocation || !Date(b, "sales_opens_at", out var opens) || !Date(b, "sales_closes_at", out var closes) || opens >= closes) return null; var policy = b.TryGetProperty("eligibility_policy", out var p) && p.ValueKind == JsonValueKind.Object ? p.GetRawText() : "{}"; DateTime? refund = null; if (b.TryGetProperty("refund_cutoff_at", out var r) && r.ValueKind != JsonValueKind.Null) { if (!DateTimeOffset.TryParse(r.GetString(), out var rd)) return null; refund = rd.UtcDateTime; } return new(name, Clean(Text(b, "description")), kind, price, allocation, opens, closes, per, policy, refund, Bool(b, "organizer_cancel_refundable")); }
    private static EventTicketType New(int t, Event e, int u, Input p) { var x = new EventTicketType { TenantId = t, EventId = e.Id, OccurrenceKey = $"event:{e.Id}", EventStartsAtSnapshot = e.StartsAt, EventTimezoneSnapshot = e.Timezone, CreatedBy = u }; Apply(x, p, u); return x; }
    private static void Apply(EventTicketType x, Input p, int u) { x.Name = p.Name; x.Description = p.Description; x.Kind = p.Kind; x.UnitPriceCredits = p.Price; x.AllocationLimit = p.Allocation; x.SalesOpensAt = p.Opens; x.SalesClosesAt = p.Closes; x.PerMemberLimit = p.PerMember; x.EligibilityPolicy = p.Policy; x.RefundCutoffAt = p.Refund; x.OrganizerCancelRefundable = p.Refundable; x.UpdatedBy = u; x.UpdatedAt = DateTime.UtcNow; }
    private static EventTicketTypeHistory History(EventTicketType x, string a, int u, string k, string h, string? r) => new() { TenantId = x.TenantId, EventId = x.EventId, TicketTypeId = x.Id, TicketVersion = x.Version, Action = a, ActorUserId = u, IdempotencyHash = k, RequestHash = h, Reason = r, ChangedFields = JsonSerializer.Serialize(x) }; private static EventTicketEntitlementHistory EntHistory(EventTicketEntitlement x, string a, int u, string k, string h, string? r) => new() { TenantId = x.TenantId, EventId = x.EventId, EntitlementId = x.Id, TicketTypeId = x.TicketTypeId, RegistrationId = x.RegistrationId, UserId = x.UserId, EntitlementVersion = x.Version, Action = a, Units = x.Units, TicketKindSnapshot = x.TicketKindSnapshot, UnitPriceCreditsSnapshot = x.UnitPriceCreditsSnapshot, TotalPriceCreditsSnapshot = x.TotalPriceCreditsSnapshot, ActorUserId = u, IdempotencyHash = k, RequestHash = h, Reason = r, Metadata = "{}" }; private static object Entitlement(EventTicketEntitlement x) => new { id = x.Id, ticket_type_id = x.TicketTypeId, units = x.Units, kind = x.TicketKindSnapshot, unit_price_credits = Money(x.UnitPriceCreditsSnapshot), total_price_credits = Money(x.TotalPriceCreditsSnapshot), status = x.Status, version = x.Version, confirmed_at = IsoN(x.ConfirmedAt), cancelled_at = IsoN(x.CancelledAt) }; private static EventTicketResult Mutation(object x, bool changed, bool replay, int status = 200) => new(new { ticket_type = x, changed, idempotent_replay = replay }, Status: status); private static EventTicketResult EntitlementMutation(EventTicketEntitlement x, int units, bool changed, bool replay, int status = 200) => new(new { entitlement = Entitlement(x), confirmed_units_after = units, changed, idempotent_replay = replay }, Status: status);
    private Task Lock(int t, int e, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({t}, {e})", ct); private static bool IsAdmin(User u) => u.IsAdmin || u.IsSuperAdmin || u.IsTenantSuperAdmin || u.IsGod || u.Role is "admin" or "super_admin" or "god"; private static bool ValidKey(string x) => !string.IsNullOrWhiteSpace(x) && x.Trim().Length <= 191; private static string Hash(string x) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(x))).ToLowerInvariant(); private static string Hash(object x) => Hash(JsonSerializer.Serialize(x)); private static string Money(decimal x) => x.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture); private static string? IsoN(DateTime? x) => x?.ToUniversalTime().ToString("O"); private static string? Text(JsonElement x, string n) => x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null; private static bool Int(JsonElement x, string n, out int v) { v = 0; return x.TryGetProperty(n, out var p) && p.TryGetInt32(out v); }
    private static bool Date(JsonElement x, string n, out DateTime v) { v = default; return DateTimeOffset.TryParse(Text(x, n), out var d) && (v = d.UtcDateTime) != default; }
    private static bool Bool(JsonElement x, string n) => x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.True; private static string? Clean(string? x, int max = 500) { if (string.IsNullOrWhiteSpace(x)) return null; var v = Regex.Replace(x, "<[^>]*>", "").Trim(); return v.Length <= max ? v : null; }
    private static EventTicketResult Missing() => new(null, new("EVENT_TICKET_NOT_FOUND", "Ticket resource not found", 404)); private static EventTicketResult Forbidden() => new(null, new("EVENT_TICKET_FORBIDDEN", "Forbidden", 403)); private static EventTicketResult Conflict() => new(null, new("EVENT_TICKET_CONFLICT", "Inventory or version conflict", 409)); private static EventTicketResult Validation(string f) => new(null, new("EVENT_TICKET_VALIDATION_FAILED", "Validation failed", 422, f)); private static EventTicketResult Unavailable() => new(null, new("EVENT_TICKET_UNAVAILABLE", "Time-credit materialization unavailable", 503));
}
