// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [Migration("20260305120000_AddTenantUpdatedAt")]
    public partial class AddTenantUpdatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "tenants",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "tenants");
        }
    }
}
