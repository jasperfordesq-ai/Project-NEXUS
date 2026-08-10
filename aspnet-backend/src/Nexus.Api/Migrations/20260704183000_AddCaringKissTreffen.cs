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
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704183000_AddCaringKissTreffen")]
    public partial class AddCaringKissTreffen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "caring_kiss_treffen",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    event_id = table.Column<int>(type: "integer", nullable: true),
                    treffen_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "monthly_stamm"),
                    members_only = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    quorum_required = table.Column<int>(type: "integer", nullable: true),
                    fondation_header = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    minutes_document_url = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    minutes_uploaded_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    minutes_uploaded_by = table.Column<int>(type: "integer", nullable: true),
                    coordinator_notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_caring_kiss_treffen", x => x.id);
                    table.ForeignKey(
                        name: "FK_caring_kiss_treffen_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_caring_kiss_treffen_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "caring_kiss_treffen_tenant_event_unique",
                table: "caring_kiss_treffen",
                columns: new[] { "tenant_id", "event_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "caring_kiss_treffen_tenant_type_idx",
                table: "caring_kiss_treffen",
                columns: new[] { "tenant_id", "treffen_type" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_kiss_treffen_event_id",
                table: "caring_kiss_treffen",
                column: "event_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "caring_kiss_treffen");
        }
    }
}
