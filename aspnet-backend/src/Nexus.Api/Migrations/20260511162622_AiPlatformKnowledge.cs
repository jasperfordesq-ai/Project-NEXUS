using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AiPlatformKnowledge : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Summary",
                table: "ai_conversations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SummaryWatermarkMessageId",
                table: "ai_conversations",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ai_conversation_long_memory",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ConversationId = table.Column<int>(type: "integer", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: false),
                    SummaryWatermarkMessageId = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_conversation_long_memory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_conversation_long_memory_ai_conversations_ConversationId",
                        column: x => x.ConversationId,
                        principalTable: "ai_conversations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ai_conversation_long_memory_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ai_message_feedback",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    AiMessageId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    Comment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ReasonCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_message_feedback", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_message_feedback_ai_messages_AiMessageId",
                        column: x => x.AiMessageId,
                        principalTable: "ai_messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ai_message_feedback_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ai_message_feedback_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ai_request_audit_logs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: true),
                    ConversationId = table.Column<int>(type: "integer", nullable: true),
                    RequestType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Provider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    InputTokens = table.Column<int>(type: "integer", nullable: false),
                    OutputTokens = table.Column<int>(type: "integer", nullable: false),
                    LatencyMs = table.Column<int>(type: "integer", nullable: false),
                    RetrievedChunkCount = table.Column<int>(type: "integer", nullable: false),
                    ToolsInvoked = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    Outcome = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_request_audit_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_request_audit_logs_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "knowledge_chunks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    SourceType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SourceId = table.Column<int>(type: "integer", nullable: false),
                    ChunkIndex = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Embedding = table.Column<float[]>(type: "real[]", nullable: false),
                    EmbeddingProvider = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    EmbeddingModel = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    MetadataJson = table.Column<string>(type: "jsonb", nullable: false, defaultValue: "{}"),
                    SourceUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IndexedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_knowledge_chunks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_knowledge_chunks_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ai_conversation_long_memory_ConversationId",
                table: "ai_conversation_long_memory",
                column: "ConversationId");

            migrationBuilder.CreateIndex(
                name: "IX_ai_conversation_long_memory_TenantId_ConversationId",
                table: "ai_conversation_long_memory",
                columns: new[] { "TenantId", "ConversationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ai_message_feedback_AiMessageId",
                table: "ai_message_feedback",
                column: "AiMessageId");

            migrationBuilder.CreateIndex(
                name: "IX_ai_message_feedback_TenantId_AiMessageId_UserId",
                table: "ai_message_feedback",
                columns: new[] { "TenantId", "AiMessageId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ai_message_feedback_TenantId_CreatedAt",
                table: "ai_message_feedback",
                columns: new[] { "TenantId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ai_message_feedback_UserId",
                table: "ai_message_feedback",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ai_request_audit_logs_TenantId_CreatedAt",
                table: "ai_request_audit_logs",
                columns: new[] { "TenantId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ai_request_audit_logs_TenantId_Outcome",
                table: "ai_request_audit_logs",
                columns: new[] { "TenantId", "Outcome" });

            migrationBuilder.CreateIndex(
                name: "IX_knowledge_chunks_TenantId_SourceType",
                table: "knowledge_chunks",
                columns: new[] { "TenantId", "SourceType" });

            migrationBuilder.CreateIndex(
                name: "IX_knowledge_chunks_TenantId_SourceType_SourceId_ChunkIndex",
                table: "knowledge_chunks",
                columns: new[] { "TenantId", "SourceType", "SourceId", "ChunkIndex" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_conversation_long_memory");

            migrationBuilder.DropTable(
                name: "ai_message_feedback");

            migrationBuilder.DropTable(
                name: "ai_request_audit_logs");

            migrationBuilder.DropTable(
                name: "knowledge_chunks");

            migrationBuilder.DropColumn(
                name: "Summary",
                table: "ai_conversations");

            migrationBuilder.DropColumn(
                name: "SummaryWatermarkMessageId",
                table: "ai_conversations");
        }
    }
}
