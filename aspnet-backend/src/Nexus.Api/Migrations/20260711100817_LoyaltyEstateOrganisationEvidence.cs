using Microsoft.EntityFrameworkCore.Migrations;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class LoyaltyEstateOrganisationEvidence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Tenant-composite foreign keys must never be installed by guessing
            // how to repair cross-tenant historical rows. Abort before changing
            // constraints and leave operators an exact, auditable disposition.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM organisations o
                        JOIN users u ON u."Id" = o."OwnerId"
                        WHERE u."TenantId" <> o."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation owner tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM organisation_members m
                        JOIN organisations o ON o."Id" = m."OrganisationId"
                        WHERE o."TenantId" <> m."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation member organisation tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM organisation_members m
                        JOIN users u ON u."Id" = m."UserId"
                        WHERE u."TenantId" <> m."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation member user tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM org_wallets w
                        JOIN organisations o ON o."Id" = w."OrganisationId"
                        WHERE o."TenantId" <> w."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation wallet tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM org_wallet_transactions t
                        JOIN org_wallets w ON w."Id" = t."OrgWalletId"
                        WHERE w."TenantId" <> t."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation wallet transaction tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM org_wallet_transactions t
                        JOIN users u ON u."Id" = t."InitiatedById"
                        WHERE t."InitiatedById" IS NOT NULL
                          AND u."TenantId" <> t."TenantId"
                    ) OR EXISTS (
                        SELECT 1
                        FROM org_wallet_transactions t
                        JOIN users u ON u."Id" = t."FromUserId"
                        WHERE t."FromUserId" IS NOT NULL
                          AND u."TenantId" <> t."TenantId"
                    ) OR EXISTS (
                        SELECT 1
                        FROM org_wallet_transactions t
                        JOIN users u ON u."Id" = t."ToUserId"
                        WHERE t."ToUserId" IS NOT NULL
                          AND u."TenantId" <> t."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'organisation wallet transaction user tenant mismatch requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM organisation_members
                        WHERE lower(btrim("Role")) NOT IN ('owner', 'admin', 'member', 'volunteer')
                    ) THEN
                        RAISE EXCEPTION 'unknown organisation membership role requires manual reconciliation';
                    END IF;
                END $$;

                UPDATE organisation_members
                SET "Role" = lower(btrim("Role"))
                WHERE "Role" <> lower(btrim("Role"));
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_org_wallet_transactions_org_wallets_OrgWalletId",
                table: "org_wallet_transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_org_wallet_transactions_users_FromUserId",
                table: "org_wallet_transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_org_wallet_transactions_users_InitiatedById",
                table: "org_wallet_transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_org_wallet_transactions_users_ToUserId",
                table: "org_wallet_transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_org_wallets_organisations_OrganisationId",
                table: "org_wallets");

            migrationBuilder.DropForeignKey(
                name: "FK_organisation_members_organisations_OrganisationId",
                table: "organisation_members");

            migrationBuilder.DropForeignKey(
                name: "FK_organisation_members_users_UserId",
                table: "organisation_members");

            migrationBuilder.DropForeignKey(
                name: "FK_organisations_users_OwnerId",
                table: "organisations");

            migrationBuilder.DropIndex(
                name: "IX_organisations_OwnerId",
                table: "organisations");

            migrationBuilder.DropIndex(
                name: "IX_organisation_members_OrganisationId_UserId",
                table: "organisation_members");

            migrationBuilder.DropIndex(
                name: "IX_organisation_members_TenantId",
                table: "organisation_members");

            migrationBuilder.DropIndex(
                name: "IX_organisation_members_UserId",
                table: "organisation_members");

            migrationBuilder.DropIndex(
                name: "IX_org_wallets_OrganisationId",
                table: "org_wallets");

            migrationBuilder.DropIndex(
                name: "IX_org_wallet_transactions_FromUserId",
                table: "org_wallet_transactions");

            migrationBuilder.DropIndex(
                name: "IX_org_wallet_transactions_InitiatedById",
                table: "org_wallet_transactions");

            migrationBuilder.DropIndex(
                name: "IX_org_wallet_transactions_OrgWalletId_CreatedAt",
                table: "org_wallet_transactions");

            migrationBuilder.DropIndex(
                name: "IX_org_wallet_transactions_TenantId",
                table: "org_wallet_transactions");

            migrationBuilder.DropIndex(
                name: "IX_org_wallet_transactions_ToUserId",
                table: "org_wallet_transactions");

            migrationBuilder.AddColumn<int>(
                name: "RedemptionTransactionId",
                table: "caring_loyalty_redemptions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ReversalTransactionId",
                table: "caring_loyalty_redemptions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "settlement_transaction_id",
                table: "caring_hour_estates",
                type: "integer",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_organisations_TenantId_Id",
                table: "organisations",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_org_wallets_TenantId_Id",
                table: "org_wallets",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_organisations_TenantId_OwnerId",
                table: "organisations",
                columns: new[] { "TenantId", "OwnerId" });

            migrationBuilder.CreateIndex(
                name: "IX_organisation_members_TenantId_OrganisationId_UserId",
                table: "organisation_members",
                columns: new[] { "TenantId", "OrganisationId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_organisation_members_TenantId_UserId",
                table: "organisation_members",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_organisation_members_Role",
                table: "organisation_members",
                sql: "\"Role\" IN ('owner', 'admin', 'member', 'volunteer')");

            migrationBuilder.CreateIndex(
                name: "IX_org_wallet_transactions_TenantId_FromUserId",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "FromUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_org_wallet_transactions_TenantId_InitiatedById",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "InitiatedById" });

            migrationBuilder.CreateIndex(
                name: "IX_org_wallet_transactions_TenantId_OrgWalletId_CreatedAt",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "OrgWalletId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_org_wallet_transactions_TenantId_ToUserId",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "ToUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_RedemptionTransactionId",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "RedemptionTransactionId" },
                unique: true,
                filter: "\"RedemptionTransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_caring_loyalty_redemptions_TenantId_ReversalTransactionId",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "ReversalTransactionId" },
                unique: true,
                filter: "\"ReversalTransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_estates_tenant_id_settlement_transaction_id",
                table: "caring_hour_estates",
                columns: new[] { "tenant_id", "settlement_transaction_id" },
                unique: true,
                filter: "\"settlement_transaction_id\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_caring_hour_estates_transactions_tenant_id_settlement_trans~",
                table: "caring_hour_estates",
                columns: new[] { "tenant_id", "settlement_transaction_id" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_loyalty_redemptions_transactions_TenantId_Redemption~",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "RedemptionTransactionId" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_loyalty_redemptions_transactions_TenantId_ReversalTr~",
                table: "caring_loyalty_redemptions",
                columns: new[] { "TenantId", "ReversalTransactionId" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_org_wallet_transactions_org_wallets_TenantId_OrgWalletId",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "OrgWalletId" },
                principalTable: "org_wallets",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_org_wallet_transactions_users_TenantId_FromUserId",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "FromUserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_org_wallet_transactions_users_TenantId_InitiatedById",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "InitiatedById" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_org_wallet_transactions_users_TenantId_ToUserId",
                table: "org_wallet_transactions",
                columns: new[] { "TenantId", "ToUserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_org_wallets_organisations_TenantId_OrganisationId",
                table: "org_wallets",
                columns: new[] { "TenantId", "OrganisationId" },
                principalTable: "organisations",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_organisation_members_organisations_TenantId_OrganisationId",
                table: "organisation_members",
                columns: new[] { "TenantId", "OrganisationId" },
                principalTable: "organisations",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_organisation_members_users_TenantId_UserId",
                table: "organisation_members",
                columns: new[] { "TenantId", "UserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_organisations_users_TenantId_OwnerId",
                table: "organisations",
                columns: new[] { "TenantId", "OwnerId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Loyalty/estate ledger evidence and tenant-composite organisation constraints are intentionally irreversible.");
        }
    }
}
