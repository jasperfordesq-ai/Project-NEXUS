using System;
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventNotificationPreferenceParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_notification_preferences",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: true),
                    CategoryId = table.Column<int>(type: "integer", nullable: true),
                    EmailEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    InAppEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    WebPushEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    FcmEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    RealtimeEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    Cadence = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    RemindersEnabled = table.Column<bool>(type: "boolean", nullable: true),
                    PreferenceVersion = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_notification_preferences", x => x.Id);
                    table.CheckConstraint("chk_event_notification_preference_cadence", "\"Cadence\" IS NULL OR \"Cadence\" IN ('instant','daily','monthly','off')");
                    table.CheckConstraint("chk_event_notification_preference_scope", "(\"EventId\" IS NOT NULL AND \"CategoryId\" IS NULL) OR (\"EventId\" IS NULL AND \"CategoryId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_event_notification_preferences_categories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "categories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_event_notification_preferences_events_EventId",
                        column: x => x.EventId,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_event_notification_preferences_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_event_notification_preferences_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_notification_preference_category",
                table: "event_notification_preferences",
                columns: new[] { "TenantId", "CategoryId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "idx_event_notification_preference_event",
                table: "event_notification_preferences",
                columns: new[] { "TenantId", "EventId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_event_notification_preferences_CategoryId",
                table: "event_notification_preferences",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_event_notification_preferences_EventId",
                table: "event_notification_preferences",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_event_notification_preferences_UserId",
                table: "event_notification_preferences",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "uq_event_notification_preference_category",
                table: "event_notification_preferences",
                columns: new[] { "TenantId", "UserId", "CategoryId" },
                unique: true,
                filter: "\"CategoryId\" IS NOT NULL AND \"EventId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "uq_event_notification_preference_event",
                table: "event_notification_preferences",
                columns: new[] { "TenantId", "UserId", "EventId" },
                unique: true,
                filter: "\"EventId\" IS NOT NULL AND \"CategoryId\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_notification_preferences");
        }
    }
}
