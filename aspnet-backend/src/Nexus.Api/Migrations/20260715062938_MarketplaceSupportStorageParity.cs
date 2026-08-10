using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceSupportStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_marketplace_reports_TenantId_Id",
                table: "marketplace_reports",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "marketplace_category_templates",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: true),
                    category_id = table.Column<int>(type: "integer", nullable: true),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    fields = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_category_templates", x => x.id);
                    table.ForeignKey(
                        name: "FK_marketplace_category_templates_marketplace_categories_categ~",
                        column: x => x.category_id,
                        principalTable: "marketplace_categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_marketplace_category_templates_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "marketplace_report_notifications",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    marketplace_report_id = table.Column<int>(type: "integer", nullable: false),
                    recipient_user_id = table.Column<int>(type: "integer", nullable: false),
                    event_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    channel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_error = table.Column<string>(type: "text", nullable: true),
                    last_attempted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    next_retry_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    payload = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketplace_report_notifications", x => x.id);
                    table.CheckConstraint("CK_marketplace_report_notifications_attempts", "attempts >= 0");
                    table.CheckConstraint("CK_marketplace_report_notifications_channel", "channel IN ('bell', 'email')");
                    table.CheckConstraint("CK_marketplace_report_notifications_status", "status IN ('pending', 'processing', 'sent', 'failed')");
                    table.ForeignKey(
                        name: "FK_marketplace_report_notifications_marketplace_reports_tenant~",
                        columns: x => new { x.tenant_id, x.marketplace_report_id },
                        principalTable: "marketplace_reports",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_marketplace_report_notifications_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_marketplace_report_notifications_users_tenant_id_recipient_~",
                        columns: x => new { x.tenant_id, x.recipient_user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_category_templates_category_id",
                table: "marketplace_category_templates",
                column: "category_id");

            migrationBuilder.CreateIndex(
                name: "marketplace_category_templates_tenant_id_index",
                table: "marketplace_category_templates",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_report_notifications_tenant_id_recipient_user_id",
                table: "marketplace_report_notifications",
                columns: new[] { "tenant_id", "recipient_user_id" });

            migrationBuilder.CreateIndex(
                name: "mrn_tenant_dedupe_channel_unique",
                table: "marketplace_report_notifications",
                columns: new[] { "tenant_id", "dedupe_key", "channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "mrn_tenant_report_idx",
                table: "marketplace_report_notifications",
                columns: new[] { "tenant_id", "marketplace_report_id" });

            migrationBuilder.CreateIndex(
                name: "mrn_tenant_status_retry_idx",
                table: "marketplace_report_notifications",
                columns: new[] { "tenant_id", "status", "next_retry_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "marketplace_category_templates");

            migrationBuilder.DropTable(
                name: "marketplace_report_notifications");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_marketplace_reports_TenantId_Id",
                table: "marketplace_reports");
        }
    }
}
