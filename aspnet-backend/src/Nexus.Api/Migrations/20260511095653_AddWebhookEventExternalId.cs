using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWebhookEventExternalId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExternalEventId",
                table: "webhook_events",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Provider",
                table: "webhook_events",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_webhook_events_TenantId_Provider_ExternalEventId",
                table: "webhook_events",
                columns: new[] { "TenantId", "Provider", "ExternalEventId" },
                unique: true,
                filter: "\"ExternalEventId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_webhook_events_TenantId_Provider_ExternalEventId",
                table: "webhook_events");

            migrationBuilder.DropColumn(
                name: "ExternalEventId",
                table: "webhook_events");

            migrationBuilder.DropColumn(
                name: "Provider",
                table: "webhook_events");
        }
    }
}
