using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMerchantCouponParityFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AppliesTo",
                table: "merchant_coupons",
                type: "text",
                nullable: false,
                defaultValue: "all_listings");

            migrationBuilder.AddColumn<string>(
                name: "AppliesToIdsJson",
                table: "merchant_coupons",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxUses",
                table: "merchant_coupons",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxUsesPerMember",
                table: "merchant_coupons",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "MinOrderCents",
                table: "merchant_coupons",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "merchant_coupons",
                type: "text",
                nullable: false,
                defaultValue: "draft");

            migrationBuilder.AddColumn<string>(
                name: "Title",
                table: "merchant_coupons",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "merchant_coupons",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UsageCount",
                table: "merchant_coupons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "ValidFrom",
                table: "merchant_coupons",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AppliesTo",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "AppliesToIdsJson",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "MaxUses",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "MaxUsesPerMember",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "MinOrderCents",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "Title",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "UsageCount",
                table: "merchant_coupons");

            migrationBuilder.DropColumn(
                name: "ValidFrom",
                table: "merchant_coupons");
        }
    }
}
