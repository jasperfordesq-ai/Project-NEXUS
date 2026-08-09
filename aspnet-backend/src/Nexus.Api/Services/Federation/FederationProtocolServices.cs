// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Phase 68 — Federation extensions ("very, very important", project owner
 * directive 2026-05-09).
 *
 * Three clients + one ingest service:
 *
 *   - CreditCommonsClient — talks to a remote Credit Commons node
 *     (https://creditcommons.net). Implements: Ping, ProposeTransfer,
 *     CommitTransfer, CancelTransfer, GetAccountBalance.
 *
 *   - KomunitinClient — talks to a Komunitin v2 node
 *     (https://komunitin.org). Implements: Ping, CreateTransfer,
 *     GetTransfer, ListAccounts.
 *
 *   - NativeIngestService — processes inbound payloads from federation
 *     partners using V2's native protocol (the JSON shape used by
 *     FederationParityController's inbound endpoints). Persists incoming
 *     listings/exchanges and notifies the matching local user.
 *
 *   - HourTransferReconciliationService — orchestrator the hosted-service
 *     scheduled job calls each tick. Picks Pending/Sent transfers, advances
 *     each through the appropriate client, and writes a local Transaction
 *     when settled.
 *
 * All three protocol clients are POSTs/GETs over HTTP+JSON. Per-partner
 * endpoints are read from the FederationPartner row's settings (stored in
 * TenantConfig keyed `federation.partner.{id}.endpoint`). Auth is bearer
 * token via FederationApiKeyService.
 */

using System.Data;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Services.Federation;

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

public record FederationProtocolResult(bool Success, string? ExternalReference, string? Error, JsonElement? RawResponse = null);

public class FederationProtocolException : Exception
{
    public FederationProtocolException(string message, Exception? inner = null) : base(message, inner) { }
}

internal static class FederationProtocolJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CreditCommonsClient
// ─────────────────────────────────────────────────────────────────────────────

public class CreditCommonsClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly NexusDbContext _db;
    private readonly ILogger<CreditCommonsClient> _logger;

    public CreditCommonsClient(IHttpClientFactory httpFactory, NexusDbContext db, ILogger<CreditCommonsClient> logger)
    {
        _httpFactory = httpFactory;
        _db = db;
        _logger = logger;
    }

    /// <summary>GET /handshake — minimal sanity check that the partner is reachable.</summary>
    public async Task<bool> PingAsync(string baseUrl, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            throw new FederationProtocolException($"Invalid base URL: {baseUrl}");
        try
        {
            var client = _httpFactory.CreateClient("NexusFederationProtocol");
            using var resp = await client.GetAsync(new Uri(baseUri, "handshake"), ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "CreditCommons handshake failed for {BaseUrl}", baseUrl);
            return false;
        }
    }

    /// <summary>
    /// POST /transfer/new — propose a transfer. Returns the remote-assigned
    /// transfer id which we persist as <see cref="FederatedHourTransfer.ExternalReference"/>.
    /// </summary>
    public async Task<FederationProtocolResult> ProposeTransferAsync(
        string baseUrl, string apiKey, FederatedHourTransfer transfer, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            return new(false, null, "invalid_partner_endpoint");

        var payload = new
        {
            payer = transfer.Direction == FederatedTransferDirection.Outbound
                ? $"local/{transfer.LocalUserId}"
                : transfer.RemoteUserExternalId ?? "unknown",
            payee = transfer.Direction == FederatedTransferDirection.Outbound
                ? transfer.RemoteUserExternalId ?? "unknown"
                : $"local/{transfer.LocalUserId}",
            quant = transfer.Amount,
            description = transfer.Description ?? string.Empty
        };

        return await PostAsync(baseUri, "transfer/new", apiKey, payload, ct);
    }

    /// <summary>POST /transfer/{id}/commit — finalize a previously-proposed transfer.</summary>
    public async Task<FederationProtocolResult> CommitTransferAsync(
        string baseUrl, string apiKey, string externalReference, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            return new(false, null, "invalid_partner_endpoint");
        return await PostAsync(baseUri, $"transfer/{Uri.EscapeDataString(externalReference)}/commit", apiKey, new { }, ct);
    }

    /// <summary>POST /transfer/{id}/cancel — abort a pending proposal.</summary>
    public async Task<FederationProtocolResult> CancelTransferAsync(
        string baseUrl, string apiKey, string externalReference, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            return new(false, null, "invalid_partner_endpoint");
        return await PostAsync(baseUri, $"transfer/{Uri.EscapeDataString(externalReference)}/cancel", apiKey, new { }, ct);
    }

    /// <summary>GET /accounts/{id}/balance — read remote balance.</summary>
    public async Task<decimal?> GetAccountBalanceAsync(
        string baseUrl, string apiKey, string accountId, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)) return null;
        var client = _httpFactory.CreateClient("NexusFederationProtocol");
        using var req = new HttpRequestMessage(HttpMethod.Get,
            new Uri(baseUri, $"accounts/{Uri.EscapeDataString(accountId)}/balance"));
        if (!string.IsNullOrWhiteSpace(apiKey))
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
            return json.TryGetProperty("balance", out var b) && b.TryGetDecimal(out var d) ? d : null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "CreditCommons balance fetch failed for {Account}", accountId);
            return null;
        }
    }

    private async Task<FederationProtocolResult> PostAsync(
        Uri baseUri, string relative, string apiKey, object payload, CancellationToken ct)
    {
        var client = _httpFactory.CreateClient("NexusFederationProtocol");
        using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, relative));
        req.Content = JsonContent.Create(payload, options: FederationProtocolJson.Options);
        if (!string.IsNullOrWhiteSpace(apiKey))
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            JsonElement? raw = null;
            try { raw = JsonDocument.Parse(body).RootElement.Clone(); } catch (JsonException) { }
            if (!resp.IsSuccessStatusCode)
                return new(false, null, $"cc_http_{(int)resp.StatusCode}", raw);
            string? id = null;
            if (raw is { } r && r.TryGetProperty("id", out var idEl)) id = idEl.GetString();
            return new(true, id, null, raw);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "CreditCommons POST {Path} failed", relative);
            return new(false, null, "cc_send_failed");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// KomunitinClient
