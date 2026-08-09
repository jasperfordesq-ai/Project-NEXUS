using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class SafeguardingPreferenceDependencyParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The permissive legacy ASP index allowed a revoked row plus a new
            // active row for the same member/option. Choosing one would destroy
            // consent history, so fail before any DDL or data change and require
            // a reviewed forward reconciliation. Null consent timestamps are
            // content-free legacy gaps and can be backfilled losslessly from the
            // row's original creation time.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM user_safeguarding_preferences
                        GROUP BY "TenantId", "UserId", "OptionId"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION USING
                            ERRCODE = 'P0001',
                            MESSAGE = 'Safeguarding preference history contains duplicate tenant/user/option rows; review and reconcile without discarding consent evidence before retrying.';
                    END IF;
                END $$;

                UPDATE user_safeguarding_preferences
                SET "ConsentGivenAt" = "CreatedAt"
                WHERE "ConsentGivenAt" IS NULL;
                """);

            // Migration 20260709203703 created this table with raw SQL and can
            // also adopt a semantically exact pre-existing table. Constraint
            // and index names are therefore not EF's inferred names. Resolve
            // the two relationships and the legacy four-column index by their
            // actual definitions so every valid predecessor shape converges.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    object_name text;
                BEGIN
                    FOR object_name IN
                        SELECT constraint_row.conname
                        FROM pg_constraint constraint_row
                        WHERE constraint_row.conrelid = to_regclass('user_safeguarding_preferences')
                          AND constraint_row.contype = 'f'
                          AND constraint_row.confrelid IN (
                              to_regclass('tenants'),
                              to_regclass('safeguarding_options'))
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(constraint_row.conkey::smallint[])
                                  WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = constraint_row.conrelid
                               AND attribute_row.attnum = key_row.attnum
                          ) IN (ARRAY['TenantId']::text[], ARRAY['OptionId']::text[])
                    LOOP
                        EXECUTE format(
                            'ALTER TABLE user_safeguarding_preferences DROP CONSTRAINT %I',
                            object_name);
                    END LOOP;

                    FOR object_name IN
                        SELECT index_class.relname
                        FROM pg_index index_row
                        JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
                        WHERE index_row.indrelid = to_regclass('user_safeguarding_preferences')
                          AND NOT index_row.indisprimary
                          AND (
                              SELECT array_agg(attribute_row.attname::text ORDER BY key_row.ordinality)
                              FROM unnest(index_row.indkey::smallint[])
                                  WITH ORDINALITY AS key_row(attnum, ordinality)
                              JOIN pg_attribute attribute_row
                                ON attribute_row.attrelid = index_row.indrelid
                               AND attribute_row.attnum = key_row.attnum
                          ) = ARRAY['TenantId', 'UserId', 'OptionId', 'RevokedAt']::text[]
                    LOOP
                        EXECUTE format('DROP INDEX %I.%I', current_schema(), object_name);
                    END LOOP;
                END $$;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "SelectedValue",
                table: "user_safeguarding_preferences",
                type: "character varying(255)",
                maxLength: 255,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(120)",
                oldMaxLength: 120);

            migrationBuilder.AlterColumn<DateTime>(
                name: "ConsentGivenAt",
                table: "user_safeguarding_preferences",
                type: "timestamp with time zone",
                nullable: false,
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_safeguarding_preferences_TenantId_UserId_OptionId",
                table: "user_safeguarding_preferences",
                columns: new[] { "TenantId", "UserId", "OptionId" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_user_safeguarding_preferences_safeguarding_options_OptionId",
                table: "user_safeguarding_preferences",
                column: "OptionId",
                principalTable: "safeguarding_options",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_user_safeguarding_preferences_tenants_TenantId",
                table: "user_safeguarding_preferences",
                column: "TenantId",
                principalTable: "tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Canonical safeguarding preference reconciliation cannot be rolled back without reintroducing ambiguous consent state.");
        }
    }
}
