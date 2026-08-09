using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GroupFormLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccentColor",
                table: "groups",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoverImageUrl",
                table: "groups",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasChildren",
                table: "groups",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "groups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "Latitude",
                table: "groups",
                type: "numeric(10,8)",
                precision: 10,
                scale: 8,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "groups",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "Longitude",
                table: "groups",
                type: "numeric(11,8)",
                precision: 11,
                scale: 8,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ParentId",
                table: "groups",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrimaryColor",
                table: "groups",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "groups",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "active");

            migrationBuilder.AddColumn<int>(
                name: "TypeId",
                table: "groups",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Visibility",
                table: "groups",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "public");

            migrationBuilder.Sql("UPDATE groups SET \"Visibility\" = CASE WHEN \"IsPrivate\" THEN 'private' ELSE 'public' END, \"IsActive\" = TRUE");

            migrationBuilder.CreateTable(
                name: "group_templates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Icon = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    DefaultVisibility = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DefaultTypeId = table.Column<int>(type: "integer", nullable: true),
                    DefaultTagsJson = table.Column<string>(type: "jsonb", nullable: false),
                    FeaturesJson = table.Column<string>(type: "jsonb", nullable: false),
                    WelcomeMessage = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_group_templates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "group_types",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Slug = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Icon = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Color = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ImageUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsHub = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_group_types", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_groups_TenantId_IsActive",
                table: "groups",
                columns: new[] { "TenantId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_groups_TenantId_ParentId",
                table: "groups",
                columns: new[] { "TenantId", "ParentId" });

            migrationBuilder.CreateIndex(
                name: "IX_group_templates_TenantId_IsActive_SortOrder",
                table: "group_templates",
                columns: new[] { "TenantId", "IsActive", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_group_types_TenantId_IsActive_SortOrder",
                table: "group_types",
                columns: new[] { "TenantId", "IsActive", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_group_types_TenantId_Slug",
                table: "group_types",
                columns: new[] { "TenantId", "Slug" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "group_templates");

            migrationBuilder.DropTable(
                name: "group_types");

            migrationBuilder.DropIndex(
                name: "IX_groups_TenantId_IsActive",
                table: "groups");

            migrationBuilder.DropIndex(
                name: "IX_groups_TenantId_ParentId",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "AccentColor",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "CoverImageUrl",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "HasChildren",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Location",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "ParentId",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "PrimaryColor",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "TypeId",
                table: "groups");

            migrationBuilder.DropColumn(
                name: "Visibility",
                table: "groups");
        }
    }
}
