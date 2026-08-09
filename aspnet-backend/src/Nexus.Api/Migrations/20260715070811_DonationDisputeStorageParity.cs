using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class DonationDisputeStorageParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "donation_disputes",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    vol_donation_id = table.Column<long>(type: "bigint", nullable: true),
                    stripe_dispute_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    payment_intent_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    charge_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    amount = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "gbp"),
                    status = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false, defaultValue: "needs_response"),
                    reason = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    evidence_due_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    payment_route = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "platform_default"),
                    stripe_account_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    payload = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_donation_disputes", x => x.id);
                    table.CheckConstraint("CK_donation_disputes_amount", "amount >= 0");
                    table.ForeignKey(
                        name: "FK_donation_disputes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_donation_disputes_payment_intent_id",
                table: "donation_disputes",
                column: "payment_intent_id");

            migrationBuilder.CreateIndex(
                name: "IX_donation_disputes_stripe_dispute_id",
                table: "donation_disputes",
                column: "stripe_dispute_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_donation_disputes_tenant_id_created_at",
                table: "donation_disputes",
                columns: new[] { "tenant_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_donation_disputes_tenant_id_status",
                table: "donation_disputes",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "donation_disputes");
        }
    }
}
