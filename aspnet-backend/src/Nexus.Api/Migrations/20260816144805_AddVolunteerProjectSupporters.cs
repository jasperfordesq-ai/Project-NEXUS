using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVolunteerProjectSupporters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vol_community_project_supporters",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    project_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_community_project_supporters", x => x.id);
                    table.ForeignKey(
                        name: "FK_vol_community_project_supporters_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_community_project_supporters_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_vol_community_project_supporters_tenant_id",
                table: "vol_community_project_supporters",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_community_project_supporters_tenant_id_project_id",
                table: "vol_community_project_supporters",
                columns: new[] { "tenant_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_community_project_supporters_tenant_id_project_id_user_~",
                table: "vol_community_project_supporters",
                columns: new[] { "tenant_id", "project_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vol_community_project_supporters_user_id",
                table: "vol_community_project_supporters",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vol_community_project_supporters");
        }
    }
}
