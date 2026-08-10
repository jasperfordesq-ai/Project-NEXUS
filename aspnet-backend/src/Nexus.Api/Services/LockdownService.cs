// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for emergency platform lockdown.
/// Activates/deactivates lockdown mode by storing state in SystemSettings
/// and deactivating/reactivating tenants.
/// </summary>
public class LockdownService
{
    private const string LockdownKey = "system.lockdown";
    private const string TenantStatesKey = "system.lockdown.tenant_states";
    private const string LockdownCategory = "security";

    private readonly NexusDbContext _db;
    private readonly ILogger<LockdownService> _logger;

    public LockdownService(NexusDbContext db, ILogger<LockdownService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Activate emergency lockdown. Stores pre-lockdown tenant states,
    /// deactivates all non-system tenants, and records lockdown metadata.
    /// </summary>
    public async Task<LockdownStatus> ActivateLockdownAsync(int adminId, string reason)
    {
        // Check if already in lockdown
        var existing = await _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == LockdownKey);

        if (existing?.Value == "true")
        {
            _logger.LogWarning("Lockdown activation attempted by admin {AdminId} but lockdown is already active", adminId);
            return await GetLockdownStatusAsync();
        }

        // Snapshot current tenant active states before lockdown
        var tenants = await _db.Tenants.ToListAsync();
        var tenantStates = tenants.ToDictionary(t => t.Id, t => t.IsActive);
        var tenantStatesJson = JsonSerializer.Serialize(tenantStates);

        // Store tenant states
        await UpsertSettingAsync(TenantStatesKey, tenantStatesJson,
            "Pre-lockdown tenant active states", LockdownCategory, adminId);

        // Build lockdown metadata
        var lockdownMeta = JsonSerializer.Serialize(new
        {
            active = true,
            reason,
            activated_at = DateTime.UtcNow,
            activated_by = adminId
        });

        // Activate lockdown setting
        await UpsertSettingAsync(LockdownKey, "true",
            lockdownMeta, LockdownCategory, adminId);

        // Deactivate all tenants
        var activeTenants = tenants.Where(t => t.IsActive).ToList();
        foreach (var tenant in activeTenants)
        {
            tenant.IsActive = false;
            tenant.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogCritical(
            "EMERGENCY LOCKDOWN ACTIVATED by admin {AdminId}. Reason: {Reason}. {Count} tenants deactivated.",
            adminId, reason, activeTenants.Count);

        return await GetLockdownStatusAsync();
    }

    /// <summary>
    /// Deactivate lockdown. Restores tenants to their pre-lockdown states.
    /// </summary>
    public async Task<LockdownStatus> DeactivateLockdownAsync(int adminId)
    {
        var lockdownSetting = await _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == LockdownKey);

        if (lockdownSetting == null || lockdownSetting.Value != "true")
        {
            _logger.LogWarning("Lockdown deactivation attempted by admin {AdminId} but lockdown is not active", adminId);
            return await GetLockdownStatusAsync();
        }

        // Restore tenant states from snapshot
        var tenantStatesSetting = await _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == TenantStatesKey);

        if (tenantStatesSetting != null && !string.IsNullOrWhiteSpace(tenantStatesSetting.Value))
        {
            var savedStates = JsonSerializer.Deserialize<Dictionary<int, bool>>(tenantStatesSetting.Value);
            if (savedStates != null)
            {
                var tenants = await _db.Tenants.ToListAsync();
                foreach (var tenant in tenants)
                {
                    if (savedStates.TryGetValue(tenant.Id, out var wasActive))
                    {
                        tenant.IsActive = wasActive;
                        tenant.UpdatedAt = DateTime.UtcNow;
                    }
                }
            }
        }

        // Clear lockdown
        lockdownSetting.Value = "false";
        lockdownSetting.Description = JsonSerializer.Serialize(new
        {
            active = false,
            deactivated_at = DateTime.UtcNow,
            deactivated_by = adminId
        });
        lockdownSetting.UpdatedById = adminId;
        lockdownSetting.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogCritical(
            "EMERGENCY LOCKDOWN DEACTIVATED by admin {AdminId}. Tenant states restored.",
            adminId);

        return await GetLockdownStatusAsync();
    }

    /// <summary>
    /// Get current lockdown status including reason and activation details.
    /// </summary>
    public async Task<LockdownStatus> GetLockdownStatusAsync()
    {
        var setting = await _db.Set<SystemSetting>()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == LockdownKey);

        if (setting == null || setting.Value != "true")
        {
            return new LockdownStatus { IsActive = false };
        }

        // Parse metadata from Description field
        var status = new LockdownStatus { IsActive = true };

        if (!string.IsNullOrWhiteSpace(setting.Description))
        {
            try
            {
                using var doc = JsonDocument.Parse(setting.Description);
                var root = doc.RootElement;

                if (root.TryGetProperty("reason", out var reasonProp))
                    status.Reason = reasonProp.GetString();

                if (root.TryGetProperty("activated_at", out var atProp) &&
                    atProp.TryGetDateTime(out var activatedAt))
                    status.ActivatedAt = activatedAt;

                if (root.TryGetProperty("activated_by", out var byProp) &&
                    byProp.TryGetInt32(out var activatedBy))
                    status.ActivatedBy = activatedBy;
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Failed to parse lockdown metadata from setting description");
            }
        }

        return status;
    }

    /// <summary>
    /// Check if lockdown is currently active. Lightweight check for middleware use.
    /// </summary>
    public async Task<bool> IsLockdownActiveAsync()
    {
        var setting = await _db.Set<SystemSetting>()
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == LockdownKey);

        return setting?.Value == "true";
    }

    private async Task UpsertSettingAsync(string key, string value, string? description, string category, int adminId)
    {
        var existing = await _db.Set<SystemSetting>()
            .FirstOrDefaultAsync(s => s.Key == key);

        if (existing != null)
        {
            existing.Value = value;
            existing.Description = description;
            existing.Category = category;
            existing.UpdatedById = adminId;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _db.Set<SystemSetting>().Add(new SystemSetting
            {
                Key = key,
                Value = value,
                Description = description,
                Category = category,
                IsSecret = false,
                UpdatedById = adminId
            });
        }

        await _db.SaveChangesAsync();
    }
}

/// <summary>
/// Represents the current lockdown status.
/// </summary>
public class LockdownStatus
{
    public bool IsActive { get; set; }
    public string? Reason { get; set; }
    public DateTime? ActivatedAt { get; set; }
    public int? ActivatedBy { get; set; }
}
