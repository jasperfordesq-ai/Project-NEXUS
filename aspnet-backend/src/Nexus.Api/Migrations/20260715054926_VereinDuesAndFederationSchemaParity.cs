using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class VereinDuesAndFederationSchemaParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_events_TenantId_Id",
                table: "events",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "verein_cross_invitations",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    source_organization_id = table.Column<int>(type: "integer", nullable: false),
                    target_organization_id = table.Column<int>(type: "integer", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    inviter_user_id = table.Column<int>(type: "integer", nullable: false),
                    invitee_user_id = table.Column<int>(type: "integer", nullable: false),
                    message = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "sent"),
                    sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    responded_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    expires_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_cross_invitations", x => x.id);
                    table.CheckConstraint("CK_verein_cross_invitations_status", "status IN ('sent', 'accepted', 'declined', 'expired')");
                    table.ForeignKey(
                        name: "FK_verein_cross_invitations_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_cross_invitations_users_tenant_id_invitee_user_id",
                        columns: x => new { x.tenant_id, x.invitee_user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_cross_invitations_users_tenant_id_inviter_user_id",
                        columns: x => new { x.tenant_id, x.inviter_user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_cross_invitations_vol_organizations_tenant_id_source~",
                        columns: x => new { x.tenant_id, x.source_organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_cross_invitations_vol_organizations_tenant_id_target~",
                        columns: x => new { x.tenant_id, x.target_organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "verein_event_shares",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    source_organization_id = table.Column<int>(type: "integer", nullable: false),
                    target_organization_id = table.Column<int>(type: "integer", nullable: false),
                    event_id = table.Column<int>(type: "integer", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    shared_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "active"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_event_shares", x => x.id);
                    table.CheckConstraint("CK_verein_event_shares_status", "status IN ('active', 'withdrawn')");
                    table.ForeignKey(
                        name: "FK_verein_event_shares_events_tenant_id_event_id",
                        columns: x => new { x.tenant_id, x.event_id },
                        principalTable: "events",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_event_shares_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_event_shares_vol_organizations_tenant_id_source_orga~",
                        columns: x => new { x.tenant_id, x.source_organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_event_shares_vol_organizations_tenant_id_target_orga~",
                        columns: x => new { x.tenant_id, x.target_organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "verein_member_dues",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    organization_id = table.Column<int>(type: "integer", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    membership_year = table.Column<int>(type: "integer", nullable: false),
                    amount_cents = table.Column<int>(type: "integer", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "CHF"),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "pending"),
                    due_date = table.Column<DateOnly>(type: "date", nullable: false),
                    paid_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    stripe_payment_intent_id = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: true),
                    reminder_count = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    last_reminder_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reminder_email_failed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    reminder_email_last_error = table.Column<string>(type: "text", nullable: true),
                    generated_email_sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    generated_email_failed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    paid_email_sent_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    paid_email_failed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    waived_by_admin_id = table.Column<int>(type: "integer", nullable: true),
                    waived_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    refunded_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_member_dues", x => x.id);
                    table.UniqueConstraint("AK_verein_member_dues_tenant_id_id", x => new { x.tenant_id, x.id });
                    table.CheckConstraint("CK_verein_member_dues_amount", "amount_cents >= 0");
                    table.CheckConstraint("CK_verein_member_dues_reminders", "reminder_count >= 0");
                    table.CheckConstraint("CK_verein_member_dues_status", "status IN ('pending', 'paid', 'overdue', 'waived', 'refunded')");
                    table.CheckConstraint("CK_verein_member_dues_year", "membership_year BETWEEN 0 AND 65535");
                    table.ForeignKey(
                        name: "FK_verein_member_dues_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_member_dues_users_tenant_id_user_id",
                        columns: x => new { x.tenant_id, x.user_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_member_dues_users_tenant_id_waived_by_admin_id",
                        columns: x => new { x.tenant_id, x.waived_by_admin_id },
                        principalTable: "users",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_member_dues_vol_organizations_tenant_id_organization~",
                        columns: x => new { x.tenant_id, x.organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "verein_membership_fees",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    organization_id = table.Column<int>(type: "integer", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    fee_amount_cents = table.Column<int>(type: "integer", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "CHF"),
                    billing_cycle = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "annual"),
                    grace_period_days = table.Column<int>(type: "integer", nullable: false, defaultValue: 30),
                    late_fee_cents = table.Column<int>(type: "integer", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_membership_fees", x => x.id);
                    table.CheckConstraint("CK_verein_membership_fees_amount", "fee_amount_cents > 0");
                    table.CheckConstraint("CK_verein_membership_fees_billing_cycle", "billing_cycle IN ('annual', 'biennial', 'monthly')");
                    table.CheckConstraint("CK_verein_membership_fees_grace_period", "grace_period_days BETWEEN 0 AND 65535");
                    table.CheckConstraint("CK_verein_membership_fees_late_fee", "late_fee_cents IS NULL OR late_fee_cents >= 0");
                    table.ForeignKey(
                        name: "FK_verein_membership_fees_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_membership_fees_vol_organizations_tenant_id_organiza~",
                        columns: x => new { x.tenant_id, x.organization_id },
                        principalTable: "vol_organizations",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "verein_dues_payments",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    dues_id = table.Column<long>(type: "bigint", nullable: false),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    stripe_payment_intent_id = table.Column<string>(type: "character varying(191)", maxLength: 191, nullable: false),
                    amount_cents = table.Column<int>(type: "integer", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "CHF"),
                    paid_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    payment_method = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    receipt_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verein_dues_payments", x => x.id);
                    table.CheckConstraint("CK_verein_dues_payments_amount", "amount_cents >= 0");
                    table.ForeignKey(
                        name: "FK_verein_dues_payments_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_verein_dues_payments_verein_member_dues_tenant_id_dues_id",
                        columns: x => new { x.tenant_id, x.dues_id },
                        principalTable: "verein_member_dues",
                        principalColumns: new[] { "tenant_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_verein_cross_invitations_tenant_id_invitee_user_id",
                table: "verein_cross_invitations",
                columns: new[] { "tenant_id", "invitee_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_cross_invitations_tenant_id_inviter_user_id",
                table: "verein_cross_invitations",
                columns: new[] { "tenant_id", "inviter_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_cross_invitations_tenant_id_source_organization_id",
                table: "verein_cross_invitations",
                columns: new[] { "tenant_id", "source_organization_id" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_cross_invitations_tenant_id_target_organization_id",
                table: "verein_cross_invitations",
                columns: new[] { "tenant_id", "target_organization_id" });

            migrationBuilder.CreateIndex(
                name: "verein_cross_inv_expiry_idx",
                table: "verein_cross_invitations",
                columns: new[] { "tenant_id", "status", "expires_at" });

            migrationBuilder.CreateIndex(
                name: "verein_cross_inv_invitee_idx",
                table: "verein_cross_invitations",
                columns: new[] { "invitee_user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "verein_cross_inv_target_idx",
                table: "verein_cross_invitations",
                columns: new[] { "target_organization_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_dues_payments_tenant_id_dues_id",
                table: "verein_dues_payments",
                columns: new[] { "tenant_id", "dues_id" });

            migrationBuilder.CreateIndex(
                name: "verein_dues_pmts_dues_idx",
                table: "verein_dues_payments",
                column: "dues_id");

            migrationBuilder.CreateIndex(
                name: "verein_dues_pmts_pi_unique",
                table: "verein_dues_payments",
                column: "stripe_payment_intent_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "verein_dues_pmts_tenant_paid_idx",
                table: "verein_dues_payments",
                columns: new[] { "tenant_id", "paid_at" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_event_shares_tenant_id_target_organization_id",
                table: "verein_event_shares",
                columns: new[] { "tenant_id", "target_organization_id" });

            migrationBuilder.CreateIndex(
                name: "verein_event_shares_event_idx",
                table: "verein_event_shares",
                column: "event_id");

            migrationBuilder.CreateIndex(
                name: "verein_event_shares_source_idx",
                table: "verein_event_shares",
                columns: new[] { "tenant_id", "source_organization_id" });

            migrationBuilder.CreateIndex(
                name: "verein_event_shares_target_idx",
                table: "verein_event_shares",
                columns: new[] { "target_organization_id", "status" });

            migrationBuilder.CreateIndex(
                name: "verein_event_shares_unique_target",
                table: "verein_event_shares",
                columns: new[] { "tenant_id", "event_id", "target_organization_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_verein_member_dues_tenant_id_organization_id",
                table: "verein_member_dues",
                columns: new[] { "tenant_id", "organization_id" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_member_dues_tenant_id_user_id",
                table: "verein_member_dues",
                columns: new[] { "tenant_id", "user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_member_dues_tenant_id_waived_by_admin_id",
                table: "verein_member_dues",
                columns: new[] { "tenant_id", "waived_by_admin_id" });

            migrationBuilder.CreateIndex(
                name: "verein_dues_org_user_year_unique",
                table: "verein_member_dues",
                columns: new[] { "organization_id", "user_id", "membership_year" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "verein_dues_org_year_idx",
                table: "verein_member_dues",
                columns: new[] { "organization_id", "membership_year" });

            migrationBuilder.CreateIndex(
                name: "verein_dues_pi_idx",
                table: "verein_member_dues",
                column: "stripe_payment_intent_id");

            migrationBuilder.CreateIndex(
                name: "verein_dues_tenant_status_idx",
                table: "verein_member_dues",
                columns: new[] { "tenant_id", "status" });

            migrationBuilder.CreateIndex(
                name: "verein_dues_user_status_idx",
                table: "verein_member_dues",
                columns: new[] { "user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_verein_membership_fees_tenant_id_organization_id",
                table: "verein_membership_fees",
                columns: new[] { "tenant_id", "organization_id" });

            migrationBuilder.CreateIndex(
                name: "verein_fees_org_unique",
                table: "verein_membership_fees",
                column: "organization_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "verein_fees_tenant_active_idx",
                table: "verein_membership_fees",
                columns: new[] { "tenant_id", "is_active" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "verein_cross_invitations");

            migrationBuilder.DropTable(
                name: "verein_dues_payments");

            migrationBuilder.DropTable(
                name: "verein_event_shares");

            migrationBuilder.DropTable(
                name: "verein_membership_fees");

            migrationBuilder.DropTable(
                name: "verein_member_dues");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_events_TenantId_Id",
                table: "events");
        }
    }
}
