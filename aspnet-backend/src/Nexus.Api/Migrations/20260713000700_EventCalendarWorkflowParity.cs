using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventCalendarWorkflowParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "event_calendar_feed_tokens",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    TokenPrefix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Label = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Locale = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_event_calendar_feed_tokens", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_event_calendar_feed_token_owner",
                table: "event_calendar_feed_tokens",
                columns: new[] { "TenantId", "UserId", "RevokedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "uq_event_calendar_feed_token_hash",
                table: "event_calendar_feed_tokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.Sql("""
                ALTER TABLE event_calendar_feed_tokens
                  ADD CONSTRAINT chk_event_calendar_token_hash CHECK ("TokenHash" ~ '^[a-f0-9]{64}$'),
                  ADD CONSTRAINT chk_event_calendar_token_prefix CHECK ("TokenPrefix" ~ '^nxc_[a-f0-9]{8}$'),
                  ADD CONSTRAINT chk_event_calendar_token_locale CHECK ("Locale" ~ '^[a-z]{2}(-[a-z0-9]{2,8})?$'),
                  ADD CONSTRAINT chk_event_calendar_token_usage_time CHECK ("LastUsedAt" IS NULL OR "LastUsedAt" >= "CreatedAt"),
                  ADD CONSTRAINT chk_event_calendar_token_revoke_time CHECK ("RevokedAt" IS NULL OR "RevokedAt" >= "CreatedAt");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "event_calendar_feed_tokens");
        }
    }
}
