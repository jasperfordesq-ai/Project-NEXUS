using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMoneyDonationWebhookEventId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_email_templates_TenantId_Key",
                table: "email_templates");

            migrationBuilder.AddColumn<string>(
                name: "StripeWebhookEventId",
                table: "money_donations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_StripeWebhookEventId",
                table: "money_donations",
                column: "StripeWebhookEventId",
                unique: true,
                filter: "\"StripeWebhookEventId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_email_templates_TenantId_Key_Version",
                table: "email_templates",
                columns: new[] { "TenantId", "Key", "Version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_money_donations_StripeWebhookEventId",
                table: "money_donations");

            migrationBuilder.DropIndex(
                name: "IX_email_templates_TenantId_Key_Version",
                table: "email_templates");

            migrationBuilder.DropColumn(
                name: "StripeWebhookEventId",
                table: "money_donations");

            migrationBuilder.CreateIndex(
                name: "IX_email_templates_TenantId_Key",
                table: "email_templates",
                columns: new[] { "TenantId", "Key" },
                unique: true);
        }
    }
}
