// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Laravel-compatible status read model for KISS/Caring Community role presets.
/// </summary>
public sealed class CaringCommunityRolePresetService
{
    private static readonly IReadOnlyDictionary<string, RolePreset> Presets = new Dictionary<string, RolePreset>
    {
        ["national_admin"] = new(
            "KISS National Foundation Admin",
            "Cross-program oversight, reporting standards, federation view, and network governance.",
            90,
            [
                "caring.view",
                "caring.configure",
                "caring.workflow.review",
                "caring.workflow.assign",
                "caring.reports.view",
                "caring.reports.export",
                "national.kiss_dashboard.view",
                "volunteering.hours.review",
                "volunteering.organisations.manage",
                "members.assisted_onboarding",
                "safeguarding.view",
                "federation.nodes.view"
            ]),
        ["canton_admin"] = new(
            "KISS Canton Admin",
            "Regional operating view, municipal coordination, reporting, and trusted partner oversight.",
            80,
            [
                "caring.view",
                "caring.workflow.review",
                "caring.workflow.assign",
                "caring.reports.view",
                "caring.reports.export",
                "volunteering.hours.review",
                "volunteering.organisations.manage",
                "members.assisted_onboarding",
                "federation.nodes.view"
            ]),
        ["municipality_admin"] = new(
            "KISS Municipality Admin",
            "Local participation, requests, organisations, and public-sector reporting.",
            70,
            [
                "caring.view",
                "caring.workflow.review",
                "caring.reports.view",
                "caring.reports.export",
                "volunteering.hours.review",
                "volunteering.organisations.manage",
                "members.assisted_onboarding"
            ]),
        ["cooperative_coordinator"] = new(
            "KISS Cooperative Coordinator",
            "Member onboarding, matching, hour review, and sensitive support escalation.",
            60,
            [
                "caring.view",
                "caring.workflow.review",
                "caring.workflow.assign",
                "volunteering.hours.review",
                "members.assisted_onboarding",
                "safeguarding.view"
            ]),
        ["organisation_coordinator"] = new(
            "KISS Organisation Coordinator",
            "Opportunity management, volunteer rosters, logged hours, and partner activity.",
            50,
            [
                "caring.view",
                "caring.workflow.review",
                "volunteering.hours.review",
                "volunteering.opportunities.manage"
            ]),
        ["trusted_reviewer"] = new(
            "KISS Trusted Volunteer Reviewer",
            "Limited review authority for approved hour logs and community trust signals.",
            40,
            [
                "caring.view",
                "caring.workflow.review",
                "volunteering.hours.review"
            ])
    };

    private readonly NexusDbContext _db;

    public CaringCommunityRolePresetService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsCaringCommunityEnabledAsync(int tenantId, CancellationToken ct)
    {
        var value = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(config => config.TenantId == tenantId && config.Key == "features.caring_community")
            .Select(config => config.Value)
            .FirstOrDefaultAsync(ct);

        return IsTruthy(value);
    }

    public async Task<object> StatusAsync(int tenantId, CancellationToken ct)
    {
        var roles = await _db.Roles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(role => role.TenantId == tenantId)
            .ToDictionaryAsync(role => role.Name, role => role, ct);

        var presetRows = Presets
            .Select(entry => PresetStatus(tenantId, entry.Key, entry.Value, roles))
            .ToArray();

        return new
        {
            available = true,
            installed_count = presetRows.Count(preset => preset.Installed),
            total_count = presetRows.Length,
            presets = presetRows.Select(preset => new
            {
                key = preset.Key,
                role_name = preset.RoleName,
                role_id = preset.RoleId,
                installed = preset.Installed,
                permission_count = preset.PermissionCount,
                installed_permissions = preset.InstalledPermissions
            }).ToArray()
        };
    }

    public async Task<object> InstallAsync(int tenantId, string? presetKey, CancellationToken ct)
    {
        var selectedPresets = !string.IsNullOrWhiteSpace(presetKey) && Presets.ContainsKey(presetKey)
            ? Presets.Where(entry => entry.Key == presetKey)
            : Presets;
        var now = DateTime.UtcNow;

        foreach (var (key, preset) in selectedPresets)
        {
            var roleName = RoleName(tenantId, key);
            var role = await _db.Roles
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(row => row.TenantId == tenantId && row.Name == roleName, ct);

            if (role is null)
            {
                role = new Role
                {
                    TenantId = tenantId,
                    Name = roleName,
                    CreatedAt = now,
                    IsSystem = false
                };
                _db.Roles.Add(role);
            }
            else
            {
                role.UpdatedAt = now;
            }

            role.Description = preset.Description;
            role.Permissions = JsonSerializer.Serialize(MergePermissions(role.Permissions, preset.Permissions));
        }

        await _db.SaveChangesAsync(ct);
        return await StatusAsync(tenantId, ct);
    }

    private static IReadOnlyList<string> MergePermissions(string? existingPermissions, IReadOnlyList<string> presetPermissions)
    {
        var merged = ParsePermissions(existingPermissions).ToList();
        foreach (var permission in presetPermissions)
        {
            if (!merged.Contains(permission, StringComparer.Ordinal))
            {
                merged.Add(permission);
            }
        }

        return merged;
    }

    private static PresetStatusRow PresetStatus(
        int tenantId,
        string key,
        RolePreset preset,
        IReadOnlyDictionary<string, Role> roles)
    {
        var roleName = RoleName(tenantId, key);
        roles.TryGetValue(roleName, out var role);
        var rolePermissions = ParsePermissions(role?.Permissions);
        var installedPermissions = preset.Permissions.Count(permission => rolePermissions.Contains(permission));

        return new PresetStatusRow(
            key,
            roleName,
            role?.Id,
            role is not null && installedPermissions == preset.Permissions.Count,
            preset.Permissions.Count,
            installedPermissions);
    }

    private static HashSet<string> ParsePermissions(string? permissions)
    {
        if (string.IsNullOrWhiteSpace(permissions))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(permissions)
                ?.Where(permission => !string.IsNullOrWhiteSpace(permission))
                .ToHashSet(StringComparer.Ordinal)
                ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string RoleName(int tenantId, string key)
    {
        return $"kiss_{key}_t{tenantId}";
    }

    private static bool IsTruthy(string? value)
    {
        return value?.Trim().ToLowerInvariant() is "1" or "true" or "yes" or "on";
    }

    private sealed record RolePreset(
        string DisplayName,
        string Description,
        int Level,
        IReadOnlyList<string> Permissions);

    private sealed record PresetStatusRow(
        string Key,
        string RoleName,
        int? RoleId,
        bool Installed,
        int PermissionCount,
        int InstalledPermissions);
}
