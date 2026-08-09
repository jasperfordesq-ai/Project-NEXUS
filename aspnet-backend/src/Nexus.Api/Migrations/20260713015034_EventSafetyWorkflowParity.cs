using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventSafetyWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_guardian_consent_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    ConsentId = table.Column<long>(type: "bigint", nullable: false),
                    MinorUserId = table.Column<int>(type: "integer", nullable: false),
                    ConsentVersion = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActorType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Evidence = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_guardian_consent_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_guardian_consents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RequirementsId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    MinorUserId = table.Column<int>(type: "integer", nullable: false),
                    GuardianEmailCiphertext = table.Column<string>(type: "text", nullable: false),
                    GuardianIdentityCiphertext = table.Column<string>(type: "text", nullable: false),
                    GuardianEmailBlindHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    GuardianLocale = table.Column<string>(type: "text", nullable: false),
                    RelationshipCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ConsentTextHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    PolicyBindingHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ConsentVersion = table.Column<long>(type: "bigint", nullable: false),
                    RequestedByUserId = table.Column<int>(type: "integer", nullable: false),
                    RequestIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TokenConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    GrantedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    WithdrawnByUserId = table.Column<int>(type: "integer", nullable: true),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_guardian_consents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_participation_denial_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    DenialId = table.Column<long>(type: "bigint", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    DecisionVersion = table.Column<long>(type: "bigint", nullable: false),
                    Decision = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ReasonCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ReviewerUserId = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EffectiveUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_participation_denial_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_participation_denials",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Decision = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ReasonCode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DecisionVersion = table.Column<long>(type: "bigint", nullable: false),
                    ReviewedByUserId = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EffectiveUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreateIdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreateRequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    WithdrawnByUserId = table.Column<int>(type: "integer", nullable: true),
                    WithdrawnAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_participation_denials", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_safety_code_acknowledgements",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RequirementsId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    EvidenceSequence = table.Column<long>(type: "bigint", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ReferencedAcknowledgementId = table.Column<long>(type: "bigint", nullable: true),
                    TextVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    TextHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    AcknowledgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_safety_code_acknowledgements", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_safety_requirement_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RequirementsId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsRevision = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionId = table.Column<long>(type: "bigint", nullable: false),
                    RequirementsVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_safety_requirement_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_safety_requirement_versions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    RequirementsId = table.Column<long>(type: "bigint", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    MinimumAge = table.Column<int>(type: "integer", nullable: true),
                    GuardianConsentRequired = table.Column<bool>(type: "boolean", nullable: false),
                    MinorAgeThreshold = table.Column<int>(type: "integer", nullable: true),
                    CodeOfConductRequired = table.Column<bool>(type: "boolean", nullable: false),
                    CodeOfConductText = table.Column<string>(type: "text", nullable: true),
                    CodeOfConductTextVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CodeOfConductTextHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    EligibilityPolicyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CapturedByUserId = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_safety_requirement_versions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "event_safety_requirements",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EventId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    CurrentVersion = table.Column<int>(type: "integer", nullable: false),
                    PublishedVersion = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    PublishedByUserId = table.Column<int>(type: "integer", nullable: true),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ArchivedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ArchivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_safety_requirements", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_event_guardian_consent_history_TenantId_ConsentId_ConsentVe~",
                table: "event_guardian_consent_history",
                columns: new[] { "TenantId", "ConsentId", "ConsentVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_guardian_consent_history_TenantId_IdempotencyHash",
                table: "event_guardian_consent_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_guardian_consents_TenantId_EventId_MinorUserId_Status",
                table: "event_guardian_consents",
                columns: new[] { "TenantId", "EventId", "MinorUserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_event_guardian_consents_TenantId_RequestIdempotencyHash",
                table: "event_guardian_consents",
                columns: new[] { "TenantId", "RequestIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_guardian_consents_TokenHash",
                table: "event_guardian_consents",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_participation_denial_history_TenantId_DenialId_Decisi~",
                table: "event_participation_denial_history",
                columns: new[] { "TenantId", "DenialId", "DecisionVersion" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_participation_denial_history_TenantId_IdempotencyHash",
                table: "event_participation_denial_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_participation_denials_TenantId_CreateIdempotencyHash",
                table: "event_participation_denials",
                columns: new[] { "TenantId", "CreateIdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_participation_denials_TenantId_EventId_UserId_Status",
                table: "event_participation_denials",
                columns: new[] { "TenantId", "EventId", "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_code_acknowledgements_TenantId_EventId_UserId_~",
                table: "event_safety_code_acknowledgements",
                columns: new[] { "TenantId", "EventId", "UserId", "EvidenceSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_code_acknowledgements_TenantId_IdempotencyHash",
                table: "event_safety_code_acknowledgements",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_requirement_history_TenantId_IdempotencyHash",
                table: "event_safety_requirement_history",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_requirement_history_TenantId_RequirementsId_Re~",
                table: "event_safety_requirement_history",
                columns: new[] { "TenantId", "RequirementsId", "RequirementsRevision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_requirement_versions_TenantId_IdempotencyHash",
                table: "event_safety_requirement_versions",
                columns: new[] { "TenantId", "IdempotencyHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_requirement_versions_TenantId_RequirementsId_V~",
                table: "event_safety_requirement_versions",
                columns: new[] { "TenantId", "RequirementsId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_event_safety_requirements_TenantId_EventId",
                table: "event_safety_requirements",
                columns: new[] { "TenantId", "EventId" },
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_safety_requirements ADD CONSTRAINT chk_event_safety_head CHECK ("Revision" > 0 AND "CurrentVersion" > 0 AND "Status" IN ('draft','published','archived') AND ("PublishedVersion" IS NULL OR "PublishedVersion" <= "CurrentVersion"));
                ALTER TABLE event_safety_requirement_versions ADD CONSTRAINT chk_event_safety_version CHECK ("VersionNumber" > 0 AND ("MinimumAge" IS NULL OR "MinimumAge" BETWEEN 0 AND 125) AND ((NOT "GuardianConsentRequired" AND "MinorAgeThreshold" IS NULL) OR ("GuardianConsentRequired" AND "MinorAgeThreshold" BETWEEN 1 AND 125)) AND ((NOT "CodeOfConductRequired" AND "CodeOfConductText" IS NULL AND "CodeOfConductTextVersion" IS NULL AND "CodeOfConductTextHash" IS NULL) OR ("CodeOfConductRequired" AND length(btrim("CodeOfConductText")) > 0 AND length(btrim("CodeOfConductTextVersion")) > 0 AND "CodeOfConductTextHash" ~ '^[0-9a-f]{64}$')));
                ALTER TABLE event_safety_requirement_history ADD CONSTRAINT chk_event_safety_history CHECK ("RequirementsRevision" > 0 AND "RequirementsVersionNumber" > 0 AND "Action" IN ('saved','published','archived'));
                ALTER TABLE event_safety_code_acknowledgements ADD CONSTRAINT chk_event_safety_ack CHECK ("EvidenceSequence" > 0 AND "Action" IN ('acknowledged','withdrawn','replaced') AND "TextHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE event_guardian_consents ADD CONSTRAINT chk_event_guardian_consent CHECK ("RelationshipCode" IN ('parent','guardian','legal_guardian','carer') AND "ConsentVersion" > 0 AND "Status" IN ('pending','active','withdrawn','expired') AND "RequestedAt" < "ExpiresAt" AND "TokenHash" ~ '^[0-9a-f]{64}$' AND "GuardianEmailBlindHash" ~ '^[0-9a-f]{64}$');
                ALTER TABLE event_guardian_consent_history ADD CONSTRAINT chk_event_guardian_history CHECK ("ConsentVersion" > 0 AND "Status" IN ('pending','active','withdrawn','expired') AND "Action" IN ('requested','granted','withdrawn','expired') AND "ActorType" IN ('platform_user','guardian_external'));
                ALTER TABLE event_participation_denials ADD CONSTRAINT chk_event_denial CHECK ("DecisionVersion" > 0 AND "Decision" IN ('deny','remove') AND "ReasonCode" IN ('safeguarding_policy','minimum_age','guardian_consent','code_of_conduct','conduct_violation','safety_review','user_block') AND "Status" IN ('active','withdrawn','expired') AND ("EffectiveUntil" IS NULL OR "EffectiveUntil" > "EffectiveFrom"));
                ALTER TABLE event_participation_denial_history ADD CONSTRAINT chk_event_denial_history CHECK ("DecisionVersion" > 0 AND "Decision" IN ('deny','remove') AND "ReasonCode" IN ('safeguarding_policy','minimum_age','guardian_consent','code_of_conduct','conduct_violation','safety_review','user_block') AND "Status" IN ('active','withdrawn','expired') AND "Action" IN ('recorded','withdrawn','expired'));

                CREATE FUNCTION event_safety_immutable() RETURNS trigger AS $guard$ BEGIN RAISE EXCEPTION 'event_safety_evidence_immutable'; END; $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_safety_version_no_update BEFORE UPDATE ON event_safety_requirement_versions FOR EACH ROW EXECUTE FUNCTION event_safety_immutable();
                CREATE TRIGGER trg_event_safety_history_no_update BEFORE UPDATE ON event_safety_requirement_history FOR EACH ROW EXECUTE FUNCTION event_safety_immutable();
                CREATE TRIGGER trg_event_safety_ack_no_update BEFORE UPDATE ON event_safety_code_acknowledgements FOR EACH ROW EXECUTE FUNCTION event_safety_immutable();
                CREATE TRIGGER trg_event_guardian_history_no_update BEFORE UPDATE ON event_guardian_consent_history FOR EACH ROW EXECUTE FUNCTION event_safety_immutable();
                CREATE TRIGGER trg_event_denial_history_no_update BEFORE UPDATE ON event_participation_denial_history FOR EACH ROW EXECUTE FUNCTION event_safety_immutable();
                CREATE FUNCTION event_safety_no_delete() RETURNS trigger AS $guard$ BEGIN RAISE EXCEPTION 'event_safety_delete_forbidden'; END; $guard$ LANGUAGE plpgsql;
                CREATE TRIGGER trg_event_safety_requirements_no_delete BEFORE DELETE ON event_safety_requirements FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_safety_version_no_delete BEFORE DELETE ON event_safety_requirement_versions FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_safety_history_no_delete BEFORE DELETE ON event_safety_requirement_history FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_safety_ack_no_delete BEFORE DELETE ON event_safety_code_acknowledgements FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_guardian_consent_no_delete BEFORE DELETE ON event_guardian_consents FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_guardian_history_no_delete BEFORE DELETE ON event_guardian_consent_history FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_denial_no_delete BEFORE DELETE ON event_participation_denials FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                CREATE TRIGGER trg_event_denial_history_no_delete BEFORE DELETE ON event_participation_denial_history FOR EACH ROW EXECUTE FUNCTION event_safety_no_delete();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS event_safety_immutable() CASCADE; DROP FUNCTION IF EXISTS event_safety_no_delete() CASCADE;");
            migrationBuilder.DropTable(
                name: "event_guardian_consent_history");

            migrationBuilder.DropTable(
                name: "event_guardian_consents");

            migrationBuilder.DropTable(
                name: "event_participation_denial_history");

            migrationBuilder.DropTable(
                name: "event_participation_denials");

            migrationBuilder.DropTable(
                name: "event_safety_code_acknowledgements");

            migrationBuilder.DropTable(
                name: "event_safety_requirement_history");

            migrationBuilder.DropTable(
                name: "event_safety_requirement_versions");

            migrationBuilder.DropTable(
                name: "event_safety_requirements");
        }
    }
}
