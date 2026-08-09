using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventAnalyticsParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_analytics_access_audits",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    AccessScope = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PurposeCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    QueryHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ResultCount = table.Column<int>(type: "integer", nullable: false),
                    SuppressedCount = table.Column<int>(type: "integer", nullable: false),
                    PrivacyThreshold = table.Column<int>(type: "integer", nullable: false, defaultValue: 5),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_analytics_access_audits", x => x.Id);
                    table.CheckConstraint("chk_event_analytics_access_scope", "\"AccessScope\" IN ('organizer_summary','tenant_summary','csv_export')");
                    table.CheckConstraint("chk_event_analytics_access_threshold", "\"PrivacyThreshold\" >= 5 AND \"SuppressedCount\" <= \"ResultCount\"");
                });

            migrationBuilder.CreateTable(
                name: "event_analytics_optional_facts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    OccurrenceKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    Metric = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DeduplicationHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    SubjectHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    PseudonymKeyVersion = table.Column<string>(type: "character(16)", fixedLength: true, maxLength: 16, nullable: true),
                    ConsentRecordId = table.Column<long>(type: "bigint", nullable: true),
                    ConsentVersion = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    SourceSurface = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ClientPlatform = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Dimensions = table.Column<string>(type: "jsonb", nullable: false),
                    IsLate = table.Column<bool>(type: "boolean", nullable: false),
                    OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RetentionDueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "active"),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_analytics_optional_facts", x => x.Id);
                    table.CheckConstraint("chk_event_analytics_fact_metric", "\"Metric\" IN ('event_viewed','registration_started')");
                    table.CheckConstraint("chk_event_analytics_fact_status", "\"Status\" IN ('active','withdrawn')");
                    table.CheckConstraint("chk_event_analytics_fact_time", "\"OccurredAt\" <= \"ReceivedAt\" + interval '5 minutes' AND \"RetentionDueAt\" > \"OccurredAt\"");
                });

            migrationBuilder.CreateTable(
                name: "event_analytics_withdrawal_runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ConsentCount = table.Column<int>(type: "integer", nullable: false),
                    FactCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_analytics_withdrawal_runs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_attendance_credit_claims",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    AttendanceId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ClaimType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    FundingSourceType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    FundingSourceId = table.Column<int>(type: "integer", nullable: true),
                    PayerUserId = table.Column<int>(type: "integer", nullable: true),
                    PayeeUserId = table.Column<int>(type: "integer", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "time_credit"),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "pending"),
                    TransactionId = table.Column<long>(type: "bigint", nullable: true),
                    ParentClaimId = table.Column<long>(type: "bigint", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ReversalCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FailedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReversedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_attendance_credit_claims", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_access_actor",
                table: "event_analytics_access_audits",
                columns: new[] { "TenantId", "ActorUserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_access_event",
                table: "event_analytics_access_audits",
                columns: new[] { "TenantId", "EventId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_fact_consent",
                table: "event_analytics_optional_facts",
                columns: new[] { "TenantId", "ConsentRecordId", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_fact_event",
                table: "event_analytics_optional_facts",
                columns: new[] { "TenantId", "EventId", "Metric", "Status", "OccurredAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_fact_retention",
                table: "event_analytics_optional_facts",
                columns: new[] { "TenantId", "RetentionDueAt", "Status", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_analytics_fact_dedup",
                table: "event_analytics_optional_facts",
                columns: new[] { "TenantId", "DeduplicationHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_analytics_fact_scope",
                table: "event_analytics_optional_facts",
                columns: new[] { "TenantId", "EventId", "Id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_analytics_withdraw_actor",
                table: "event_analytics_withdrawal_runs",
                columns: new[] { "TenantId", "ActorUserId", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_analytics_withdraw_key",
                table: "event_analytics_withdrawal_runs",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_event_credit_claim_attendance",
                table: "event_attendance_credit_claims",
                columns: new[] { "TenantId", "EventId", "AttendanceId" });

            migrationBuilder.CreateIndex(
                name: "idx_event_credit_claim_status",
                table: "event_attendance_credit_claims",
                columns: new[] { "TenantId", "Status", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_credit_claim_key",
                table: "event_attendance_credit_claims",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_credit_claim_subject",
                table: "event_attendance_credit_claims",
                columns: new[] { "TenantId", "EventId", "UserId", "ClaimType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_event_credit_claim_transaction",
                table: "event_attendance_credit_claims",
                column: "TransactionId",
                unique: true);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION reject_event_analytics_evidence_mutation()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION USING
                        ERRCODE = 'P0001',
                        MESSAGE = 'event_analytics_evidence_immutable';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_event_analytics_access_audits_immutable
                BEFORE UPDATE OR DELETE ON event_analytics_access_audits
                FOR EACH ROW EXECUTE FUNCTION reject_event_analytics_evidence_mutation();

                CREATE TRIGGER trg_event_analytics_withdrawal_runs_immutable
                BEFORE UPDATE OR DELETE ON event_analytics_withdrawal_runs
                FOR EACH ROW EXECUTE FUNCTION reject_event_analytics_evidence_mutation();

                CREATE TRIGGER trg_event_attendance_credit_claims_no_delete
                BEFORE DELETE ON event_attendance_credit_claims
                FOR EACH ROW EXECUTE FUNCTION reject_event_analytics_evidence_mutation();

                CREATE TRIGGER trg_event_analytics_optional_facts_no_delete
                BEFORE DELETE ON event_analytics_optional_facts
                FOR EACH ROW EXECUTE FUNCTION reject_event_analytics_evidence_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_event_analytics_access_audits_immutable ON event_analytics_access_audits;
                DROP TRIGGER IF EXISTS trg_event_analytics_withdrawal_runs_immutable ON event_analytics_withdrawal_runs;
                DROP TRIGGER IF EXISTS trg_event_attendance_credit_claims_no_delete ON event_attendance_credit_claims;
                DROP TRIGGER IF EXISTS trg_event_analytics_optional_facts_no_delete ON event_analytics_optional_facts;
                DROP FUNCTION IF EXISTS reject_event_analytics_evidence_mutation();
                """);

            migrationBuilder.DropTable(
                name: "event_analytics_access_audits");

            migrationBuilder.DropTable(
                name: "event_analytics_optional_facts");

            migrationBuilder.DropTable(
                name: "event_analytics_withdrawal_runs");

            migrationBuilder.DropTable(
                name: "event_attendance_credit_claims");
        }
    }
}
