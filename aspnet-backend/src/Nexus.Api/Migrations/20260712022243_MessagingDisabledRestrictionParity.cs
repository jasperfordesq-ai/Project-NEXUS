using Microsoft.EntityFrameworkCore.Migrations;

using System;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MessagingDisabledRestrictionParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "messaging_disabled",
                table: "user_monitoring_restrictions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Administrative messaging restrictions cannot be rolled back without losing safety state.");
        }
    }
}
