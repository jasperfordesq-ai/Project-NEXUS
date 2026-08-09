// Copyright © 2024–2026 Jasper Ford
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
    public partial class AddSafeguardingBrokerControls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "broker_risk_tags",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ListingId = table.Column<int>(type: "integer", nullable: false),
                    RiskLevel = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    RiskType = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_broker_risk_tags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_broker_risk_tags_listings_ListingId",
                        column: x => x.ListingId,
                        principalTable: "listings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_broker_risk_tags_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_broker_risk_tags_users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_assignments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    WardUserId = table.Column<int>(type: "integer", nullable: false),
                    GuardianUserId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ConsentGivenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AssignedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_assignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_safeguarding_assignments_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_assignments_users_GuardianUserId",
                        column: x => x.GuardianUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_safeguarding_assignments_users_WardUserId",
                        column: x => x.WardUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_message_reviews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MessageId = table.Column<int>(type: "integer", nullable: false),
                    SenderId = table.Column<int>(type: "integer", nullable: false),
                    RecipientId = table.Column<int>(type: "integer", nullable: true),
                    Severity = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    FlagReason = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    IsFlagged = table.Column<bool>(type: "boolean", nullable: false),
                    ReviewedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReviewNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_message_reviews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_safeguarding_message_reviews_messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_safeguarding_message_reviews_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_safeguarding_message_reviews_users_RecipientId",
                        column: x => x.RecipientId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_safeguarding_message_reviews_users_ReviewedByUserId",
                        column: x => x.ReviewedByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_safeguarding_message_reviews_users_SenderId",
                        column: x => x.SenderId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "safeguarding_options",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    OptionKey = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OptionType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    HelpUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsRequired = table.Column<bool>(type: "boolean", nullable: false),
                    SelectOptionsJson = table.Column<string>(type: "text", nullable: true),
                    TriggersJson = table.Column<string>(type: "text", nullable: true),
                    PresetSource = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_safeguarding_options", x => x.Id);
                    table.ForeignKey(
                        name: "FK_safeguarding_options_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "user_monitoring_restrictions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    UnderMonitoring = table.Column<bool>(type: "boolean", nullable: false),
                    MonitoringExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    SetByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_monitoring_restrictions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_monitoring_restrictions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_user_monitoring_restrictions_users_SetByUserId",
                        column: x => x.SetByUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_user_monitoring_restrictions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_broker_risk_tags_CreatedByUserId",
                table: "broker_risk_tags",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_broker_risk_tags_ListingId",
                table: "broker_risk_tags",
                column: "ListingId");

            migrationBuilder.CreateIndex(
                name: "IX_broker_risk_tags_TenantId_ListingId",
                table: "broker_risk_tags",
                columns: new[] { "TenantId", "ListingId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_assignments_GuardianUserId",
                table: "safeguarding_assignments",
                column: "GuardianUserId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_assignments_TenantId_WardUserId_GuardianUserId~",
                table: "safeguarding_assignments",
                columns: new[] { "TenantId", "WardUserId", "GuardianUserId", "RevokedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_assignments_WardUserId",
                table: "safeguarding_assignments",
                column: "WardUserId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_MessageId",
                table: "safeguarding_message_reviews",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_RecipientId",
                table: "safeguarding_message_reviews",
                column: "RecipientId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_ReviewedByUserId",
                table: "safeguarding_message_reviews",
                column: "ReviewedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_SenderId",
                table: "safeguarding_message_reviews",
                column: "SenderId");

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_TenantId_IsFlagged_ReviewedAt",
                table: "safeguarding_message_reviews",
                columns: new[] { "TenantId", "IsFlagged", "ReviewedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_message_reviews_TenantId_MessageId",
                table: "safeguarding_message_reviews",
                columns: new[] { "TenantId", "MessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_safeguarding_options_TenantId_OptionKey",
                table: "safeguarding_options",
                columns: new[] { "TenantId", "OptionKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_monitoring_restrictions_SetByUserId",
                table: "user_monitoring_restrictions",
                column: "SetByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_user_monitoring_restrictions_TenantId_UserId",
                table: "user_monitoring_restrictions",
                columns: new[] { "TenantId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_monitoring_restrictions_UserId",
                table: "user_monitoring_restrictions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "broker_risk_tags");

            migrationBuilder.DropTable(
                name: "safeguarding_assignments");

            migrationBuilder.DropTable(
                name: "safeguarding_message_reviews");

            migrationBuilder.DropTable(
                name: "safeguarding_options");

            migrationBuilder.DropTable(
                name: "user_monitoring_restrictions");
        }
    }
}
