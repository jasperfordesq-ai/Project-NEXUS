using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260705142000_AddMunicipalReportingSchema")]
    public partial class AddMunicipalReportingSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "municipal_report_templates",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    audience = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "municipality"),
                    date_preset = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "last_90_days"),
                    include_social_value = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    hour_value_chf = table.Column<int>(type: "integer", nullable: true),
                    sections = table.Column<string>(type: "jsonb", nullable: true),
                    created_by = table.Column<int>(type: "integer", nullable: true),
                    updated_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipal_report_templates", x => x.id);
                    table.ForeignKey(
                        name: "FK_municipal_report_templates_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "municipal_verifications",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    domain = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    method = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "dns_txt"),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "pending"),
                    dns_record_name = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: true),
                    dns_record_value = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    requested_by = table.Column<int>(type: "integer", nullable: true),
                    verified_by = table.Column<int>(type: "integer", nullable: true),
                    verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    attestation_note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_municipal_verifications", x => x.id);
                    table.ForeignKey(
                        name: "FK_municipal_verifications_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "municipal_report_templates_tenant_name_unique",
                table: "municipal_report_templates",
                columns: new[] { "tenant_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "municipal_verifications_tenant_domain_unique",
                table: "municipal_verifications",
                columns: new[] { "tenant_id", "domain" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "municipal_verifications_tenant_status_idx",
                table: "municipal_verifications",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "municipal_report_templates");

            migrationBuilder.DropTable(
                name: "municipal_verifications");
        }
    }
}
