using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AtomicNotificationSettingsParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "federation_notifications_enabled",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "notification_frequency",
                table: "match_preferences",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "monthly");

            migrationBuilder.AddColumn<bool>(
                name: "notify_hot_matches",
                table: "match_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "notify_mutual_matches",
                table: "match_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "federation_notifications_enabled",
                table: "users");

            migrationBuilder.DropColumn(
                name: "notification_frequency",
                table: "match_preferences");

            migrationBuilder.DropColumn(
                name: "notify_hot_matches",
                table: "match_preferences");

            migrationBuilder.DropColumn(
                name: "notify_mutual_matches",
                table: "match_preferences");
        }
    }
}
