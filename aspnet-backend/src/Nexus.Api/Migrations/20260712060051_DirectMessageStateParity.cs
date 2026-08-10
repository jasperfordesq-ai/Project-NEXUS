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
    public partial class DirectMessageStateParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "archived_by_receiver",
                table: "messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "archived_by_sender",
                table: "messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "deleted_at",
                table: "messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "deleted_by_user_id",
                table: "messages",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "edited_at",
                table: "messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_deleted",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_deleted_receiver",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_deleted_sender",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "is_edited",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "idx_messages_conversation_receiver_archived",
                table: "messages",
                columns: new[] { "ConversationId", "archived_by_receiver" });

            migrationBuilder.CreateIndex(
                name: "idx_messages_deleted",
                table: "messages",
                column: "is_deleted");

            migrationBuilder.CreateIndex(
                name: "idx_messages_is_deleted_receiver",
                table: "messages",
                columns: new[] { "TenantId", "ConversationId", "is_deleted_receiver" });

            migrationBuilder.CreateIndex(
                name: "idx_messages_is_deleted_sender",
                table: "messages",
                columns: new[] { "TenantId", "SenderId", "is_deleted_sender" });

            migrationBuilder.CreateIndex(
                name: "idx_messages_sender_archived",
                table: "messages",
                columns: new[] { "SenderId", "archived_by_sender" });

            migrationBuilder.CreateIndex(
                name: "IX_messages_deleted_by_user_id",
                table: "messages",
                column: "deleted_by_user_id");

            migrationBuilder.AddForeignKey(
                name: "FK_messages_users_deleted_by_user_id",
                table: "messages",
                column: "deleted_by_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "DirectMessageStateParity is forward-only: removing edit, delete, and archive state " +
                "would re-expose participant-hidden messages and discard lifecycle history. Restore a " +
                "verified predecessor backup or apply a reviewed forward remediation instead.");
        }
    }
}
