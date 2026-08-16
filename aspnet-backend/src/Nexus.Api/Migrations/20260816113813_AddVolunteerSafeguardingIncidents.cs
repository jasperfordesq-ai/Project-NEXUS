using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVolunteerSafeguardingIncidents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vol_safeguarding_incidents",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    shift_id = table.Column<int>(type: "integer", nullable: true),
                    opportunity_id = table.Column<int>(type: "integer", nullable: true),
                    organization_id = table.Column<int>(type: "integer", nullable: true),
                    reported_by = table.Column<int>(type: "integer", nullable: false),
                    title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    subject_user_id = table.Column<int>(type: "integer", nullable: true),
                    involved_user_id = table.Column<int>(type: "integer", nullable: true),
                    incident_type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    incident_date = table.Column<DateOnly>(type: "date", nullable: true),
                    description = table.Column<string>(type: "text", nullable: false),
                    action_taken = table.Column<string>(type: "text", nullable: true),
                    dlp_user_id = table.Column<int>(type: "integer", nullable: true),
                    dlp_notified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    assigned_to = table.Column<int>(type: "integer", nullable: true),
                    authority_notified = table.Column<bool>(type: "boolean", nullable: false),
                    authority_reference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    resolved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    resolution_notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_safeguarding_incidents", x => x.id);
                    table.ForeignKey(
                        name: "FK_vol_safeguarding_incidents_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_safeguarding_incidents_users_reported_by",
                        column: x => x.reported_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_vol_safeguarding_incidents_reported_by",
                table: "vol_safeguarding_incidents",
                column: "reported_by");

            migrationBuilder.CreateIndex(
                name: "IX_vol_safeguarding_incidents_tenant_id",
                table: "vol_safeguarding_incidents",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_safeguarding_incidents_tenant_id_severity",
                table: "vol_safeguarding_incidents",
                columns: new[] { "tenant_id", "severity" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_safeguarding_incidents_tenant_id_shift_id",
                table: "vol_safeguarding_incidents",
                columns: new[] { "tenant_id", "shift_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_safeguarding_incidents_tenant_id_status",
                table: "vol_safeguarding_incidents",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vol_safeguarding_incidents");
        }
    }
}
