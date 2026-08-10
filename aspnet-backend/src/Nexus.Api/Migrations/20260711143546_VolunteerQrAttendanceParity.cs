using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class VolunteerQrAttendanceParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // These scalar relationships pre-date tenant-composite foreign keys.
            // Abort before any DDL when legacy rows cannot be upgraded without
            // guessing, deleting, or merging attendance evidence.
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_check_ins
                        GROUP BY "TenantId", "ShiftId", "UserId"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: duplicate tenant/shift/user attendance rows exist';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_opportunities AS opportunity
                        LEFT JOIN users AS organizer
                          ON organizer."Id" = opportunity."OrganizerId"
                        WHERE organizer."Id" IS NULL
                           OR organizer."TenantId" <> opportunity."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: opportunity organizer tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_shifts AS shift
                        LEFT JOIN volunteer_opportunities AS opportunity
                          ON opportunity."Id" = shift."OpportunityId"
                        WHERE opportunity."Id" IS NULL
                           OR opportunity."TenantId" <> shift."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: shift opportunity tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_applications AS application
                        LEFT JOIN volunteer_opportunities AS opportunity
                          ON opportunity."Id" = application."OpportunityId"
                        WHERE opportunity."Id" IS NULL
                           OR opportunity."TenantId" <> application."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: application opportunity tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_applications AS application
                        LEFT JOIN volunteer_shifts AS shift
                          ON shift."Id" = application."ShiftId"
                        WHERE application."ShiftId" IS NOT NULL
                          AND (
                              shift."Id" IS NULL
                              OR shift."TenantId" <> application."TenantId"
                              OR shift."OpportunityId" <> application."OpportunityId"
                          )
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: application shift tenant/opportunity mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_applications AS application
                        LEFT JOIN users AS volunteer
                          ON volunteer."Id" = application."UserId"
                        WHERE volunteer."Id" IS NULL
                           OR volunteer."TenantId" <> application."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: application volunteer tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_applications AS application
                        LEFT JOIN users AS reviewer
                          ON reviewer."Id" = application."ReviewedById"
                        WHERE application."ReviewedById" IS NOT NULL
                          AND (
                              reviewer."Id" IS NULL
                              OR reviewer."TenantId" <> application."TenantId"
                          )
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: application reviewer tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_check_ins AS attendance
                        LEFT JOIN volunteer_shifts AS shift
                          ON shift."Id" = attendance."ShiftId"
                        WHERE shift."Id" IS NULL
                           OR shift."TenantId" <> attendance."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: attendance shift tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_check_ins AS attendance
                        LEFT JOIN users AS volunteer
                          ON volunteer."Id" = attendance."UserId"
                        WHERE volunteer."Id" IS NULL
                           OR volunteer."TenantId" <> attendance."TenantId"
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: attendance volunteer tenant mismatch or orphan exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_check_ins AS attendance
                        LEFT JOIN transactions AS transaction_row
                          ON transaction_row."Id" = attendance."TransactionId"
                        WHERE attendance."TransactionId" IS NOT NULL
                          AND (
                              transaction_row."Id" IS NULL
                              OR transaction_row."TenantId" <> attendance."TenantId"
                          )
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration requires manual reconciliation: attendance transaction tenant mismatch or orphan exists';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_users_ReviewedById",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_users_UserId",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_volunteer_opportunities_OpportunityId",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_volunteer_shifts_ShiftId",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_transactions_TransactionId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_users_UserId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_volunteer_shifts_ShiftId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_opportunities_users_OrganizerId",
                table: "volunteer_opportunities");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_shifts_volunteer_opportunities_OpportunityId",
                table: "volunteer_shifts");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_ShiftId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TransactionId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_UserId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_applications_ReviewedById",
                table: "volunteer_applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerOrganisationMembers_Role",
                table: "org_members");

            migrationBuilder.AlterColumn<DateTime>(
                name: "CheckedInAt",
                table: "volunteer_check_ins",
                type: "timestamp with time zone",
                nullable: true,
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone");

            migrationBuilder.AddColumn<int>(
                name: "CheckedInById",
                table: "volunteer_check_ins",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CheckedOutById",
                table: "volunteer_check_ins",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QrToken",
                table: "volunteer_check_ins",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "volunteer_check_ins",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "volunteer_check_ins",
                type: "timestamp with time zone",
                nullable: true);

            // Preserve legacy evidence deterministically. Historical rows do not
            // receive invented QR tokens or coordinator identities.
            migrationBuilder.Sql(
                """
                UPDATE volunteer_check_ins
                SET "Status" = CASE
                        WHEN "CheckedOutAt" IS NOT NULL THEN 'checked_out'
                        WHEN "CheckedInAt" IS NOT NULL THEN 'checked_in'
                        ELSE 'pending'
                    END,
                    "UpdatedAt" = "CreatedAt";

                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM volunteer_check_ins
                        WHERE "Status" IS NULL
                           OR "UpdatedAt" IS NULL
                           OR "Status" NOT IN ('pending', 'checked_in', 'checked_out', 'no_show')
                    ) THEN
                        RAISE EXCEPTION 'Volunteer QR attendance migration failed to produce valid status/update evidence';
                    END IF;
                END $$;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "volunteer_check_ins",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "pending",
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20,
                oldNullable: true);

            migrationBuilder.AlterColumn<DateTime>(
                name: "UpdatedAt",
                table: "volunteer_check_ins",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP",
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone",
                oldNullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_volunteer_shifts_TenantId_Id",
                table: "volunteer_shifts",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_volunteer_shifts_TenantId_OpportunityId_Id",
                table: "volunteer_shifts",
                columns: new[] { "TenantId", "OpportunityId", "Id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_volunteer_opportunities_TenantId_Id",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_opportunities_TenantId_OrganizerId",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "OrganizerId" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_QrToken",
                table: "volunteer_check_ins",
                column: "QrToken",
                unique: true,
                filter: "\"QrToken\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_CheckedInById",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "CheckedInById" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_CheckedOutById",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "CheckedOutById" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_ShiftId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "ShiftId" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_ShiftId_UserId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "ShiftId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_TransactionId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "TransactionId" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId_UserId_Status",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "UserId", "Status" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerCheckIns_Status",
                table: "volunteer_check_ins",
                sql: "\"Status\" IN ('pending', 'checked_in', 'checked_out', 'no_show')");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_applications_TenantId_OpportunityId_ShiftId",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "OpportunityId", "ShiftId" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_applications_TenantId_ReviewedById",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "ReviewedById" });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_applications_TenantId_UserId",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerOrganisationMembers_Role",
                table: "org_members",
                sql: "\"role\" IN ('owner', 'admin', 'manager', 'coordinator', 'member')");

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_users_TenantId_ReviewedById",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "ReviewedById" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_users_TenantId_UserId",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "UserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_volunteer_opportunities_TenantId_Opp~",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "OpportunityId" },
                principalTable: "volunteer_opportunities",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_volunteer_shifts_TenantId_Opportunit~",
                table: "volunteer_applications",
                columns: new[] { "TenantId", "OpportunityId", "ShiftId" },
                principalTable: "volunteer_shifts",
                principalColumns: new[] { "TenantId", "OpportunityId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_transactions_TenantId_TransactionId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "TransactionId" },
                principalTable: "transactions",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_CheckedInById",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "CheckedInById" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_CheckedOutById",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "CheckedOutById" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_UserId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "UserId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_volunteer_shifts_TenantId_ShiftId",
                table: "volunteer_check_ins",
                columns: new[] { "TenantId", "ShiftId" },
                principalTable: "volunteer_shifts",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_opportunities_users_TenantId_OrganizerId",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "OrganizerId" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_shifts_volunteer_opportunities_TenantId_Opportuni~",
                table: "volunteer_shifts",
                columns: new[] { "TenantId", "OpportunityId" },
                principalTable: "volunteer_opportunities",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Volunteer QR attendance parity cannot be downgraded safely because doing so would discard token, status, and coordinator evidence and make pending attendance timestamps non-nullable.");

#if false
            // Retained only as generated schema documentation. The migration is
            // intentionally irreversible for the evidence-preservation reasons
            // above, so none of these destructive rollback operations compile.
            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_users_TenantId_ReviewedById",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_users_TenantId_UserId",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_volunteer_opportunities_TenantId_Opp~",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_applications_volunteer_shifts_TenantId_Opportunit~",
                table: "volunteer_applications");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_transactions_TenantId_TransactionId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_CheckedInById",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_CheckedOutById",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_users_TenantId_UserId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_check_ins_volunteer_shifts_TenantId_ShiftId",
                table: "volunteer_check_ins");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_opportunities_users_TenantId_OrganizerId",
                table: "volunteer_opportunities");

            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_shifts_volunteer_opportunities_TenantId_Opportuni~",
                table: "volunteer_shifts");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_volunteer_shifts_TenantId_Id",
                table: "volunteer_shifts");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_volunteer_shifts_TenantId_OpportunityId_Id",
                table: "volunteer_shifts");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_volunteer_opportunities_TenantId_Id",
                table: "volunteer_opportunities");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_opportunities_TenantId_OrganizerId",
                table: "volunteer_opportunities");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_QrToken",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_CheckedInById",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_CheckedOutById",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_ShiftId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_ShiftId_UserId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_TransactionId",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_check_ins_TenantId_UserId_Status",
                table: "volunteer_check_ins");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerCheckIns_Status",
                table: "volunteer_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_applications_TenantId_OpportunityId_ShiftId",
                table: "volunteer_applications");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_applications_TenantId_ReviewedById",
                table: "volunteer_applications");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_applications_TenantId_UserId",
                table: "volunteer_applications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerOrganisationMembers_Role",
                table: "org_members");

            migrationBuilder.DropColumn(
                name: "CheckedInById",
                table: "volunteer_check_ins");

            migrationBuilder.DropColumn(
                name: "CheckedOutById",
                table: "volunteer_check_ins");

            migrationBuilder.DropColumn(
                name: "QrToken",
                table: "volunteer_check_ins");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "volunteer_check_ins");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "volunteer_check_ins");

            migrationBuilder.AlterColumn<DateTime>(
                name: "CheckedInAt",
                table: "volunteer_check_ins",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified),
                oldClrType: typeof(DateTime),
                oldType: "timestamp with time zone",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_ShiftId",
                table: "volunteer_check_ins",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TenantId",
                table: "volunteer_check_ins",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_TransactionId",
                table: "volunteer_check_ins",
                column: "TransactionId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_check_ins_UserId",
                table: "volunteer_check_ins",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_applications_ReviewedById",
                table: "volunteer_applications",
                column: "ReviewedById");

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerOrganisationMembers_Role",
                table: "org_members",
                sql: "\"role\" IN ('owner', 'admin', 'member')");

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_users_ReviewedById",
                table: "volunteer_applications",
                column: "ReviewedById",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_users_UserId",
                table: "volunteer_applications",
                column: "UserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_volunteer_opportunities_OpportunityId",
                table: "volunteer_applications",
                column: "OpportunityId",
                principalTable: "volunteer_opportunities",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_applications_volunteer_shifts_ShiftId",
                table: "volunteer_applications",
                column: "ShiftId",
                principalTable: "volunteer_shifts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_transactions_TransactionId",
                table: "volunteer_check_ins",
                column: "TransactionId",
                principalTable: "transactions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_users_UserId",
                table: "volunteer_check_ins",
                column: "UserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_check_ins_volunteer_shifts_ShiftId",
                table: "volunteer_check_ins",
                column: "ShiftId",
                principalTable: "volunteer_shifts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_opportunities_users_OrganizerId",
                table: "volunteer_opportunities",
                column: "OrganizerId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_shifts_volunteer_opportunities_OpportunityId",
                table: "volunteer_shifts",
                column: "OpportunityId",
                principalTable: "volunteer_opportunities",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
#endif
        }
    }
}
