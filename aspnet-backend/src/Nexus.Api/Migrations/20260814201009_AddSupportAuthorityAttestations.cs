using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSupportAuthorityAttestations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "support_authority_attestations",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    relationship_id = table.Column<int>(type: "integer", nullable: false),
                    supported_user_id = table.Column<int>(type: "integer", nullable: false),
                    authority_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    acknowledged_sighted = table.Column<bool>(type: "boolean", nullable: false),
                    scope_summary_encrypted = table.Column<string>(type: "text", nullable: true),
                    private_notes_encrypted = table.Column<string>(type: "text", nullable: true),
                    decision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    attested_by = table.Column<int>(type: "integer", nullable: true),
                    attested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_by = table.Column<int>(type: "integer", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revocation_reason_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    policy_version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: "1"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_support_authority_attestations", x => x.id);
                    table.CheckConstraint("CK_SupportAuthorityAttestations_Decision", "\"decision\" IN ('active', 'revoked')");
                    table.CheckConstraint("CK_SupportAuthorityAttestations_Type", "\"authority_type\" IN ('dmr_court_order', 'power_of_attorney', 'edm_assistant_agreement', 'co_decision_agreement')");
                    table.ForeignKey(
                        name: "FK_support_authority_attestations_account_relationships_relati~",
                        column: x => x.relationship_id,
                        principalTable: "account_relationships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_support_authority_attestations_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_support_authority_attestations_users_supported_user_id",
                        column: x => x.supported_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "support_authority_attestation_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    attestation_id = table.Column<long>(type: "bigint", nullable: false),
                    relationship_id = table.Column<int>(type: "integer", nullable: false),
                    supported_user_id = table.Column<int>(type: "integer", nullable: false),
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
                    table.PrimaryKey("PK_support_authority_attestation_events", x => x.id);
                    table.CheckConstraint("CK_SupportAuthorityAttestationEvents_Type", "\"event_type\" IN ('attested', 're_attested', 'revoked')");
                    table.ForeignKey(
                        name: "FK_support_authority_attestation_events_support_authority_atte~",
                        column: x => x.attestation_id,
                        principalTable: "support_authority_attestations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_support_authority_attestation_events_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestation_events_attestation_id",
                table: "support_authority_attestation_events",
                column: "attestation_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestation_events_tenant_id_attestation_~",
                table: "support_authority_attestation_events",
                columns: new[] { "tenant_id", "attestation_id", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestation_events_tenant_id_supported_us~",
                table: "support_authority_attestation_events",
                columns: new[] { "tenant_id", "supported_user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestations_relationship_id",
                table: "support_authority_attestations",
                column: "relationship_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestations_supported_user_id",
                table: "support_authority_attestations",
                column: "supported_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestations_tenant_id_relationship_id_au~",
                table: "support_authority_attestations",
                columns: new[] { "tenant_id", "relationship_id", "authority_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_support_authority_attestations_tenant_id_supported_user_id_~",
                table: "support_authority_attestations",
                columns: new[] { "tenant_id", "supported_user_id", "decision" });

            // Attestation history is append-only: refuse UPDATE and DELETE at
            // the database level, mirroring Laravel's trg_saa_events triggers.
            // The same no-delete guard is retrofitted onto
            // account_relationship_events, which Laravel also protects.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION support_authority_attestation_events_immutable()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'support_authority_attestation_events_immutable';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_saa_events_no_update
                BEFORE UPDATE ON support_authority_attestation_events
                FOR EACH ROW EXECUTE FUNCTION support_authority_attestation_events_immutable();

                CREATE TRIGGER trg_saa_events_no_delete
                BEFORE DELETE ON support_authority_attestation_events
                FOR EACH ROW EXECUTE FUNCTION support_authority_attestation_events_immutable();

                CREATE TRIGGER trg_ar_events_no_delete
                BEFORE DELETE ON account_relationship_events
                FOR EACH ROW EXECUTE FUNCTION account_relationship_events_no_update();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_ar_events_no_delete ON account_relationship_events;
                DROP TRIGGER IF EXISTS trg_saa_events_no_delete ON support_authority_attestation_events;
                DROP TRIGGER IF EXISTS trg_saa_events_no_update ON support_authority_attestation_events;
                DROP FUNCTION IF EXISTS support_authority_attestation_events_immutable();
                """);

            migrationBuilder.DropTable(
                name: "support_authority_attestation_events");

            migrationBuilder.DropTable(
                name: "support_authority_attestations");
        }
    }
}
