using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountRelationships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "account_relationship_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    relationship_id = table.Column<int>(type: "integer", nullable: false),
                    parent_user_id = table.Column<int>(type: "integer", nullable: false),
                    child_user_id = table.Column<int>(type: "integer", nullable: false),
                    action = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    actor_role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    actor_user_id = table.Column<int>(type: "integer", nullable: true),
                    reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    details = table.Column<string>(type: "text", nullable: true),
                    ip_address = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    user_agent = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_relationship_events", x => x.id);
                    table.CheckConstraint("CK_AccountRelationshipEvents_Action", "\"action\" IN ('requested', 'proposed', 'approved', 'declined', 'withdrawn', 'revoked', 'permissions_changed')");
                    table.CheckConstraint("CK_AccountRelationshipEvents_ActorRole", "\"actor_role\" IN ('member', 'staff', 'system')");
                    table.ForeignKey(
                        name: "FK_account_relationship_events_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "account_relationships",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    parent_user_id = table.Column<int>(type: "integer", nullable: false),
                    child_user_id = table.Column<int>(type: "integer", nullable: false),
                    relationship_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "family"),
                    permissions = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "pending"),
                    proposed_by_user_id = table.Column<int>(type: "integer", nullable: true),
                    staff_notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    approved_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    message_access_granted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    declined_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    withdrawn_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    response_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    safeguarding_assignment_id = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_account_relationships", x => x.id);
                    table.CheckConstraint("CK_AccountRelationships_Status", "\"status\" IN ('active', 'pending', 'revoked')");
                    table.ForeignKey(
                        name: "FK_account_relationships_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_account_relationships_users_child_user_id",
                        column: x => x.child_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_account_relationships_users_parent_user_id",
                        column: x => x.parent_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_account_relationship_events_tenant_id_child_user_id_created~",
                table: "account_relationship_events",
                columns: new[] { "tenant_id", "child_user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_account_relationship_events_tenant_id_relationship_id_creat~",
                table: "account_relationship_events",
                columns: new[] { "tenant_id", "relationship_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_account_relationships_child_user_id",
                table: "account_relationships",
                column: "child_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_account_relationships_parent_user_id_child_user_id_tenant_id",
                table: "account_relationships",
                columns: new[] { "parent_user_id", "child_user_id", "tenant_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_account_relationships_tenant_id_child_user_id_message_acces~",
                table: "account_relationships",
                columns: new[] { "tenant_id", "child_user_id", "message_access_granted_at" });

            migrationBuilder.CreateIndex(
                name: "IX_account_relationships_tenant_id_status",
                table: "account_relationships",
                columns: new[] { "tenant_id", "status" });

            // The event trail is append-only: refuse UPDATE at the database
            // level, mirroring Laravel's trg_ar_events_no_update trigger.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION account_relationship_events_no_update()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'account_relationship_events_immutable';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_ar_events_no_update
                BEFORE UPDATE ON account_relationship_events
                FOR EACH ROW EXECUTE FUNCTION account_relationship_events_no_update();
                """);

            // Carry existing sub_accounts rows into the richer model so an
            // upgraded environment keeps its relationships. Booleans map to
            // their tier equivalents; can_view_messages is stored false (the
            // legacy boolean is permanently dead) and no messages tier is
            // granted — message access always requires fresh consent.
            migrationBuilder.Sql("""
                INSERT INTO account_relationships
                    (tenant_id, parent_user_id, child_user_id, relationship_type,
                     permissions, status, approved_at, created_at, updated_at)
                SELECT
                    s."TenantId", s."PrimaryUserId", s."SubUserId",
                    CASE WHEN s."Relationship" IN ('family','guardian','carer','organization')
                         THEN s."Relationship" ELSE 'family' END,
                    jsonb_build_object(
                        'can_view_activity', true,
                        'can_manage_listings', s."CanJoinGroups",
                        'can_transact', s."CanTransact",
                        'can_view_messages', false,
                        'tiers', jsonb_build_object(
                            'activity', 'assist',
                            'listings', CASE WHEN s."CanJoinGroups" THEN 'represent' ELSE 'none' END,
                            'credits', CASE WHEN s."CanTransact" THEN 'represent' ELSE 'none' END,
                            'messages', 'none'))::text,
                    CASE WHEN s."IsActive" THEN 'active' ELSE 'pending' END,
                    CASE WHEN s."IsActive" THEN COALESCE(s."UpdatedAt", s."CreatedAt") END,
                    s."CreatedAt", s."UpdatedAt"
                FROM sub_accounts s
                WHERE EXISTS (SELECT 1 FROM users u WHERE u."Id" = s."PrimaryUserId")
                  AND EXISTS (SELECT 1 FROM users u WHERE u."Id" = s."SubUserId")
                ON CONFLICT (parent_user_id, child_user_id, tenant_id) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_ar_events_no_update ON account_relationship_events;
                DROP FUNCTION IF EXISTS account_relationship_events_no_update();
                """);

            migrationBuilder.DropTable(
                name: "account_relationship_events");

            migrationBuilder.DropTable(
                name: "account_relationships");
        }
    }
}
