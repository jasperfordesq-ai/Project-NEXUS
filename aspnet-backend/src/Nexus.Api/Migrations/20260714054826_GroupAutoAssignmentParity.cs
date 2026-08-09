using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GroupAutoAssignmentParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "group_auto_assign_rules",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    group_id = table.Column<int>(type: "integer", nullable: false),
                    rule_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    rule_value = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_group_auto_assign_rules", x => x.id);
                    table.CheckConstraint("CK_group_auto_assign_rules_rule_type", "rule_type IN ('location', 'interest', 'role', 'attribute')");
                    table.CheckConstraint("CK_group_auto_assign_rules_rule_value", "length(btrim(rule_value)) > 0");
                    table.ForeignKey(
                        name: "FK_group_auto_assign_rules_groups_group_id",
                        column: x => x.group_id,
                        principalTable: "groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_group_auto_assign_rules_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_group_auto_assign_rules_group_id",
                table: "group_auto_assign_rules",
                column: "group_id");

            migrationBuilder.CreateIndex(
                name: "IX_group_auto_assign_rules_tenant_active",
                table: "group_auto_assign_rules",
                columns: new[] { "tenant_id", "is_active" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "group_auto_assign_rules");
        }
    }
}
