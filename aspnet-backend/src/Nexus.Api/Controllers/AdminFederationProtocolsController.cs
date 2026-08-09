// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services.Federation;

namespace Nexus.Api.Controllers;

/// <summary>
/// Phase 68 — admin endpoints for the federation protocol layer
/// (CreditCommons, Komunitin, native ingest, hour transfer reconciliation).
/// </summary>
[ApiController]
[Route("api/admin/federation/protocols")]
[Authorize(Policy = "AdminOnly")]
public class AdminFederationProtocolsController : ControllerBase
{
    private static readonly bool DurableFederationTransferSagaAvailable = false;
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly CreditCommonsClient _cc;
    private readonly KomunitinClient _komunitin;
    private readonly NativeIngestService _native;
    private readonly HourTransferReconciliationService _reconcile;

    public AdminFederationProtocolsController(
        NexusDbContext db,
        TenantContext tenant,
        CreditCommonsClient cc,
        KomunitinClient komunitin,
        NativeIngestService native,
        HourTransferReconciliationService reconcile)
    {
        _db = db;
        _tenant = tenant;
        _cc = cc;
        _komunitin = komunitin;
        _native = native;
        _reconcile = reconcile;
    }

    /// <summary>POST .../partners/{id}/ping/{protocol} — connectivity check.</summary>
    [HttpPost("partners/{partnerId:int}/ping/{protocol}")]
    public async Task<IActionResult> Ping(int partnerId, string protocol, CancellationToken ct)
    {
        var endpoint = await ResolvePartnerSettingAsync(partnerId, "endpoint", ct);
        if (string.IsNullOrWhiteSpace(endpoint))
            return NotFound(new { error = "partner_endpoint_not_configured" });

        var ok = protocol switch
        {
            "credit-commons" => await _cc.PingAsync(endpoint, ct),
            "komunitin" => await _komunitin.PingAsync(endpoint, ct),
            _ => false
        };
        return Ok(new { reachable = ok, partner_id = partnerId, protocol, endpoint });
    }

