// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

/// <summary>
/// Serializes generic organisation lifecycle, membership, and wallet writes.
/// Callers must hold a relational database transaction before acquiring it.
/// </summary>
internal static class OrganisationLifecycleLock
{
    internal static long Key(int organisationId) => (long)organisationId + int.MaxValue / 2;

    internal static async Task AcquireAsync(
        NexusDbContext db,
        int organisationId,
        CancellationToken cancellationToken = default)
    {
        await db.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            [Key(organisationId)],
            cancellationToken);
    }
}
