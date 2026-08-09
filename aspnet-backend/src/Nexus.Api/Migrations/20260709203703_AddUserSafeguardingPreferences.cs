// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Nexus.Api.Data;

#nullable disable

namespace Nexus.Api.Migrations;

[DbContext(typeof(NexusDbContext))]
[Migration("20260709203703_AddUserSafeguardingPreferences")]
public partial class AddUserSafeguardingPreferences : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DO $$
            DECLARE
                actual_columns jsonb;
                expected_columns jsonb := jsonb_build_object(
                    'Id',                   jsonb_build_array('integer', 'NO', NULL, 'YES'),
                    'TenantId',             jsonb_build_array('integer', 'NO', NULL, 'NO'),
                    'UserId',               jsonb_build_array('integer', 'NO', NULL, 'NO'),
                    'OptionId',             jsonb_build_array('integer', 'NO', NULL, 'NO'),
                    'SelectedValue',         jsonb_build_array('character varying', 'NO', 120, 'NO'),
                    'Notes',                 jsonb_build_array('character varying', 'YES', 2000, 'NO'),
                    'ConsentGivenAt',        jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'),
                    'ConsentIp',             jsonb_build_array('character varying', 'YES', 64, 'NO'),
                    'RevokedAt',             jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'),
                    'ReviewReminderSentAt',  jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'),
                    'ReviewConfirmedAt',     jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'),
                    'ReviewEscalatedAt',     jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'),
                    'CreatedAt',             jsonb_build_array('timestamp with time zone', 'NO', NULL, 'NO'),
                    'UpdatedAt',             jsonb_build_array('timestamp with time zone', 'YES', NULL, 'NO'));
            BEGIN
                IF to_regclass('user_safeguarding_preferences') IS NOT NULL THEN
                    SELECT jsonb_object_agg(
                        column_name,
                        jsonb_build_array(data_type, is_nullable, character_maximum_length, is_identity))
                    INTO actual_columns
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'user_safeguarding_preferences';

                    IF actual_columns IS DISTINCT FROM expected_columns THEN
                        RAISE EXCEPTION
                            'Existing user_safeguarding_preferences has an unexpected column fingerprint; refusing partial reconciliation. Expected %, found %',
                            expected_columns,
                            actual_columns;
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = to_regclass('user_safeguarding_preferences')
                          AND constraint_row.contype = 'p'
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(constraint_row.conkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = constraint_row.conrelid
                               AND attribute_row.attnum = key_row.attnum) = ARRAY['Id']::text[]) THEN
                        RAISE EXCEPTION 'Existing user_safeguarding_preferences is missing the canonical Id primary key.';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = to_regclass('user_safeguarding_preferences')
                          AND constraint_row.contype = 'f'
                          AND constraint_row.confrelid = to_regclass('tenants')
                          AND constraint_row.confdeltype = 'r'
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(constraint_row.conkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = constraint_row.conrelid
                               AND attribute_row.attnum = key_row.attnum) = ARRAY['TenantId']::text[]) THEN
                        RAISE EXCEPTION 'Existing user_safeguarding_preferences has no canonical TenantId foreign key.';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = to_regclass('user_safeguarding_preferences')
                          AND constraint_row.contype = 'f'
                          AND constraint_row.confrelid = to_regclass('users')
                          AND constraint_row.confdeltype = 'c'
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(constraint_row.conkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = constraint_row.conrelid
                               AND attribute_row.attnum = key_row.attnum) = ARRAY['UserId']::text[]) THEN
                        RAISE EXCEPTION 'Existing user_safeguarding_preferences has no canonical UserId foreign key.';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = to_regclass('user_safeguarding_preferences')
                          AND constraint_row.contype = 'f'
                          AND constraint_row.confrelid = to_regclass('safeguarding_options')
                          AND constraint_row.confdeltype = 'r'
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(constraint_row.conkey::smallint[]) WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = constraint_row.conrelid
                               AND attribute_row.attnum = key_row.attnum) = ARRAY['OptionId']::text[]) THEN
                        RAISE EXCEPTION 'Existing user_safeguarding_preferences has no canonical OptionId foreign key.';
                    END IF;
                END IF;
            END $$;

            CREATE TABLE IF NOT EXISTS user_safeguarding_preferences (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "TenantId" integer NOT NULL REFERENCES tenants("Id") ON DELETE RESTRICT,
                "UserId" integer NOT NULL REFERENCES users("Id") ON DELETE CASCADE,
                "OptionId" integer NOT NULL REFERENCES safeguarding_options("Id") ON DELETE RESTRICT,
                "SelectedValue" character varying(120) NOT NULL DEFAULT 'true',
                "Notes" character varying(2000) NULL,
                "ConsentGivenAt" timestamp with time zone NULL,
                "ConsentIp" character varying(64) NULL,
                "RevokedAt" timestamp with time zone NULL,
                "ReviewReminderSentAt" timestamp with time zone NULL,
                "ReviewConfirmedAt" timestamp with time zone NULL,
                "ReviewEscalatedAt" timestamp with time zone NULL,
                "CreatedAt" timestamp with time zone NOT NULL DEFAULT now(),
                "UpdatedAt" timestamp with time zone NULL
            );

            CREATE INDEX IF NOT EXISTS "IX_user_safeguarding_preferences_tenant_user_option_revoked"
                ON user_safeguarding_preferences ("TenantId", "UserId", "OptionId", "RevokedAt");

            CREATE INDEX IF NOT EXISTS "IX_user_safeguarding_preferences_tenant_review_reminder"
                ON user_safeguarding_preferences ("TenantId", "ReviewReminderSentAt");

            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_index index_row
                    WHERE index_row.indrelid = to_regclass('user_safeguarding_preferences')
                      AND pg_get_indexdef(index_row.indexrelid) LIKE
                          '%("TenantId", "UserId", "OptionId", "RevokedAt")%') THEN
                    RAISE EXCEPTION 'Canonical tenant/user/option/revoked safeguarding preference index is missing.';
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_index index_row
                    WHERE index_row.indrelid = to_regclass('user_safeguarding_preferences')
                      AND pg_get_indexdef(index_row.indexrelid) LIKE
                          '%("TenantId", "ReviewReminderSentAt")%') THEN
                    RAISE EXCEPTION 'Canonical tenant/review-reminder safeguarding preference index is missing.';
                END IF;
            END $$;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Intentionally irreversible. Up may adopt an exact pre-existing table;
        // dropping it on rollback would destroy data that this migration did not
        // create. Removing the history row and re-applying remains safe because Up
        // fingerprints the table before recording success.
    }
}