    /// <summary>
    /// POST .../transfers — create a new outbound federated hour transfer for
    /// reconciliation by the cron. Tenants drive transfers from this endpoint;
    /// the cron walks them through Sent → Acknowledged → Reconciled.
    /// </summary>
    [HttpPost("transfers")]
    public async Task<IActionResult> CreateTransfer([FromBody] CreateTransferRequest req, CancellationToken ct)
    {
        if (!DurableFederationTransferSagaAvailable)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "federation_settlement_unavailable"
            });
        }

        if (req.LocalUserId <= 0) return BadRequest(new { error = "local_user_id_required" });
        if (req.PartnerId <= 0) return BadRequest(new { error = "partner_id_required" });
        if (req.Amount <= 0) return BadRequest(new { error = "amount_must_be_positive" });
        if (req.Protocol is not ("credit-commons" or "komunitin" or "native"))
            return BadRequest(new { error = "unknown_protocol" });

        var partner = await _db.FederationPartners.FirstOrDefaultAsync(p => p.Id == req.PartnerId, ct);
        if (partner == null) return NotFound(new { error = "partner_not_found" });

        var entity = new FederatedHourTransfer
        {
            TenantId = _tenant.GetTenantIdOrThrow(),
            PartnerId = req.PartnerId,
            Direction = FederatedTransferDirection.Outbound,
            LocalUserId = req.LocalUserId,
            RemoteUserExternalId = req.RemoteUserExternalId,
            RemoteUserDisplayName = req.RemoteUserDisplayName,
            Amount = req.Amount,
            Protocol = req.Protocol,
            Description = req.Description,
            Status = FederatedTransferStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.FederatedHourTransfers.Add(entity);
        await _db.SaveChangesAsync(ct);
        return Created($"/api/admin/federation/protocols/transfers/{entity.Id}", new { data = MapTransfer(entity) });
    }

    /// <summary>GET .../transfers — list federated hour transfers (filterable by status).</summary>
    [HttpGet("transfers")]
    public async Task<IActionResult> ListTransfers([FromQuery] string? status = null)
    {
        var q = _db.FederatedHourTransfers.AsQueryable();
        if (Enum.TryParse<FederatedTransferStatus>(status, true, out var s))
            q = q.Where(t => t.Status == s);
        var rows = await q.OrderByDescending(t => t.CreatedAt).Take(200).ToListAsync();
        return Ok(new { data = rows.Select(MapTransfer), total = rows.Count });
    }

    /// <summary>
    /// GET .../transfers/failed — last 100 transfers in terminal Failed state,
    /// ordered by most-recent UpdatedAt. Gives ops a surface for the
    /// max-retries-exceeded path that previously only logged a warning.
    /// </summary>
    [HttpGet("transfers/failed")]
    public async Task<IActionResult> ListFailedTransfers(CancellationToken ct)
    {
        var rows = await _db.FederatedHourTransfers
            .Where(t => t.Status == FederatedTransferStatus.Failed)
            .OrderByDescending(t => t.UpdatedAt ?? t.CreatedAt)
            .Take(100)
            .ToListAsync(ct);
        return Ok(new { data = rows.Select(MapTransfer), total = rows.Count });
    }

    /// <summary>GET .../transfers/{id} — single transfer detail.</summary>
    [HttpGet("transfers/{id:int}")]
    public async Task<IActionResult> GetTransfer(int id)
    {
        var entity = await _db.FederatedHourTransfers.FirstOrDefaultAsync(t => t.Id == id);
        return entity == null ? NotFound() : Ok(new { data = MapTransfer(entity) });
    }

    /// <summary>POST .../transfers/{id}/cancel — abort a pristine local pending transfer.</summary>
    [HttpPost("transfers/{id:int}/cancel")]
    public async Task<IActionResult> CancelTransfer(int id, CancellationToken ct)
    {
        var entity = await _db.FederatedHourTransfers.FirstOrDefaultAsync(t => t.Id == id);
        if (entity == null) return NotFound();
        if (entity.Status is FederatedTransferStatus.Reconciled
            or FederatedTransferStatus.Cancelled
            or FederatedTransferStatus.Rejected)
            return BadRequest(new { error = "transfer_already_terminal" });

        // Only a transfer that has never left the local pending state can be
        // cancelled without compensating the remote system. Once a send may
        // have occurred, a best-effort remote call is not enough evidence to
        // mark the local row cancelled.
        if (entity.Status != FederatedTransferStatus.Pending
            || !string.IsNullOrWhiteSpace(entity.ExternalReference)
            || entity.LocalTransactionId.HasValue
            || entity.LastReconcileAttemptAt.HasValue
            || entity.ReconciledAt.HasValue
            || entity.RetryCount > 0)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "federation_cancellation_unavailable"
            });
        }

        entity.Status = FederatedTransferStatus.Cancelled;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { data = MapTransfer(entity) });
    }

    /// <summary>POST .../transfers/reconcile — manual trigger of the reconciliation tick.</summary>
    [HttpPost("transfers/reconcile")]
    public async Task<IActionResult> ReconcileNow([FromQuery] int batchSize = 25, CancellationToken ct = default)
    {
        if (!DurableFederationTransferSagaAvailable)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "federation_settlement_unavailable"
            });
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var result = await _reconcile.ReconcileTenantAsync(tenantId, Math.Clamp(batchSize, 1, 200), ct);
        return Ok(new { data = result });
    }

    /// <summary>
    /// POST .../ingest/listings — accept an inbound listing payload from a
    /// federation partner. Body: { partner_tenant_id, listing: {...} }.
    /// </summary>
    [HttpPost("ingest/listings")]
    public async Task<IActionResult> IngestListing([FromBody] JsonElement body, CancellationToken ct)
    {
        if (!body.TryGetProperty("partner_tenant_id", out var pt) || !pt.TryGetInt32(out var partnerTenantId))
            return BadRequest(new { error = "partner_tenant_id_required" });
        if (!body.TryGetProperty("listing", out var listing) || listing.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "listing_required" });
        var (id, error) = await _native.IngestInboundListingAsync(partnerTenantId, listing, ct);
        return error != null ? BadRequest(new { error }) : Ok(new { data = new { federated_listing_id = id } });
    }

    /// <summary>POST .../ingest/exchanges — accept an inbound cross-tenant match notification.</summary>
    [HttpPost("ingest/exchanges")]
    public async Task<IActionResult> IngestExchange([FromBody] JsonElement body, CancellationToken ct)
    {
        if (!body.TryGetProperty("partner_tenant_id", out var pt) || !pt.TryGetInt32(out var partnerTenantId))
            return BadRequest(new { error = "partner_tenant_id_required" });
        if (!body.TryGetProperty("exchange", out var exchange) || exchange.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "exchange_required" });
        var (id, error) = await _native.IngestInboundExchangeAsync(partnerTenantId, exchange, ct);
        return error != null ? BadRequest(new { error }) : Ok(new { data = new { federated_exchange_id = id } });
    }

    private static object MapTransfer(FederatedHourTransfer t) => new
    {
        t.Id,
        partner_id = t.PartnerId,
        direction = t.Direction.ToString(),
        local_user_id = t.LocalUserId,
        remote_user_external_id = t.RemoteUserExternalId,
        remote_user_display_name = t.RemoteUserDisplayName,
        t.Amount,
        external_reference = t.ExternalReference,
        t.Protocol,
        status = t.Status.ToString(),
        local_transaction_id = t.LocalTransactionId,
        t.Description,
        last_reconcile_attempt_at = t.LastReconcileAttemptAt,
        reconciled_at = t.ReconciledAt,
        failure_reason = t.FailureReason,
        retry_count = t.RetryCount,
        created_at = t.CreatedAt,
        updated_at = t.UpdatedAt
    };

    private async Task<string?> ResolvePartnerSettingAsync(int partnerId, string suffix, CancellationToken ct)
    {
        var key = $"federation.partner.{partnerId}.{suffix}";
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == key, ct);
        return row?.Value;
    }

    public class CreateTransferRequest
    {
        [JsonPropertyName("partner_id")] public int PartnerId { get; set; }
        [JsonPropertyName("local_user_id")] public int LocalUserId { get; set; }
        [JsonPropertyName("remote_user_external_id")] public string? RemoteUserExternalId { get; set; }
        [JsonPropertyName("remote_user_display_name")] public string? RemoteUserDisplayName { get; set; }
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("protocol")] public string Protocol { get; set; } = "native";
        [JsonPropertyName("description")] public string? Description { get; set; }
    }
}
