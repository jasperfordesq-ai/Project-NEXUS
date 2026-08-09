using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class MarketplaceConnectOnboardingParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM marketplace_seller_profiles
                        WHERE "StripeAccountId" IS NOT NULL
                          AND length("StripeAccountId") > 100
                    ) THEN
                        RAISE EXCEPTION 'Marketplace Connect migration blocked: StripeAccountId exceeds 100 characters.';
                    END IF;
                    IF EXISTS (
                        SELECT 1
                        FROM marketplace_seller_profiles
                        WHERE "StripeAccountId" IS NOT NULL
                        GROUP BY "StripeAccountId"
                        HAVING count(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'Marketplace Connect migration blocked: duplicate StripeAccountId values require operator reconciliation.';
                    END IF;
                END $$;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "StripeAccountId",
                table: "marketplace_seller_profiles",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_marketplace_seller_profiles_StripeAccountId",
                table: "marketplace_seller_profiles",
                column: "StripeAccountId",
                unique: true,
                filter: "\"StripeAccountId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_marketplace_seller_profiles_StripeAccountId",
                table: "marketplace_seller_profiles");

            migrationBuilder.AlterColumn<string>(
                name: "StripeAccountId",
                table: "marketplace_seller_profiles",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);
        }
    }
}
