// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations;

public partial class MarketplacePaidNotificationParity : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "OrderNumber",
            table: "marketplace_orders",
            type: "character varying(100)",
            maxLength: 100,
            nullable: true);

        migrationBuilder.Sql(
            """
            UPDATE marketplace_orders
            SET "OrderNumber" = 'MKT-' || upper(substr(md5("TenantId"::text || ':' || "Id"::text || ':marketplace-order-number-v1'), 1, 26))
            WHERE "OrderNumber" IS NULL OR btrim("OrderNumber") = '';

            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM marketplace_orders
                    GROUP BY "TenantId", "OrderNumber"
                    HAVING count(*) > 1
                ) THEN
                    RAISE EXCEPTION 'Marketplace order-number backfill produced duplicate tenant/order identities';
                END IF;
            END $$;
            """);

        migrationBuilder.AlterColumn<string>(
            name: "OrderNumber",
            table: "marketplace_orders",
            type: "character varying(100)",
            maxLength: 100,
            nullable: false,
            oldClrType: typeof(string),
            oldType: "character varying(100)",
            oldMaxLength: 100,
            oldNullable: true);

        migrationBuilder.CreateTable(
            name: "marketplace_order_notification_deliveries",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                TenantId = table.Column<int>(type: "integer", nullable: false),
                MarketplaceOrderId = table.Column<int>(type: "integer", nullable: false),
                Event = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                UserId = table.Column<int>(type: "integer", nullable: false),
                Channel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Attempts = table.Column<int>(type: "integer", nullable: false),
                ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                FailedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                EvidenceId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                LastError = table.Column<string>(type: "text", nullable: true),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_marketplace_order_notification_deliveries", x => x.Id);
                table.CheckConstraint("chk_marketplace_order_notification_delivery_attempts", "\"Attempts\" > 0");
                table.CheckConstraint("chk_marketplace_order_notification_delivery_channel", "\"Channel\" IN ('email','bell')");
                table.CheckConstraint("chk_marketplace_order_notification_delivery_status", "\"Status\" IN ('claimed','delivered','failed','skipped')");
                table.ForeignKey(
                    name: "FK_marketplace_order_notification_deliveries_marketplace_orders_TenantId_MarketplaceOrderId",
                    columns: x => new { x.TenantId, x.MarketplaceOrderId },
                    principalTable: "marketplace_orders",
                    principalColumns: new[] { "TenantId", "Id" },
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "uk_marketplace_order_number",
            table: "marketplace_orders",
            columns: new[] { "TenantId", "OrderNumber" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "uk_marketplace_order_delivery",
            table: "marketplace_order_notification_deliveries",
            columns: new[] { "TenantId", "MarketplaceOrderId", "Event", "UserId", "Channel" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "idx_marketplace_order_delivery_event",
            table: "marketplace_order_notification_deliveries",
            columns: new[] { "TenantId", "MarketplaceOrderId", "Event" });

        migrationBuilder.CreateIndex(
            name: "idx_marketplace_order_delivery_status",
            table: "marketplace_order_notification_deliveries",
            columns: new[] { "TenantId", "Status", "ClaimedAt" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "marketplace_order_notification_deliveries");

        migrationBuilder.DropIndex(
            name: "uk_marketplace_order_number",
            table: "marketplace_orders");

        migrationBuilder.DropColumn(
            name: "OrderNumber",
            table: "marketplace_orders");
    }
}
