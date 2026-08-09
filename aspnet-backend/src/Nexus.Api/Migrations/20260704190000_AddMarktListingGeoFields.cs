using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Microsoft.EntityFrameworkCore.Migrations.Migration("20260704190000_AddMarktListingGeoFields")]
    public partial class AddMarktListingGeoFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ImageUrl",
                table: "listings",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "listings",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "listings",
                type: "double precision",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_listings_TenantId_Latitude_Longitude",
                table: "listings",
                columns: new[] { "TenantId", "Latitude", "Longitude" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_listings_TenantId_Latitude_Longitude",
                table: "listings");

            migrationBuilder.DropColumn(
                name: "ImageUrl",
                table: "listings");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "listings");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "listings");
        }
    }
}
