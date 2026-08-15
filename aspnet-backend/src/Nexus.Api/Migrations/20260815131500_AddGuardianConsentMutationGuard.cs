// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations;

/// <summary>
/// Ports Laravel's <c>trg_event_guardian_consent_update</c>
/// (database/migrations/2026_07_11_000060_create_event_safety_foundation.php:728-733)
/// to PostgreSQL.
///
/// 🔴 Why this exists. The 2026-08-15 audit found ASP.NET created only
/// <c>trg_event_guardian_history_no_update</c> and
/// <c>trg_event_guardian_consent_no_delete</c> — there was NO update guard on
/// <c>event_guardian_consents</c> itself. The application enforces the state
/// machine, but nothing below it did: a bad UPDATE (a bug, a manual fix, a future
/// endpoint) could rewrite a guardian's encrypted identity, swap the token hash,
/// move the expiry, or resurrect a withdrawn consent, and the row would still
/// look valid. For a record that evidences a parent's permission for a child to
/// attend an event, the database is the right place to make that impossible.
///
/// The four rules mirror Laravel exactly, including its error strings:
///   identity columns immutable · terminal states frozen ·
///   consent_version strictly +1 · only pending→active|withdrawn|expired and
///   active→withdrawn|expired.
///
/// The existing application writes satisfy all four: GrantGuardianAsync moves
/// pending→active and WithdrawGuardianAsync moves pending|active→withdrawn, each
/// incrementing ConsentVersion by exactly one.
/// </summary>
public partial class AddGuardianConsentMutationGuard : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            CREATE OR REPLACE FUNCTION event_guardian_consent_guard() RETURNS trigger AS $guard$
            BEGIN
                IF NEW."Id" IS DISTINCT FROM OLD."Id"
                    OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                    OR NEW."EventId" IS DISTINCT FROM OLD."EventId"
                    OR NEW."RequirementsId" IS DISTINCT FROM OLD."RequirementsId"
                    OR NEW."RequirementsVersionId" IS DISTINCT FROM OLD."RequirementsVersionId"
                    OR NEW."RequirementsVersionNumber" IS DISTINCT FROM OLD."RequirementsVersionNumber"
                    OR NEW."MinorUserId" IS DISTINCT FROM OLD."MinorUserId"
                    OR NEW."GuardianEmailCiphertext" IS DISTINCT FROM OLD."GuardianEmailCiphertext"
                    OR NEW."GuardianIdentityCiphertext" IS DISTINCT FROM OLD."GuardianIdentityCiphertext"
                    OR NEW."GuardianEmailBlindHash" IS DISTINCT FROM OLD."GuardianEmailBlindHash"
                    OR NEW."RelationshipCode" IS DISTINCT FROM OLD."RelationshipCode"
                    OR NEW."ConsentTextHash" IS DISTINCT FROM OLD."ConsentTextHash"
                    OR NEW."PolicyBindingHash" IS DISTINCT FROM OLD."PolicyBindingHash"
                    OR NEW."TokenHash" IS DISTINCT FROM OLD."TokenHash"
                    OR NEW."RequestedByUserId" IS DISTINCT FROM OLD."RequestedByUserId"
                    OR NEW."RequestIdempotencyHash" IS DISTINCT FROM OLD."RequestIdempotencyHash"
                    OR NEW."RequestHash" IS DISTINCT FROM OLD."RequestHash"
                    OR NEW."RequestedAt" IS DISTINCT FROM OLD."RequestedAt"
                    OR NEW."ExpiresAt" IS DISTINCT FROM OLD."ExpiresAt"
                    OR NEW."CreatedAt" IS DISTINCT FROM OLD."CreatedAt"
                THEN
                    RAISE EXCEPTION 'event_guardian_consent_identity_immutable';
                END IF;

                IF OLD."Status" IN ('withdrawn','expired') THEN
                    RAISE EXCEPTION 'event_guardian_consent_terminal_immutable';
                END IF;

                IF NEW."ConsentVersion" <> OLD."ConsentVersion" + 1 THEN
                    RAISE EXCEPTION 'event_guardian_consent_version_invalid';
                END IF;

                IF (OLD."Status" = 'pending' AND NEW."Status" NOT IN ('active','withdrawn','expired'))
                    OR (OLD."Status" = 'active' AND NEW."Status" NOT IN ('withdrawn','expired'))
                THEN
                    RAISE EXCEPTION 'event_guardian_consent_transition_invalid';
                END IF;

                RETURN NEW;
            END;
            $guard$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_event_guardian_consent_update ON event_guardian_consents;
            CREATE TRIGGER trg_event_guardian_consent_update
                BEFORE UPDATE ON event_guardian_consents
                FOR EACH ROW EXECUTE FUNCTION event_guardian_consent_guard();
            """);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TRIGGER IF EXISTS trg_event_guardian_consent_update ON event_guardian_consents;
            DROP FUNCTION IF EXISTS event_guardian_consent_guard();
            """);
    }
}
