using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVolunteerMemberRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vol_accessibility_needs",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    need_type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    accommodations_required = table.Column<string>(type: "text", nullable: true),
                    emergency_contact_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    emergency_contact_phone = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_accessibility_needs", x => x.id);
                    table.ForeignKey(
                        name: "FK_vol_accessibility_needs_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_accessibility_needs_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "vol_credentials",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    credential_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    file_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    verified_by = table.Column<int>(type: "integer", nullable: true),
                    verified_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateOnly>(type: "date", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_credentials", x => x.id);
                    table.ForeignKey(
                        name: "FK_vol_credentials_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_credentials_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_vol_credentials_users_verified_by",
                        column: x => x.verified_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "vol_reviews",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    reviewer_id = table.Column<int>(type: "integer", nullable: false),
                    target_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    target_id = table.Column<int>(type: "integer", nullable: false),
                    rating = table.Column<int>(type: "integer", nullable: false),
                    comment = table.Column<string>(type: "text", nullable: true),
                    approved = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_reviews", x => x.id);
                    table.CheckConstraint("chk_vol_review_rating", "rating BETWEEN 1 AND 5");
                    table.ForeignKey(
                        name: "FK_vol_reviews_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_reviews_users_reviewer_id",
                        column: x => x.reviewer_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_vol_accessibility_needs_tenant_id",
                table: "vol_accessibility_needs",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_accessibility_needs_tenant_id_user_id_need_type",
                table: "vol_accessibility_needs",
                columns: new[] { "tenant_id", "user_id", "need_type" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vol_accessibility_needs_user_id",
                table: "vol_accessibility_needs",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_credentials_expires_at",
                table: "vol_credentials",
                column: "expires_at");

            migrationBuilder.CreateIndex(
                name: "IX_vol_credentials_status_tenant_id",
                table: "vol_credentials",
                columns: new[] { "status", "tenant_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_credentials_tenant_id",
                table: "vol_credentials",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_credentials_user_id_tenant_id",
                table: "vol_credentials",
                columns: new[] { "user_id", "tenant_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_credentials_verified_by",
                table: "vol_credentials",
                column: "verified_by");

            migrationBuilder.CreateIndex(
                name: "IX_vol_reviews_reviewer_id",
                table: "vol_reviews",
                column: "reviewer_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_reviews_target_type_target_id",
                table: "vol_reviews",
                columns: new[] { "target_type", "target_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_reviews_tenant_id",
                table: "vol_reviews",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_reviews_tenant_id_reviewer_id",
                table: "vol_reviews",
                columns: new[] { "tenant_id", "reviewer_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vol_accessibility_needs");

            migrationBuilder.DropTable(
                name: "vol_credentials");

            migrationBuilder.DropTable(
                name: "vol_reviews");
        }
    }
}
