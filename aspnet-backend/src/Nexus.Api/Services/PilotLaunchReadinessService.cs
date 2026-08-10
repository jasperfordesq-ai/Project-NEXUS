// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class PilotLaunchReadinessService
{
    public const string BoundaryAcknowledgementKey = "caring.launch_readiness.boundary_acknowledged";
    public const string OperatingPolicyKey = "caring.operating_policy";
    public const string PilotLaunchedAtKey = "caring_community.pilot_launched_at";
    public const string PilotLaunchedByKey = "caring_community.pilot_launched_by";

    private const string StatusReady = "ready";
    private const string StatusNeedsReview = "needs_review";
    private const string StatusNotStarted = "not_started";
    private const string StatusBlocked = "blocked";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly NexusDbContext _db;
    private readonly PilotDisclosurePackService _disclosurePack;
    private readonly CommercialBoundaryService _commercialBoundary;
    private readonly CaringKpiBaselineService _kpiBaselines;
    private readonly TenantDataQualityService _dataQuality;
    private readonly IsolatedNodeReadinessService _isolatedNode;
    private readonly ExternalIntegrationBacklogService _externalIntegrations;

    public PilotLaunchReadinessService(
        NexusDbContext db,
        PilotDisclosurePackService disclosurePack,
        CommercialBoundaryService commercialBoundary,
        CaringKpiBaselineService kpiBaselines,
        TenantDataQualityService dataQuality,
        IsolatedNodeReadinessService isolatedNode,
        ExternalIntegrationBacklogService externalIntegrations)
    {
        _db = db;
        _disclosurePack = disclosurePack;
        _commercialBoundary = commercialBoundary;
        _kpiBaselines = kpiBaselines;
        _dataQuality = dataQuality;
        _isolatedNode = isolatedNode;
        _externalIntegrations = externalIntegrations;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<PilotLaunchReadinessReport> ReportAsync(int tenantId, CancellationToken ct)
    {
        var isolatedNodeRequired = await IsIsolatedNodeRequiredAsync(tenantId, ct);
        var sections = new[]
        {
            await DisclosurePackSectionAsync(tenantId, ct),
            await OperatingPolicySectionAsync(tenantId, ct),
            await CommercialBoundarySectionAsync(tenantId, ct),
            await PilotScoreboardSectionAsync(tenantId, ct),
            await DataQualitySectionAsync(tenantId, ct),
            await IsolatedNodeSectionAsync(tenantId, isolatedNodeRequired, ct),
            await ExternalIntegrationsSectionAsync(tenantId, ct)
        };

        var launched = await GetLaunchStateAsync(tenantId, ct);
        var blockers = new List<PilotLaunchReadinessBlocker>();
        foreach (var section in sections)
        {
            if (section.Key == "isolated_node" && !isolatedNodeRequired)
            {
                continue;
            }

            if (section.Status is not (StatusReady or "decided"))
            {
                blockers.Add(new PilotLaunchReadinessBlocker(section.Key, section.Label, section.Status));
            }
        }

        return new PilotLaunchReadinessReport(
            GeneratedAt: IsoNow(),
            Overall: ComputeOverallStatus(sections),
            Sections: sections,
            IsolatedNodeRequired: isolatedNodeRequired,
            CanLaunch: blockers.Count == 0 && launched is null,
            Blockers: blockers,
            Launched: launched);
    }

    public async Task<PilotLaunchReadinessAcknowledgement> AcknowledgeBoundaryAsync(int tenantId, CancellationToken ct)
    {
        await UpsertSettingAsync(tenantId, BoundaryAcknowledgementKey, "1", ct);
        return new PilotLaunchReadinessAcknowledgement(true);
    }

    public async Task<PilotLaunchReadinessLaunchResult> LaunchPilotAsync(
        int tenantId,
        int userId,
        CancellationToken ct)
    {
        var existing = await GetLaunchStateAsync(tenantId, ct);
        if (existing is not null)
        {
            return new PilotLaunchReadinessLaunchResult(Error: "ALREADY_LAUNCHED", Launched: existing);
        }

        var report = await ReportAsync(tenantId, ct);
        if (!report.CanLaunch)
        {
            return new PilotLaunchReadinessLaunchResult(Error: "CANNOT_LAUNCH", Blockers: report.Blockers);
        }

        var launchedAt = IsoNow();
        await UpsertSettingAsync(tenantId, PilotLaunchedAtKey, launchedAt, ct);
        await UpsertSettingAsync(tenantId, PilotLaunchedByKey, userId.ToString(CultureInfo.InvariantCulture), ct);

        return new PilotLaunchReadinessLaunchResult(
            LaunchedAt: launchedAt,
            LaunchedById: userId);
    }

    private async Task<PilotLaunchReadinessSection> DisclosurePackSectionAsync(int tenantId, CancellationToken ct)
    {
        var pack = await _disclosurePack.GetAsync(tenantId, ct);
        var missing = new List<string>();
        if (ReadJsonString(pack.Pack, "controller", "name") == "") missing.Add("controller.name");
        if (ReadJsonString(pack.Pack, "controller", "contact_email") == "") missing.Add("controller.contact_email");
        if (ReadJsonString(pack.Pack, "controller", "data_protection_officer") == "") missing.Add("controller.data_protection_officer");
        if (ReadJsonString(pack.Pack, "incident_response", "contact_email") == "") missing.Add("incident_response.contact_email");

        if (!pack.IsCustomised)
        {
            return Section(
                "disclosure_pack",
                "AG80 - FADP/nDSG disclosure pack",
                StatusNotStarted,
                "Pack still on platform defaults; no controller named.",
                "/admin/caring-community/disclosure-pack",
                pack.LastUpdatedAt,
                missing);
        }

        if (missing.Count > 0)
        {
            return Section(
                "disclosure_pack",
                "AG80 - FADP/nDSG disclosure pack",
                StatusNeedsReview,
                "Controller / DPO / incident contact still incomplete.",
                "/admin/caring-community/disclosure-pack",
                pack.LastUpdatedAt,
                missing);
        }

        return Section(
            "disclosure_pack",
            "AG80 - FADP/nDSG disclosure pack",
            StatusReady,
            "Controller, DPO, and incident contact captured.",
            "/admin/caring-community/disclosure-pack",
            pack.LastUpdatedAt,
            []);
    }

    private async Task<PilotLaunchReadinessSection> OperatingPolicySectionAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId
                && (c.Key == OperatingPolicyKey || c.Key.StartsWith(OperatingPolicyKey + ".")))
            .ToListAsync(ct);

        var policy = ReadOperatingPolicy(rows);
        var appendixSet = !string.IsNullOrWhiteSpace(policy.GetValueOrDefault("policy_appendix_url"));
        var safeguardingSet = int.TryParse(
            policy.GetValueOrDefault("safeguarding_escalation_user_id"),
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var safeguardingUserId)
            && safeguardingUserId > 0;

        var missing = new List<string>();
        if (!appendixSet) missing.Add("policy_appendix_url");
        if (!safeguardingSet) missing.Add("safeguarding_escalation_user_id");

        var lastUpdatedAt = rows
            .Select(row => row.UpdatedAt ?? row.CreatedAt)
            .OrderByDescending(value => value)
            .FirstOrDefault();
        var hasPolicy = rows.Count > 0;

        if (!hasPolicy)
        {
            return Section(
                "operating_policy",
                "AG81 - KISS operating policy",
                StatusNotStarted,
                "Policy still on platform defaults - schedule the workshop.",
                "/admin/caring-community/operating-policy",
                null,
                ["workshop_not_run", .. missing]);
        }

        if (missing.Count > 0)
        {
            return Section(
                "operating_policy",
                "AG81 - KISS operating policy",
                StatusNeedsReview,
                "Workshop run, but appendix URL or safeguarding owner missing.",
                "/admin/caring-community/operating-policy",
                FormatDate(lastUpdatedAt),
                missing);
        }

        return Section(
            "operating_policy",
            "AG81 - KISS operating policy",
            StatusReady,
            "Policy workshop complete; appendix linked and safeguarding owner assigned.",
            "/admin/caring-community/operating-policy",
            FormatDate(lastUpdatedAt),
            []);
    }

    private async Task<PilotLaunchReadinessSection> CommercialBoundarySectionAsync(int tenantId, CancellationToken ct)
    {
        var matrix = await _commercialBoundary.MatrixAsync(tenantId, ct);
        var acknowledged = await BoundaryAcknowledgedAsync(tenantId, ct);
        if (!acknowledged && matrix.OverridesCount == 0)
        {
            return Section(
                "commercial_boundary",
                "AG82 - Commercial boundary map",
                StatusNeedsReview,
                "Default classifications in effect; admin has not acknowledged the matrix.",
                "/admin/caring-community/commercial-boundary",
                matrix.LastUpdatedAt,
                ["acknowledgement"]);
        }

        return Section(
            "commercial_boundary",
            "AG82 - Commercial boundary map",
            StatusReady,
            matrix.OverridesCount > 0
                ? $"{matrix.OverridesCount} override(s) applied; matrix reviewed."
                : "Default matrix acknowledged.",
            "/admin/caring-community/commercial-boundary",
            matrix.LastUpdatedAt,
            []);
    }

    private async Task<PilotLaunchReadinessSection> PilotScoreboardSectionAsync(int tenantId, CancellationToken ct)
    {
        var baselines = await _kpiBaselines.ListBaselinesAsync(tenantId, ct);
        var prePilot = baselines.FirstOrDefault();
        if (prePilot is null)
        {
            return Section(
                "pilot_scoreboard",
                "AG83 - Pilot scoreboard baseline",
                StatusNotStarted,
                "No pre-pilot baseline captured - without it, no before/after comparison is possible.",
                "/admin/caring-community/pilot-scoreboard",
                null,
                ["pre_pilot_baseline"]);
        }

        return Section(
            "pilot_scoreboard",
            "AG83 - Pilot scoreboard baseline",
            StatusReady,
            "Pre-pilot baseline captured; quarterly cadence on track.",
            "/admin/caring-community/pilot-scoreboard",
            prePilot.CapturedAt,
            [],
            new Dictionary<string, object?> { ["next_due_at"] = null });
    }

    private async Task<PilotLaunchReadinessSection> DataQualitySectionAsync(int tenantId, CancellationToken ct)
    {
        var report = await _dataQuality.RunChecksAsync(tenantId, ct);
        var danger = report.Totals.GetValueOrDefault("danger");
        var warning = report.Totals.GetValueOrDefault("warning");
        var extra = new Dictionary<string, object?>
        {
            ["danger"] = danger,
            ["warning"] = warning
        };

        if (danger > 0)
        {
            return Section(
                "data_quality",
                "AG84 - Tenant data quality",
                StatusBlocked,
                $"{danger} blocking issue(s) - duplicate accounts or seed users still present.",
                "/admin/caring-community/data-quality",
                FormatDate(report.GeneratedAt),
                ["danger_checks"],
                extra);
        }

        if (warning > 0)
        {
            return Section(
                "data_quality",
                "AG84 - Tenant data quality",
                StatusNeedsReview,
                $"{warning} warning(s) - review before launch.",
                "/admin/caring-community/data-quality",
                FormatDate(report.GeneratedAt),
                ["warning_checks"],
                extra);
        }

        return Section(
            "data_quality",
            "AG84 - Tenant data quality",
            StatusReady,
            "All checks pass - data is ready for real residents.",
            "/admin/caring-community/data-quality",
            FormatDate(report.GeneratedAt),
            [],
            extra);
    }

    private async Task<PilotLaunchReadinessSection> IsolatedNodeSectionAsync(
        int tenantId,
        bool required,
        CancellationToken ct)
    {
        var node = await _isolatedNode.GetAsync(tenantId, ct);
        var blockers = node.Gate.Blockers;
        var extra = new Dictionary<string, object?>
        {
            ["gate_closed"] = node.Gate.Closed,
            ["decided_count"] = node.Gate.DecidedCount,
            ["total_count"] = node.Gate.TotalCount,
            ["blockers"] = blockers,
            ["required"] = required
        };

        if (!required)
        {
            return Section(
                "isolated_node",
                "AG85 - Isolated-node decision gate",
                node.Gate.Closed ? StatusReady : StatusNotStarted,
                node.Gate.Closed
                    ? "Gate closed (informational - deployment is hosted)."
                    : "Not required for hosted deployments - gate is informational.",
                "/admin/caring-community/isolated-node",
                node.LastUpdatedAt,
                [],
                extra);
        }

        if (blockers.Count > 0)
        {
            return Section(
                "isolated_node",
                "AG85 - Isolated-node decision gate",
                StatusBlocked,
                $"{blockers.Count} blocked decision(s) - canton deployment cannot launch.",
                "/admin/caring-community/isolated-node",
                node.LastUpdatedAt,
                blockers,
                extra);
        }

        if (!node.Gate.Closed)
        {
            return Section(
                "isolated_node",
                "AG85 - Isolated-node decision gate",
                StatusNeedsReview,
                $"{node.Gate.DecidedCount} of {node.Gate.TotalCount} decisions made - canton deployment requires all decided.",
                "/admin/caring-community/isolated-node",
                node.LastUpdatedAt,
                ["undecided_items"],
                extra);
        }

        return Section(
            "isolated_node",
            "AG85 - Isolated-node decision gate",
            StatusReady,
            "Every gate decision recorded - canton deployment ready.",
            "/admin/caring-community/isolated-node",
            node.LastUpdatedAt,
            [],
            extra);
    }

    private async Task<PilotLaunchReadinessSection> ExternalIntegrationsSectionAsync(
        int tenantId,
        CancellationToken ct)
    {
        var list = await _externalIntegrations.ListAsync(tenantId, ct);
        var blockedCount = list.Items.Count(item => item.Status == "blocked");
        var proposedCount = list.Items.Count(item => item.Status == "proposed");
        var extra = new Dictionary<string, object?>
        {
            ["total"] = list.Items.Count,
            ["blocked"] = blockedCount,
            ["proposed"] = proposedCount
        };

        if (list.Items.Count == 0)
        {
            return Section(
                "external_integrations",
                "AG87 - External integration backlog",
                StatusNotStarted,
                "Backlog empty - seed defaults or confirm no partner integrations are needed.",
                "/admin/caring-community/external-integrations",
                list.LastUpdatedAt,
                ["backlog_empty"],
                extra);
        }

        if (blockedCount > 0)
        {
            return Section(
                "external_integrations",
                "AG87 - External integration backlog",
                StatusBlocked,
                $"{blockedCount} integration(s) blocked - partner-dependent features cannot ship.",
                "/admin/caring-community/external-integrations",
                list.LastUpdatedAt,
                ["blocked_integrations"],
                extra);
        }

        return Section(
            "external_integrations",
            "AG87 - External integration backlog",
            StatusReady,
            $"{list.Items.Count} item(s) tracked, none blocked.",
            "/admin/caring-community/external-integrations",
            list.LastUpdatedAt,
            [],
            extra);
    }

    private async Task<bool> BoundaryAcknowledgedAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == BoundaryAcknowledgementKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    private async Task<bool> IsIsolatedNodeRequiredAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == IsolatedNodeReadinessService.KeyPrefix + "deployment_mode")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ReadSettingScalar(raw) == "canton_isolated_node";
    }

    private async Task<PilotLaunchState?> GetLaunchStateAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && (c.Key == PilotLaunchedAtKey || c.Key == PilotLaunchedByKey))
            .ToListAsync(ct);

        var launchedAt = rows.FirstOrDefault(row => row.Key == PilotLaunchedAtKey)?.Value;
        if (string.IsNullOrWhiteSpace(launchedAt))
        {
            return null;
        }

        var launchedByRaw = rows.FirstOrDefault(row => row.Key == PilotLaunchedByKey)?.Value;
        var launchedById = int.TryParse(
            launchedByRaw,
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var userId)
            ? userId
            : 0;

        return new PilotLaunchState(launchedAt, launchedById);
    }

    private async Task UpsertSettingAsync(int tenantId, string key, string value, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key, ct);

        if (existing is null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
        else
        {
            existing.Value = value;
            existing.UpdatedAt = now;
        }

        await _db.SaveChangesAsync(ct);
    }

    private static PilotLaunchReadinessOverall ComputeOverallStatus(
        IReadOnlyList<PilotLaunchReadinessSection> sections)
    {
        var readyCount = sections.Count(section => section.Status == StatusReady);
        var total = sections.Count;

        if (sections.Any(section => section.Status == StatusBlocked))
        {
            return new PilotLaunchReadinessOverall(
                StatusBlocked,
                readyCount,
                total,
                "One or more sections are blocked - pilot launch is not safe.");
        }

        if (readyCount == total)
        {
            return new PilotLaunchReadinessOverall(
                StatusReady,
                readyCount,
                total,
                "All sections ready - pilot launch may proceed.");
        }

        if (sections.Any(section => section.Status == StatusNeedsReview))
        {
            return new PilotLaunchReadinessOverall(
                StatusNeedsReview,
                readyCount,
                total,
                $"{readyCount} of {total} ready - coordinator review needed before launch.");
        }

        if (sections.Any(section => section.Status == StatusNotStarted))
        {
            return new PilotLaunchReadinessOverall(
                StatusNotStarted,
                readyCount,
                total,
                $"{readyCount} of {total} ready - pilot evaluation has not been run end to end.");
        }

        return new PilotLaunchReadinessOverall(
            StatusNeedsReview,
            readyCount,
            total,
            $"{readyCount} of {total} ready.");
    }

    private static IReadOnlyDictionary<string, string?> ReadOperatingPolicy(IReadOnlyList<TenantConfig> rows)
    {
        var policy = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            if (row.Key == OperatingPolicyKey)
            {
                foreach (var (key, value) in ReadJsonObjectScalars(row.Value))
                {
                    policy[key] = value;
                }

                continue;
            }

            if (row.Key.StartsWith(OperatingPolicyKey + ".", StringComparison.Ordinal))
            {
                policy[row.Key[(OperatingPolicyKey.Length + 1)..]] = ReadSettingScalar(row.Value);
            }
        }

        return policy;
    }

    private static IReadOnlyDictionary<string, string?> ReadJsonObjectScalars(string raw)
    {
        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("value", out var envelope)
                && envelope.ValueKind == JsonValueKind.Object)
            {
                root = envelope;
            }

            if (root.ValueKind != JsonValueKind.Object)
            {
                return new Dictionary<string, string?>(StringComparer.Ordinal);
            }

            var values = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                values[property.Name] = ElementToString(property.Value);
            }

            return values;
        }
        catch (JsonException)
        {
            return new Dictionary<string, string?>(StringComparer.Ordinal);
        }
    }

    private static string? ReadSettingScalar(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("value", out var value))
            {
                return ElementToString(value);
            }

            return ElementToString(root);
        }
        catch (JsonException)
        {
            return raw.Trim();
        }
    }

    private static string? ElementToString(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => element.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => null,
            _ => element.GetRawText()
        };
    }

    private static bool? ParseBool(string? raw)
    {
        var value = ReadSettingScalar(raw)?.Trim();
        return value?.ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private static string ReadJsonString(JsonObject root, string section, string field)
    {
        var node = root[section]?[field];
        if (node is null)
        {
            return string.Empty;
        }

        try
        {
            return node.GetValue<string>()?.Trim() ?? string.Empty;
        }
        catch (InvalidOperationException)
        {
            return string.Empty;
        }
    }

    private static PilotLaunchReadinessSection Section(
        string key,
        string label,
        string status,
        string summary,
        string adminPath,
        string? lastUpdatedAt,
        IReadOnlyList<string> missing,
        IReadOnlyDictionary<string, object?>? extra = null)
    {
        return new PilotLaunchReadinessSection(
            key,
            label,
            status,
            summary,
            adminPath,
            lastUpdatedAt,
            missing,
            extra);
    }

    private static string IsoNow() => FormatDate(DateTime.UtcNow)!;

    private static string? FormatDate(DateTime? value)
    {
        return value?.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    }
}

