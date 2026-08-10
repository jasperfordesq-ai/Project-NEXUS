using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class Phase65VolunteerLongTail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChangeNote",
                table: "email_templates",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CreatedByUserId",
                table: "email_templates",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "email_templates",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "volunteer_certificates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    HoursRecognised = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: true),
                    IssuedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IssuedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VerificationCode = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    IsPubliclyVerifiable = table.Column<bool>(type: "boolean", nullable: false),
                    PdfUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    IsRevoked = table.Column<bool>(type: "boolean", nullable: false),
                    RevocationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_volunteer_certificates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_volunteer_certificates_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_volunteer_certificates_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "volunteer_emergency_alerts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    OpportunityId = table.Column<int>(type: "integer", nullable: true),
                    ShiftId = table.Column<int>(type: "integer", nullable: true),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    AcknowledgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_volunteer_emergency_alerts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_volunteer_emergency_alerts_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "volunteer_expenses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ShiftId = table.Column<int>(type: "integer", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(10,2)", precision: 10, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ReceiptUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReviewerNote = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ReviewedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReimbursedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_volunteer_expenses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_volunteer_expenses_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_volunteer_expenses_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "volunteer_wellbeing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    ShiftId = table.Column<int>(type: "integer", nullable: true),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RequiresFollowUp = table.Column<bool>(type: "boolean", nullable: false),
                    IsResolved = table.Column<bool>(type: "boolean", nullable: false),
                    ResolvedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ResolutionNote = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_volunteer_wellbeing", x => x.Id);
                    table.ForeignKey(
                        name: "FK_volunteer_wellbeing_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_volunteer_wellbeing_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_certificates_TenantId",
                table: "volunteer_certificates",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_certificates_UserId",
                table: "volunteer_certificates",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_certificates_VerificationCode",
                table: "volunteer_certificates",
                column: "VerificationCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_emergency_alerts_IsActive",
                table: "volunteer_emergency_alerts",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_emergency_alerts_OpportunityId",
                table: "volunteer_emergency_alerts",
                column: "OpportunityId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_emergency_alerts_ShiftId",
                table: "volunteer_emergency_alerts",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_emergency_alerts_TenantId",
                table: "volunteer_emergency_alerts",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_expenses_ShiftId",
                table: "volunteer_expenses",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_expenses_Status",
                table: "volunteer_expenses",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_expenses_TenantId",
                table: "volunteer_expenses",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_expenses_UserId",
                table: "volunteer_expenses",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_wellbeing_IsResolved",
                table: "volunteer_wellbeing",
                column: "IsResolved");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_wellbeing_RequiresFollowUp",
                table: "volunteer_wellbeing",
                column: "RequiresFollowUp");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_wellbeing_ShiftId",
                table: "volunteer_wellbeing",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_wellbeing_TenantId",
                table: "volunteer_wellbeing",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_wellbeing_UserId",
                table: "volunteer_wellbeing",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "volunteer_certificates");

            migrationBuilder.DropTable(
                name: "volunteer_emergency_alerts");

            migrationBuilder.DropTable(
                name: "volunteer_expenses");

            migrationBuilder.DropTable(
                name: "volunteer_wellbeing");

            migrationBuilder.DropColumn(
                name: "ChangeNote",
                table: "email_templates");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "email_templates");

            migrationBuilder.DropColumn(
                name: "Version",
                table: "email_templates");
        }
    }
}