// ─────────────────────────────────────────────────────────────────────────────

public class KomunitinClient
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<KomunitinClient> _logger;

    public KomunitinClient(IHttpClientFactory httpFactory, ILogger<KomunitinClient> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<bool> PingAsync(string baseUrl, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)) return false;
        try
        {
            var client = _httpFactory.CreateClient("NexusFederationProtocol");
            using var resp = await client.GetAsync(new Uri(baseUri, "ping"), ct);
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Komunitin ping failed for {BaseUrl}", baseUrl);
            return false;
        }
    }

    /// <summary>POST /transfers — Komunitin v2 transfer request.</summary>
    public async Task<FederationProtocolResult> CreateTransferAsync(
        string baseUrl, string apiKey, FederatedHourTransfer transfer, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            return new(false, null, "invalid_partner_endpoint");

        // Komunitin uses JSON:API style:
        //   { "data": { "type":"transfers", "attributes":{...}, "relationships":{...} } }
        var payload = new
        {
            data = new
            {
                type = "transfers",
                attributes = new
                {
                    amount = transfer.Amount,
                    meta = transfer.Description ?? string.Empty,
                    state = "pending"
                },
                relationships = new
                {
                    payer = new { data = new { type = "accounts", id = $"local/{transfer.LocalUserId}" } },
                    payee = new { data = new { type = "accounts", id = transfer.RemoteUserExternalId ?? "unknown" } }
                }
            }
        };

        var client = _httpFactory.CreateClient("NexusFederationProtocol");
        using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(baseUri, "transfers"));
        req.Content = JsonContent.Create(payload, options: FederationProtocolJson.Options);
        req.Headers.TryAddWithoutValidation("Accept", "application/vnd.api+json");
        if (!string.IsNullOrWhiteSpace(apiKey))
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            JsonElement? raw = null;
            try { raw = JsonDocument.Parse(body).RootElement.Clone(); } catch (JsonException) { }
            if (!resp.IsSuccessStatusCode)
                return new(false, null, $"komunitin_http_{(int)resp.StatusCode}", raw);
            string? id = null;
            if (raw is { } r && r.TryGetProperty("data", out var d) && d.TryGetProperty("id", out var idEl))
                id = idEl.GetString();
            return new(true, id, null, raw);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Komunitin transfer POST failed");
            return new(false, null, "komunitin_send_failed");
        }
    }

    public async Task<FederationProtocolResult> GetTransferAsync(
        string baseUrl, string apiKey, string id, CancellationToken ct)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            return new(false, null, "invalid_partner_endpoint");
        var client = _httpFactory.CreateClient("NexusFederationProtocol");
        using var req = new HttpRequestMessage(HttpMethod.Get,
            new Uri(baseUri, $"transfers/{Uri.EscapeDataString(id)}"));
        req.Headers.TryAddWithoutValidation("Accept", "application/vnd.api+json");
        if (!string.IsNullOrWhiteSpace(apiKey))
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {apiKey}");
        try
        {
            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            JsonElement? raw = null;
            try { raw = JsonDocument.Parse(body).RootElement.Clone(); } catch (JsonException) { }
            return resp.IsSuccessStatusCode
                ? new(true, id, null, raw)
                : new(false, id, $"komunitin_http_{(int)resp.StatusCode}", raw);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(ex, "Komunitin transfer GET failed");
            return new(false, id, "komunitin_send_failed");
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeIngestService
// ─────────────────────────────────────────────────────────────────────────────

public class NativeIngestService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<NativeIngestService> _logger;

    public NativeIngestService(NexusDbContext db, TenantContext tenant, ILogger<NativeIngestService> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>
    /// Ingest an inbound listing payload from a federation partner using V2's
    /// native JSON shape. Idempotent on (PartnerTenantId, RemoteListingId).
    /// </summary>
    public async Task<(int? FederatedListingId, string? Error)> IngestInboundListingAsync(
        int partnerTenantId, JsonElement payload, CancellationToken ct = default)
    {
        if (!payload.TryGetProperty("id", out var idEl)) return (null, "missing_id");
        var remoteId = idEl.ValueKind == JsonValueKind.Number ? idEl.GetInt32() : 0;
        if (remoteId <= 0) return (null, "invalid_id");

        var tenantId = _tenant.GetTenantIdOrThrow();
        var existing = await _db.FederatedListings
            .FirstOrDefaultAsync(l => l.TenantId == tenantId &&
                                       l.SourceTenantId == partnerTenantId &&
                                       l.SourceListingId == remoteId, ct);

        var title = payload.TryGetProperty("title", out var t) ? t.GetString() ?? string.Empty : string.Empty;
        var desc = payload.TryGetProperty("description", out var d) ? d.GetString() : null;
        var owner = payload.TryGetProperty("owner_display_name", out var o) ? o.GetString() ?? string.Empty : string.Empty;
        var listingType = payload.TryGetProperty("listing_type", out var lt) ? lt.GetString() ?? "offer" : "offer";

        if (existing != null)
        {
            existing.Title = title;
            existing.Description = desc;
            existing.OwnerDisplayName = owner;
            existing.ListingType = listingType;
            existing.SyncedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return (existing.Id, null);
        }

        var entity = new FederatedListing
        {
            TenantId = tenantId,
            SourceTenantId = partnerTenantId,
            SourceListingId = remoteId,
            Title = title,
            Description = desc,
            OwnerDisplayName = owner,
            ListingType = listingType,
            SyncedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        _db.FederatedListings.Add(entity);
        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("NativeIngest stored federated listing partner={PartnerId} remote={RemoteId} → local={LocalId}",
            partnerTenantId, remoteId, entity.Id);
        return (entity.Id, null);
    }

    /// <summary>Ingest an inbound exchange (cross-tenant match notification).</summary>
    public async Task<(int? FederatedExchangeId, string? Error)> IngestInboundExchangeAsync(
        int partnerTenantId, JsonElement payload, CancellationToken ct = default)
    {
        if (!payload.TryGetProperty("local_user_id", out var luEl) || !luEl.TryGetInt32(out var localUserId))
            return (null, "missing_local_user_id");
        if (!payload.TryGetProperty("source_listing_id", out var slEl) || !slEl.TryGetInt32(out var sourceListingId))
            return (null, "missing_source_listing_id");

        var tenantId = _tenant.GetTenantIdOrThrow();
        var entity = new FederatedExchange
        {
            TenantId = tenantId,
            PartnerTenantId = partnerTenantId,
            LocalUserId = localUserId,
            SourceListingId = sourceListingId,
            RemoteUserDisplayName = payload.TryGetProperty("remote_user_display_name", out var n) ? n.GetString() ?? "" : "",
            RemoteUserId = payload.TryGetProperty("remote_user_id", out var ru) && ru.TryGetInt32(out var rid) ? rid : null,
            Status = ExchangeStatus.Requested,
            CreatedAt = DateTime.UtcNow
        };
        _db.FederatedExchanges.Add(entity);
        await _db.SaveChangesAsync(ct);

        // Drop a per-user notification so the local user knows about the
        // inbound match. Notification.UserId is non-nullable so this is safe.
        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = localUserId,
            Type = "federated_exchange_proposed",
            Title = "New cross-tenant match",
            Body = $"{entity.RemoteUserDisplayName} wants to exchange.",
            IsRead = false,
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation("NativeIngest stored federated exchange partner={PartnerId} local_user={LocalUserId} → local={LocalId}",
            partnerTenantId, localUserId, entity.Id);
        return (entity.Id, null);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HourTransferReconciliationService — orchestrator used by the cron job
// ─────────────────────────────────────────────────────────────────────────────

public class HourTransferReconciliationService
{
    private static readonly bool DurableFederationTransferSagaAvailable = false;
    private readonly NexusDbContext _db;
    private readonly CreditCommonsClient _cc;
    private readonly KomunitinClient _komunitin;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly IConfiguration _config;
    private readonly ILogger<HourTransferReconciliationService> _logger;

    private const int MaxRetries = 5;

    public HourTransferReconciliationService(
        NexusDbContext db,
        CreditCommonsClient cc,
        KomunitinClient komunitin,
        PersonalWalletLedgerService personalWallet,
        IConfiguration config,
        ILogger<HourTransferReconciliationService> logger)
    {
        _db = db;
        _cc = cc;
        _komunitin = komunitin;
        _personalWallet = personalWallet;
        _config = config;
        _logger = logger;
    }

    /// <summary>
    /// Pick up to <paramref name="batchSize"/> non-terminal transfers for the
    /// given tenant and advance each one. Returns counts.
    /// </summary>
    public async Task<ReconcileBatchResult> ReconcileTenantAsync(int tenantId, int batchSize, CancellationToken ct)
    {
        if (!DurableFederationTransferSagaAvailable)
        {
            _logger.LogWarning(
                "Skipped federation transfer reconciliation for tenant {TenantId}: durable settlement saga is unavailable",
                tenantId);
            return new ReconcileBatchResult();
        }

        var rateLimit = TimeSpan.FromMinutes(2);
        var rateCutoff = DateTime.UtcNow - rateLimit;

        var pending = await _db.FederatedHourTransfers
            .Where(t => t.TenantId == tenantId)
            .Where(t => t.Status == FederatedTransferStatus.Pending ||
                        t.Status == FederatedTransferStatus.Sent ||
                        t.Status == FederatedTransferStatus.Acknowledged)
            .Where(t => t.LastReconcileAttemptAt == null || t.LastReconcileAttemptAt < rateCutoff)
            .OrderBy(t => t.CreatedAt)
            .Take(batchSize)
            .ToListAsync(ct);

        var result = new ReconcileBatchResult();
        foreach (var transfer in pending)
        {
            transfer.LastReconcileAttemptAt = DateTime.UtcNow;
            transfer.RetryCount++;
            try
            {
                await AdvanceTransferAsync(transfer, ct);
                result.Advanced++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Transfer {Id} reconciliation threw", transfer.Id);
                transfer.FailureReason = ex.Message;
                result.Failed++;
            }
            if (transfer.RetryCount >= MaxRetries && transfer.Status != FederatedTransferStatus.Reconciled)
            {
                var previousStatus = transfer.Status;
                transfer.Status = FederatedTransferStatus.Failed;
                if (string.IsNullOrEmpty(transfer.FailureReason))
                    transfer.FailureReason = "max_retries_exceeded";
                result.GivenUp++;
                await RecordFailedTransferAlertAsync(transfer, previousStatus, ct);
            }
            transfer.UpdatedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
        return result;
    }

    /// <summary>
    /// Surface a stuck/failed federated hour transfer to ops:
    ///  - LogError with structured properties (picked up by Sentry).
    ///  - Append a redacted record to TenantConfig key
    ///    "federation.alerts.failed_transfers" (JSON array, capped at 50)
    ///    so the admin federation dashboard can surface it without needing
    ///    a synthetic Notification.UserId.
    /// </summary>
    private async Task RecordFailedTransferAlertAsync(
        FederatedHourTransfer transfer,
        FederatedTransferStatus previousStatus,
        CancellationToken ct)
    {
        var endpoint = await ResolvePartnerSettingAsync(transfer.TenantId, transfer.PartnerId, "endpoint");
        var redactedEndpoint = string.IsNullOrWhiteSpace(endpoint) ? null : RedactSecretsInUrl(endpoint!);

        _logger.LogError(
            "Federated hour transfer failed — tenant={TenantId} transfer_id={TransferId} direction={Direction} previous_status={PreviousStatus} partner_endpoint={PartnerEndpoint} amount={Amount} failure_reason={FailureReason}",
            transfer.TenantId,
            transfer.Id,
            transfer.Direction.ToString(),
            previousStatus.ToString(),
            redactedEndpoint,
            transfer.Amount,
            transfer.FailureReason ?? "unknown");

        var alertRecord = new
        {
            tenant_id = transfer.TenantId,
            transfer_id = transfer.Id,
            direction = transfer.Direction.ToString(),
            previous_status = previousStatus.ToString(),
            partner_id = transfer.PartnerId,
            partner_endpoint = redactedEndpoint,
            amount = transfer.Amount,
            failure_reason = transfer.FailureReason ?? "unknown",
            timestamp = DateTime.UtcNow
        };

        const string key = "federation.alerts.failed_transfers";
        try
        {
            var row = await _db.TenantConfigs
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(c => c.TenantId == transfer.TenantId && c.Key == key, ct);

            List<JsonElement> existing;
            if (row == null || string.IsNullOrWhiteSpace(row.Value))
            {
                existing = new List<JsonElement>();
            }
            else
            {
                try
                {
                    using var doc = JsonDocument.Parse(row.Value);
                    existing = doc.RootElement.ValueKind == JsonValueKind.Array
                        ? doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList()
                        : new List<JsonElement>();
                }
                catch (JsonException)
                {
                    existing = new List<JsonElement>();
                }
            }

            // Append, then cap to the most recent 50.
            using var newDoc = JsonDocument.Parse(JsonSerializer.Serialize(alertRecord));
            existing.Add(newDoc.RootElement.Clone());
            if (existing.Count > 50)
                existing = existing.Skip(existing.Count - 50).ToList();

            var payload = JsonSerializer.Serialize(existing);
            if (row == null)
            {
                _db.TenantConfigs.Add(new TenantConfig
                {
                    TenantId = transfer.TenantId,
                    Key = key,
                    Value = payload,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                });
            }
            else
            {
                row.Value = payload;
                row.UpdatedAt = DateTime.UtcNow;
            }
            // Save handled by the outer ReconcileTenantAsync SaveChangesAsync.
        }
        catch (Exception ex)
        {
            // Don't let the alert path mask the underlying failure.
            _logger.LogWarning(ex, "Failed to persist failed-transfer alert for transfer {Id}", transfer.Id);
        }
    }

    private static string RedactSecretsInUrl(string url)
    {
        // Strip query-string credentials (api_key=..., token=..., key=...) and
        // userinfo (user:pass@) without depending on the URL being well-formed.
        try
        {
            var u = new Uri(url, UriKind.Absolute);
            var builder = new UriBuilder(u) { UserName = string.Empty, Password = string.Empty };
            if (!string.IsNullOrEmpty(u.Query))
            {
                var parts = u.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
                var safe = parts.Where(p =>
                {
                    var name = p.Split('=', 2)[0].ToLowerInvariant();
                    return name is not ("api_key" or "apikey" or "token" or "key" or "secret" or "access_token");
                });
                builder.Query = string.Join('&', safe);
            }
            return builder.Uri.ToString();
        }
        catch
        {
            return "[redacted]";
        }
    }

    private async Task AdvanceTransferAsync(FederatedHourTransfer transfer, CancellationToken ct)
    {
        // Resolve partner endpoint + api key via configured TenantConfig.
        var partner = await _db.FederationPartners.FirstOrDefaultAsync(p => p.Id == transfer.PartnerId, ct);
        if (partner == null)
        {
            transfer.Status = FederatedTransferStatus.Failed;
            transfer.FailureReason = "partner_not_found";
            return;
        }

        var endpoint = await ResolvePartnerSettingAsync(transfer.TenantId, transfer.PartnerId, "endpoint");
        var apiKey = await ResolvePartnerSettingAsync(transfer.TenantId, transfer.PartnerId, "api_key");

        if (string.IsNullOrWhiteSpace(endpoint))
        {
            transfer.FailureReason = "partner_endpoint_not_configured";
            return;
        }

        switch (transfer.Status)
        {
            case FederatedTransferStatus.Pending:
                await ProposeAsync(transfer, endpoint, apiKey, ct);
                break;
            case FederatedTransferStatus.Sent:
                await CheckRemoteStateAsync(transfer, endpoint, apiKey, ct);
                break;
            case FederatedTransferStatus.Acknowledged:
                await CommitAndSettleAsync(transfer, endpoint, apiKey, ct);
                break;
        }
    }

    private async Task ProposeAsync(FederatedHourTransfer t, string endpoint, string? apiKey, CancellationToken ct)
    {
        var result = t.Protocol switch
        {
            "credit-commons" => await _cc.ProposeTransferAsync(endpoint, apiKey ?? string.Empty, t, ct),
            "komunitin" => await _komunitin.CreateTransferAsync(endpoint, apiKey ?? string.Empty, t, ct),
            _ => new FederationProtocolResult(false, null, "unknown_protocol")
        };
        if (result.Success)
        {
            t.ExternalReference = result.ExternalReference;
            t.Status = FederatedTransferStatus.Sent;
            t.FailureReason = null;
        }
        else
        {
            t.FailureReason = result.Error;
        }
    }

    private async Task CheckRemoteStateAsync(FederatedHourTransfer t, string endpoint, string? apiKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(t.ExternalReference)) return;
        if (t.Protocol == "komunitin")
        {
            var result = await _komunitin.GetTransferAsync(endpoint, apiKey ?? string.Empty, t.ExternalReference, ct);
            if (!result.Success) { t.FailureReason = result.Error; return; }
            // Komunitin state lives at data.attributes.state. Promote to Acknowledged on "accepted".
            if (result.RawResponse is { } raw &&
                raw.TryGetProperty("data", out var d) &&
                d.TryGetProperty("attributes", out var a) &&
                a.TryGetProperty("state", out var s) &&
                s.GetString()?.Equals("accepted", StringComparison.OrdinalIgnoreCase) == true)
            {
                t.Status = FederatedTransferStatus.Acknowledged;
                t.FailureReason = null;
            }
        }
        else if (t.Protocol == "credit-commons")
        {
            // CC has no separate "check" — proposed transfers transition to
            // Acknowledged on the first successful retry of CommitTransfer
            // (idempotent). We optimistically promote to Acknowledged here so
            // the next tick attempts commit.
            t.Status = FederatedTransferStatus.Acknowledged;
        }
    }

    private async Task CommitAndSettleAsync(FederatedHourTransfer t, string endpoint, string? apiKey, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(t.ExternalReference)) return;

        var sender = t.Direction == FederatedTransferDirection.Outbound
            ? t.LocalUserId
            : (int?)null;
        var receiver = t.Direction == FederatedTransferDirection.Inbound
            ? t.LocalUserId
            : (int?)null;
        // The remote side is deliberately null. Routing it through an admin or
        // broker account would silently mutate that person's personal wallet.
        // Use the shared personal-wallet lock so federation settlement serializes
        // with every other path that can spend the local member's balance.
        var hasOuterTx = _db.Database.CurrentTransaction != null;
        IDbContextTransaction? localTx = null;
        if (!hasOuterTx)
            localTx = await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            await _personalWallet.AcquireSpendLockAsync(t.LocalUserId, ct);

            // Double-checked locking under READ COMMITTED. We hold the advisory
            // lock, so a concurrent reconciliation tick has either not entered its
            // critical section yet or has already committed and released. Re-read
            // the transfer's current status (AsNoTracking, READ COMMITTED — so we
            // see a sibling tick's committed write; a Serializable snapshot, taken
            // at the lock statement *before* it blocks, would still show the stale
            // Acknowledged value). If another tick already settled it, abort
            // without writing a second ledger row. Without this, two parallel
            // ticks (the cron tick and a manual admin trigger) both write a
            // Transaction — a double-spend.
            var settledStatus = await _db.FederatedHourTransfers
                .AsNoTracking()
                .Where(x => x.Id == t.Id)
                .Select(x => x.Status)
                .FirstOrDefaultAsync(ct);
            if (settledStatus != FederatedTransferStatus.Acknowledged)
            {
                if (localTx != null) await localTx.RollbackAsync(ct);
                // Refresh the stale tracked entity to the winner's committed state
                // so the outer ReconcileTenantAsync SaveChanges does not revert its
                // Status / LocalTransactionId / ReconciledAt back.
                await _db.Entry(t).ReloadAsync(ct);
                return;
            }

            var localUserExists = await _db.Users
                .IgnoreQueryFilters()
                .AnyAsync(user => user.Id == t.LocalUserId
                    && user.TenantId == t.TenantId
                    && user.IsActive
                    && user.SuspendedAt == null, ct);
            if (!localUserExists)
            {
                if (localTx != null) await localTx.RollbackAsync(ct);
                t.FailureReason = "local_user_not_active_in_transfer_tenant";
                return;
            }

            // For Outbound, the local user is spending credits — verify they
            // have the balance before writing the ledger row.
            if (t.Direction == FederatedTransferDirection.Outbound)
            {
                var balance = await _personalWallet.GetBalanceAsync(
                    t.TenantId,
                    t.LocalUserId,
                    ct);
                if (balance < t.Amount)
                {
                    if (localTx != null) await localTx.RollbackAsync(ct);
                    t.FailureReason = $"insufficient_balance: have {balance:F2}, need {t.Amount:F2}";
                    return;
                }
            }

            // Credit Commons has an explicit final commit. Do it only after the
            // local payer is locked and funded, so a remote success cannot be
            // followed by a predictable local insufficient-balance failure.
            if (t.Protocol == "credit-commons")
            {
                var commit = await _cc.CommitTransferAsync(
                    endpoint,
                    apiKey ?? string.Empty,
                    t.ExternalReference,
                    ct);
                if (!commit.Success)
                {
                    if (localTx != null) await localTx.RollbackAsync(ct);
                    t.FailureReason = commit.Error;
                    return;
                }
            }
            // Komunitin v2 settles on partner-side accept; there is no commit verb.

            var tx = new Transaction
            {
                TenantId = t.TenantId,
                SenderId = sender,
                ReceiverId = receiver,
                Amount = t.Amount,
                Status = TransactionStatus.Completed,
                TransactionType = PersonalWalletLedgerService.TransferTransactionType,
                Description = $"Federated {t.Protocol} transfer #{t.Id}: {t.Description}",
                CreatedAt = DateTime.UtcNow
            };
            _db.Transactions.Add(tx);
            await _db.SaveChangesAsync(ct);
            t.LocalTransactionId = tx.Id;
            t.Status = FederatedTransferStatus.Reconciled;
            t.ReconciledAt = DateTime.UtcNow;
            t.FailureReason = null;
            await _db.SaveChangesAsync(ct);

            if (localTx != null) await localTx.CommitAsync(ct);
            _logger.LogInformation("Federated transfer {Id} reconciled — local tx={TxId}", t.Id, tx.Id);
        }
        catch
        {
            if (localTx != null) await localTx.RollbackAsync(ct);
            throw;
        }
        finally
        {
            if (localTx != null) await localTx.DisposeAsync();
        }
    }

    private async Task<string?> ResolvePartnerSettingAsync(int tenantId, int partnerId, string suffix)
    {
        var key = $"federation.partner.{partnerId}.{suffix}";
        var row = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        return row?.Value;
    }
}

public class ReconcileBatchResult
{
    public int Advanced { get; set; }
    public int Failed { get; set; }
    public int GivenUp { get; set; }
}
