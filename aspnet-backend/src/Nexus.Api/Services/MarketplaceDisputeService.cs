// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record MarketplaceDisputeError(string Code, string Message, int Status, string? Field = null);
public sealed record MarketplaceDisputeResult(object? Data, MarketplaceDisputeError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}

public sealed class MarketplaceDisputeService(NexusDbContext db, MarketplacePaymentService? payments = null)
{
    private static readonly HashSet<string> Reasons = ["not_received", "not_as_described", "damaged", "wrong_item", "other"];
    private static readonly HashSet<string> Resolutions = ["buyer", "seller", "closed"];
    private static readonly string[] ActiveStatuses = ["open", "under_review", "escalated"];
    private static readonly string[] DisputableOrderStatuses = ["paid", "processing", "shipped", "delivered", "completed"];

    public async Task<MarketplaceDisputeResult> OpenAsync(int tenant, int actorId, int orderId, string? reason, string? description, IReadOnlyCollection<string>? evidenceUrls, CancellationToken ct)
    {
        reason = reason?.Trim().ToLowerInvariant(); description = description?.Trim();
        if (reason is null || !Reasons.Contains(reason)) return Validation("reason");
        if (string.IsNullOrWhiteSpace(description) || description.Length > 5000) return Validation("description");
        if (evidenceUrls is { Count: > 10 } || evidenceUrls?.Any(x => !SafeUrl(x)) == true) return Validation("evidence_urls");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, orderId, ct);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == orderId, ct);
        if (order is null) return Missing();
        if (actorId != order.BuyerUserId && actorId != order.SellerUserId) return Forbidden();
        if (!DisputableOrderStatuses.Contains(order.Status)) return new(null, new("VALIDATION_ERROR", "Order cannot be disputed in its current state", 422, "status"));
        if (await db.MarketplaceDisputes.IgnoreQueryFilters().AnyAsync(x => x.TenantId == tenant && x.MarketplaceOrderId == orderId && ActiveStatuses.Contains(x.Status), ct))
            return new(null, new("VALIDATION_ERROR", "An active dispute already exists", 422, "order_id"));
        var now = DateTime.UtcNow;
        var dispute = new MarketplaceDispute { TenantId = tenant, MarketplaceOrderId = orderId, OpenedByUserId = actorId, Reason = reason, Description = description, EvidenceUrlsJson = evidenceUrls is { Count: > 0 } ? JsonSerializer.Serialize(evidenceUrls) : null, Status = "open", PriorOrderStatus = order.Status, CreatedAt = now, UpdatedAt = now };
        order.Status = "disputed"; order.UpdatedAt = now; db.MarketplaceDisputes.Add(dispute);
        var escrow = await db.MarketplaceEscrows.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenant && x.MarketplaceOrderId == orderId, ct);
        if (escrow is { Status: "held" })
        {
            escrow.Status = "disputed";
            escrow.UpdatedAt = now;
        }
        await db.SaveChangesAsync(ct);
        Notify(tenant, actorId, "marketplace_dispute_opened", "Marketplace dispute opened", orderId, dispute.Id);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(Map(dispute, order, null, null, null), Status: 201);
    }

    public async Task<MarketplaceDisputeResult> AdminListAsync(int tenant, string? status, int page, int perPage, CancellationToken ct)
    {
        page = Math.Max(1, page); perPage = Math.Clamp(perPage, 1, 100);
        var query = db.MarketplaceDisputes.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant);
        query = string.IsNullOrWhiteSpace(status) ? query.Where(x => ActiveStatuses.Contains(x.Status)) : query.Where(x => x.Status == status.Trim());
        var total = await query.CountAsync(ct);
        var disputes = await query.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).Skip((page - 1) * perPage).Take(perPage).ToListAsync(ct);
        var orderIds = disputes.Select(x => x.MarketplaceOrderId).Distinct().ToArray();
        var orders = await db.MarketplaceOrders.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && orderIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var listingIds = orders.Values.Select(x => x.MarketplaceListingId).Distinct().ToArray();
        var listings = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && listingIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var userIds = disputes.Select(x => x.OpenedByUserId).Concat(orders.Values.SelectMany(x => new[] { x.BuyerUserId, x.SellerUserId })).Distinct().ToArray();
        var users = await db.Users.IgnoreQueryFilters().AsNoTracking().Where(x => x.TenantId == tenant && userIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        var items = disputes.Select(x => { orders.TryGetValue(x.MarketplaceOrderId, out var order); MarketplaceListing? listing = null; User? buyer = null; User? seller = null; User? opener = null; if (order is not null) { listings.TryGetValue(order.MarketplaceListingId, out listing); users.TryGetValue(order.BuyerUserId, out buyer); users.TryGetValue(order.SellerUserId, out seller); } users.TryGetValue(x.OpenedByUserId, out opener); return Map(x, order, listing, buyer, seller, opener); }).ToArray();
        return new(new { items, total, page, per_page = perPage });
    }

    public async Task<MarketplaceDisputeResult> ResolveAsync(int tenant, int adminId, long disputeId, string? resolution, string? notes, decimal? refundAmount, CancellationToken ct)
    {
        resolution = resolution?.Trim().ToLowerInvariant(); notes = notes?.Trim();
        if (resolution is null || !Resolutions.Contains(resolution)) return Validation("resolution");
        if (string.IsNullOrWhiteSpace(notes) || notes.Length > 5000) return Validation("resolution_notes");
        if (refundAmount is <= 0) return Validation("refund_amount");
        if (resolution != "buyer" && refundAmount is not null) return Validation("refund_amount");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Lock(tenant, unchecked((int)(disputeId % int.MaxValue)), ct);
        var dispute = await db.MarketplaceDisputes.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == disputeId, ct);
        if (dispute is null) return Missing();
        if (!ActiveStatuses.Contains(dispute.Status)) return new(null, new("VALIDATION_ERROR", "Dispute is already resolved", 422, "status"));
        await Lock(tenant, dispute.MarketplaceOrderId, ct);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == dispute.MarketplaceOrderId, ct);
        if (order is null) return new(null, new("RESOLUTION_FAILED", "Marketplace order not found", 409));

        decimal? settledRefund = null;
        if (resolution == "buyer")
        {
            if (order.WalletTransactionId is int originalId)
            {
                var original = await db.Transactions.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == originalId, ct);
                if (original is null || original.SenderId != order.BuyerUserId || original.ReceiverId != order.SellerUserId || original.Status != TransactionStatus.Completed)
                    return new(null, new("RESOLUTION_FAILED", "Original wallet settlement evidence is unavailable", 409));
                var full = decimal.Round(order.TimeCreditTotal ?? original.Amount, 2);
                if (refundAmount is not null && Math.Abs(refundAmount.Value - full) > 0.005m) return new(null, new("VALIDATION_ERROR", "Time-credit disputes require a full refund", 422, "refund_amount"));
                if (order.WalletRefundTransactionId is not null) return new(null, new("VALIDATION_ERROR", "Order was already refunded", 422, "status"));
                var reversal = new Transaction { TenantId = tenant, SenderId = order.SellerUserId, ReceiverId = order.BuyerUserId, Amount = full, Description = notes, TransactionType = "marketplace_refund", Status = TransactionStatus.Completed, CreatedAt = DateTime.UtcNow };
                db.Transactions.Add(reversal); await db.SaveChangesAsync(ct); order.WalletRefundTransactionId = reversal.Id; settledRefund = full;
            }
            else if ((order.TotalAmount ?? 0) > 0)
            {
                if (payments is null)
                    return new(null, new("RESOLUTION_FAILED", "Fiat refund provider settlement is unavailable", 409));
                var refund = await payments.ProcessRefundAsync(tenant, order.Id, refundAmount, notes, ct);
                if (!refund.Succeeded)
                    return new(null, new(
                        refund.Error!.Code == "VALIDATION_ERROR" ? "VALIDATION_ERROR" : "RESOLUTION_FAILED",
                        refund.Error.Message,
                        refund.Error.Code == "VALIDATION_ERROR" ? 422 : 409,
                        refund.Error.Field));
                settledRefund = refundAmount ?? order.TotalAmount;
            }
            else settledRefund = 0m;
            if (order.Status != "refunded") await RestoreInventory(order, tenant, ct);
            order.Status = "refunded";
        }
        else if (order.Status == "disputed") order.Status = string.IsNullOrWhiteSpace(dispute.PriorOrderStatus) ? "paid" : dispute.PriorOrderStatus;

        if (resolution != "buyer")
        {
            var escrow = await db.MarketplaceEscrows.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == tenant && x.MarketplaceOrderId == order.Id, ct);
            if (escrow is { Status: "disputed" })
            {
                escrow.Status = "held";
                escrow.ReleaseAfter = DateTime.UtcNow;
                escrow.UpdatedAt = DateTime.UtcNow;
            }
        }

        var now = DateTime.UtcNow;
        dispute.Status = resolution switch { "buyer" => "resolved_buyer", "seller" => "resolved_seller", _ => "closed" };
        dispute.ResolutionNotes = notes; dispute.ResolvedByUserId = adminId; dispute.ResolvedAt = now; dispute.RefundAmount = resolution == "buyer" ? settledRefund : null; dispute.UpdatedAt = now; order.UpdatedAt = now;
        Notify(tenant, order.BuyerUserId, "marketplace_dispute_resolved", "Marketplace dispute resolved", order.Id, dispute.Id);
        if (order.SellerUserId != order.BuyerUserId) Notify(tenant, order.SellerUserId, "marketplace_dispute_resolved", "Marketplace dispute resolved", order.Id, dispute.Id);
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return new(new { message = "Dispute resolved", status = dispute.Status });
    }

    private async Task RestoreInventory(MarketplaceOrder order, int tenant, CancellationToken ct)
    {
        var listing = await db.MarketplaceListings.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenant && x.Id == order.MarketplaceListingId, ct);
        if (listing is null) return;
        listing.Quantity = checked(listing.Quantity + Math.Max(1, order.Quantity)); listing.Status = "active"; listing.MarketplaceStatus = "available"; listing.UpdatedAt = DateTime.UtcNow;
    }

    private static object Map(MarketplaceDispute dispute, MarketplaceOrder? order, MarketplaceListing? listing, User? buyer, User? seller, User? opener = null) => new
    {
        id = dispute.Id, order_id = dispute.MarketplaceOrderId, reason = dispute.Reason, description = dispute.Description, evidence_urls = ParseUrls(dispute.EvidenceUrlsJson), status = dispute.Status, prior_order_status = dispute.PriorOrderStatus, resolution_notes = dispute.ResolutionNotes, refund_amount = dispute.RefundAmount, created_at = Iso(dispute.CreatedAt), resolved_at = Iso(dispute.ResolvedAt),
        opened_by = opener is null ? null : new { id = opener.Id, name = Name(opener), avatar_url = opener.AvatarUrl },
        order = order is null ? null : new { id = order.Id, order_number = $"MP-{order.Id:D8}", total_price = order.TotalAmount, time_credits_used = order.TimeCreditTotal, currency = order.Currency, status = order.Status, listing = listing is null ? null : new { id = listing.Id, title = listing.Title }, buyer = Person(buyer), seller = Person(seller) }
    };
    private static object? Person(User? user) => user is null ? null : new { id = user.Id, name = Name(user), avatar_url = user.AvatarUrl };
    private static string Name(User user) => string.Join(' ', new[] { user.FirstName, user.LastName }.Where(x => !string.IsNullOrWhiteSpace(x)));
    private static string? Iso(DateTime? value) => value?.ToUniversalTime().ToString("O");
    private static string[]? ParseUrls(string? json) { try { return string.IsNullOrWhiteSpace(json) ? null : JsonSerializer.Deserialize<string[]>(json); } catch { return null; } }
    private static bool SafeUrl(string value) => value.Length <= 2000 && Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && string.IsNullOrEmpty(uri.UserInfo);
    private Task Lock(int tenant, int id, CancellationToken ct) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenant}, {id})", ct);
    private void Notify(int tenant, int userId, string type, string title, int orderId, long disputeId) => db.Notifications.Add(new Notification { TenantId = tenant, UserId = userId, Type = type, Title = title, Link = $"/marketplace/orders/{orderId}", Data = JsonSerializer.Serialize(new { marketplace_dispute_id = disputeId, marketplace_order_id = orderId }) });
    private static MarketplaceDisputeResult Validation(string field) => new(null, new("VALIDATION_ERROR", "Validation failed", 422, field));
    private static MarketplaceDisputeResult Missing() => new(null, new("NOT_FOUND", "Marketplace dispute not found", 404));
    private static MarketplaceDisputeResult Forbidden() => new(null, new("FORBIDDEN", "You cannot dispute this order", 403));
}
