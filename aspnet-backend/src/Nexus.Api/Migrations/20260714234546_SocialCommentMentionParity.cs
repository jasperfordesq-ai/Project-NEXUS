using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class SocialCommentMentionParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "username",
                table: "users",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "mentions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    CommentId = table.Column<int>(type: "integer", nullable: true),
                    MentionedUserId = table.Column<int>(type: "integer", nullable: false),
                    MentioningUserId = table.Column<int>(type: "integer", nullable: false),
                    EntityType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "comment"),
                    EntityId = table.Column<int>(type: "integer", nullable: true),
                    SeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_mentions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_mentions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_mentions_threaded_comments_CommentId",
                        column: x => x.CommentId,
                        principalTable: "threaded_comments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_mentions_users_TenantId_MentionedUserId",
                        columns: x => new { x.TenantId, x.MentionedUserId },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_mentions_users_TenantId_MentioningUserId",
                        columns: x => new { x.TenantId, x.MentioningUserId },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_tenant_username",
                table: "users",
                columns: new[] { "TenantId", "username" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_comment",
                table: "mentions",
                column: "CommentId");

            migrationBuilder.CreateIndex(
                name: "idx_mentioned_user",
                table: "mentions",
                column: "MentionedUserId");

            migrationBuilder.CreateIndex(
                name: "idx_tenant",
                table: "mentions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "idx_tenant_entity",
                table: "mentions",
                columns: new[] { "TenantId", "EntityType", "EntityId" });

            migrationBuilder.CreateIndex(
                name: "idx_tenant_mentioned",
                table: "mentions",
                columns: new[] { "TenantId", "MentionedUserId" });

            migrationBuilder.CreateIndex(
                name: "idx_unseen",
                table: "mentions",
                columns: new[] { "MentionedUserId", "SeenAt" });

            migrationBuilder.CreateIndex(
                name: "IX_mentions_MentioningUserId",
                table: "mentions",
                column: "MentioningUserId");

            migrationBuilder.CreateIndex(
                name: "IX_mentions_TenantId_MentioningUserId",
                table: "mentions",
                columns: new[] { "TenantId", "MentioningUserId" });

            migrationBuilder.CreateIndex(
                name: "unique_mention",
                table: "mentions",
                columns: new[] { "CommentId", "MentionedUserId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "mentions");

            migrationBuilder.DropIndex(
                name: "idx_tenant_username",
                table: "users");

            migrationBuilder.DropColumn(
                name: "username",
                table: "users");
        }
    }
}
