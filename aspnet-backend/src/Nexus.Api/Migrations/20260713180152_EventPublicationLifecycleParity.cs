using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventPublicationLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "content_moderation_queue",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ContentId = table.Column<int>(type: "integer", nullable: false),
                    AuthorId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ReviewerId = table.Column<int>(type: "integer", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RejectionReason = table.Column<string>(type: "text", nullable: true),
                    AutoFlagged = table.Column<bool>(type: "boolean", nullable: false),
                    FlagReason = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_content_moderation_queue", x => x.Id);
                    table.CheckConstraint("ck_content_moderation_status", "\"Status\" IN ('pending','approved','rejected','flagged')");
                    table.CheckConstraint("ck_content_moderation_type", "\"ContentType\" IN ('post','listing','event','comment','group')");
                    table.ForeignKey(
                        name: "FK_content_moderation_queue_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_content_moderation_queue_users_AuthorId",
                        column: x => x.AuthorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_content_moderation_queue_users_ReviewerId",
                        column: x => x.ReviewerId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_author",
                table: "content_moderation_queue",
                columns: new[] { "TenantId", "AuthorId" });

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_content",
                table: "content_moderation_queue",
                columns: new[] { "ContentType", "ContentId" });

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_created",
                table: "content_moderation_queue",
                columns: new[] { "TenantId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_reviewer",
                table: "content_moderation_queue",
                column: "ReviewerId");

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_tenant_status",
                table: "content_moderation_queue",
                columns: new[] { "TenantId", "Status" });

            migrationBuilder.CreateIndex(
                name: "idx_content_moderation_tenant_type_status",
                table: "content_moderation_queue",
                columns: new[] { "TenantId", "ContentType", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_content_moderation_queue_AuthorId",
                table: "content_moderation_queue",
                column: "AuthorId");

            migrationBuilder.CreateIndex(
                name: "uq_content_moderation_subject",
                table: "content_moderation_queue",
                columns: new[] { "TenantId", "ContentType", "ContentId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "content_moderation_queue");
        }
    }
}
