using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPasskeysAndRegistrationPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RegistrationStatus",
                table: "users",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "Active");

            migrationBuilder.CreateTable(
                name: "federated_exchanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PartnerTenantId = table.Column<int>(type: "integer", nullable: false),
                    LocalUserId = table.Column<int>(type: "integer", nullable: false),
                    RemoteUserDisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    RemoteUserId = table.Column<int>(type: "integer", nullable: true),
                    SourceListingId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    AgreedHours = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    ActualHours = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    CreditExchangeRate = table.Column<decimal>(type: "numeric(10,4)", precision: 10, scale: 4, nullable: false),
                    LocalTransactionId = table.Column<int>(type: "integer", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federated_exchanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federated_exchanges_tenants_PartnerTenantId",
                        column: x => x.PartnerTenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federated_exchanges_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federated_exchanges_transactions_LocalTransactionId",
                        column: x => x.LocalTransactionId,
                        principalTable: "transactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_federated_exchanges_users_LocalUserId",
                        column: x => x.LocalUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "federated_listings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    SourceTenantId = table.Column<int>(type: "integer", nullable: false),
                    SourceListingId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    ListingType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OwnerDisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federated_listings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federated_listings_tenants_SourceTenantId",
                        column: x => x.SourceTenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federated_listings_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "federation_audit_logs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PartnerTenantId = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    EntityId = table.Column<int>(type: "integer", nullable: true),
                    Details = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_audit_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_audit_logs_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "federation_partners",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PartnerTenantId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SharedListings = table.Column<bool>(type: "boolean", nullable: false),
                    SharedEvents = table.Column<bool>(type: "boolean", nullable: false),
                    SharedMembers = table.Column<bool>(type: "boolean", nullable: false),
                    CreditExchangeRate = table.Column<decimal>(type: "numeric(10,4)", precision: 10, scale: 4, nullable: false),
                    RequestedById = table.Column<int>(type: "integer", nullable: false),
                    ApprovedById = table.Column<int>(type: "integer", nullable: true),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_partners", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_partners_tenants_PartnerTenantId",
                        column: x => x.PartnerTenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federation_partners_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_federation_partners_users_ApprovedById",
                        column: x => x.ApprovedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_federation_partners_users_RequestedById",
                        column: x => x.RequestedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "identity_verification_sessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Provider = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Level = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ExternalSessionId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RedirectUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ProviderDecision = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DecisionReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ConfidenceScore = table.Column<double>(type: "double precision", nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_identity_verification_sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_identity_verification_sessions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_identity_verification_sessions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "platform_announcements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedById = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_announcements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_platform_announcements_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_platform_announcements_users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "scheduled_tasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    TaskName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LastRunAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextRunAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CronExpression = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Parameters = table.Column<string>(type: "text", nullable: true),
                    ErrorMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RunCount = table.Column<int>(type: "integer", nullable: false),
                    AverageDurationMs = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scheduled_tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_scheduled_tasks_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "staffing_predictions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    OpportunityId = table.Column<int>(type: "integer", nullable: true),
                    PredictedDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PredictedVolunteersNeeded = table.Column<int>(type: "integer", nullable: false),
                    PredictedVolunteersAvailable = table.Column<int>(type: "integer", nullable: false),
                    ShortfallRisk = table.Column<decimal>(type: "numeric(3,2)", precision: 5, scale: 4, nullable: false),
                    Factors = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_staffing_predictions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_staffing_predictions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_staffing_predictions_volunteer_opportunities_OpportunityId",
                        column: x => x.OpportunityId,
                        principalTable: "volunteer_opportunities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "system_settings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    IsSecret = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedById = table.Column<int>(type: "integer", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_system_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tenant_registration_policies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Mode = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Provider = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    VerificationLevel = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    PostVerificationAction = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ProviderConfigEncrypted = table.Column<string>(type: "text", nullable: true),
                    CustomWebhookUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CustomProviderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    RegistrationMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    InviteCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    MaxInviteUses = table.Column<int>(type: "integer", nullable: true),
                    InviteUsesCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenant_registration_policies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tenant_registration_policies_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "user_passkeys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CredentialId = table.Column<byte[]>(type: "bytea", nullable: false),
                    PublicKey = table.Column<byte[]>(type: "bytea", nullable: false),
                    UserHandle = table.Column<byte[]>(type: "bytea", nullable: false),
                    SignCount = table.Column<long>(type: "bigint", nullable: false),
                    CredType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AaGuid = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Transports = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    IsDiscoverable = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_passkeys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_passkeys_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_user_passkeys_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "volunteer_availabilities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    DayOfWeek = table.Column<int>(type: "integer", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    IsRecurring = table.Column<bool>(type: "boolean", nullable: false),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EffectiveUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_volunteer_availabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_volunteer_availabilities_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_volunteer_availabilities_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "identity_verification_events",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<int>(type: "integer", nullable: false),
                    EventType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PreviousStatus = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    NewStatus = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    Metadata = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    IpAddress = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_identity_verification_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_identity_verification_events_identity_verification_sessions~",
                        column: x => x.SessionId,
                        principalTable: "identity_verification_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_LocalTransactionId",
                table: "federated_exchanges",
                column: "LocalTransactionId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_LocalUserId",
                table: "federated_exchanges",
                column: "LocalUserId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_PartnerTenantId",
                table: "federated_exchanges",
                column: "PartnerTenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_exchanges_TenantId",
                table: "federated_exchanges",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_listings_SourceTenantId",
                table: "federated_listings",
                column: "SourceTenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federated_listings_TenantId",
                table: "federated_listings",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federation_audit_logs_CreatedAt",
                table: "federation_audit_logs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_federation_audit_logs_TenantId",
                table: "federation_audit_logs",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federation_partners_ApprovedById",
                table: "federation_partners",
                column: "ApprovedById");

            migrationBuilder.CreateIndex(
                name: "IX_federation_partners_PartnerTenantId",
                table: "federation_partners",
                column: "PartnerTenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federation_partners_RequestedById",
                table: "federation_partners",
                column: "RequestedById");

            migrationBuilder.CreateIndex(
                name: "IX_federation_partners_TenantId",
                table: "federation_partners",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_federation_partners_TenantId_PartnerTenantId",
                table: "federation_partners",
                columns: new[] { "TenantId", "PartnerTenantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_identity_verification_events_SessionId",
                table: "identity_verification_events",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_identity_verification_sessions_ExternalSessionId",
                table: "identity_verification_sessions",
                column: "ExternalSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_identity_verification_sessions_TenantId_UserId",
                table: "identity_verification_sessions",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_identity_verification_sessions_UserId",
                table: "identity_verification_sessions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_platform_announcements_CreatedById",
                table: "platform_announcements",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_platform_announcements_IsActive",
                table: "platform_announcements",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_platform_announcements_TenantId",
                table: "platform_announcements",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_scheduled_tasks_TaskName",
                table: "scheduled_tasks",
                column: "TaskName");

            migrationBuilder.CreateIndex(
                name: "IX_scheduled_tasks_TenantId",
                table: "scheduled_tasks",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_staffing_predictions_OpportunityId",
                table: "staffing_predictions",
                column: "OpportunityId");

            migrationBuilder.CreateIndex(
                name: "IX_staffing_predictions_PredictedDate",
                table: "staffing_predictions",
                column: "PredictedDate");

            migrationBuilder.CreateIndex(
                name: "IX_staffing_predictions_TenantId",
                table: "staffing_predictions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_system_settings_Key",
                table: "system_settings",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenant_registration_policies_TenantId_IsActive",
                table: "tenant_registration_policies",
                columns: new[] { "TenantId", "IsActive" },
                unique: true,
                filter: "\"IsActive\" = true");

            migrationBuilder.CreateIndex(
                name: "IX_user_passkeys_CredentialId",
                table: "user_passkeys",
                column: "CredentialId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_passkeys_TenantId_UserId",
                table: "user_passkeys",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_user_passkeys_UserHandle",
                table: "user_passkeys",
                column: "UserHandle");

            migrationBuilder.CreateIndex(
                name: "IX_user_passkeys_UserId",
                table: "user_passkeys",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_availabilities_TenantId",
                table: "volunteer_availabilities",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_availabilities_TenantId_UserId_DayOfWeek",
                table: "volunteer_availabilities",
                columns: new[] { "TenantId", "UserId", "DayOfWeek" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_availabilities_UserId",
                table: "volunteer_availabilities",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "federated_exchanges");

            migrationBuilder.DropTable(
                name: "federated_listings");

            migrationBuilder.DropTable(
                name: "federation_audit_logs");

            migrationBuilder.DropTable(
                name: "federation_partners");

            migrationBuilder.DropTable(
                name: "identity_verification_events");

            migrationBuilder.DropTable(
                name: "platform_announcements");

            migrationBuilder.DropTable(
                name: "scheduled_tasks");

            migrationBuilder.DropTable(
                name: "staffing_predictions");

            migrationBuilder.DropTable(
                name: "system_settings");

            migrationBuilder.DropTable(
                name: "tenant_registration_policies");

            migrationBuilder.DropTable(
                name: "user_passkeys");

            migrationBuilder.DropTable(
                name: "volunteer_availabilities");

            migrationBuilder.DropTable(
                name: "identity_verification_sessions");

            migrationBuilder.DropColumn(
                name: "RegistrationStatus",
                table: "users");
        }
    }
}
