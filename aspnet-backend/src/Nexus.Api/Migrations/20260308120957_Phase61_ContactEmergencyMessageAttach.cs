using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class Phase61_ContactEmergencyMessageAttach : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "contact_submissions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Subject = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<int>(type: "integer", nullable: true),
                    IsResolved = table.Column<bool>(type: "boolean", nullable: false),
                    ResolvedNote = table.Column<string>(type: "text", nullable: true),
                    ResolvedById = table.Column<int>(type: "integer", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contact_submissions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_contact_submissions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_contact_submissions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "emergency_alerts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Urgency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ContactInfo = table.Column<string>(type: "text", nullable: true),
                    VolunteerOpportunityId = table.Column<int>(type: "integer", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedById = table.Column<int>(type: "integer", nullable: false),
                    ResolvedById = table.Column<int>(type: "integer", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_emergency_alerts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_emergency_alerts_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_emergency_alerts_users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "message_attachments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    MessageId = table.Column<int>(type: "integer", nullable: false),
                    FileUploadId = table.Column<int>(type: "integer", nullable: false),
                    UploadedById = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_message_attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_message_attachments_file_uploads_FileUploadId",
                        column: x => x.FileUploadId,
                        principalTable: "file_uploads",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_message_attachments_messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_message_attachments_users_UploadedById",
                        column: x => x.UploadedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_contact_submissions_CreatedAt",
                table: "contact_submissions",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_contact_submissions_TenantId",
                table: "contact_submissions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_contact_submissions_UserId",
                table: "contact_submissions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_emergency_alerts_CreatedById",
                table: "emergency_alerts",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_emergency_alerts_TenantId_IsActive",
                table: "emergency_alerts",
                columns: new[] { "TenantId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_message_attachments_FileUploadId",
                table: "message_attachments",
                column: "FileUploadId");

            migrationBuilder.CreateIndex(
                name: "IX_message_attachments_MessageId",
                table: "message_attachments",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_message_attachments_UploadedById",
                table: "message_attachments",
                column: "UploadedById");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "contact_submissions");

            migrationBuilder.DropTable(
                name: "emergency_alerts");

            migrationBuilder.DropTable(
                name: "message_attachments");
        }
    }
}
