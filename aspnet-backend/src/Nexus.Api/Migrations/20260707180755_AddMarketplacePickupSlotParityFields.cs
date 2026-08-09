// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMarketplacePickupSlotParityFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BookedCount",
                table: "marketplace_pickup_slots",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsRecurring",
                table: "marketplace_pickup_slots",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "RecurringPattern",
                table: "marketplace_pickup_slots",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "marketplace_pickup_slots",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MarketplaceListingId",
                table: "marketplace_pickup_reservations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PickedUpAt",
                table: "marketplace_pickup_reservations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QrCode",
                table: "marketplace_pickup_reservations",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "ReservedAt",
                table: "marketplace_pickup_reservations",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BookedCount",
                table: "marketplace_pickup_slots");

            migrationBuilder.DropColumn(
                name: "IsRecurring",
                table: "marketplace_pickup_slots");

            migrationBuilder.DropColumn(
                name: "RecurringPattern",
                table: "marketplace_pickup_slots");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "marketplace_pickup_slots");

            migrationBuilder.DropColumn(
                name: "MarketplaceListingId",
                table: "marketplace_pickup_reservations");

            migrationBuilder.DropColumn(
                name: "PickedUpAt",
                table: "marketplace_pickup_reservations");

            migrationBuilder.DropColumn(
                name: "QrCode",
                table: "marketplace_pickup_reservations");

            migrationBuilder.DropColumn(
                name: "ReservedAt",
                table: "marketplace_pickup_reservations");
        }
    }
}
