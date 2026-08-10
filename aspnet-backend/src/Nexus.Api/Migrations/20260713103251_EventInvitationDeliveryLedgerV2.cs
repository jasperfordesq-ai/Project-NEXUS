using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

using System;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

namespace Nexus.Api.Migrations
{
    // Copyright (c) 2024-2026 Jasper Ford
    // SPDX-License-Identifier: AGPL-3.0-or-later
    // Author: Jasper Ford
    // See NOTICE file for attribution and acknowledgements.
    /// <inheritdoc />
    public partial class EventInvitationDeliveryLedgerV2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_notification_deliveries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false), OutboxId = table.Column<long>(type: "bigint", nullable: false),
                    RecipientUserId = table.Column<int>(type: "integer", nullable: true), ExternalRecipientHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    Channel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false), DeliveryKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false), Attempts = table.Column<short>(type: "smallint", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true), ClaimToken = table.Column<Guid>(type: "uuid", nullable: true), ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true), SuppressedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true), DeadLetteredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PreferenceReason = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true), SuppressionReason = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    Provider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true), ProviderEvidenceId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true), LastError = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false), UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_notification_deliveries", x => x.Id);
                    table.CheckConstraint("ck_event_notification_delivery_external_hash", "\"ExternalRecipientHash\" IS NULL OR \"ExternalRecipientHash\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("ck_event_notification_delivery_recipient", "(\"RecipientUserId\" IS NOT NULL) <> (\"ExternalRecipientHash\" IS NOT NULL)");
                    table.ForeignKey(name: "FK_event_notification_deliveries_event_domain_outbox_OutboxId", column: x => x.OutboxId, principalTable: "event_domain_outbox", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateIndex(name: "idx_event_notification_delivery_claim", table: "event_notification_deliveries", columns: new[] { "Status", "NextAttemptAt", "Id" });
            migrationBuilder.CreateIndex(name: "uq_event_notification_delivery_external", table: "event_notification_deliveries", columns: new[] { "OutboxId", "ExternalRecipientHash", "Channel" }, unique: true, filter: "\"ExternalRecipientHash\" IS NOT NULL");
            migrationBuilder.CreateIndex(name: "uq_event_notification_delivery_key", table: "event_notification_deliveries", columns: new[] { "TenantId", "DeliveryKey" }, unique: true);
            migrationBuilder.CreateIndex(name: "uq_event_notification_delivery_member", table: "event_notification_deliveries", columns: new[] { "OutboxId", "RecipientUserId", "Channel" }, unique: true, filter: "\"RecipientUserId\" IS NOT NULL");
            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_delivery_evidence_NotificationDeliveryId",
                table: "event_invitation_delivery_evidence",
                column: "NotificationDeliveryId");

            migrationBuilder.AddForeignKey(
                name: "FK_event_invitation_delivery_evidence_event_notification_deliv~",
                table: "event_invitation_delivery_evidence",
                column: "NotificationDeliveryId",
                principalTable: "event_notification_deliveries",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_event_invitation_delivery_evidence_event_notification_deliv~",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropIndex(
                name: "IX_event_invitation_delivery_evidence_NotificationDeliveryId",
                table: "event_invitation_delivery_evidence");

            migrationBuilder.DropTable(name: "event_notification_deliveries");
        }
    }
}
