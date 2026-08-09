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
    public partial class AddCaringHourTransfers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_hour_transfers",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    counterpart_tenant_slug = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    member_user_id = table.Column<int>(type: "integer", nullable: false),
                    counterpart_member_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    hours_transferred = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "pending"),
                    reason = table.Column<string>(type: "text", nullable: true),
                    signature = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    payload_json = table.Column<string>(type: "jsonb", nullable: true),
                    linked_transfer_id = table.Column<long>(type: "bigint", nullable: true),
                    remote_idempotency_key = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    is_remote = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    remote_delivery_status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    remote_delivery_attempts = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    remote_delivery_last_error = table.Column<string>(type: "text", nullable: true),
                    remote_delivery_next_retry_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    remote_delivered_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_hour_transfers", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_hour_transfers_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_hour_transfers_users_member_user_id",
                        column: x => x.member_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_caring_hour_remote_outbox_due",
                table: "caring_hour_transfers",
                columns: new[] { "tenant_id", "role", "is_remote", "status", "remote_delivery_next_retry_at" });

            migrationBuilder.CreateIndex(
                name: "idx_caring_hour_xfer_linked",
                table: "caring_hour_transfers",
                column: "linked_transfer_id");

            migrationBuilder.CreateIndex(
                name: "idx_caring_hour_xfer_tenant_member",
                table: "caring_hour_transfers",
                columns: new[] { "tenant_id", "member_user_id" });

            migrationBuilder.CreateIndex(
                name: "idx_caring_hour_xfer_tenant_role_status",
                table: "caring_hour_transfers",
                columns: new[] { "tenant_id", "role", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_transfers_member_user_id",
                table: "caring_hour_transfers",
                column: "member_user_id");

            migrationBuilder.CreateIndex(
                name: "uq_caring_hour_xfer_remote_idem_tenant",
                table: "caring_hour_transfers",
                columns: new[] { "tenant_id", "remote_idempotency_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_hour_transfers");
        }
    }
}
