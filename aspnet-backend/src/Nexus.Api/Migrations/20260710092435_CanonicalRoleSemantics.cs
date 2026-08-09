using Microsoft.EntityFrameworkCore.Migrations;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class CanonicalRoleSemantics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_admin",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_god",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_super_admin",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_tenant_super_admin",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Retired ASP.NET role aliases cannot survive as writable role
            // values. Preserve the only legacy tenant-super signal while the
            // new explicit flag is introduced, then normalize the role.
            migrationBuilder.Sql("""
                UPDATE "users"
                SET "Role" = 'member'
                WHERE "Role" IN ('moderator', 'newsletter_admin');

                UPDATE "users"
                SET "Role" = 'admin',
                    "is_tenant_super_admin" = TRUE
                WHERE "Role" = 'tenant_admin';
                """);

            // Earlier ASP.NET builds stored platform-super grants as JSON
            // arrays in tenant_configs. Validate every legacy row before
            // adopting it: malformed, non-array, non-integer, non-positive,
            // or out-of-range values stop deployment for operator review.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    config_row RECORD;
                    config_item jsonb;
                    scalar_value text;
                BEGIN
                    FOR config_row IN
                        SELECT "Id", "Value"
                        FROM "tenant_configs"
                        WHERE "Key" = 'super_admins.global_user_ids'
                    LOOP
                        BEGIN
                            IF jsonb_typeof(config_row."Value"::jsonb) <> 'array' THEN
                                RAISE EXCEPTION 'value is not a JSON array';
                            END IF;

                            FOR config_item IN
                                SELECT value
                                FROM jsonb_array_elements(config_row."Value"::jsonb)
                            LOOP
                                scalar_value := config_item #>> '{}';
                                IF jsonb_typeof(config_item) NOT IN ('number', 'string')
                                   OR scalar_value IS NULL
                                   OR scalar_value !~ '^[0-9]+$'
                                   OR scalar_value::numeric < 1
                                   OR scalar_value::numeric > 2147483647 THEN
                                    RAISE EXCEPTION 'array contains a value that is not a positive 32-bit integer';
                                END IF;
                            END LOOP;
                        EXCEPTION WHEN OTHERS THEN
                            RAISE EXCEPTION
                                'Cannot adopt tenant_configs row % as platform-super grants: %',
                                config_row."Id",
                                SQLERRM;
                        END;
                    END LOOP;
                END $$;
                """);

            migrationBuilder.Sql("""
                WITH configured_ids AS (
                    SELECT DISTINCT (item.value #>> '{}')::integer AS user_id
                    FROM "tenant_configs" AS config
                    CROSS JOIN LATERAL jsonb_array_elements(config."Value"::jsonb) AS item(value)
                    WHERE config."Key" = 'super_admins.global_user_ids'
                )
                UPDATE "users" AS target
                SET "is_super_admin" = TRUE,
                    "Role" = CASE WHEN target."Role" = 'member' THEN 'admin' ELSE target."Role" END
                FROM configured_ids
                WHERE target."Id" = configured_ids.user_id;
                """);

            migrationBuilder.CreateIndex(
                name: "idx_users_is_god",
                table: "users",
                column: "is_god");

            migrationBuilder.CreateIndex(
                name: "idx_users_is_super_admin",
                table: "users",
                column: "is_super_admin");

            migrationBuilder.CreateIndex(
                name: "idx_users_role",
                table: "users",
                column: "Role");

            migrationBuilder.CreateIndex(
                name: "idx_users_tenant_role",
                table: "users",
                columns: new[] { "TenantId", "Role" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Role normalization and legacy JSON-grant adoption are
            // intentionally irreversible: after deployment there is no safe
            // way to distinguish an original canonical role/flag from an
            // adopted one. Down removes only the schema introduced here.
            migrationBuilder.DropIndex(
                name: "idx_users_is_god",
                table: "users");

            migrationBuilder.DropIndex(
                name: "idx_users_is_super_admin",
                table: "users");

            migrationBuilder.DropIndex(
                name: "idx_users_role",
                table: "users");

            migrationBuilder.DropIndex(
                name: "idx_users_tenant_role",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_admin",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_god",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_super_admin",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_tenant_super_admin",
                table: "users");
        }
    }
}
