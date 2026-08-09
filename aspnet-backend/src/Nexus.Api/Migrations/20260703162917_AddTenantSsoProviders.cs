using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantSsoProviders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "tenant_sso_providers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ProviderKey = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Preset = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "generic"),
                    IssuerUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ClientId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ClientSecretEncrypted = table.Column<string>(type: "text", nullable: true),
                    Scopes = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false, defaultValue: "openid profile email"),
                    AllowedEmailDomains = table.Column<string>(type: "jsonb", nullable: true),
                    AutoProvision = table.Column<bool>(type: "boolean", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_sso_providers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tenant_sso_providers_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "sso_tenant_idx",
                table: "tenant_sso_providers",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "sso_tenant_provider_unique",
                table: "tenant_sso_providers",
                columns: new[] { "TenantId", "ProviderKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "tenant_sso_providers");
        }
    }
}
