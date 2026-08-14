using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSupporterMessageViewAudits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "supporter_message_view_audits",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    relationship_id = table.Column<int>(type: "integer", nullable: false),
                    supporter_user_id = table.Column<int>(type: "integer", nullable: false),
                    supported_user_id = table.Column<int>(type: "integer", nullable: false),
                    partner_user_id = table.Column<int>(type: "integer", nullable: true),
                    action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    purpose = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    correlation_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_supporter_message_view_audits", x => x.id);
                    table.CheckConstraint("CK_SupporterMessageViewAudits_Action", "\"action\" IN ('list', 'read')");
                    table.ForeignKey(
                        name: "FK_supporter_message_view_audits_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_supporter_message_view_audits_tenant_id_supported_user_id_c~",
                table: "supporter_message_view_audits",
                columns: new[] { "tenant_id", "supported_user_id", "created_at", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_supporter_message_view_audits_tenant_id_supporter_user_id_c~",
                table: "supporter_message_view_audits",
                columns: new[] { "tenant_id", "supporter_user_id", "created_at", "id" });

            // The view audit is append-only: refuse UPDATE at the database
            // level, mirroring Laravel's trg_smva_no_update trigger.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION supporter_message_view_audits_no_update()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'supporter_message_view_audit_immutable';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_smva_no_update
                BEFORE UPDATE ON supporter_message_view_audits
                FOR EACH ROW EXECUTE FUNCTION supporter_message_view_audits_no_update();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_smva_no_update ON supporter_message_view_audits;
                DROP FUNCTION IF EXISTS supporter_message_view_audits_no_update();
                """);

            migrationBuilder.DropTable(
                name: "supporter_message_view_audits");
        }
    }
}
