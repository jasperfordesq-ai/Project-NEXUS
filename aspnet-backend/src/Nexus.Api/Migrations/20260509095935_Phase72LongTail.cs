using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class Phase72LongTail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "bookmark_collections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsPublic = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookmark_collections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bookmark_collections_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bookmark_collections_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "money_donations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    DonorUserId = table.Column<int>(type: "integer", nullable: true),
                    DonorDisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DonorEmail = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    AmountMinorUnits = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    Message = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    StripeCheckoutSessionId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    StripePaymentIntentId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FailureReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_money_donations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_money_donations_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "peer_endorsements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    EndorserId = table.Column<int>(type: "integer", nullable: false),
                    EndorsedUserId = table.Column<int>(type: "integer", nullable: false),
                    Strength = table.Column<int>(type: "integer", nullable: false),
                    Comment = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Relationship = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsHidden = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_peer_endorsements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_peer_endorsements_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "user_presence",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Platform = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_presence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_presence_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_user_presence_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "bookmarks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ContentId = table.Column<int>(type: "integer", nullable: false),
                    CollectionId = table.Column<int>(type: "integer", nullable: true),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookmarks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bookmarks_bookmark_collections_CollectionId",
                        column: x => x.CollectionId,
                        principalTable: "bookmark_collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_bookmarks_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_bookmarks_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_bookmark_collections_TenantId",
                table: "bookmark_collections",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_bookmark_collections_UserId",
                table: "bookmark_collections",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_bookmarks_CollectionId",
                table: "bookmarks",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "IX_bookmarks_ContentType_ContentId",
                table: "bookmarks",
                columns: new[] { "ContentType", "ContentId" });

            migrationBuilder.CreateIndex(
                name: "IX_bookmarks_TenantId",
                table: "bookmarks",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_bookmarks_TenantId_UserId_ContentType_ContentId",
                table: "bookmarks",
                columns: new[] { "TenantId", "UserId", "ContentType", "ContentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_bookmarks_UserId",
                table: "bookmarks",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_DonorUserId",
                table: "money_donations",
                column: "DonorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_Status",
                table: "money_donations",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_StripeCheckoutSessionId",
                table: "money_donations",
                column: "StripeCheckoutSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_StripePaymentIntentId",
                table: "money_donations",
                column: "StripePaymentIntentId");

            migrationBuilder.CreateIndex(
                name: "IX_money_donations_TenantId",
                table: "money_donations",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_peer_endorsements_EndorsedUserId",
                table: "peer_endorsements",
                column: "EndorsedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_peer_endorsements_EndorserId",
                table: "peer_endorsements",
                column: "EndorserId");

            migrationBuilder.CreateIndex(
                name: "IX_peer_endorsements_IsHidden",
                table: "peer_endorsements",
                column: "IsHidden");

            migrationBuilder.CreateIndex(
                name: "IX_peer_endorsements_TenantId",
                table: "peer_endorsements",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_peer_endorsements_TenantId_EndorserId_EndorsedUserId",
                table: "peer_endorsements",
                columns: new[] { "TenantId", "EndorserId", "EndorsedUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_presence_LastSeenAt",
                table: "user_presence",
                column: "LastSeenAt");

            migrationBuilder.CreateIndex(
                name: "IX_user_presence_TenantId",
                table: "user_presence",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_user_presence_TenantId_UserId",
                table: "user_presence",
                columns: new[] { "TenantId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_presence_UserId",
                table: "user_presence",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "bookmarks");

            migrationBuilder.DropTable(
                name: "money_donations");

            migrationBuilder.DropTable(
                name: "peer_endorsements");

            migrationBuilder.DropTable(
                name: "user_presence");

            migrationBuilder.DropTable(
                name: "bookmark_collections");
        }
    }
}
