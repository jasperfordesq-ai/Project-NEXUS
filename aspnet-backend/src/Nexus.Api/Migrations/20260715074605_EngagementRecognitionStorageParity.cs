using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EngagementRecognitionStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "monthly_engagement",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    year_month = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    was_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    activity_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    recognized_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_monthly_engagement", x => x.id);
                    table.CheckConstraint("CK_monthly_engagement_activity_count", "activity_count >= 0");
                    table.ForeignKey(
                        name: "FK_monthly_engagement_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_monthly_engagement_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "seasonal_recognition",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    season = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    months_active = table.Column<short>(type: "smallint", nullable: false, defaultValue: (short)0),
                    recognized_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_seasonal_recognition", x => x.id);
                    table.CheckConstraint("CK_seasonal_recognition_months_active", "months_active >= 0");
                    table.ForeignKey(
                        name: "FK_seasonal_recognition_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_seasonal_recognition_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_me_tenant",
                table: "monthly_engagement",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "idx_me_user_month",
                table: "monthly_engagement",
                columns: new[] { "user_id", "year_month" });

            migrationBuilder.CreateIndex(
                name: "uniq_monthly_engagement",
                table: "monthly_engagement",
                columns: new[] { "tenant_id", "user_id", "year_month" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_sr_tenant",
                table: "seasonal_recognition",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "uniq_seasonal_recognition",
                table: "seasonal_recognition",
                columns: new[] { "tenant_id", "user_id", "season" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "monthly_engagement");

            migrationBuilder.DropTable(
                name: "seasonal_recognition");
        }
    }
}
