// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704174500_AddCaringHourGifts")]
    public partial class AddCaringHourGifts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_hour_gifts",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    sender_user_id = table.Column<int>(type: "integer", nullable: false),
                    recipient_user_id = table.Column<int>(type: "integer", nullable: false),
                    hours = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    message = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    decline_reason = table.Column<string>(type: "text", nullable: true),
                    accepted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    declined_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reverted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_hour_gifts", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_hour_gifts_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_hour_gifts_users_recipient_user_id",
                        column: x => x.recipient_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_hour_gifts_users_sender_user_id",
                        column: x => x.sender_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "caring_hour_gifts_tenant_recipient_idx",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "recipient_user_id" });

            migrationBuilder.CreateIndex(
                name: "caring_hour_gifts_tenant_sender_idx",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "sender_user_id" });

            migrationBuilder.CreateIndex(
                name: "caring_hour_gifts_tenant_status_idx",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_gifts_recipient_user_id",
                table: "caring_hour_gifts",
                column: "recipient_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_gifts_sender_user_id",
                table: "caring_hour_gifts",
                column: "sender_user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_hour_gifts");
        }
    }
}
