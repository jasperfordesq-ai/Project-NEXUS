using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class Phase68FederationProtocols : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "federated_hour_transfers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PartnerId = table.Column<int>(type: "integer", nullable: false),
                    Direction = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LocalUserId = table.Column<int>(type: "integer", nullable: false),
                    RemoteUserExternalId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RemoteUserDisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    ExternalReference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Protocol = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LocalTransactionId = table.Column<int>(type: "integer", nullable: true),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    LastReconcileAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReconciledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FailureReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federated_hour_transfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federated_hour_transfers_federation_partners_PartnerId",
                        column: x => x.PartnerId,
                        principalTable: "federation_partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federated_hour_transfers_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_ExternalReference",
                table: "federated_hour_transfers",
                column: "ExternalReference");

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_PartnerId",
                table: "federated_hour_transfers",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_Status",
                table: "federated_hour_transfers",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_Status_LastReconcileAttemptAt",
                table: "federated_hour_transfers",
                columns: new[] { "Status", "LastReconcileAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_TenantId",
                table: "federated_hour_transfers",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "federated_hour_transfers");
        }
    }
}
