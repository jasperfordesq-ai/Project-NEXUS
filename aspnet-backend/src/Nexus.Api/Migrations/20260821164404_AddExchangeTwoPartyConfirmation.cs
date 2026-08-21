using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <summary>
    /// Adds the two-party hours-confirmation state to <c>exchanges</c>, which is the
    /// schema this backend was missing in order to settle an exchange at all —
    /// ledger row 1.21. Names, nullability and precision are copied from Laravel's
    /// committed schema dump, table <c>exchange_requests</c>
    /// (database/schema/mysql-schema.sql:8909-8917): all five columns nullable,
    /// the three hour columns <c>decimal(5,2)</c>.
    ///
    /// Purely additive: five nullable columns, no drops, no defaults, no data
    /// rewrite, so an existing populated database upgrades with every row intact and
    /// every pre-existing exchange reading as "neither party has confirmed" — which
    /// is the correct starting state for rows created before the feature existed.
    ///
    /// 🔴 This migration is the chain tail. The tail is pinned by
    /// <c>CompatibilityAuditEntrySchemaTests.RepairMigration_IsPresentInTheRuntimeChain</c>
    /// and the migration COUNT is checked against the directory listing by
    /// <c>scripts/check-doc-scores.mjs</c> via the
    /// <c>SCHEMA_CURRENT_RUNTIME_MIGRATIONS</c> marker in
    /// <c>docs/CURRENT_SCHEMA_READINESS.md</c>. Both were updated in the same commit
    /// as this file; a previous tail (AddSkillCategories) went in without updating
    /// the pin and left main red.
    /// </summary>
    public partial class AddExchangeTwoPartyConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "FinalHours",
                table: "exchanges",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ProviderConfirmedAt",
                table: "exchanges",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ProviderConfirmedHours",
                table: "exchanges",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RequesterConfirmedAt",
                table: "exchanges",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "RequesterConfirmedHours",
                table: "exchanges",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FinalHours",
                table: "exchanges");

            migrationBuilder.DropColumn(
                name: "ProviderConfirmedAt",
                table: "exchanges");

            migrationBuilder.DropColumn(
                name: "ProviderConfirmedHours",
                table: "exchanges");

            migrationBuilder.DropColumn(
                name: "RequesterConfirmedAt",
                table: "exchanges");

            migrationBuilder.DropColumn(
                name: "RequesterConfirmedHours",
                table: "exchanges");
        }
    }
}
