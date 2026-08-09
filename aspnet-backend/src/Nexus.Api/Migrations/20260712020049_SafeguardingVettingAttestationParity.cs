using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class SafeguardingVettingAttestationParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "legacy_sensitive_metadata_redacted",
                table: "vetting_records",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "policy_review_reason_code",
                table: "user_safeguarding_preferences",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "policy_review_required_at",
                table: "user_safeguarding_preferences",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "member_vetting_attestations",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    scheme_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    attestation_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    purpose_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scope_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "tenant"),
                    scope_identifier = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false, defaultValue: ""),
                    decision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    confirmed_by = table.Column<int>(type: "integer", nullable: true),
                    confirmed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_by = table.Column<int>(type: "integer", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revocation_reason_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: "1"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_member_vetting_attestations", x => x.id);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestations_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestations_users_confirmed_by",
                        column: x => x.confirmed_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestations_users_revoked_by",
                        column: x => x.revoked_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestations_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_policy_rotation_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    jurisdiction = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    scheme_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    attestation_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    purpose_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scope_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    scope_identifier = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false, defaultValue: ""),
                    previous_policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    new_policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    reason_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    actor_user_id = table.Column<int>(type: "integer", nullable: true),
                    affected_member_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_policy_rotation_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_safeguarding_policy_rotation_events_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_safeguarding_policy_rotation_events_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_vetting_review_requests",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    jurisdiction = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    scheme_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    attestation_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    purpose_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scope_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "tenant"),
                    scope_identifier = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false, defaultValue: ""),
                    policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    request_source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "member_request"),
                    requested_by = table.Column<int>(type: "integer", nullable: true),
                    requested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    handled_by = table.Column<int>(type: "integer", nullable: true),
                    handled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    resolution_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_vetting_review_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_safeguarding_vetting_review_requests_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_safeguarding_vetting_review_requests_users_handled_by",
                        column: x => x.handled_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_safeguarding_vetting_review_requests_users_requested_by",
                        column: x => x.requested_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_safeguarding_vetting_review_requests_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tenant_safeguarding_settings",
                columns: table => new
                {
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    jurisdiction = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: "1"),
                    configured_by = table.Column<int>(type: "integer", nullable: true),
                    configured_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_safeguarding_settings", x => x.tenant_id);
                    table.ForeignKey(
                        name: "FK_tenant_safeguarding_settings_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_tenant_safeguarding_settings_users_configured_by",
                        column: x => x.configured_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "member_vetting_attestation_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    attestation_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    scheme_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    attestation_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    purpose_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    scope_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    scope_identifier = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false, defaultValue: ""),
                    event_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    decision_before = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    decision_after = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    reason_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    actor_user_id = table.Column<int>(type: "integer", nullable: true),
                    policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_member_vetting_attestation_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestation_events_member_vetting_attestatio~",
                        column: x => x.attestation_id,
                        principalTable: "member_vetting_attestations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestation_events_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestation_events_users_actor_user_id",
                        column: x => x.actor_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_member_vetting_attestation_events_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_vetting_event_actor_history",
                table: "member_vetting_attestation_events",
                columns: new[] { "tenant_id", "actor_user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "idx_vetting_event_member_history",
                table: "member_vetting_attestation_events",
                columns: new[] { "tenant_id", "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestation_events_actor_user_id",
                table: "member_vetting_attestation_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestation_events_attestation_id",
                table: "member_vetting_attestation_events",
                column: "attestation_id");

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestation_events_user_id",
                table: "member_vetting_attestation_events",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "idx_member_vetting_policy_status",
                table: "member_vetting_attestations",
                columns: new[] { "tenant_id", "user_id", "attestation_code", "purpose_code", "decision" });

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestations_confirmed_by",
                table: "member_vetting_attestations",
                column: "confirmed_by");

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestations_revoked_by",
                table: "member_vetting_attestations",
                column: "revoked_by");

            migrationBuilder.CreateIndex(
                name: "IX_member_vetting_attestations_user_id",
                table: "member_vetting_attestations",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_member_vetting_attestation_scope",
                table: "member_vetting_attestations",
                columns: new[] { "tenant_id", "user_id", "scheme_code", "attestation_code", "purpose_code", "scope_type", "scope_identifier" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_safeguarding_policy_rotation_tenant",
                table: "safeguarding_policy_rotation_events",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_policy_rotation_events_actor_user_id",
                table: "safeguarding_policy_rotation_events",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "idx_vetting_review_member",
                table: "safeguarding_vetting_review_requests",
                columns: new[] { "tenant_id", "user_id", "purpose_code" });

            migrationBuilder.CreateIndex(
                name: "idx_vetting_review_queue",
                table: "safeguarding_vetting_review_requests",
                columns: new[] { "tenant_id", "status", "requested_at" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_vetting_review_requests_handled_by",
                table: "safeguarding_vetting_review_requests",
                column: "handled_by");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_vetting_review_requests_requested_by",
                table: "safeguarding_vetting_review_requests",
                column: "requested_by");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_vetting_review_requests_user_id",
                table: "safeguarding_vetting_review_requests",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_vetting_review_member_scope",
                table: "safeguarding_vetting_review_requests",
                columns: new[] { "tenant_id", "user_id", "purpose_code", "scope_type", "scope_identifier" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenant_safeguarding_settings_configured_by",
                table: "tenant_safeguarding_settings",
                column: "configured_by");

            // ASP.NET stores its legacy offer-attribute catalog as a JSON array
            // in tenant_configs rather than Laravel's attributes table. Apply
            // the same containment rule to the actual local source of truth:
            // member-selected historical claims must not remain active trust
            // signals. Invalid/custom catalog JSON is deliberately preserved.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    catalog RECORD;
                    parsed JSONB;
                    transformed JSONB;
                BEGIN
                    FOR catalog IN
                        SELECT "Id", "Value"
                        FROM tenant_configs
                        WHERE "Key" = 'attributes.catalog'
                    LOOP
                        BEGIN
                            parsed := catalog."Value"::jsonb;
                        EXCEPTION WHEN OTHERS THEN
                            CONTINUE;
                        END;

                        IF jsonb_typeof(parsed) <> 'array' THEN
                            CONTINUE;
                        END IF;

                        SELECT COALESCE(
                            jsonb_agg(
                                CASE
                                    WHEN COALESCE(item->>'Name', item->>'name') IN ('Background Checked', 'Garda Vetted')
                                        AND lower(COALESCE(item->>'Active', item->>'active', 'false')) IN ('true', '1')
                                        AND (
                                            lower(COALESCE(item->>'Metadata', item->>'metadata', '')) LIKE '%"target_type"%'
                                            OR lower(COALESCE(item->>'Metadata', item->>'metadata', '')) LIKE '%"targettype"%'
                                        )
                                        AND lower(COALESCE(item->>'Metadata', item->>'metadata', '')) LIKE '%"offer"%'
                                    THEN CASE
                                        WHEN item ? 'Active' THEN jsonb_set(item, '{Active}', 'false'::jsonb, false)
                                        ELSE jsonb_set(item, '{active}', 'false'::jsonb, false)
                                    END
                                    ELSE item
                                END
                                ORDER BY item_ordinal
                            ),
                            '[]'::jsonb)
                        INTO transformed
                        FROM jsonb_array_elements(parsed) WITH ORDINALITY AS items(item, item_ordinal);

                        IF transformed IS DISTINCT FROM parsed THEN
                            UPDATE tenant_configs
                            SET "Value" = transformed::text,
                                "UpdatedAt" = CURRENT_TIMESTAMP
                            WHERE "Id" = catalog."Id";
                        END IF;
                    END LOOP;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Safeguarding vetting attestation metadata is audit evidence and cannot be rolled back destructively.");
        }
    }
}
