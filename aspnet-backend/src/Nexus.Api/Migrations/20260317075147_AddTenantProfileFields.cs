using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Domain",
                table: "tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LogoUrl",
                table: "tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Tagline",
                table: "tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FeaturedUntil",
                table: "job_vacancies",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Domain",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "LogoUrl",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "Tagline",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "FeaturedUntil",
                table: "job_vacancies");
        }
    }
}
