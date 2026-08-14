using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSupportPendingActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "support_pending_actions",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    relationship_id = table.Column<int>(type: "integer", nullable: false),
                    supported_user_id = table.Column<int>(type: "integer", nullable: false),
                    supporter_user_id = table.Column<int>(type: "integer", nullable: false),
                    action_type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    payload = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    token_consumed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    confirmed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    declined_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    cancelled_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    confirmed_via = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    attested_by_user_id = table.Column<int>(type: "integer", nullable: true),
                    attested_channel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    attested_witness = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    decline_reason = table.Column<string>(type: "text", nullable: true),
                    response_ip = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    response_user_agent = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    result_id = table.Column<int>(type: "integer", nullable: true),
                    pending_message_relationship_id = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_support_pending_actions", x => x.id);
                    table.CheckConstraint("CK_SupportPendingActions_Status", "\"status\" IN ('pending', 'confirmed', 'declined', 'expired', 'cancelled')");
                    table.ForeignKey(
                        name: "FK_support_pending_actions_account_relationships_relationship_~",
                        column: x => x.relationship_id,
                        principalTable: "account_relationships",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_support_pending_actions_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_support_pending_actions_users_supported_user_id",
                        column: x => x.supported_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_support_pending_actions_users_supporter_user_id",
                        column: x => x.supporter_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_pending_message_relationship_id",
                table: "support_pending_actions",
                column: "pending_message_relationship_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_relationship_id",
                table: "support_pending_actions",
                column: "relationship_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_status_expires_at",
                table: "support_pending_actions",
                columns: new[] { "status", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_supported_user_id",
                table: "support_pending_actions",
                column: "supported_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_supporter_user_id",
                table: "support_pending_actions",
                column: "supporter_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_tenant_id_supported_user_id_status",
                table: "support_pending_actions",
                columns: new[] { "tenant_id", "supported_user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_tenant_id_supporter_user_id_status",
                table: "support_pending_actions",
                columns: new[] { "tenant_id", "supporter_user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_support_pending_actions_token_hash",
                table: "support_pending_actions",
                column: "token_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "support_pending_actions");
        }
    }
}
