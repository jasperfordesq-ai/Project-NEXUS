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
    public partial class AddCaringProjectAnnouncements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_project_announcements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: true),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: true),
                    Location = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    CurrentStage = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    ProgressPercent = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastUpdateAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SubscriberCount = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_project_announcements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_caring_project_announcements_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_project_announcements_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "caring_project_subscriptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    SubscribedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UnsubscribedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_project_subscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_caring_project_subscriptions_caring_project_announcements_P~",
                        column: x => x.ProjectId,
                        principalTable: "caring_project_announcements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_caring_project_subscriptions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_project_subscriptions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "caring_project_updates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: true),
                    StageLabel = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Body = table.Column<string>(type: "text", nullable: true),
                    ProgressPercent = table.Column<int>(type: "integer", nullable: true),
                    IsMilestone = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "draft"),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NotificationCount = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_project_updates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_caring_project_updates_caring_project_announcements_Project~",
                        column: x => x.ProjectId,
                        principalTable: "caring_project_announcements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_caring_project_updates_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_caring_project_updates_users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_announcements_CreatedBy",
                table: "caring_project_announcements",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_announcements_TenantId_PublishedAt",
                table: "caring_project_announcements",
                columns: new[] { "TenantId", "PublishedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_announcements_TenantId_Status",
                table: "caring_project_announcements",
                columns: new[] { "TenantId", "Status" });

            migrationBuilder.CreateIndex(
                name: "caring_project_subscriptions_project_user_unique",
                table: "caring_project_subscriptions",
                columns: new[] { "ProjectId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_subscriptions_ProjectId_UnsubscribedAt",
                table: "caring_project_subscriptions",
                columns: new[] { "ProjectId", "UnsubscribedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_subscriptions_TenantId_UserId",
                table: "caring_project_subscriptions",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_subscriptions_UserId",
                table: "caring_project_subscriptions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_updates_CreatedBy",
                table: "caring_project_updates",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_updates_ProjectId_Status",
                table: "caring_project_updates",
                columns: new[] { "ProjectId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_project_updates_TenantId_PublishedAt",
                table: "caring_project_updates",
                columns: new[] { "TenantId", "PublishedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_project_subscriptions");

            migrationBuilder.DropTable(
                name: "caring_project_updates");

            migrationBuilder.DropTable(
                name: "caring_project_announcements");
        }
    }
}
