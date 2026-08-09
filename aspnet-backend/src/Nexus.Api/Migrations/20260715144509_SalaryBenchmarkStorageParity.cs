using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class SalaryBenchmarkStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "salary_benchmarks",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: true),
                    role_keyword = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    industry = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    location = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    salary_min = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    salary_max = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    salary_median = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    salary_type = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "annual"),
                    currency = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false, defaultValue: "EUR"),
                    year = table.Column<short>(type: "smallint", nullable: false, defaultValue: (short)2026),
                    source = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_salary_benchmarks", x => x.id);
                    table.CheckConstraint("CK_salary_benchmarks_salary_type", "salary_type IN ('hourly', 'monthly', 'annual')");
                    table.ForeignKey(
                        name: "FK_salary_benchmarks_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "idx_benchmark_role",
                table: "salary_benchmarks",
                column: "role_keyword");

            migrationBuilder.CreateIndex(
                name: "salary_benchmarks_tenant_id_index",
                table: "salary_benchmarks",
                column: "tenant_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "salary_benchmarks");
        }
    }
}
