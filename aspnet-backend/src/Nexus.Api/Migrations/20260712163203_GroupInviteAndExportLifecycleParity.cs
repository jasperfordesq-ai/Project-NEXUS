using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GroupInviteAndExportLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CachedMemberCount",
                table: "groups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "group_members",
                type: "text",
                nullable: false,
                defaultValue: "active");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "group_invites",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<DateTime>(
                name: "AcceptedAt",
                table: "group_invites",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AcceptedByUserId",
                table: "group_invites",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InviteType",
                table: "group_invites",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "link");

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "group_invites",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP");

            migrationBuilder.Sql("""
                UPDATE group_invites
                SET "InviteType" = CASE WHEN "Email" IS NULL OR btrim("Email") = '' THEN 'link' ELSE 'email' END,
                    "UpdatedAt" = "CreatedAt";

                UPDATE groups AS g
                SET "CachedMemberCount" = counts.member_count
                FROM (
                    SELECT "GroupId", count(*)::integer AS member_count
                    FROM group_members
                    WHERE "Status" = 'active'
                    GROUP BY "GroupId"
                ) AS counts
                WHERE g."Id" = counts."GroupId";
                """);

            migrationBuilder.CreateTable(
                name: "group_data_exports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    GroupId = table.Column<int>(type: "integer", nullable: false),
                    RequestedByUserId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StoragePath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ByteSize = table.Column<long>(type: "bigint", nullable: true),
                    ErrorCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Attempts = table.Column<short>(type: "smallint", nullable: false),
                    ProcessingStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_group_data_exports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_group_exports_expiry",
                table: "group_data_exports",
                columns: new[] { "Status", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "idx_group_exports_requester",
                table: "group_data_exports",
                columns: new[] { "TenantId", "GroupId", "RequestedByUserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "group_data_exports");

            migrationBuilder.DropColumn(
                name: "CachedMemberCount",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "group_members");

            migrationBuilder.DropColumn(
                name: "AcceptedAt",
                table: "group_invites");

            migrationBuilder.DropColumn(
                name: "AcceptedByUserId",
                table: "group_invites");

            migrationBuilder.DropColumn(
                name: "InviteType",
                table: "group_invites");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "group_invites");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "group_invites",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);
        }
    }
}
