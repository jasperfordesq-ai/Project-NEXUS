// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations;

    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260708164000_AddCommentReactions")]
    public partial class AddCommentReactions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "comment_reactions",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                TenantId = table.Column<int>(type: "integer", nullable: false),
                CommentId = table.Column<int>(type: "integer", nullable: false),
                UserId = table.Column<int>(type: "integer", nullable: false),
                ReactionType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_comment_reactions", x => x.Id);
                table.ForeignKey(
                    name: "FK_comment_reactions_tenants_TenantId",
                    column: x => x.TenantId,
                    principalTable: "tenants",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_comment_reactions_threaded_comments_CommentId",
                    column: x => x.CommentId,
                    principalTable: "threaded_comments",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_comment_reactions_users_UserId",
                    column: x => x.UserId,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_comment_reactions_CommentId",
            table: "comment_reactions",
            column: "CommentId");

        migrationBuilder.CreateIndex(
            name: "IX_comment_reactions_TenantId_CommentId_ReactionType",
            table: "comment_reactions",
            columns: new[] { "TenantId", "CommentId", "ReactionType" });

        migrationBuilder.CreateIndex(
            name: "IX_comment_reactions_TenantId_CommentId_UserId",
            table: "comment_reactions",
            columns: new[] { "TenantId", "CommentId", "UserId" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_comment_reactions_UserId",
            table: "comment_reactions",
            column: "UserId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "comment_reactions");
    }
}
