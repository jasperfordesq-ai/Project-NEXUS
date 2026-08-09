using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MemberResidencyVerificationStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "member_residency_verifications",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    declared_municipality = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    declared_postcode = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    declared_address = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    evidence_note = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "pending"),
                    attested_by = table.Column<int>(type: "integer", nullable: true),
                    attested_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    rejection_reason = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_member_residency_verifications", x => x.id);
                    table.CheckConstraint("CK_member_residency_verifications_status", "status IN ('pending', 'approved', 'rejected')");
                    table.ForeignKey(
                        name: "FK_member_residency_verifications_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_member_residency_verifications_users_tenant_id_attested_by",
                        columns: x => new { x.tenant_id, x.attested_by },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_member_residency_verifications_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_attested_by",
                table: "member_residency_verifications",
                column: "attested_by");

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_status",
                table: "member_residency_verifications",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_tenant_id",
                table: "member_residency_verifications",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_tenant_id_attested_by",
                table: "member_residency_verifications",
                columns: new[] { "tenant_id", "attested_by" });

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_tenant_id_user_id_status",
                table: "member_residency_verifications",
                columns: new[] { "tenant_id", "user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_member_residency_verifications_user_id",
                table: "member_residency_verifications",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "member_residency_verifications");
        }
    }
}
