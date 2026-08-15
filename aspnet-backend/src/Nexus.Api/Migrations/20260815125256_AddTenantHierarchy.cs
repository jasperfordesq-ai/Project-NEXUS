using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantHierarchy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AllowsSubtenants",
                table: "tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "Depth",
                table: "tenants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxDepth",
                table: "tenants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ParentId",
                table: "tenants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Path",
                table: "tenants",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenants_ParentId",
                table: "tenants",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_tenants_Path",
                table: "tenants",
                column: "Path");

            migrationBuilder.AddForeignKey(
                name: "FK_tenants_tenants_ParentId",
                table: "tenants",
                column: "ParentId",
                principalTable: "tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // Backfill: every existing tenant is a root until someone says
            // otherwise, so it gets the Laravel path shape '/{id}/' at depth 0.
            //
            // 🔴 This matters for safety, not tidiness. SuperPanelAccess refuses
            // a regional grant when the path is empty, because an empty prefix
            // matches EVERY tenant. Leaving these NULL would be fail-closed and
            // therefore safe, but it would also silently deny legitimate hub
            // admins with no explanation. Giving roots a real path makes the
            // boundary meaningful from the first request.
            migrationBuilder.Sql("""
                UPDATE tenants
                   SET "Path" = '/' || "Id" || '/',
                       "Depth" = 0
                 WHERE "ParentId" IS NULL
                   AND ("Path" IS NULL OR "Path" = '');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tenants_tenants_ParentId",
                table: "tenants");

            migrationBuilder.DropIndex(
                name: "IX_tenants_ParentId",
                table: "tenants");

            migrationBuilder.DropIndex(
                name: "IX_tenants_Path",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "AllowsSubtenants",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "Depth",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "MaxDepth",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "ParentId",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "Path",
                table: "tenants");
        }
    }
}
