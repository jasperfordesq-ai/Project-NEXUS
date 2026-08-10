using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceReportAppealWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MarketplaceSuspensionReportId",
                table: "marketplace_seller_profiles",
                type: "integer",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE marketplace_reports
                SET "Reason" = 'other'
                WHERE "Reason" NOT IN ('counterfeit','illegal','unsafe','misleading','discrimination','ip_violation','other');
                UPDATE marketplace_reports
                SET "Status" = CASE
                    WHEN "Status" = 'open' THEN 'received'
                    WHEN "Status" = 'resolved' THEN 'no_action'
                    WHEN "Status" = 'acknowledged' THEN 'under_review'
                    ELSE 'received'
                END
                WHERE "Status" NOT IN ('received','under_review','action_taken','no_action','appealed','appeal_resolved');
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "marketplace_reports",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "Reason",
                table: "marketplace_reports",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<string>(
                name: "ActionTaken",
                table: "marketplace_reports",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "AppealResolvedAt",
                table: "marketplace_reports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AppealText",
                table: "marketplace_reports",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AppealedByUserId",
                table: "marketplace_reports",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnforcementSnapshotJson",
                table: "marketplace_reports",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EvidenceUrlsJson",
                table: "marketplace_reports",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TransparencyReportIncluded",
                table: "marketplace_reports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "marketplace_reports",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("UPDATE marketplace_reports SET \"UpdatedAt\" = \"CreatedAt\" WHERE \"UpdatedAt\" IS NULL;");

            migrationBuilder.AddColumn<int>(
                name: "MarketplaceEnforcementReportId",
                table: "marketplace_listings",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_profiles_TenantId_MarketplaceSuspensionR~",
                table: "marketplace_seller_profiles",
                columns: new[] { "TenantId", "MarketplaceSuspensionReportId" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_reports_TenantId_AppealedByUserId",
                table: "marketplace_reports",
                columns: new[] { "TenantId", "AppealedByUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_reports_TenantId_ReporterUserId_CreatedAt",
                table: "marketplace_reports",
                columns: new[] { "TenantId", "ReporterUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_reports_TenantId_Status_CreatedAt",
                table: "marketplace_reports",
                columns: new[] { "TenantId", "Status", "CreatedAt" });

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_report_action",
                table: "marketplace_reports",
                sql: "\"ActionTaken\" IS NULL OR \"ActionTaken\" IN ('none','warning','listing_removed','seller_suspended')");

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_report_reason",
                table: "marketplace_reports",
                sql: "\"Reason\" IN ('counterfeit','illegal','unsafe','misleading','discrimination','ip_violation','other')");

            migrationBuilder.AddCheckConstraint(
                name: "chk_marketplace_report_status",
                table: "marketplace_reports",
                sql: "\"Status\" IN ('received','acknowledged','under_review','action_taken','no_action','appealed','appeal_resolved')");

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_listings_TenantId_MarketplaceEnforcementReportId",
                table: "marketplace_listings",
                columns: new[] { "TenantId", "MarketplaceEnforcementReportId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_marketplace_seller_profiles_TenantId_MarketplaceSuspensionR~",
                table: "marketplace_seller_profiles");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_reports_TenantId_AppealedByUserId",
                table: "marketplace_reports");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_reports_TenantId_ReporterUserId_CreatedAt",
                table: "marketplace_reports");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_reports_TenantId_Status_CreatedAt",
                table: "marketplace_reports");

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_report_action",
                table: "marketplace_reports");

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_report_reason",
                table: "marketplace_reports");

            migrationBuilder.DropCheckConstraint(
                name: "chk_marketplace_report_status",
                table: "marketplace_reports");

            migrationBuilder.DropIndex(
                name: "IX_marketplace_listings_TenantId_MarketplaceEnforcementReportId",
                table: "marketplace_listings");

            migrationBuilder.DropColumn(
                name: "MarketplaceSuspensionReportId",
                table: "marketplace_seller_profiles");

            migrationBuilder.DropColumn(
                name: "ActionTaken",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "AppealResolvedAt",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "AppealText",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "AppealedByUserId",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "EnforcementSnapshotJson",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "EvidenceUrlsJson",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "TransparencyReportIncluded",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "marketplace_reports");

            migrationBuilder.DropColumn(
                name: "MarketplaceEnforcementReportId",
                table: "marketplace_listings");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "marketplace_reports",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);

            migrationBuilder.AlterColumn<string>(
                name: "Reason",
                table: "marketplace_reports",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32);
        }
    }
}
