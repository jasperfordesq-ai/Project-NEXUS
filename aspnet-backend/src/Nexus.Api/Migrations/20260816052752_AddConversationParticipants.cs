using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddConversationParticipants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_conversations_TenantId_Participant1Id_Participant2Id",
                table: "conversations");

            migrationBuilder.AddColumn<int>(
                name: "CreatedBy",
                table: "conversations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GroupAvatarUrl",
                table: "conversations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GroupName",
                table: "conversations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsGroup",
                table: "conversations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "conversation_participants",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ConversationId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeftAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MutedUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_conversation_participants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_conversation_participants_conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_conversation_participants_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_participants_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_conversations_TenantId_Participant1Id_Participant2Id",
                table: "conversations",
                columns: new[] { "TenantId", "Participant1Id", "Participant2Id" },
                unique: true,
                filter: "\"IsGroup\" = false");

            migrationBuilder.CreateIndex(
                name: "IX_conversation_participants_ConversationId_UserId",
                table: "conversation_participants",
                columns: new[] { "ConversationId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_participants_TenantId",
                table: "conversation_participants",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_conversation_participants_TenantId_ConversationId_UserId",
                table: "conversation_participants",
                columns: new[] { "TenantId", "ConversationId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_conversation_participants_UserId",
                table: "conversation_participants",
                column: "UserId");

            // 🔴 Backfill: every existing one-to-one thread becomes two
            // participant rows, so nothing has to special-case "old
            // conversations have no participants". Idempotent via the unique
            // participant key, so a re-run cannot duplicate membership.
            //
            // Participant1Id/Participant2Id are deliberately KEPT: the
            // conversation list, unread counts, attachments and the voice-send
            // path still read them. Writes go to both; reads move to
            // participants first; the columns come out once nothing reads them.
            migrationBuilder.Sql("""
                INSERT INTO conversation_participants ("TenantId", "ConversationId", "UserId", "Role", "JoinedAt")
                SELECT c."TenantId", c."Id", c."Participant1Id", 'member', COALESCE(c."CreatedAt", NOW())
                FROM conversations c
                ON CONFLICT ("TenantId", "ConversationId", "UserId") DO NOTHING;

                INSERT INTO conversation_participants ("TenantId", "ConversationId", "UserId", "Role", "JoinedAt")
                SELECT c."TenantId", c."Id", c."Participant2Id", 'member', COALESCE(c."CreatedAt", NOW())
                FROM conversations c
                WHERE c."Participant2Id" <> c."Participant1Id"
                ON CONFLICT ("TenantId", "ConversationId", "UserId") DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "conversation_participants");

            migrationBuilder.DropIndex(
                name: "IX_conversations_TenantId_Participant1Id_Participant2Id",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "CreatedBy",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "GroupAvatarUrl",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "GroupName",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "IsGroup",
                table: "conversations");

            migrationBuilder.CreateIndex(
                name: "IX_conversations_TenantId_Participant1Id_Participant2Id",
                table: "conversations",
                columns: new[] { "TenantId", "Participant1Id", "Participant2Id" },
                unique: true);
        }
    }
}