public sealed record PilotLaunchReadinessReport(
    [property: JsonPropertyName("generated_at")] string GeneratedAt,
    [property: JsonPropertyName("overall")] PilotLaunchReadinessOverall Overall,
    [property: JsonPropertyName("sections")] IReadOnlyList<PilotLaunchReadinessSection> Sections,
    [property: JsonPropertyName("isolated_node_required")] bool IsolatedNodeRequired,
    [property: JsonPropertyName("can_launch")] bool CanLaunch,
    [property: JsonPropertyName("blockers")] IReadOnlyList<PilotLaunchReadinessBlocker> Blockers,
    [property: JsonPropertyName("launched")] PilotLaunchState? Launched);

public sealed record PilotLaunchReadinessOverall(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("ready_section_count")] int ReadySectionCount,
    [property: JsonPropertyName("total_section_count")] int TotalSectionCount,
    [property: JsonPropertyName("summary")] string Summary);

public sealed record PilotLaunchReadinessSection(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("summary")] string Summary,
    [property: JsonPropertyName("admin_path")] string AdminPath,
    [property: JsonPropertyName("last_updated_at")] string? LastUpdatedAt,
    [property: JsonPropertyName("missing")] IReadOnlyList<string> Missing,
    [property: JsonPropertyName("extra")] IReadOnlyDictionary<string, object?>? Extra = null);

public sealed record PilotLaunchReadinessBlocker(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("status")] string Status);

public sealed record PilotLaunchState(
    [property: JsonPropertyName("launched_at")] string LaunchedAt,
    [property: JsonPropertyName("launched_by_id")] int LaunchedById);

public sealed record PilotLaunchReadinessAcknowledgement(
    [property: JsonPropertyName("acknowledged")] bool Acknowledged);

public sealed record PilotLaunchReadinessLaunchResult(
    string? Error = null,
    string? LaunchedAt = null,
    int? LaunchedById = null,
    IReadOnlyList<PilotLaunchReadinessBlocker>? Blockers = null,
    PilotLaunchState? Launched = null);
