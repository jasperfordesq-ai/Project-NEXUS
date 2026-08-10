using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(Nexus.Api.Data.NexusDbContext))]
    [Migration("20260303120000_AddAiMessageTenantId")]
    public partial class AddAiMessageTenantId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add TenantId column (nullable initially so we can backfill)
            migrationBuilder.AddColumn<int>(
                name: "TenantId",
                table: "ai_messages",
                type: "integer",
                nullable: true);

            // Backfill TenantId from parent AiConversation
            migrationBuilder.Sql(@"
                UPDATE ai_messages m
                SET ""TenantId"" = c.""TenantId""
                FROM ai_conversations c
                WHERE m.""ConversationId"" = c.""Id""
            ");

            // Make TenantId non-nullable after backfill
            migrationBuilder.AlterColumn<int>(
                name: "TenantId",
                table: "ai_messages",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            // Add index on TenantId
            migrationBuilder.CreateIndex(
                name: "IX_ai_messages_TenantId",
                table: "ai_messages",
                column: "TenantId");

            // Add foreign key to tenants
            migrationBuilder.AddForeignKey(
                name: "FK_ai_messages_tenants_TenantId",
                table: "ai_messages",
                column: "TenantId",
                principalTable: "tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ai_messages_tenants_TenantId",
                table: "ai_messages");

            migrationBuilder.DropIndex(
                name: "IX_ai_messages_TenantId",
                table: "ai_messages");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "ai_messages");
        }
    }
}
