using System;
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class CompleteCaringCaregiverLinkLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovedAt",
                table: "caring_caregiver_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ConsentEvidence",
                table: "caring_caregiver_links",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ConsentVerifiedAt",
                table: "caring_caregiver_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ConsentVerifiedBy",
                table: "caring_caregiver_links",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RecipientConfirmedAt",
                table: "caring_caregiver_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RecipientConfirmedBy",
                table: "caring_caregiver_links",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RejectedAt",
                table: "caring_caregiver_links",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RejectedBy",
                table: "caring_caregiver_links",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RejectionReason",
                table: "caring_caregiver_links",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_caring_caregiver_links_TenantId_Status",
                table: "caring_caregiver_links",
                columns: new[] { "TenantId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_caring_caregiver_links_TenantId_Status",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "ApprovedAt",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "ConsentEvidence",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "ConsentVerifiedAt",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "ConsentVerifiedBy",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "RecipientConfirmedAt",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "RecipientConfirmedBy",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "RejectedAt",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "RejectedBy",
                table: "caring_caregiver_links");

            migrationBuilder.DropColumn(
                name: "RejectionReason",
                table: "caring_caregiver_links");
        }
    }
}
