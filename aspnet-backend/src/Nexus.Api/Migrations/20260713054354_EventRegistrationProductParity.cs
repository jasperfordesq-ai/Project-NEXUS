using System;
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventRegistrationProductParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_invitation_campaign_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    CampaignId = table.Column<long>(type: "bigint", nullable: false),
                    CampaignRevision = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_invitation_campaign_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_invitation_campaigns",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    CampaignType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    SegmentCriteriaSummary = table.Column<string>(type: "jsonb", nullable: true),
                    PreviewCount = table.Column<int>(type: "integer", nullable: false),
                    ValidCount = table.Column<int>(type: "integer", nullable: false),
                    ErrorCount = table.Column<int>(type: "integer", nullable: false),
                    PreviewErrors = table.Column<string>(type: "jsonb", nullable: false),
                    DefaultLocale = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    ScheduledForUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IssuedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancellationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    CreateIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreateRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_invitation_campaigns", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_invitation_delivery_evidence",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    CampaignId = table.Column<long>(type: "bigint", nullable: false),
                    InvitationId = table.Column<long>(type: "bigint", nullable: false),
                    Channel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RecipientHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_invitation_delivery_evidence", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_invitation_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    InvitationId = table.Column<long>(type: "bigint", nullable: false),
                    InvitationVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_invitation_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_invitations",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    CampaignId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: true),
                    EmailCiphertext = table.Column<string>(type: "text", nullable: true),
                    EmailBlindHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    TokenPrefix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    InvitationVersion = table.Column<long>(type: "bigint", nullable: false),
                    Locale = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    TokenExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AcceptedBy = table.Column<int>(type: "integer", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedBy = table.Column<int>(type: "integer", nullable: true),
                    RevocationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_invitations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_answer_access_audits",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SubmissionId = table.Column<long>(type: "bigint", nullable: true),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CorrelationId = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IncludedSensitive = table.Column<bool>(type: "boolean", nullable: false),
                    AnswerCount = table.Column<int>(type: "integer", nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_answer_access_audits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_form_answers",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SubmissionId = table.Column<long>(type: "bigint", nullable: false),
                    QuestionId = table.Column<long>(type: "bigint", nullable: false),
                    StableKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DataClassification = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ValueJson = table.Column<string>(type: "text", nullable: true),
                    ValueHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IsPurged = table.Column<bool>(type: "boolean", nullable: false),
                    PurgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RetentionDueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_form_answers", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_form_questions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    FormVersionId = table.Column<long>(type: "bigint", nullable: false),
                    StableKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    QuestionType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Prompt = table.Column<string>(type: "text", nullable: false),
                    HelpText = table.Column<string>(type: "text", nullable: true),
                    IsRequired = table.Column<bool>(type: "boolean", nullable: false),
                    DataClassification = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    RetentionDays = table.Column<int>(type: "integer", nullable: false),
                    ChoiceOptions = table.Column<string>(type: "jsonb", nullable: true),
                    ValidationRules = table.Column<string>(type: "jsonb", nullable: true),
                    VisibilityRules = table.Column<string>(type: "jsonb", nullable: true),
                    DisplayedText = table.Column<string>(type: "text", nullable: true),
                    DisplayedTextVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_form_questions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_form_submissions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    FormVersionId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    EffectiveSlot = table.Column<int>(type: "integer", nullable: true),
                    SupersedesSubmissionId = table.Column<long>(type: "bigint", nullable: true),
                    SupersededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SaveIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    SaveRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AnonymisedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_form_submissions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_form_versions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    VersionNumber = table.Column<long>(type: "bigint", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Name = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    ForkedFromFormId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    PublishedBy = table.Column<int>(type: "integer", nullable: true),
                    CreateIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreateRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_form_versions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_guest_attendance",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    GuestId = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    CheckedInAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CheckedOutAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_guest_attendance", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_guest_attendance_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    AttendanceId = table.Column<long>(type: "bigint", nullable: false),
                    GuestId = table.Column<long>(type: "bigint", nullable: false),
                    AttendanceVersion = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_guest_attendance_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_guests",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RegistrationId = table.Column<long>(type: "bigint", nullable: false),
                    TicketEntitlementId = table.Column<long>(type: "bigint", nullable: true),
                    GuestNumber = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DisplayNameCiphertext = table.Column<string>(type: "text", nullable: false),
                    EmailCiphertext = table.Column<string>(type: "text", nullable: true),
                    PhoneCiphertext = table.Column<string>(type: "text", nullable: true),
                    EmailBlindHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    PreferredLocale = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    NotificationConsent = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentTextHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ConsentTextVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NotificationConsentHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    NotificationConsentVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    RetentionDueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AnonymisedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_guests", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_retention_items",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RetentionRunId = table.Column<long>(type: "bigint", nullable: false),
                    SubjectType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SubjectId = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Evidence = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_retention_items", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_retention_runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DryRunId = table.Column<long>(type: "bigint", nullable: true),
                    AsOfUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EligibleCount = table.Column<int>(type: "integer", nullable: false),
                    AffectedCount = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_retention_runs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_settings",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ApprovalMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FormState = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PublishedFormVersionId = table.Column<long>(type: "bigint", nullable: true),
                    PerMemberLimit = table.Column<int>(type: "integer", nullable: false),
                    GuestsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    MaxGuestsPerRegistration = table.Column<int>(type: "integer", nullable: false),
                    GuestRetentionDays = table.Column<int>(type: "integer", nullable: false),
                    OpensAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosesAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancellationCutoffAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EventTimezoneSnapshot = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    UpdatedBy = table.Column<int>(type: "integer", nullable: false),
                    PublishedBy = table.Column<int>(type: "integer", nullable: true),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_settings_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SettingsId = table.Column<long>(type: "bigint", nullable: false),
                    SettingsRevision = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_settings_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_registration_submission_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    SubmissionId = table.Column<long>(type: "bigint", nullable: false),
                    SubmissionRevision = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Snapshot = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_registration_submission_history", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_campaign_history_TenantId_CampaignId_Campa~",
                table: "event_invitation_campaign_history",
                columns: new[] { "TenantId", "CampaignId", "CampaignRevision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_campaign_history_TenantId_IdempotencyHash",
                table: "event_invitation_campaign_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_campaigns_TenantId_CreateIdempotencyHash",
                table: "event_invitation_campaigns",
                columns: new[] { "TenantId", "CreateIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_IdempotencyHash",
                table: "event_invitation_delivery_evidence",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_delivery_evidence_TenantId_InvitationId_Ch~",
                table: "event_invitation_delivery_evidence",
                columns: new[] { "TenantId", "InvitationId", "Channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_history_TenantId_IdempotencyHash",
                table: "event_invitation_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitation_history_TenantId_InvitationId_InvitationVe~",
                table: "event_invitation_history",
                columns: new[] { "TenantId", "InvitationId", "InvitationVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_invitations_TenantId_CampaignId_UserId",
                table: "event_invitations",
                columns: new[] { "TenantId", "CampaignId", "UserId" },
                unique: true,
                filter: "\"UserId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_event_invitations_TokenHash",
                table: "event_invitations",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_answer_access_audits_TenantId_Correlatio~",
                table: "event_registration_answer_access_audits",
                columns: new[] { "TenantId", "CorrelationId", "Action" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_answers_TenantId_SubmissionId_Quest~",
                table: "event_registration_form_answers",
                columns: new[] { "TenantId", "SubmissionId", "QuestionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_questions_TenantId_FormVersionId_Po~",
                table: "event_registration_form_questions",
                columns: new[] { "TenantId", "FormVersionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_questions_TenantId_FormVersionId_St~",
                table: "event_registration_form_questions",
                columns: new[] { "TenantId", "FormVersionId", "StableKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_submissions_TenantId_EventId_Regis~1",
                table: "event_registration_form_submissions",
                columns: new[] { "TenantId", "EventId", "RegistrationId", "EffectiveSlot" },
                unique: true,
                filter: "\"EffectiveSlot\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_submissions_TenantId_EventId_Regist~",
                table: "event_registration_form_submissions",
                columns: new[] { "TenantId", "EventId", "RegistrationId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_submissions_TenantId_SaveIdempotenc~",
                table: "event_registration_form_submissions",
                columns: new[] { "TenantId", "SaveIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_versions_TenantId_CreateIdempotency~",
                table: "event_registration_form_versions",
                columns: new[] { "TenantId", "CreateIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_form_versions_TenantId_EventId_VersionNu~",
                table: "event_registration_form_versions",
                columns: new[] { "TenantId", "EventId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guest_attendance_TenantId_EventId_GuestId",
                table: "event_registration_guest_attendance",
                columns: new[] { "TenantId", "EventId", "GuestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guest_attendance_history_TenantId_Attend~",
                table: "event_registration_guest_attendance_history",
                columns: new[] { "TenantId", "AttendanceId", "AttendanceVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guest_attendance_history_TenantId_Idempo~",
                table: "event_registration_guest_attendance_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guests_TenantId_RegistrationId_GuestNumb~",
                table: "event_registration_guests",
                columns: new[] { "TenantId", "RegistrationId", "GuestNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_guests_TenantId_TicketEntitlementId",
                table: "event_registration_guests",
                columns: new[] { "TenantId", "TicketEntitlementId" },
                unique: true,
                filter: "\"TicketEntitlementId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_retention_items_TenantId_RetentionRunId_~",
                table: "event_registration_retention_items",
                columns: new[] { "TenantId", "RetentionRunId", "SubjectType", "SubjectId", "Action" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_retention_runs_TenantId_IdempotencyHash",
                table: "event_registration_retention_runs",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_settings_TenantId_EventId",
                table: "event_registration_settings",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_settings_history_TenantId_IdempotencyHash",
                table: "event_registration_settings_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_settings_history_TenantId_SettingsId_Set~",
                table: "event_registration_settings_history",
                columns: new[] { "TenantId", "SettingsId", "SettingsRevision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_submission_history_TenantId_IdempotencyH~",
                table: "event_registration_submission_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_registration_submission_history_TenantId_SubmissionId~",
                table: "event_registration_submission_history",
                columns: new[] { "TenantId", "SubmissionId", "SubmissionRevision" },
                unique: true);

            migrationBuilder.Sql("""
                CREATE UNIQUE INDEX uq_events_tenant_id ON events ("TenantId", "Id");
                CREATE UNIQUE INDEX uq_event_registrations_tenant_event_id ON event_registrations ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_settings_tenant_event_id ON event_registration_settings ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_form_tenant_event_id ON event_registration_form_versions ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_question_tenant_event_id ON event_registration_form_questions ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_submission_tenant_event_id ON event_registration_form_submissions ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_inv_campaign_tenant_event_id ON event_invitation_campaigns ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_invitation_tenant_event_id ON event_invitations ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_guest_tenant_event_id ON event_registration_guests ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_guest_att_tenant_event_id ON event_registration_guest_attendance ("TenantId", "EventId", "Id");
                CREATE UNIQUE INDEX uq_ev_reg_retention_tenant_event_id ON event_registration_retention_runs ("TenantId", "EventId", "Id");

                ALTER TABLE event_registration_settings
                  ADD CONSTRAINT fk_ev_reg_settings_tenant FOREIGN KEY ("TenantId") REFERENCES tenants("Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_event FOREIGN KEY ("TenantId","EventId") REFERENCES events("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_creator FOREIGN KEY ("TenantId","CreatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_updater FOREIGN KEY ("TenantId","UpdatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_publisher FOREIGN KEY ("TenantId","PublishedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_form FOREIGN KEY ("TenantId","EventId","PublishedFormVersionId") REFERENCES event_registration_form_versions("TenantId","EventId","VersionNumber") ON DELETE RESTRICT;

                ALTER TABLE event_registration_settings_history
                  ADD CONSTRAINT fk_ev_reg_settings_hist_settings FOREIGN KEY ("TenantId","EventId","SettingsId") REFERENCES event_registration_settings("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_settings_hist_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_form_versions
                  ADD CONSTRAINT fk_ev_reg_form_settings FOREIGN KEY ("TenantId","EventId") REFERENCES event_registration_settings("TenantId","EventId") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_form_creator FOREIGN KEY ("TenantId","CreatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_form_updater FOREIGN KEY ("TenantId","UpdatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_form_publisher FOREIGN KEY ("TenantId","PublishedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_form_questions
                  ADD CONSTRAINT fk_ev_reg_question_form FOREIGN KEY ("TenantId","EventId","FormVersionId") REFERENCES event_registration_form_versions("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_form_submissions
                  ADD CONSTRAINT fk_ev_reg_submission_registration FOREIGN KEY ("TenantId","EventId","RegistrationId") REFERENCES event_registrations("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_submission_form FOREIGN KEY ("TenantId","EventId","FormVersionId") REFERENCES event_registration_form_versions("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_submission_user FOREIGN KEY ("TenantId","UserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_submission_supersedes FOREIGN KEY ("TenantId","EventId","SupersedesSubmissionId") REFERENCES event_registration_form_submissions("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_form_answers
                  ADD CONSTRAINT fk_ev_reg_answer_submission FOREIGN KEY ("TenantId","EventId","SubmissionId") REFERENCES event_registration_form_submissions("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_answer_question FOREIGN KEY ("TenantId","EventId","QuestionId") REFERENCES event_registration_form_questions("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_submission_history
                  ADD CONSTRAINT fk_ev_reg_submission_hist_submission FOREIGN KEY ("TenantId","EventId","SubmissionId") REFERENCES event_registration_form_submissions("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_submission_hist_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_answer_access_audits
                  ADD CONSTRAINT fk_ev_reg_access_submission FOREIGN KEY ("TenantId","EventId","SubmissionId") REFERENCES event_registration_form_submissions("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_access_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitation_campaigns
                  ADD CONSTRAINT fk_ev_inv_campaign_event FOREIGN KEY ("TenantId","EventId") REFERENCES events("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_inv_campaign_creator FOREIGN KEY ("TenantId","CreatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_inv_campaign_updater FOREIGN KEY ("TenantId","UpdatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitation_campaign_history
                  ADD CONSTRAINT fk_ev_inv_campaign_hist_campaign FOREIGN KEY ("TenantId","EventId","CampaignId") REFERENCES event_invitation_campaigns("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_inv_campaign_hist_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitations
                  ADD CONSTRAINT fk_ev_invitation_campaign FOREIGN KEY ("TenantId","EventId","CampaignId") REFERENCES event_invitation_campaigns("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_invitation_member FOREIGN KEY ("TenantId","UserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_invitation_accepted_by FOREIGN KEY ("TenantId","AcceptedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_invitation_revoked_by FOREIGN KEY ("TenantId","RevokedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitation_history
                  ADD CONSTRAINT fk_ev_invitation_hist_invitation FOREIGN KEY ("TenantId","EventId","InvitationId") REFERENCES event_invitations("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_invitation_hist_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_invitation_delivery_evidence
                  ADD CONSTRAINT fk_ev_inv_delivery_campaign FOREIGN KEY ("TenantId","EventId","CampaignId") REFERENCES event_invitation_campaigns("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_inv_delivery_invitation FOREIGN KEY ("TenantId","EventId","InvitationId") REFERENCES event_invitations("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_guests
                  ADD CONSTRAINT fk_ev_reg_guest_registration FOREIGN KEY ("TenantId","EventId","RegistrationId") REFERENCES event_registrations("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_ticket FOREIGN KEY ("TenantId","EventId","TicketEntitlementId") REFERENCES event_ticket_entitlements("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_creator FOREIGN KEY ("TenantId","CreatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_guest_attendance
                  ADD CONSTRAINT fk_ev_reg_guest_att_guest FOREIGN KEY ("TenantId","EventId","GuestId") REFERENCES event_registration_guests("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_att_updater FOREIGN KEY ("TenantId","UpdatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_guest_attendance_history
                  ADD CONSTRAINT fk_ev_reg_guest_att_hist_attendance FOREIGN KEY ("TenantId","EventId","AttendanceId") REFERENCES event_registration_guest_attendance("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_att_hist_guest FOREIGN KEY ("TenantId","EventId","GuestId") REFERENCES event_registration_guests("TenantId","EventId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_guest_att_hist_actor FOREIGN KEY ("TenantId","ActorUserId") REFERENCES users("TenantId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_retention_runs
                  ADD CONSTRAINT fk_ev_reg_retention_event FOREIGN KEY ("TenantId","EventId") REFERENCES events("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_retention_actor FOREIGN KEY ("TenantId","CreatedBy") REFERENCES users("TenantId","Id") ON DELETE RESTRICT,
                  ADD CONSTRAINT fk_ev_reg_retention_dry FOREIGN KEY ("TenantId","EventId","DryRunId") REFERENCES event_registration_retention_runs("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_retention_items
                  ADD CONSTRAINT fk_ev_reg_retention_item_run FOREIGN KEY ("TenantId","EventId","RetentionRunId") REFERENCES event_registration_retention_runs("TenantId","EventId","Id") ON DELETE RESTRICT;

                ALTER TABLE event_registration_settings
                  ADD CONSTRAINT chk_event_registration_settings_revision CHECK ("Revision" > 0),
                  ADD CONSTRAINT chk_event_registration_settings_status CHECK ("Status" IN ('draft','published')),
                  ADD CONSTRAINT chk_event_registration_settings_approval CHECK ("ApprovalMode" IN ('auto','manual')),
                  ADD CONSTRAINT chk_event_registration_settings_form_state CHECK ("FormState" IN ('none','draft','published')),
                  ADD CONSTRAINT chk_event_registration_settings_limits CHECK ("PerMemberLimit" BETWEEN 1 AND 1000 AND "MaxGuestsPerRegistration" BETWEEN 0 AND 20 AND "GuestRetentionDays" BETWEEN 1 AND 3650),
                  ADD CONSTRAINT chk_event_registration_settings_guests CHECK ("GuestsEnabled" OR "MaxGuestsPerRegistration" = 0),
                  ADD CONSTRAINT chk_event_registration_settings_window CHECK (("OpensAtUtc" IS NULL OR "ClosesAtUtc" IS NULL OR "OpensAtUtc" < "ClosesAtUtc") AND ("CancellationCutoffAtUtc" IS NULL OR "ClosesAtUtc" IS NULL OR "CancellationCutoffAtUtc" <= "ClosesAtUtc")),
                  ADD CONSTRAINT chk_event_registration_settings_publish CHECK (("Status"='draft' AND "PublishedBy" IS NULL AND "PublishedAt" IS NULL) OR ("Status"='published' AND "PublishedBy" IS NOT NULL AND "PublishedAt" IS NOT NULL));

                ALTER TABLE event_registration_settings_history
                  ADD CONSTRAINT chk_event_registration_settings_hist_revision CHECK ("SettingsRevision" > 0),
                  ADD CONSTRAINT chk_event_registration_settings_hist_action CHECK ("Action" IN ('saved','published','form_updated','form_published')),
                  ADD CONSTRAINT chk_event_registration_settings_hist_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_form_versions
                  ADD CONSTRAINT chk_event_registration_form_revision CHECK ("VersionNumber" > 0 AND "Revision" > 0),
                  ADD CONSTRAINT chk_event_registration_form_status CHECK ("Status" IN ('draft','published')),
                  ADD CONSTRAINT chk_event_registration_form_name CHECK (char_length(btrim("Name")) BETWEEN 1 AND 191),
                  ADD CONSTRAINT chk_event_registration_form_publish CHECK (("Status"='draft' AND "PublishedBy" IS NULL AND "PublishedAt" IS NULL) OR ("Status"='published' AND "PublishedBy" IS NOT NULL AND "PublishedAt" IS NOT NULL)),
                  ADD CONSTRAINT chk_event_registration_form_hashes CHECK ("CreateIdempotencyHash" ~ '^[0-9a-f]{64}$' AND "CreateRequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_form_questions
                  ADD CONSTRAINT chk_event_registration_question_position CHECK ("Position" > 0),
                  ADD CONSTRAINT chk_event_registration_question_type CHECK ("QuestionType" IN ('short_text','long_text','single_choice','multiple_choice','dietary','accessibility','consent','waiver')),
                  ADD CONSTRAINT chk_event_registration_question_class CHECK ("DataClassification" IN ('public','internal','confidential','sensitive')),
                  ADD CONSTRAINT chk_event_registration_question_retention CHECK ("RetentionDays" BETWEEN 1 AND 3650),
                  ADD CONSTRAINT chk_event_registration_question_json CHECK (("ChoiceOptions" IS NULL OR jsonb_typeof("ChoiceOptions")='array') AND ("ValidationRules" IS NULL OR jsonb_typeof("ValidationRules")='object') AND ("VisibilityRules" IS NULL OR jsonb_typeof("VisibilityRules")='object'));

                ALTER TABLE event_registration_form_submissions
                  ADD CONSTRAINT chk_event_registration_submission_revision CHECK ("Revision" > 0 AND "AttemptNumber" > 0),
                  ADD CONSTRAINT chk_event_registration_submission_status CHECK ("Status" IN ('draft','submitted','withdrawn','anonymised')),
                  ADD CONSTRAINT chk_event_registration_submission_effective CHECK ("EffectiveSlot" IS NULL OR "EffectiveSlot"=1),
                  ADD CONSTRAINT chk_event_registration_submission_lifecycle CHECK (("Status"='draft' AND "SubmittedAt" IS NULL AND "WithdrawnAt" IS NULL AND "AnonymisedAt" IS NULL) OR ("Status"='submitted' AND "SubmittedAt" IS NOT NULL AND "WithdrawnAt" IS NULL AND "AnonymisedAt" IS NULL) OR ("Status"='withdrawn' AND "SubmittedAt" IS NOT NULL AND "WithdrawnAt" IS NOT NULL AND "AnonymisedAt" IS NULL) OR ("Status"='anonymised' AND "AnonymisedAt" IS NOT NULL)),
                  ADD CONSTRAINT chk_event_registration_submission_hashes CHECK ("SaveIdempotencyHash" ~ '^[0-9a-f]{64}$' AND "SaveRequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_form_answers
                  ADD CONSTRAINT chk_event_registration_answer_class CHECK ("DataClassification" IN ('public','internal','confidential','sensitive')),
                  ADD CONSTRAINT chk_event_registration_answer_hash CHECK ("ValueHash" ~ '^[0-9a-f]{64}$'),
                  ADD CONSTRAINT chk_event_registration_answer_purge CHECK ((NOT "IsPurged" AND "ValueJson" IS NOT NULL AND "PurgedAt" IS NULL) OR ("IsPurged" AND "ValueJson" IS NULL AND "PurgedAt" IS NOT NULL));

                ALTER TABLE event_registration_submission_history
                  ADD CONSTRAINT chk_event_registration_submission_hist_revision CHECK ("SubmissionRevision" > 0),
                  ADD CONSTRAINT chk_event_registration_submission_hist_action CHECK ("Action" IN ('saved','submitted','amended','withdrawn','anonymised')),
                  ADD CONSTRAINT chk_event_registration_submission_hist_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_answer_access_audits
                  ADD CONSTRAINT chk_event_registration_access_action CHECK ("Action" IN ('read','export')),
                  ADD CONSTRAINT chk_event_registration_access_correlation CHECK ("CorrelationId" ~ '^[0-9a-f]{64}$' AND char_length(btrim("Purpose")) > 0 AND "AnswerCount" >= 0);

                ALTER TABLE event_invitation_campaigns
                  ADD CONSTRAINT chk_event_invitation_campaign_revision CHECK ("Revision" > 0),
                  ADD CONSTRAINT chk_event_invitation_campaign_type CHECK ("CampaignType" IN ('member','email','group','audience','csv')),
                  ADD CONSTRAINT chk_event_invitation_campaign_status CHECK ("Status" IN ('previewed','scheduled','issued','cancelled')),
                  ADD CONSTRAINT chk_event_invitation_campaign_counts CHECK ("PreviewCount">=0 AND "ValidCount">=0 AND "ErrorCount">=0 AND "ValidCount"+"ErrorCount"="PreviewCount"),
                  ADD CONSTRAINT chk_event_invitation_campaign_json CHECK (jsonb_typeof("PreviewErrors")='array' AND ("SegmentCriteriaSummary" IS NULL OR jsonb_typeof("SegmentCriteriaSummary")='object')),
                  ADD CONSTRAINT chk_event_invitation_campaign_state CHECK (("Status"='previewed' AND "IssuedAt" IS NULL AND "CancelledAt" IS NULL) OR ("Status"='scheduled' AND "ScheduledForUtc" IS NOT NULL AND "IssuedAt" IS NULL AND "CancelledAt" IS NULL) OR ("Status"='issued' AND "IssuedAt" IS NOT NULL AND "CancelledAt" IS NULL) OR ("Status"='cancelled' AND "CancelledAt" IS NOT NULL AND char_length(btrim("CancellationReason"))>0)),
                  ADD CONSTRAINT chk_event_invitation_campaign_hashes CHECK ("CreateIdempotencyHash" ~ '^[0-9a-f]{64}$' AND "CreateRequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_invitation_campaign_history
                  ADD CONSTRAINT chk_event_invitation_campaign_hist_revision CHECK ("CampaignRevision" > 0),
                  ADD CONSTRAINT chk_event_invitation_campaign_hist_action CHECK ("Action" IN ('previewed','scheduled','issued','cancelled')),
                  ADD CONSTRAINT chk_event_invitation_campaign_hist_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_invitations
                  ADD CONSTRAINT chk_event_invitation_version CHECK ("InvitationVersion" > 0),
                  ADD CONSTRAINT chk_event_invitation_status CHECK ("Status" IN ('issued','accepted','revoked','expired')),
                  ADD CONSTRAINT chk_event_invitation_target CHECK (("UserId" IS NOT NULL AND "EmailCiphertext" IS NULL AND "EmailBlindHash" IS NULL) OR ("UserId" IS NULL AND "EmailCiphertext" IS NOT NULL AND "EmailBlindHash" ~ '^[0-9a-f]{64}$')),
                  ADD CONSTRAINT chk_event_invitation_token CHECK ("TokenHash" ~ '^[0-9a-f]{64}$' AND char_length("TokenPrefix") BETWEEN 8 AND 16),
                  ADD CONSTRAINT chk_event_invitation_lifecycle CHECK (("Status"='issued' AND "AcceptedAt" IS NULL AND "RevokedAt" IS NULL) OR ("Status"='accepted' AND "AcceptedAt" IS NOT NULL AND "AcceptedBy" IS NOT NULL AND "RevokedAt" IS NULL) OR ("Status"='revoked' AND "RevokedAt" IS NOT NULL AND "RevokedBy" IS NOT NULL AND char_length(btrim("RevocationReason"))>0) OR "Status"='expired');

                ALTER TABLE event_invitation_history
                  ADD CONSTRAINT chk_event_invitation_hist_version CHECK ("InvitationVersion" > 0),
                  ADD CONSTRAINT chk_event_invitation_hist_action CHECK ("Action" IN ('issued','accepted','revoked','expired')),
                  ADD CONSTRAINT chk_event_invitation_hist_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_guests
                  ADD CONSTRAINT chk_event_registration_guest_revision CHECK ("Revision" > 0 AND "GuestNumber" BETWEEN 1 AND 20),
                  ADD CONSTRAINT chk_event_registration_guest_status CHECK ("Status" IN ('captured','withdrawn','anonymised')),
                  ADD CONSTRAINT chk_event_registration_guest_consent CHECK ("ConsentTextHash" ~ '^[0-9a-f]{64}$' AND char_length(btrim("ConsentTextVersion"))>0),
                  ADD CONSTRAINT chk_event_registration_guest_lifecycle CHECK (("Status"='captured' AND "DisplayNameCiphertext" IS NOT NULL AND "WithdrawnAt" IS NULL AND "AnonymisedAt" IS NULL) OR ("Status"='withdrawn' AND "WithdrawnAt" IS NOT NULL AND "AnonymisedAt" IS NULL) OR ("Status"='anonymised' AND "AnonymisedAt" IS NOT NULL AND "EmailCiphertext" IS NULL AND "PhoneCiphertext" IS NULL));

                ALTER TABLE event_registration_guest_attendance
                  ADD CONSTRAINT chk_event_registration_guest_att_version CHECK ("Version" >= 0),
                  ADD CONSTRAINT chk_event_registration_guest_att_status CHECK ("Status" IN ('not_checked_in','checked_in','checked_out','no_show'));

                ALTER TABLE event_registration_guest_attendance_history
                  ADD CONSTRAINT chk_event_registration_guest_att_hist_version CHECK ("AttendanceVersion" > 0),
                  ADD CONSTRAINT chk_event_registration_guest_att_hist_action CHECK ("Action" IN ('check_in','check_out','no_show','undo')),
                  ADD CONSTRAINT chk_event_registration_guest_att_hist_status CHECK ("Status" IN ('not_checked_in','checked_in','checked_out','no_show')),
                  ADD CONSTRAINT chk_event_registration_guest_att_hist_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_retention_runs
                  ADD CONSTRAINT chk_event_registration_retention_mode CHECK ("Mode" IN ('dry_run','apply')),
                  ADD CONSTRAINT chk_event_registration_retention_status CHECK ("Status"='completed' AND "EligibleCount">=0 AND "AffectedCount">=0 AND "AffectedCount"<="EligibleCount"),
                  ADD CONSTRAINT chk_event_registration_retention_link CHECK (("Mode"='dry_run' AND "DryRunId" IS NULL AND "AffectedCount"=0) OR ("Mode"='apply' AND "DryRunId" IS NOT NULL)),
                  ADD CONSTRAINT chk_event_registration_retention_hashes CHECK ("IdempotencyHash" ~ '^[0-9a-f]{64}$' AND "RequestHash" ~ '^[0-9a-f]{64}$');

                ALTER TABLE event_registration_retention_items
                  ADD CONSTRAINT chk_event_registration_retention_item_subject CHECK ("SubjectType" IN ('answer','guest')),
                  ADD CONSTRAINT chk_event_registration_retention_item_action CHECK (("SubjectType"='answer' AND "Action"='purge') OR ("SubjectType"='guest' AND "Action"='anonymise')),
                  ADD CONSTRAINT chk_event_registration_retention_item_status CHECK ("Status" IN ('eligible','applied','skipped'));

                CREATE OR REPLACE FUNCTION event_registration_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_registration_history_immutable' USING ERRCODE='P0001'; END $$;
                CREATE TRIGGER trg_ev_reg_settings_hist_no_update BEFORE UPDATE ON event_registration_settings_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_settings_hist_no_delete BEFORE DELETE ON event_registration_settings_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_submission_hist_no_update BEFORE UPDATE ON event_registration_submission_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_submission_hist_no_delete BEFORE DELETE ON event_registration_submission_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_access_audit_no_update BEFORE UPDATE ON event_registration_answer_access_audits FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_access_audit_no_delete BEFORE DELETE ON event_registration_answer_access_audits FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_inv_campaign_hist_no_update BEFORE UPDATE ON event_invitation_campaign_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_inv_campaign_hist_no_delete BEFORE DELETE ON event_invitation_campaign_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_inv_history_no_update BEFORE UPDATE ON event_invitation_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_inv_history_no_delete BEFORE DELETE ON event_invitation_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_guest_att_hist_no_update BEFORE UPDATE ON event_registration_guest_attendance_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();
                CREATE TRIGGER trg_ev_reg_guest_att_hist_no_delete BEFORE DELETE ON event_registration_guest_attendance_history FOR EACH ROW EXECUTE FUNCTION event_registration_history_immutable();

                CREATE OR REPLACE FUNCTION event_registration_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'event_registration_delete_forbidden' USING ERRCODE='P0001'; END $$;
                CREATE TRIGGER trg_ev_reg_settings_no_delete BEFORE DELETE ON event_registration_settings FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_reg_form_no_delete BEFORE DELETE ON event_registration_form_versions FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_reg_submission_no_delete BEFORE DELETE ON event_registration_form_submissions FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_inv_campaign_no_delete BEFORE DELETE ON event_invitation_campaigns FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_invitation_no_delete BEFORE DELETE ON event_invitations FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_reg_guest_no_delete BEFORE DELETE ON event_registration_guests FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();
                CREATE TRIGGER trg_ev_reg_guest_att_no_delete BEFORE DELETE ON event_registration_guest_attendance FOR EACH ROW EXECUTE FUNCTION event_registration_no_delete();

                CREATE OR REPLACE FUNCTION event_registration_versioned_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF TG_TABLE_NAME='event_registration_form_submissions' THEN
                    IF NEW."Revision"<>OLD."Revision"+1 THEN RAISE EXCEPTION 'event_registration_submission_revision_invalid' USING ERRCODE='P0001'; END IF;
                  ELSIF TG_TABLE_NAME='event_invitation_campaigns' THEN
                    IF NEW."Revision"<>OLD."Revision"+1 THEN RAISE EXCEPTION 'event_invitation_campaign_revision_invalid' USING ERRCODE='P0001'; END IF;
                  ELSIF TG_TABLE_NAME='event_invitations' THEN
                    IF NEW."InvitationVersion"<>OLD."InvitationVersion"+1 THEN RAISE EXCEPTION 'event_invitation_version_invalid' USING ERRCODE='P0001'; END IF;
                  ELSIF TG_TABLE_NAME='event_registration_guest_attendance' THEN
                    IF NEW."Version"<>OLD."Version"+1 THEN RAISE EXCEPTION 'event_registration_guest_attendance_version_invalid' USING ERRCODE='P0001'; END IF;
                  END IF;
                  RETURN NEW;
                END $$;
                CREATE TRIGGER trg_ev_reg_submission_version BEFORE UPDATE ON event_registration_form_submissions FOR EACH ROW EXECUTE FUNCTION event_registration_versioned_update();
                CREATE TRIGGER trg_ev_inv_campaign_version BEFORE UPDATE ON event_invitation_campaigns FOR EACH ROW EXECUTE FUNCTION event_registration_versioned_update();
                CREATE TRIGGER trg_ev_invitation_version BEFORE UPDATE ON event_invitations FOR EACH ROW EXECUTE FUNCTION event_registration_versioned_update();
                CREATE TRIGGER trg_ev_reg_guest_att_version BEFORE UPDATE ON event_registration_guest_attendance FOR EACH ROW EXECUTE FUNCTION event_registration_versioned_update();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DO $$ BEGIN
                  IF EXISTS (SELECT 1 FROM event_registration_settings LIMIT 1)
                     OR EXISTS (SELECT 1 FROM event_invitation_campaigns LIMIT 1)
                     OR EXISTS (SELECT 1 FROM event_registration_form_submissions LIMIT 1)
                     OR EXISTS (SELECT 1 FROM event_registration_guests LIMIT 1)
                     OR EXISTS (SELECT 1 FROM event_registration_retention_runs LIMIT 1)
                  THEN RAISE EXCEPTION 'event_registration_product_rollback_refused_evidence_exists' USING ERRCODE='P0001';
                  END IF;
                END $$;
                DROP FUNCTION IF EXISTS event_registration_versioned_update() CASCADE;
                DROP FUNCTION IF EXISTS event_registration_no_delete() CASCADE;
                DROP FUNCTION IF EXISTS event_registration_history_immutable() CASCADE;
                ALTER TABLE event_registration_settings DROP CONSTRAINT IF EXISTS fk_ev_reg_settings_form;
                """);
            migrationBuilder.DropTable(
                name: "event_invitation_delivery_evidence");

            migrationBuilder.DropTable(
                name: "event_invitation_history");

            migrationBuilder.DropTable(
                name: "event_registration_guest_attendance_history");

            migrationBuilder.DropTable(
                name: "event_registration_answer_access_audits");

            migrationBuilder.DropTable(
                name: "event_registration_submission_history");

            migrationBuilder.DropTable(
                name: "event_invitation_campaign_history");

            migrationBuilder.DropTable(
                name: "event_registration_retention_items");

            migrationBuilder.DropTable(
                name: "event_registration_guest_attendance");

            migrationBuilder.DropTable(
                name: "event_registration_guests");

            migrationBuilder.DropTable(
                name: "event_registration_form_answers");

            migrationBuilder.DropTable(
                name: "event_registration_form_submissions");

            migrationBuilder.DropTable(
                name: "event_registration_form_questions");

            migrationBuilder.DropTable(
                name: "event_invitations");

            migrationBuilder.DropTable(
                name: "event_invitation_campaigns");

            migrationBuilder.DropTable(
                name: "event_registration_settings_history");

            migrationBuilder.DropTable(
                name: "event_registration_form_versions");

            migrationBuilder.DropTable(
                name: "event_registration_retention_runs");

            migrationBuilder.DropTable(
                name: "event_registration_settings");

            migrationBuilder.Sql("""
                DROP INDEX IF EXISTS uq_event_registrations_tenant_event_id;
                DROP INDEX IF EXISTS uq_events_tenant_id;
                """);
        }
    }
}
