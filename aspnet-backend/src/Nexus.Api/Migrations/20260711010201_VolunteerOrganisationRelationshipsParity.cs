using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class VolunteerOrganisationRelationshipsParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "organization_id",
                table: "volunteer_opportunities",
                type: "integer",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_users_TenantId_Id",
                table: "users",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "vol_organizations",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    slug = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    contact_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    website = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    logo_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    location = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    org_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true, defaultValue: "organisation"),
                    meeting_schedule = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    auto_pay_enabled = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    balance = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false, defaultValue: 0m),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_organizations", x => x.id);
                    table.UniqueConstraint("AK_vol_organizations_tenant_id_id", x => new { x.tenant_id, x.id });
                    table.CheckConstraint("CK_VolunteerOrganisations_Status", "\"status\" IN ('pending', 'approved', 'active', 'declined', 'suspended')");
                    table.ForeignKey(
                        name: "FK_vol_organizations_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_organizations_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "org_members",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    organization_id = table.Column<int>(type: "integer", nullable: false),
                    org_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "volunteer"),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_org_members", x => x.id);
                    table.CheckConstraint("CK_VolunteerOrganisationMembers_OrgType", "\"org_type\" = 'volunteer'");
                    table.CheckConstraint("CK_VolunteerOrganisationMembers_Role", "\"role\" IN ('owner', 'admin', 'member')");
                    table.CheckConstraint("CK_VolunteerOrganisationMembers_Status", "\"status\" IN ('active', 'pending', 'invited', 'removed')");
                    table.ForeignKey(
                        name: "FK_org_members_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_org_members_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_org_members_vol_organizations_tenant_id_organization_id",
                        columns: x => new { x.tenant_id, x.organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "vol_org_transactions",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    vol_organization_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: true),
                    vol_log_id = table.Column<int>(type: "integer", nullable: true),
                    type = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    balance_after = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vol_org_transactions", x => x.id);
                    table.CheckConstraint("CK_VolunteerOrganisationTransactions_Type", "\"type\" IN ('deposit', 'withdrawal', 'volunteer_payment', 'admin_adjustment')");
                    table.ForeignKey(
                        name: "FK_vol_org_transactions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_org_transactions_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_vol_org_transactions_vol_organizations_tenant_id_vol_organi~",
                        columns: x => new { x.tenant_id, x.vol_organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_opportunities_TenantId_organization_id",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "organization_id" });

            migrationBuilder.CreateIndex(
                name: "IX_org_members_tenant_id_org_type_organization_id_user_id",
                table: "org_members",
                columns: new[] { "tenant_id", "org_type", "organization_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_org_members_tenant_id_organization_id_status",
                table: "org_members",
                columns: new[] { "tenant_id", "organization_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_org_members_tenant_id_user_id_status",
                table: "org_members",
                columns: new[] { "tenant_id", "user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_org_transactions_created_at",
                table: "vol_org_transactions",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "IX_vol_org_transactions_tenant_id_vol_organization_id",
                table: "vol_org_transactions",
                columns: new[] { "tenant_id", "vol_organization_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_org_transactions_tenant_id_user_id",
                table: "vol_org_transactions",
                columns: new[] { "tenant_id", "user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_org_transactions_vol_log_id",
                table: "vol_org_transactions",
                column: "vol_log_id");

            migrationBuilder.CreateIndex(
                name: "IX_vol_org_transactions_tenant_id_vol_log_id_type",
                table: "vol_org_transactions",
                columns: new[] { "tenant_id", "vol_log_id", "type" },
                unique: true,
                filter: "\"vol_log_id\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_vol_organizations_tenant_id_balance",
                table: "vol_organizations",
                columns: new[] { "tenant_id", "balance" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_organizations_tenant_id_org_type_status",
                table: "vol_organizations",
                columns: new[] { "tenant_id", "org_type", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_organizations_tenant_id_slug",
                table: "vol_organizations",
                columns: new[] { "tenant_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vol_organizations_tenant_id_status",
                table: "vol_organizations",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_organizations_tenant_id_user_id",
                table: "vol_organizations",
                columns: new[] { "tenant_id", "user_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_opportunities_vol_organizations_TenantId_organiza~",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "organization_id" },
                principalTable: "vol_organizations",
                principalColumns: new[] { "tenant_id", "id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_opportunities_vol_organizations_TenantId_organiza~",
                table: "volunteer_opportunities");

            migrationBuilder.DropTable(
                name: "org_members");

            migrationBuilder.DropTable(
                name: "vol_org_transactions");

            migrationBuilder.DropTable(
                name: "vol_organizations");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_opportunities_TenantId_organization_id",
                table: "volunteer_opportunities");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_users_TenantId_Id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "organization_id",
                table: "volunteer_opportunities");
        }
    }
}
