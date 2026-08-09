using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class PilotInquiryStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "pilot_inquiries",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    municipality_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    region = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    country = table.Column<string>(type: "character(2)", fixedLength: true, maxLength: 2, nullable: false, defaultValue: "CH"),
                    population = table.Column<int>(type: "integer", nullable: true),
                    contact_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    contact_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    contact_phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    contact_role = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    has_kiss_cooperative = table.Column<short>(type: "smallint", nullable: false, defaultValue: (short)0),
                    has_existing_digital_tool = table.Column<short>(type: "smallint", nullable: false, defaultValue: (short)0),
                    existing_tool_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    timeline_months = table.Column<int>(type: "integer", nullable: true),
                    interest_modules = table.Column<string>(type: "jsonb", nullable: true),
                    budget_indication = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    fit_score = table.Column<decimal>(type: "numeric(4,1)", precision: 4, scale: 1, nullable: true),
                    fit_breakdown = table.Column<string>(type: "jsonb", nullable: true),
                    stage = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "new"),
                    assigned_to = table.Column<int>(type: "integer", nullable: true),
                    proposal_sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    pilot_agreed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    went_live_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    rejection_reason = table.Column<string>(type: "text", nullable: true),
                    internal_notes = table.Column<string>(type: "text", nullable: true),
                    source = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pilot_inquiries", x => x.id);
                    table.CheckConstraint("CK_pilot_inquiries_fit_score", "fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)");
                    table.CheckConstraint("CK_pilot_inquiries_has_existing_digital_tool", "has_existing_digital_tool IN (0, 1)");
                    table.CheckConstraint("CK_pilot_inquiries_has_kiss_cooperative", "has_kiss_cooperative IN (0, 1)");
                    table.CheckConstraint("CK_pilot_inquiries_population", "population IS NULL OR population >= 0");
                    table.CheckConstraint("CK_pilot_inquiries_stage", "stage IN ('new', 'qualified', 'proposal_sent', 'pilot_agreed', 'live', 'rejected', 'dormant')");
                    table.CheckConstraint("CK_pilot_inquiries_timeline_months", "timeline_months IS NULL OR timeline_months >= 0");
                    table.ForeignKey(
                        name: "FK_pilot_inquiries_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_pilot_inquiries_users_tenant_id_assigned_to",
                        columns: x => new { x.tenant_id, x.assigned_to },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_pilot_inquiries_contact_email",
                table: "pilot_inquiries",
                column: "contact_email");

            migrationBuilder.CreateIndex(
                name: "IX_pilot_inquiries_tenant_id",
                table: "pilot_inquiries",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_pilot_inquiries_tenant_id_assigned_to",
                table: "pilot_inquiries",
                columns: new[] { "tenant_id", "assigned_to" });

            migrationBuilder.CreateIndex(
                name: "IX_pilot_inquiries_tenant_id_stage",
                table: "pilot_inquiries",
                columns: new[] { "tenant_id", "stage" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "pilot_inquiries");
        }
    }
}
