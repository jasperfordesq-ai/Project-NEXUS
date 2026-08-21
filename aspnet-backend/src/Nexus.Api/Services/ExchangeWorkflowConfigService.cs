// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Tenant-level exchange-workflow configuration, in the exact shape the React
/// client reads from <c>GET /api/v2/exchanges/config</c>.
///
/// 🔴 WHY THIS EXISTS. Until 2026-08-21 that endpoint was a do-nothing stub
/// returning <c>min_amount</c>/<c>max_amount</c>/<c>statuses</c>/<c>listing_types</c>
/// — four fields NO client reads — and none of the four fields every exchange page
/// actually reads. The consequence was not cosmetic: it took the whole exchange
/// journey off the map.
///
///   react-frontend/src/types/api.ts:1710-1715 declares exactly four fields;
///   ExchangesPage.tsx:238        renders "workflow not enabled" when the flag is falsy;
///   RequestExchangePage.tsx:176  renders "cannot request" when the flag is falsy;
///   ListingDetailPage.tsx:806    hides the "Request Exchange" button entirely.
///
/// So a member could not reach the request form at all, and every page reported a
/// disabled feature rather than an error — which is why no 500, no failed request
/// and no response diff ever pointed at it.
///
/// The values mirror Laravel's <c>BrokerControlConfigService::DEFAULTS</c>
/// (app/Services/BrokerControlConfigService.php:40-48) rather than
/// <c>AdminBrokerController.DefaultBrokerConfiguration</c>, because the four fields
/// the client reads are a CONTRACT and Laravel is the contract's author. The two
/// engines' admin-surface defaults differ (Laravel: approval off, 72h deadline,
/// adjustment on, 25% variance; ASP.NET's admin default set: approval on, 48h,
/// adjustment off, 20%) and reconciling that admin surface is separate work — but
/// what this endpoint reports must match Laravel, defaults included.
///
/// 🔴 Defaulting <c>exchange_workflow_enabled</c> to FALSE is deliberate and is not
/// a stub. Laravel defaults it off, so a tenant that has never opted in must be
/// told "off" by both engines. Returning true here to make a journey reachable
/// would be inventing a capability, which is the one thing this workstream may
/// never do.
/// </summary>
public class ExchangeWorkflowConfigService
{
    /// <summary>The tenant row `AdminBrokerController` reads and writes.</summary>
    public const string ConfigKey = "broker.configuration";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly ILogger<ExchangeWorkflowConfigService> _logger;

    public ExchangeWorkflowConfigService(
        NexusDbContext db,
        TenantContext tenant,
        ILogger<ExchangeWorkflowConfigService> logger)
    {
        _db = db;
        _tenant = tenant;
        _logger = logger;
    }

    /// <summary>The client-consumed payload. Laravel: ExchangesController@config.</summary>
    public sealed record ExchangeWorkflowConfig(
        bool ExchangeWorkflowEnabled,
        bool DirectMessagingEnabled,
        bool RequireBrokerApproval,
        int ConfirmationDeadlineHours,
        bool AllowHourAdjustment,
        int MaxHourVariancePercent);

    /// <summary>Laravel's documented defaults, used when the tenant has stored nothing.</summary>
    public static ExchangeWorkflowConfig Defaults => new(
        ExchangeWorkflowEnabled: false,
        DirectMessagingEnabled: true,
        RequireBrokerApproval: false,
        ConfirmationDeadlineHours: 72,
        AllowHourAdjustment: true,
        MaxHourVariancePercent: 25);

    public async Task<ExchangeWorkflowConfig> GetAsync(CancellationToken ct = default)
    {
        var tenantId = _tenant.TenantId;
        if (tenantId == null) return Defaults;

        var row = await _db.EnterpriseConfigs.AsNoTracking()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId.Value && c.Key == ConfigKey, ct);

        if (row == null || string.IsNullOrWhiteSpace(row.Value)) return Defaults;

        Dictionary<string, JsonElement> saved;
        try
        {
            saved = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.Value, JsonOptions) ?? [];
        }
        catch (JsonException ex)
        {
            // A malformed stored blob must not be reported as "feature on". Log and
            // fall back to the documented defaults, which is what Laravel does too
            // (BrokerControlConfigService.php:106 swallows and uses defaults).
            _logger.LogWarning(ex, "Tenant {TenantId} has an unparseable {Key} blob; using default exchange config", tenantId, ConfigKey);
            return Defaults;
        }

        var d = Defaults;
        return new ExchangeWorkflowConfig(
            ExchangeWorkflowEnabled: Bool(saved, d.ExchangeWorkflowEnabled, "exchange_workflow_enabled"),
            DirectMessagingEnabled: Bool(saved, d.DirectMessagingEnabled, "direct_messaging_enabled"),
            // 🔴 Two spellings, one setting. Laravel's flat form is
            // `require_broker_approval` (BrokerControlConfigService.php:440) and it
            // maps the nested value back OUT as `broker_approval_required`
            // (:206) — which is the spelling ASP.NET's admin surface saves
            // (AdminBrokerController.cs:40). Accept both, or an admin who toggled
            // approval on in the admin panel would still be told it was off here.
            RequireBrokerApproval: Bool(saved, d.RequireBrokerApproval, "require_broker_approval", "broker_approval_required"),
            ConfirmationDeadlineHours: Int(saved, d.ConfirmationDeadlineHours, "confirmation_deadline_hours"),
            AllowHourAdjustment: Bool(saved, d.AllowHourAdjustment, "allow_hour_adjustment"),
            MaxHourVariancePercent: Int(saved, d.MaxHourVariancePercent, "max_hour_variance_percent"));
    }

    private static bool Bool(Dictionary<string, JsonElement> saved, bool fallback, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!saved.TryGetValue(key, out var value)) continue;
            switch (value.ValueKind)
            {
                case JsonValueKind.True: return true;
                case JsonValueKind.False: return false;
                // Laravel writes booleans through a PHP JSON encode that has emitted
                // 0/1 and "0"/"1" for this blob in the past; treat those as booleans
                // rather than silently falling through to the default.
                case JsonValueKind.Number when value.TryGetInt32(out var n): return n != 0;
                case JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed): return parsed;
                case JsonValueKind.String when int.TryParse(value.GetString(), out var sn): return sn != 0;
            }
        }
        return fallback;
    }

    private static int Int(Dictionary<string, JsonElement> saved, int fallback, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!saved.TryGetValue(key, out var value)) continue;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n)) return n;
            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var sn)) return sn;
        }
        return fallback;
    }
}
