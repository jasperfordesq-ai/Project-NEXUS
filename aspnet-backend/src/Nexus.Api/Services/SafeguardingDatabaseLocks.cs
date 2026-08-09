// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

internal static class SafeguardingDatabaseLocks
{
    public static async Task AcquireTenantPolicyLockAsync(
        NexusDbContext db,
        int tenantId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres(db))
        {
            return;
        }
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("A database transaction is required before locking safeguarding policy state.");
        }

        await db.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM tenants WHERE \"Id\" = {0} FOR UPDATE",
            [tenantId],
            cancellationToken);
    }

    public static async Task LockMemberAttestationsAsync(
        NexusDbContext db,
        int tenantId,
        int memberId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres(db))
        {
            return;
        }
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("A database transaction is required before locking safeguarding attestations.");
        }

        await db.Database.ExecuteSqlRawAsync(
            "SELECT id FROM member_vetting_attestations WHERE tenant_id = {0} AND user_id = {1} ORDER BY id FOR UPDATE",
            [tenantId, memberId],
            cancellationToken);
    }

    public static async Task LockRecipientPreferencesAndOptionsAsync(
        NexusDbContext db,
        int tenantId,
        int recipientId,
        CancellationToken cancellationToken)
    {
        if (!IsPostgres(db))
        {
            return;
        }
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("A database transaction is required before locking safeguarding preferences.");
        }

        await db.Database.ExecuteSqlRawAsync(
            "SELECT \"Id\" FROM user_safeguarding_preferences WHERE \"TenantId\" = {0} AND \"UserId\" = {1} AND \"RevokedAt\" IS NULL ORDER BY \"Id\" FOR UPDATE",
            [tenantId, recipientId],
            cancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "SELECT o.\"Id\" FROM safeguarding_options o JOIN user_safeguarding_preferences p ON p.\"OptionId\" = o.\"Id\" AND p.\"TenantId\" = o.\"TenantId\" WHERE p.\"TenantId\" = {0} AND p.\"UserId\" = {1} AND p.\"RevokedAt\" IS NULL ORDER BY o.\"Id\" FOR UPDATE OF o",
            [tenantId, recipientId],
            cancellationToken);
    }

    private static bool IsPostgres(NexusDbContext db)
        => db.Database.ProviderName?.Contains("Npgsql", StringComparison.OrdinalIgnoreCase) == true;
}
