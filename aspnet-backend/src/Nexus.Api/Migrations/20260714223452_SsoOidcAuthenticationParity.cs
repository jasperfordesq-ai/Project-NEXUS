using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class SsoOidcAuthenticationParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AuthenticationInvalidatedAt",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "oauth_callback_grants",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CodeHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsNew = table.Column<bool>(type: "boolean", nullable: false),
                    BrowserChallenge = table.Column<string>(type: "character varying(43)", maxLength: 43, nullable: false),
                    AuthenticationStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PendingIdentityCiphertext = table.Column<string>(type: "text", nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oauth_callback_grants", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "oauth_identities",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ProviderUserId = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    ProviderEmail = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    AvatarUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RawPayload = table.Column<string>(type: "jsonb", nullable: true),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oauth_identities", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "sso_oidc_flows",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ProviderKey = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StateNonceHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CodeVerifierCiphertext = table.Column<string>(type: "text", nullable: false),
                    OidcNonce = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    BrowserChallenge = table.Column<string>(type: "character varying(43)", maxLength: 43, nullable: false),
                    RedirectUri = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    AuthenticationStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConsumedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sso_oidc_flows", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_oauth_callback_grants_CodeHash",
                table: "oauth_callback_grants",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_oauth_callback_grants_TenantId_UserId_ExpiresAt",
                table: "oauth_callback_grants",
                columns: new[] { "TenantId", "UserId", "ExpiresAt" });

            migrationBuilder.CreateIndex(
                name: "IX_oauth_identities_ProviderUserId",
                table: "oauth_identities",
                column: "ProviderUserId");

            migrationBuilder.CreateIndex(
                name: "IX_oauth_identities_TenantId",
                table: "oauth_identities",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "oauth_identities_provider_uid_unique",
                table: "oauth_identities",
                columns: new[] { "Provider", "ProviderUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "oauth_identities_user_provider_unique",
                table: "oauth_identities",
                columns: new[] { "UserId", "Provider" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sso_oidc_flows_StateNonceHash",
                table: "sso_oidc_flows",
                column: "StateNonceHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sso_oidc_flows_TenantId_ProviderKey_ExpiresAt",
                table: "sso_oidc_flows",
                columns: new[] { "TenantId", "ProviderKey", "ExpiresAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "oauth_callback_grants");

            migrationBuilder.DropTable(
                name: "oauth_identities");

            migrationBuilder.DropTable(
                name: "sso_oidc_flows");

            migrationBuilder.DropColumn(
                name: "AuthenticationInvalidatedAt",
                table: "users");
        }
    }
}
