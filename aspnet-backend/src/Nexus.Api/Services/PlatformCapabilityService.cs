// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Platform capability overrides — Laravel parity for
/// PlatformCapabilityService. The allowlist below is the entire security
/// boundary: unknown capabilities and out-of-vocabulary values are refused,
/// and reads FAIL OPEN to the environment value when the table is unreadable
/// (the environment keeps deciding, never a crash).
/// </summary>
public class PlatformCapabilityService
{
    public sealed record CapabilityDefinition(
        string Capability, string ConfigKey, string Type, string[] Values, string Off);

    public static readonly CapabilityDefinition[] Definitions =
    [
        new("attendance_credits", "Events:AttendanceCreditMode", "enum", ["off", "treasury"], "off"),
        new("recurrence_v2", "Events:Recurrence:EngineV2Enabled", "bool", ["0", "1"], "0"),
        new("rolling_recurrence", "Events:Recurrence:MaterializationEnabled", "bool", ["0", "1"], "0"),
        new("recurrence_definition_blueprints", "Events:Recurrence:DefinitionBlueprintsEnabled", "bool", ["0", "1"], "0"),
        new("timed_waitlist_offers", "Events:Registration:TimedWaitlistOffersEnabled", "bool", ["0", "1"], "0"),
        new("optional_analytics_capture", "Events:Analytics:OptionalCaptureEnabled", "bool", ["0", "1"], "0"),
    ];

    private readonly NexusDbContext _db;
    private readonly IConfiguration _configuration;
    private readonly ILogger<PlatformCapabilityService> _logger;

    public PlatformCapabilityService(
        NexusDbContext db, IConfiguration configuration, ILogger<PlatformCapabilityService> logger)
    {
        _db = db;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<List<object>> InspectAsync(CancellationToken ct)
    {
        var overrides = await OverridesAsync(ct);
        return Definitions.Select(definition =>
        {
            var envValue = EnvValue(definition);
            var hasOverride = overrides.TryGetValue(definition.Capability, out var overrideValue);
            return (object)new
            {
                capability = definition.Capability,
                type = definition.Type,
                values = definition.Values,
                value = hasOverride ? overrideValue : envValue,
                source = hasOverride ? "platform_override" : "environment",
                env_value = envValue
            };
        }).ToList();
    }

    /// <summary>Effective value: platform override wins, else environment.</summary>
    public async Task<string> EffectiveValueAsync(string capability, CancellationToken ct)
    {
        var definition = Definitions.FirstOrDefault(d => d.Capability == capability);
        if (definition is null) return "off";
        var overrides = await OverridesAsync(ct);
        return overrides.TryGetValue(capability, out var value) ? value : EnvValue(definition);
    }

    public async Task<bool> SetAsync(
        string capability, string value, int actorUserId, string? reason, CancellationToken ct)
    {
        var definition = Definitions.FirstOrDefault(d => d.Capability == capability);
        if (definition is null || !definition.Values.Contains(value)) return false;

        var trimmedReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (trimmedReason is { Length: > 500 }) trimmedReason = trimmedReason[..500];

        var row = await _db.PlatformCapabilityOverrides
            .FirstOrDefaultAsync(o => o.Capability == capability, ct);
        if (row is null)
        {
            _db.PlatformCapabilityOverrides.Add(new PlatformCapabilityOverride
            {
                Capability = capability,
                Value = value,
                UpdatedByUserId = actorUserId,
                Reason = trimmedReason,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            row.Value = value;
            row.UpdatedByUserId = actorUserId;
            row.Reason = trimmedReason;
            row.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        _logger.LogInformation(
            "Platform capability changed capability={Capability} value={Value} actor_user_id={ActorUserId}",
            capability, value, actorUserId);
        return true;
    }

    public async Task<bool> ClearAsync(string capability, CancellationToken ct)
    {
        if (Definitions.All(d => d.Capability != capability)) return false;
        await _db.PlatformCapabilityOverrides
            .Where(o => o.Capability == capability)
            .ExecuteDeleteAsync(ct);
        return true;
    }

    private async Task<Dictionary<string, string>> OverridesAsync(CancellationToken ct)
    {
        try
        {
            return await _db.PlatformCapabilityOverrides
                .AsNoTracking()
                .ToDictionaryAsync(o => o.Capability, o => o.Value, ct);
        }
        catch (Exception ex)
        {
            // Fail open: the environment keeps deciding.
            _logger.LogWarning(ex, "[PlatformCapabilities] override read failed; using environment");
            return [];
        }
    }

    private string EnvValue(CapabilityDefinition definition)
    {
        var raw = _configuration[definition.ConfigKey];
        if (definition.Type == "bool")
        {
            return raw?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on" ? "1" : "0";
        }

        return raw is not null && definition.Values.Contains(raw) ? raw : definition.Off;
    }
}
