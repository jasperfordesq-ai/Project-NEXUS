// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations;

    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260708153000_AddPostSharePolymorphicFields")]
    public partial class AddPostSharePolymorphicFields : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_post_shares_feed_posts_PostId",
            table: "post_shares");

        migrationBuilder.AddColumn<string>(
            name: "OriginalType",
            table: "post_shares",
            type: "character varying(50)",
            maxLength: 50,
            nullable: false,
            defaultValue: "post");

        migrationBuilder.AddColumn<int>(
            name: "OriginalPostId",
            table: "post_shares",
            type: "integer",
            nullable: false,
            defaultValue: 0);

        migrationBuilder.AddColumn<string>(
            name: "Comment",
            table: "post_shares",
            type: "character varying(1000)",
            maxLength: 1000,
            nullable: true);

        migrationBuilder.Sql("""
            UPDATE post_shares
            SET "OriginalPostId" = "PostId"
            WHERE "OriginalPostId" = 0
            """);

        migrationBuilder.CreateIndex(
            name: "IX_post_shares_TenantId_UserId_OriginalType_OriginalPostId",
            table: "post_shares",
            columns: new[] { "TenantId", "UserId", "OriginalType", "OriginalPostId" },
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_post_shares_TenantId_UserId_OriginalType_OriginalPostId",
            table: "post_shares");

        migrationBuilder.DropColumn(
            name: "Comment",
            table: "post_shares");

        migrationBuilder.DropColumn(
            name: "OriginalPostId",
            table: "post_shares");

        migrationBuilder.DropColumn(
            name: "OriginalType",
            table: "post_shares");

        migrationBuilder.AddForeignKey(
            name: "FK_post_shares_feed_posts_PostId",
            table: "post_shares",
            column: "PostId",
            principalTable: "feed_posts",
            principalColumn: "Id",
            onDelete: ReferentialAction.Cascade);
    }
}
