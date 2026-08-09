// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Configuration;

/// <summary>
/// Prevents deployment of the retired request-time administrator 2FA setup gate.
/// Unenrolled administrators cannot complete that flow with the canonical clients,
/// so enabling either historical setting would create an account lockout risk.
/// </summary>
public static class ForcedAdminTwoFactorGuard
{
    private static readonly string[] RetiredKeys = ["ForceAdmin2Fa", "FORCE_ADMIN_2FA"];

    public static void Validate(IConfiguration configuration)
    {
        var enabledKeys = RetiredKeys
            .Where(key => bool.TryParse(configuration[key]?.Trim(), out var enabled) && enabled)
            .ToArray();

        if (enabledKeys.Length == 0)
        {
            return;
        }

        throw new InvalidOperationException(
            $"Startup blocked: retired forced administrator 2FA setting(s) {string.Join(", ", enabledKeys)} " +
            "are enabled. This is a lockout risk because the canonical clients do not provide a compatible " +
            "first-time setup flow during login. Leave ForceAdmin2Fa and FORCE_ADMIN_2FA false or unset; " +
            "administrators must enroll through the authenticated security settings flow.");
    }
}
