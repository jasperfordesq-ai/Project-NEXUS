using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVolunteerDonationFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "GivingDayId",
                table: "money_donations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAnonymous",
                table: "money_donations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PaymentMethod",
                table: "money_donations",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_GivingDayId",
                table: "money_donations",
                column: "GivingDayId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_money_donations_GivingDayId",
                table: "money_donations");

            migrationBuilder.DropColumn(
                name: "GivingDayId",
                table: "money_donations");

            migrationBuilder.DropColumn(
                name: "IsAnonymous",
                table: "money_donations");

            migrationBuilder.DropColumn(
                name: "PaymentMethod",
                table: "money_donations");
        }
    }
}
