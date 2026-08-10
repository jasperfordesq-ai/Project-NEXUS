using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class WalletLedgerFederationPartnerParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_federated_exchanges_transactions_LocalTransactionId",
                table: "federated_exchanges");

            migrationBuilder.DropForeignKey(
                name: "FK_federated_exchanges_users_LocalUserId",
                table: "federated_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_federated_exchanges_LocalTransactionId",
                table: "federated_exchanges");

            migrationBuilder.DropIndex(
                name: "IX_federated_exchanges_LocalUserId",
                table: "federated_exchanges");

            migrationBuilder.AlterColumn<int>(
                name: "SenderId",
                table: "transactions",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<int>(
                name: "ReceiverId",
                table: "transactions",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AlterColumn<string>(
                name: "Description",
                table: "transactions",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "DeletedForReceiver",
                table: "transactions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DeletedForSender",
                table: "transactions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "TransactionType",
                table: "transactions",
                type: "character varying(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "transfer");

            migrationBuilder.AddColumn<bool>(
                name: "TransactionsEnabled",
                table: "federation_user_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "TransactionsEnabled",
                table: "federation_partners",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "reservation_transaction_id",
                table: "caring_hour_gifts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "settlement_transaction_id",
                table: "caring_hour_gifts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AllowedIpCidrs",
                table: "api_partners",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsSandbox",
                table: "api_partners",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_transactions_TenantId_Id",
                table: "transactions",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_api_partners_TenantId_Id",
                table: "api_partners",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.Sql(
                """
                -- Workflow links are authoritative only when the linked row
                -- still has the exact shape written by the legacy workflow.
                -- Abort instead of repurposing stale or ambiguous ledger rows.
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT transfer."LocalTransactionId"
                        FROM federated_hour_transfers AS transfer
                        WHERE transfer."LocalTransactionId" IS NOT NULL
                        GROUP BY transfer."LocalTransactionId"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: duplicate federated hour-transfer transaction links require manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT exchange."LocalTransactionId"
                        FROM federated_exchanges AS exchange
                        WHERE exchange."LocalTransactionId" IS NOT NULL
                        GROUP BY exchange."LocalTransactionId"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: duplicate federated exchange transaction links require manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM federated_hour_transfers AS transfer
                        JOIN federated_exchanges AS exchange
                          ON exchange."LocalTransactionId" = transfer."LocalTransactionId"
                        WHERE transfer."LocalTransactionId" IS NOT NULL
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: cross-workflow transaction link reuse requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM federated_hour_transfers AS transfer
                        LEFT JOIN users AS local_user
                          ON local_user."Id" = transfer."LocalUserId"
                        LEFT JOIN transactions AS ledger
                          ON ledger."Id" = transfer."LocalTransactionId"
                        LEFT JOIN users AS remote_user
                          ON remote_user."Id" = CASE
                              WHEN transfer."Direction" = 'Outbound' THEN ledger."ReceiverId"
                              WHEN transfer."Direction" = 'Inbound' THEN ledger."SenderId"
                              ELSE NULL
                          END
                        WHERE local_user."Id" IS NULL
                           OR local_user."TenantId" <> transfer."TenantId"
                           OR (transfer."LocalTransactionId" IS NOT NULL
                               AND (ledger."Id" IS NULL
                                    OR ledger."TenantId" <> transfer."TenantId"
                                    OR transfer."Direction" NOT IN ('Outbound', 'Inbound')
                                    OR transfer."Status" <> 'Reconciled'
                                    OR ledger."Status" <> 'Completed'
                                    OR ledger."Amount" <> transfer."Amount"
                                    OR ledger."Description" IS DISTINCT FROM
                                       ('Federated ' || transfer."Protocol" || ' transfer #' || transfer."Id"::text || ': ' || COALESCE(transfer."Description", ''))
                                    OR (transfer."Direction" = 'Outbound'
                                        AND (ledger."SenderId" IS DISTINCT FROM transfer."LocalUserId"
                                             OR ledger."ReceiverId" IS NULL))
                                    OR (transfer."Direction" = 'Inbound'
                                        AND (ledger."ReceiverId" IS DISTINCT FROM transfer."LocalUserId"
                                             OR ledger."SenderId" IS NULL))
                                    OR remote_user."Id" IS NULL
                                    OR remote_user."TenantId" <> transfer."TenantId"
                                    OR remote_user."Role" <> 'admin'))
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: invalid federated hour-transfer transaction provenance requires manual reconciliation';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM federated_exchanges AS exchange
                        LEFT JOIN users AS local_user
                          ON local_user."Id" = exchange."LocalUserId"
                        LEFT JOIN transactions AS ledger
                          ON ledger."Id" = exchange."LocalTransactionId"
                        WHERE local_user."Id" IS NULL
                           OR local_user."TenantId" <> exchange."TenantId"
                           OR (exchange."LocalTransactionId" IS NOT NULL
                               AND (ledger."Id" IS NULL
                                    OR ledger."TenantId" <> exchange."TenantId"
                                    OR exchange."Status" <> 'Completed'
                                    OR exchange."CompletedAt" IS NULL
                                    OR ledger."Status" <> 'Completed'
                                    OR ledger."SenderId" IS DISTINCT FROM exchange."LocalUserId"
                                    OR ledger."ReceiverId" IS DISTINCT FROM exchange."LocalUserId"
                                    OR ledger."Amount" <> (COALESCE(exchange."ActualHours", exchange."AgreedHours") * exchange."CreditExchangeRate")
                                    OR ledger."Description" IS DISTINCT FROM
                                       ('Federated exchange with ' || exchange."RemoteUserDisplayName" || ' (Tenant ' || exchange."PartnerTenantId"::text || ')')))
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: invalid federated exchange transaction provenance requires manual reconciliation';
                    END IF;
                END $$;

                UPDATE transactions AS ledger
                SET "SenderId" = CASE
                        WHEN transfer."Direction" = 'Outbound' THEN transfer."LocalUserId"
                        ELSE NULL
                    END,
                    "ReceiverId" = CASE
                        WHEN transfer."Direction" = 'Inbound' THEN transfer."LocalUserId"
                        ELSE NULL
                    END,
                    "TransactionType" = 'transfer',
                    "UpdatedAt" = NOW()
                FROM federated_hour_transfers AS transfer
                WHERE transfer."LocalTransactionId" = ledger."Id"
                  AND transfer."TenantId" = ledger."TenantId";

                UPDATE transactions AS ledger
                SET "SenderId" = NULL,
                    "ReceiverId" = exchange."LocalUserId",
                    "TransactionType" = 'federated_exchange',
                    "UpdatedAt" = NOW()
                FROM federated_exchanges AS exchange
                WHERE exchange."LocalTransactionId" = ledger."Id"
                  AND exchange."TenantId" = ledger."TenantId";
                """);

            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM caring_hour_gifts AS gift
                        LEFT JOIN users AS sender
                          ON sender."Id" = gift.sender_user_id
                        LEFT JOIN users AS recipient
                          ON recipient."Id" = gift.recipient_user_id
                        WHERE gift.status = 'pending'
                          AND (gift.hours <= 0
                               OR sender."Id" IS NULL
                               OR recipient."Id" IS NULL
                               OR sender."TenantId" <> gift.tenant_id
                               OR recipient."TenantId" <> gift.tenant_id)
                    ) THEN
                        RAISE EXCEPTION 'WalletLedgerFederationPartnerParity: invalid pending caring-hour gift provenance requires manual reconciliation';
                    END IF;
                END $$;

                CREATE TEMP TABLE migration_caring_gift_balances
                (
                    tenant_id integer NOT NULL,
                    user_id integer NOT NULL,
                    balance numeric NOT NULL,
                    PRIMARY KEY (tenant_id, user_id)
                ) ON COMMIT DROP;

                INSERT INTO migration_caring_gift_balances (tenant_id, user_id, balance)
                WITH gift_senders AS (
                    SELECT DISTINCT
                        gift.tenant_id,
                        gift.sender_user_id AS user_id
                    FROM caring_hour_gifts AS gift
                    WHERE gift.status = 'pending'
                      AND gift.reservation_transaction_id IS NULL
                ),
                wallet_deltas AS (
                    SELECT
                        ledger."TenantId" AS tenant_id,
                        ledger."ReceiverId" AS user_id,
                        ledger."Amount" AS delta
                    FROM transactions AS ledger
                    WHERE ledger."Status" = 'Completed'
                      AND ledger."ReceiverId" IS NOT NULL

                    UNION ALL

                    SELECT
                        ledger."TenantId" AS tenant_id,
                        ledger."SenderId" AS user_id,
                        -ledger."Amount" AS delta
                    FROM transactions AS ledger
                    WHERE ledger."Status" = 'Completed'
                      AND ledger."SenderId" IS NOT NULL
                )
                SELECT
                    sender.tenant_id,
                    sender.user_id,
                    COALESCE(SUM(delta.delta), 0)
                FROM gift_senders AS sender
                LEFT JOIN wallet_deltas AS delta
                  ON delta.tenant_id = sender.tenant_id
                 AND delta.user_id = sender.user_id
                GROUP BY sender.tenant_id, sender.user_id;

                DO $$
                DECLARE
                    gift_row RECORD;
                    reservation_id integer;
                    available_balance numeric;
                BEGIN
                    FOR gift_row IN
                        SELECT id, tenant_id, sender_user_id, hours, created_at
                        FROM caring_hour_gifts
                        WHERE status = 'pending'
                          AND reservation_transaction_id IS NULL
                        ORDER BY tenant_id, sender_user_id, created_at, id
                    LOOP
                        SELECT balances.balance
                        INTO available_balance
                        FROM migration_caring_gift_balances AS balances
                        WHERE balances.tenant_id = gift_row.tenant_id
                          AND balances.user_id = gift_row.sender_user_id
                        FOR UPDATE;

                        available_balance := COALESCE(available_balance, 0);

                        IF available_balance < gift_row.hours THEN
                            UPDATE caring_hour_gifts
                            SET status = 'reverted',
                                reverted_at = NOW(),
                                updated_at = NOW(),
                                decline_reason = 'Migration cancelled: insufficient available balance for reservation'
                            WHERE id = gift_row.id;
                        ELSE
                            INSERT INTO transactions
                                ("TenantId", "SenderId", "ReceiverId", "Amount", "Description", "TransactionType", "Status", "CreatedAt")
                            VALUES
                                (gift_row.tenant_id, gift_row.sender_user_id, NULL, gift_row.hours,
                                 'Caring hour gift reservation', 'caring_hour_gift_adapter', 'Completed',
                                 COALESCE(gift_row.created_at, NOW()))
                            RETURNING "Id" INTO reservation_id;

                            UPDATE caring_hour_gifts
                            SET reservation_transaction_id = reservation_id
                            WHERE id = gift_row.id;

                            UPDATE migration_caring_gift_balances
                            SET balance = balance - gift_row.hours
                            WHERE tenant_id = gift_row.tenant_id
                              AND user_id = gift_row.sender_user_id;
                        END IF;
                    END LOOP;
                END $$;

                -- The exact Pending marker was exclusive to the legacy gift
                -- hold writer. Retire obsolete holds without guessing which
                -- one belonged to each gift; the new links are authoritative.
                UPDATE transactions
                SET "Description" = 'Legacy caring hour gift hold retired during reservation migration',
                    "TransactionType" = 'caring_hour_gift_adapter',
                    "Status" = 'Cancelled',
                    "UpdatedAt" = NOW()
                WHERE "Description" = 'Caring hour gift pending'
                  AND "Status" = 'Pending';
                """);

            migrationBuilder.CreateTable(
                name: "api_partner_access_tokens",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    AccessTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Scopes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_api_partner_access_tokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_api_partner_access_tokens_api_partners_TenantId_PartnerId",
                        columns: x => new { x.TenantId, x.PartnerId },
                        principalTable: "api_partners",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_api_partner_access_tokens_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "api_partner_wallet_credits",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PartnerId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Reference = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    ReferenceNormalized = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    TransactionId = table.Column<int>(type: "integer", nullable: true),
                    Hours = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "processing"),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_api_partner_wallet_credits", x => x.Id);
                    table.CheckConstraint("CK_api_partner_wallet_credits_completion", "\"Status\" <> 'completed' OR (\"TransactionId\" IS NOT NULL AND \"CompletedAt\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_api_partner_wallet_credits_api_partners_TenantId_PartnerId",
                        columns: x => new { x.TenantId, x.PartnerId },
                        principalTable: "api_partners",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_api_partner_wallet_credits_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_api_partner_wallet_credits_transactions_TenantId_Transactio~",
                        columns: x => new { x.TenantId, x.TransactionId },
                        principalTable: "transactions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_api_partner_wallet_credits_users_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_LocalTransactionId",
                table: "federated_hour_transfers",
                column: "LocalTransactionId",
                unique: true,
                filter: "\"LocalTransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_TenantId_LocalTransactionId",
                table: "federated_hour_transfers",
                columns: new[] { "TenantId", "LocalTransactionId" });

            migrationBuilder.CreateIndex(
                name: "IX_federated_hour_transfers_TenantId_LocalUserId",
                table: "federated_hour_transfers",
                columns: new[] { "TenantId", "LocalUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_LocalTransactionId",
                table: "federated_exchanges",
                column: "LocalTransactionId",
                unique: true,
                filter: "\"LocalTransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_TenantId_LocalTransactionId",
                table: "federated_exchanges",
                columns: new[] { "TenantId", "LocalTransactionId" });

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_TenantId_LocalUserId",
                table: "federated_exchanges",
                columns: new[] { "TenantId", "LocalUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_gifts_tenant_id_reservation_transaction_id",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "reservation_transaction_id" },
                unique: true,
                filter: "\"reservation_transaction_id\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_caring_hour_gifts_tenant_id_settlement_transaction_id",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "settlement_transaction_id" },
                unique: true,
                filter: "\"settlement_transaction_id\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_api_partner_access_tokens_AccessTokenHash",
                table: "api_partner_access_tokens",
                column: "AccessTokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_api_partner_access_tokens_PartnerId_ExpiresAt",
                table: "api_partner_access_tokens",
                columns: new[] { "PartnerId", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_api_partner_access_tokens_TenantId_PartnerId",
                table: "api_partner_access_tokens",
                columns: new[] { "TenantId", "PartnerId" });

            migrationBuilder.CreateIndex(
                name: "idx_partner_wallet_credit_transaction",
                table: "api_partner_wallet_credits",
                column: "TransactionId",
                unique: true,
                filter: "\"TransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "idx_partner_wallet_credit_user",
                table: "api_partner_wallet_credits",
                columns: new[] { "TenantId", "UserId", "CompletedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_api_partner_wallet_credits_TenantId_TransactionId",
                table: "api_partner_wallet_credits",
                columns: new[] { "TenantId", "TransactionId" });

            migrationBuilder.CreateIndex(
                name: "uk_partner_wallet_credit_reference",
                table: "api_partner_wallet_credits",
                columns: new[] { "TenantId", "PartnerId", "ReferenceNormalized" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_hour_gifts_transactions_tenant_id_reservation_transa~",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "reservation_transaction_id" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_hour_gifts_transactions_tenant_id_settlement_transac~",
                table: "caring_hour_gifts",
                columns: new[] { "tenant_id", "settlement_transaction_id" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_federated_exchanges_transactions_TenantId_LocalTransactionId",
                table: "federated_exchanges",
                columns: new[] { "TenantId", "LocalTransactionId" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_federated_exchanges_users_TenantId_LocalUserId",
                table: "federated_exchanges",
                columns: new[] { "TenantId", "LocalUserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_federated_hour_transfers_transactions_TenantId_LocalTransac~",
                table: "federated_hour_transfers",
                columns: new[] { "TenantId", "LocalTransactionId" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_federated_hour_transfers_users_TenantId_LocalUserId",
                table: "federated_hour_transfers",
                columns: new[] { "TenantId", "LocalUserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // One-sided ledger legs, gift reservation links, partner token
            // revocations and wallet-credit references are durable financial
            // and security evidence. The former schema cannot represent them
            // without changing balances or allowing replay.
            throw new NotSupportedException(
                "WalletLedgerFederationPartnerParity is intentionally irreversible because downgrading would destroy wallet, idempotency, and token-revocation evidence while leaving external effects in place.");
        }
    }
}
