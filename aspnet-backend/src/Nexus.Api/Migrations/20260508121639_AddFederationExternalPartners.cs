// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFederationExternalPartners : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "federation_external_partners",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    BaseUrl = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ApiPath = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ApiKey = table.Column<string>(type: "text", nullable: true),
                    AuthMethod = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ProtocolType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    SigningSecret = table.Column<string>(type: "text", nullable: true),
                    OAuthClientId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    OAuthClientSecret = table.Column<string>(type: "text", nullable: true),
                    OAuthTokenUrl = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    AllowMemberSearch = table.Column<bool>(type: "boolean", nullable: false),
                    AllowListingSearch = table.Column<bool>(type: "boolean", nullable: false),
                    AllowMessaging = table.Column<bool>(type: "boolean", nullable: false),
                    AllowTransactions = table.Column<bool>(type: "boolean", nullable: false),
                    AllowEvents = table.Column<bool>(type: "boolean", nullable: false),
                    AllowGroups = table.Column<bool>(type: "boolean", nullable: false),
                    AllowConnections = table.Column<bool>(type: "boolean", nullable: false),
                    AllowVolunteering = table.Column<bool>(type: "boolean", nullable: false),
                    AllowMemberSync = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    VerifiedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    ErrorCount = table.Column<int>(type: "integer", nullable: false),
                    PartnerName = table.Column<string>(type: "text", nullable: true),
                    PartnerVersion = table.Column<string>(type: "text", nullable: true),
                    PartnerMemberCount = table.Column<int>(type: "integer", nullable: true),
                    PartnerMetadata = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedBy = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_external_partners", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_external_partners_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "federation_system_control",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FederationEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    EmergencyLockdown = table.Column<bool>(type: "boolean", nullable: false),
                    RequireTenantWhitelist = table.Column<bool>(type: "boolean", nullable: false),
                    AutoApprovePartnerships = table.Column<bool>(type: "boolean", nullable: false),
                    MaxPartnersPerTenant = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_system_control", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "federation_tenant_features",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Feature = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    Configuration = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_tenant_features", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_tenant_features_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "federation_tenant_whitelist",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    ApprovedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_tenant_whitelist", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_tenant_whitelist_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "federation_webhook_nonces",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlatformId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Nonce = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_webhook_nonces", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "federation_external_partner_logs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PartnerId = table.Column<int>(type: "integer", nullable: false),
                    Endpoint = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Method = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    RequestBody = table.Column<string>(type: "text", nullable: true),
                    ResponseCode = table.Column<int>(type: "integer", nullable: true),
                    ResponseBody = table.Column<string>(type: "text", nullable: true),
                    ResponseTimeMs = table.Column<int>(type: "integer", nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    ErrorMessage = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_federation_external_partner_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_federation_external_partner_logs_federation_external_partne~",
                        column: x => x.PartnerId,
                        principalTable: "federation_external_partners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_federation_external_partner_logs_CreatedAt",
                table: "federation_external_partner_logs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_federation_external_partner_logs_PartnerId",
                table: "federation_external_partner_logs",
                column: "PartnerId");

            migrationBuilder.CreateIndex(
                name: "IX_federation_external_partners_TenantId_BaseUrl",
                table: "federation_external_partners",
                columns: new[] { "TenantId", "BaseUrl" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_federation_external_partners_TenantId_Status",
                table: "federation_external_partners",
                columns: new[] { "TenantId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_federation_tenant_features_TenantId_Feature",
                table: "federation_tenant_features",
                columns: new[] { "TenantId", "Feature" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_federation_tenant_whitelist_TenantId",
                table: "federation_tenant_whitelist",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_federation_webhook_nonces_ExpiresAt",
                table: "federation_webhook_nonces",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_federation_webhook_nonces_PlatformId_Nonce",
                table: "federation_webhook_nonces",
                columns: new[] { "PlatformId", "Nonce" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "federation_external_partner_logs");

            migrationBuilder.DropTable(
                name: "federation_system_control");

            migrationBuilder.DropTable(
                name: "federation_tenant_features");

            migrationBuilder.DropTable(
                name: "federation_tenant_whitelist");

            migrationBuilder.DropTable(
                name: "federation_webhook_nonces");

            migrationBuilder.DropTable(
                name: "federation_external_partners");
        }
    }
}
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
