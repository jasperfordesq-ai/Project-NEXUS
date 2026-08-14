using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPartnerVenueTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "partner_member_passes",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    last_used_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_partner_member_passes", x => x.id);
                    table.ForeignKey(
                        name: "FK_partner_member_passes_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_partner_member_passes_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "partner_venues",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    slug = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    description = table.Column<string>(type: "text", nullable: true),
                    category = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    offer_summary = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    address_line = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    city = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    postcode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    latitude = table.Column<decimal>(type: "numeric(10,7)", precision: 10, scale: 7, nullable: true),
                    longitude = table.Column<decimal>(type: "numeric(10,7)", precision: 10, scale: 7, nullable: true),
                    website = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    contact_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    logo_url = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    poster_token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_by = table.Column<int>(type: "integer", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_partner_venues", x => x.id);
                    table.ForeignKey(
                        name: "FK_partner_venues_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_partner_venues_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "partner_venue_staff",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    venue_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "member"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "active"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_partner_venue_staff", x => x.id);
                    table.CheckConstraint("CK_PartnerVenueStaff_Role", "\"role\" IN ('owner', 'admin', 'member')");
                    table.CheckConstraint("CK_PartnerVenueStaff_Status", "\"status\" IN ('active', 'pending', 'invited', 'removed')");
                    table.ForeignKey(
                        name: "FK_partner_venue_staff_partner_venues_venue_id",
                        column: x => x.venue_id,
                        principalTable: "partner_venues",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_partner_venue_staff_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_partner_venue_staff_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "partner_venue_visits",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    venue_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    recorded_by_user_id = table.Column<int>(type: "integer", nullable: true),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "member_pass"),
                    visited_on = table.Column<DateOnly>(type: "date", nullable: false),
                    visited_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_partner_venue_visits", x => x.id);
                    table.ForeignKey(
                        name: "FK_partner_venue_visits_partner_venues_venue_id",
                        column: x => x.venue_id,
                        principalTable: "partner_venues",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_partner_venue_visits_tenants_tenant_id",
                        column: x => x.tenant_id,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_partner_venue_visits_users_recorded_by_user_id",
                        column: x => x.recorded_by_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_partner_venue_visits_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_partner_member_passes_tenant_id_user_id",
                table: "partner_member_passes",
                columns: new[] { "tenant_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_member_passes_token",
                table: "partner_member_passes",
                column: "token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_member_passes_user_id",
                table: "partner_member_passes",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_staff_tenant_id_user_id_status",
                table: "partner_venue_staff",
                columns: new[] { "tenant_id", "user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_staff_tenant_id_venue_id_user_id",
                table: "partner_venue_staff",
                columns: new[] { "tenant_id", "venue_id", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_staff_user_id",
                table: "partner_venue_staff",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_staff_venue_id",
                table: "partner_venue_staff",
                column: "venue_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_recorded_by_user_id",
                table: "partner_venue_visits",
                column: "recorded_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_tenant_id_user_id_visited_at",
                table: "partner_venue_visits",
                columns: new[] { "tenant_id", "user_id", "visited_at" });

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_tenant_id_user_id_visited_on",
                table: "partner_venue_visits",
                columns: new[] { "tenant_id", "user_id", "visited_on" });

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_tenant_id_venue_id_user_id_visited_on",
                table: "partner_venue_visits",
                columns: new[] { "tenant_id", "venue_id", "user_id", "visited_on" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_tenant_id_venue_id_visited_at",
                table: "partner_venue_visits",
                columns: new[] { "tenant_id", "venue_id", "visited_at" });

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_user_id",
                table: "partner_venue_visits",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venue_visits_venue_id",
                table: "partner_venue_visits",
                column: "venue_id");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venues_created_by",
                table: "partner_venues",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_partner_venues_poster_token",
                table: "partner_venues",
                column: "poster_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_venues_tenant_id_slug",
                table: "partner_venues",
                columns: new[] { "tenant_id", "slug" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_partner_venues_tenant_id_status",
                table: "partner_venues",
                columns: new[] { "tenant_id", "status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "partner_member_passes");

            migrationBuilder.DropTable(
                name: "partner_venue_staff");

            migrationBuilder.DropTable(
                name: "partner_venue_visits");

            migrationBuilder.DropTable(
                name: "partner_venues");
        }
    }
}
