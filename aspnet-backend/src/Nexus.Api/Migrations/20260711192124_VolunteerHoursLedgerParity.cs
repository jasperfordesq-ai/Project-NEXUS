using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class VolunteerHoursLedgerParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                -- The pre-111 ASP Caring writer could persist an approved
                -- whole-hour log without minting either side of the time-credit
                -- payment. Do not invent money during deployment. Return only
                -- those evidence-free legacy rows to pending so an authorized
                -- reviewer can make the financial transition explicitly.
                UPDATE vol_logs vl
                SET status = 'pending',
                    updated_at = COALESCE(vl.updated_at, NOW())
                WHERE vl.status = 'approved'
                  AND vl.organization_id IS NOT NULL
                  AND FLOOR(vl.hours) >= 1
                  AND NOT EXISTS (
                      SELECT 1 FROM vol_org_transactions payment
                      WHERE payment.tenant_id = vl.tenant_id
                        AND payment.vol_log_id = vl.id
                        AND payment.type = 'volunteer_payment'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM xp_logs xp
                      WHERE xp."TenantId" = vl.tenant_id
                        AND xp."UserId" = vl.user_id
                        AND xp."Source" = 'volunteer_hour'
                        AND xp."ReferenceId" = vl.id
                  );

                -- Laravel records the badge award action as `earn_badge`.
                -- Normalize the older ASP label without changing amounts or
                -- references so historical reward evidence remains intact.
                UPDATE xp_logs
                SET "Source" = 'earn_badge'
                WHERE "Source" = 'badge_earned';

                DO $volunteer_hours_preflight$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM vol_logs
                        WHERE hours IS NULL
                           OR hours < 0
                           OR hours > 24
                           OR (caring_support_relationship_id IS NULL AND hours < 0.25)
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains invalid hours for its workflow';
                    END IF;

                    IF EXISTS (SELECT 1 FROM vol_logs WHERE status IS NULL OR status NOT IN ('pending', 'approved', 'declined', 'rejected')) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an unsupported status';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.user_id IS NULL OR NOT EXISTS (
                            SELECT 1 FROM users u WHERE u."Id" = vl.user_id AND u."TenantId" = vl.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an orphan or cross-tenant user';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.organization_id IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM vol_organizations vo WHERE vo.id = vl.organization_id AND vo.tenant_id = vl.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an orphan or cross-tenant organisation';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.opportunity_id IS NOT NULL AND (
                            vl.organization_id IS NULL OR NOT EXISTS (
                                SELECT 1 FROM volunteer_opportunities opportunity
                                WHERE opportunity."Id" = vl.opportunity_id
                                  AND opportunity."TenantId" = vl.tenant_id
                                  AND opportunity.organization_id = vl.organization_id
                            )
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: a logged opportunity is orphaned, cross-tenant, or belongs to another organisation';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.support_recipient_id IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM users u WHERE u."Id" = vl.support_recipient_id AND u."TenantId" = vl.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an orphan or cross-tenant support recipient';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.assigned_to IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM users u WHERE u."Id" = vl.assigned_to AND u."TenantId" = vl.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an orphan or cross-tenant assigned reviewer';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM caring_support_relationships relationship
                        WHERE NOT EXISTS (
                                SELECT 1 FROM users u
                                WHERE u."Id" = relationship.supporter_id AND u."TenantId" = relationship.tenant_id
                            )
                           OR NOT EXISTS (
                                SELECT 1 FROM users u
                                WHERE u."Id" = relationship.recipient_id AND u."TenantId" = relationship.tenant_id
                            )
                           OR (relationship.coordinator_id IS NOT NULL AND NOT EXISTS (
                                SELECT 1 FROM users u
                                WHERE u."Id" = relationship.coordinator_id AND u."TenantId" = relationship.tenant_id
                            ))
                           OR (relationship.organization_id IS NOT NULL AND NOT EXISTS (
                                SELECT 1 FROM vol_organizations vo
                                WHERE vo.id = relationship.organization_id AND vo.tenant_id = relationship.tenant_id
                            ))
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: a caring relationship contains a cross-tenant or orphan participant';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.caring_support_relationship_id IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM caring_support_relationships relationship
                            WHERE relationship.id = vl.caring_support_relationship_id
                              AND relationship.tenant_id = vl.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_logs contains an orphan or cross-tenant caring relationship';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs
                        WHERE organization_id IS NULL AND caring_support_relationship_id IS NULL
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: an hour log is not attached to an organisation or caring relationship';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM vol_logs vl
                        JOIN caring_support_relationships relationship
                          ON relationship.id = vl.caring_support_relationship_id
                         AND relationship.tenant_id = vl.tenant_id
                        WHERE vl.caring_support_relationship_id IS NOT NULL
                          AND (
                              vl.user_id IS DISTINCT FROM relationship.supporter_id
                              OR vl.support_recipient_id IS DISTINCT FROM relationship.recipient_id
                              OR vl.organization_id IS DISTINCT FROM relationship.organization_id
                          )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: a caring hour log disagrees with its relationship participants or organisation';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_org_transactions transaction_row
                        WHERE transaction_row.vol_log_id IS NOT NULL AND NOT EXISTS (
                            SELECT 1 FROM vol_logs vl
                            WHERE vl.id = transaction_row.vol_log_id AND vl.tenant_id = transaction_row.tenant_id
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: vol_org_transactions contains an orphan or cross-tenant vol_log reference';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM vol_org_transactions transaction_row
                        JOIN vol_logs vl
                          ON vl.id = transaction_row.vol_log_id AND vl.tenant_id = transaction_row.tenant_id
                        WHERE transaction_row.type = 'volunteer_payment'
                          AND (
                              vl.status <> 'approved'
                              OR vl.organization_id IS NULL
                              OR FLOOR(vl.hours) < 1
                              OR transaction_row.user_id IS DISTINCT FROM vl.user_id
                              OR transaction_row.vol_organization_id IS DISTINCT FROM vl.organization_id
                              OR transaction_row.amount IS DISTINCT FROM -FLOOR(vl.hours)
                          )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: volunteer payment evidence disagrees with its approved vol_log';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_org_transactions
                        WHERE type = 'volunteer_payment' AND vol_log_id IS NOT NULL
                        GROUP BY tenant_id, vol_log_id, type
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: duplicate volunteer payment evidence exists';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.status = 'approved'
                          AND vl.organization_id IS NOT NULL
                          AND FLOOR(vl.hours) >= 1
                          AND NOT EXISTS (
                              SELECT 1 FROM vol_org_transactions transaction_row
                              WHERE transaction_row.tenant_id = vl.tenant_id
                                AND transaction_row.vol_log_id = vl.id
                                AND transaction_row.type = 'volunteer_payment'
                          )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: an approved whole-hour organisation log has no payment evidence';
                    END IF;

                    IF EXISTS (
                        SELECT 1
                        FROM vol_org_transactions payment
                        JOIN vol_logs vl ON vl.id = payment.vol_log_id AND vl.tenant_id = payment.tenant_id
                        WHERE payment.type = 'volunteer_payment'
                          AND (
                              SELECT COUNT(*)
                              FROM transactions personal
                              WHERE personal."TenantId" = payment.tenant_id
                                AND personal."ReceiverId" = vl.user_id
                                AND personal."Amount" = -payment.amount
                                AND personal."TransactionType" = 'volunteer'
                                AND personal."Status" IN ('Completed', 'completed')
                                AND personal."Description" IS NOT DISTINCT FROM payment.description
                                AND ABS(EXTRACT(EPOCH FROM (personal."CreatedAt" - payment.created_at))) <= 300
                          ) <> 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: a volunteer payment has no unique matching personal mint';
                    END IF;

                    IF EXISTS (
                        SELECT personal."Id"
                        FROM transactions personal
                        JOIN vol_org_transactions payment
                          ON personal."TenantId" = payment.tenant_id
                         AND personal."ReceiverId" = payment.user_id
                         AND personal."Amount" = -payment.amount
                         AND personal."TransactionType" = 'volunteer'
                         AND personal."Status" IN ('Completed', 'completed')
                         AND personal."Description" IS NOT DISTINCT FROM payment.description
                         AND ABS(EXTRACT(EPOCH FROM (personal."CreatedAt" - payment.created_at))) <= 300
                        WHERE payment.type = 'volunteer_payment' AND payment.vol_log_id IS NOT NULL
                        GROUP BY personal."Id"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: one personal mint ambiguously matches multiple volunteer payments';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM xp_logs xp
                        WHERE xp."Source" = 'volunteer_hour' AND xp."ReferenceId" IS NOT NULL
                          AND NOT EXISTS (
                              SELECT 1 FROM vol_logs vl
                              WHERE vl.id = xp."ReferenceId"
                                AND vl.tenant_id = xp."TenantId"
                                AND vl.user_id = xp."UserId"
                                AND vl.status = 'approved'
                                AND xp."Amount" = ROUND(vl.hours * 20)::integer
                          )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: volunteer-hour XP is orphaned or disagrees with its approved vol_log';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs vl
                        WHERE vl.status = 'approved'
                          AND vl.caring_support_relationship_id IS NULL
                          AND NOT EXISTS (
                            SELECT 1 FROM xp_logs xp
                            WHERE xp."TenantId" = vl.tenant_id
                              AND xp."UserId" = vl.user_id
                              AND xp."Source" = 'volunteer_hour'
                              AND xp."ReferenceId" = vl.id
                              AND xp."Amount" = ROUND(vl.hours * 20)::integer
                        )
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: an approved vol_log has no matching volunteer-hour XP evidence';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs
                        WHERE status NOT IN ('declined', 'rejected') AND opportunity_id IS NOT NULL
                        GROUP BY tenant_id, user_id, organization_id, date_logged, opportunity_id
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: duplicate active opportunity hour logs exist';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs
                        WHERE status NOT IN ('declined', 'rejected')
                          AND opportunity_id IS NULL
                          AND caring_support_relationship_id IS NULL
                          AND organization_id IS NOT NULL
                        GROUP BY tenant_id, user_id, organization_id, date_logged
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: duplicate active organisation hour logs exist';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM vol_logs
                        WHERE status NOT IN ('declined', 'rejected') AND caring_support_relationship_id IS NOT NULL
                        GROUP BY tenant_id, user_id, caring_support_relationship_id, date_logged
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: duplicate active caring relationship hour logs exist';
                    END IF;

                    IF EXISTS (
                        SELECT 1 FROM xp_logs
                        WHERE "Source" = 'volunteer_hour' AND "ReferenceId" IS NOT NULL
                        GROUP BY "TenantId", "Source", "ReferenceId"
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'VolunteerHoursLedgerParity preflight failed: duplicate volunteer-hour XP evidence exists';
                    END IF;
                END
                $volunteer_hours_preflight$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_coordinator_id",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_recipient_id",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_supporter_id",
                table: "caring_support_relationships");

            // Migration 55 supplied a 71-byte name; PostgreSQL persisted its
            // first 63 bytes, while modern EF renders a different '~' suffix.
            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    DROP CONSTRAINT IF EXISTS "FK_vol_logs_caring_support_relationships_caring_support_relatio";
                ALTER TABLE vol_logs
                    DROP CONSTRAINT IF EXISTS "FK_vol_logs_caring_support_relationships_caring_support_relati~";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_users_support_recipient_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_users_user_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_org_transactions_users_tenant_id_user_id",
                table: "vol_org_transactions");

            migrationBuilder.DropIndex(
                name: "IX_caring_support_relationships_coordinator_id",
                table: "caring_support_relationships");

            migrationBuilder.DropIndex(
                name: "IX_caring_support_relationships_recipient_id",
                table: "caring_support_relationships");

            migrationBuilder.DropIndex(
                name: "IX_caring_support_relationships_supporter_id",
                table: "caring_support_relationships");

            migrationBuilder.AddColumn<string>(
                name: "feedback",
                table: "vol_logs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VolunteerLogId",
                table: "transactions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "show_on_leaderboard",
                table: "users",
                type: "boolean",
                nullable: true,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "feed_activity",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation(
                            "Npgsql:ValueGenerationStrategy",
                            Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    tenant_id = table.Column<int>(type: "integer", nullable: false),
                    user_id = table.Column<int>(type: "integer", nullable: false),
                    source_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source_id = table.Column<int>(type: "integer", nullable: false),
                    group_id = table.Column<int>(type: "integer", nullable: true),
                    title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    content = table.Column<string>(type: "text", nullable: true),
                    image_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    metadata = table.Column<string>(type: "jsonb", nullable: true),
                    is_visible = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    is_hidden = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feed_activity", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "uq_tenant_source",
                table: "feed_activity",
                columns: new[] { "tenant_id", "source_type", "source_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "idx_main_feed",
                table: "feed_activity",
                columns: new[] { "tenant_id", "is_visible", "created_at", "id" },
                descending: new[] { false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "idx_user_feed",
                table: "feed_activity",
                columns: new[] { "tenant_id", "user_id", "is_visible", "created_at", "id" },
                descending: new[] { false, false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "idx_group_feed",
                table: "feed_activity",
                columns: new[] { "tenant_id", "group_id", "is_visible", "created_at", "id" },
                descending: new[] { false, false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "idx_type_feed",
                table: "feed_activity",
                columns: new[] { "tenant_id", "source_type", "is_visible", "created_at", "id" },
                descending: new[] { false, false, false, true, true });

            migrationBuilder.CreateIndex(
                name: "idx_source_lookup",
                table: "feed_activity",
                columns: new[] { "source_type", "source_id" });

            migrationBuilder.CreateIndex(
                name: "idx_feed_activity_cursor",
                table: "feed_activity",
                columns: new[] { "tenant_id", "created_at", "id" });

            migrationBuilder.Sql(
                """
                WITH personal_mint_matches AS (
                    SELECT payment.vol_log_id, personal."Id" AS transaction_id
                    FROM vol_org_transactions payment
                    JOIN vol_logs vl
                      ON vl.id = payment.vol_log_id
                     AND vl.tenant_id = payment.tenant_id
                    JOIN transactions personal
                      ON personal."TenantId" = payment.tenant_id
                     AND personal."ReceiverId" = vl.user_id
                     AND personal."Amount" = -payment.amount
                     AND personal."TransactionType" = 'volunteer'
                     AND personal."Status" IN ('Completed', 'completed')
                     AND personal."Description" IS NOT DISTINCT FROM payment.description
                     AND ABS(EXTRACT(EPOCH FROM (personal."CreatedAt" - payment.created_at))) <= 300
                    WHERE payment.type = 'volunteer_payment'
                      AND payment.vol_log_id IS NOT NULL
                )
                UPDATE transactions personal
                SET "VolunteerLogId" = matched.vol_log_id,
                    "SenderId" = NULL
                FROM personal_mint_matches matched
                WHERE personal."Id" = matched.transaction_id;
                """);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_vol_logs_tenant_id_id",
                table: "vol_logs",
                columns: new[] { "tenant_id", "id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_caring_support_relationships_tenant_id_id",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "id" });

            migrationBuilder.CreateIndex(
                name: "ux_xp_logs_volunteer_hour_reference",
                table: "xp_logs",
                columns: new[] { "TenantId", "Source", "ReferenceId" },
                unique: true,
                filter: "\"Source\" = 'volunteer_hour' AND \"ReferenceId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_volunteer_opportunities_tenant_org_id",
                table: "volunteer_opportunities",
                columns: new[] { "TenantId", "organization_id", "Id" },
                unique: true);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_opportunity_organisation_evidence"
                    FOREIGN KEY (tenant_id, organization_id, opportunity_id)
                    REFERENCES volunteer_opportunities ("TenantId", organization_id, "Id")
                    ON DELETE SET NULL (opportunity_id);
                """);

            migrationBuilder.CreateIndex(
                name: "idx_vol_logs_tenant_org_opportunity",
                table: "vol_logs",
                columns: new[] { "tenant_id", "organization_id", "opportunity_id" });

            migrationBuilder.CreateIndex(
                name: "idx_vol_logs_tenant_status_created",
                table: "vol_logs",
                columns: new[] { "tenant_id", "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_assigned_to",
                table: "vol_logs",
                columns: new[] { "tenant_id", "assigned_to" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_caring_support_relationship_id",
                table: "vol_logs",
                columns: new[] { "tenant_id", "caring_support_relationship_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_opportunity_id",
                table: "vol_logs",
                columns: new[] { "tenant_id", "opportunity_id" });

            migrationBuilder.CreateIndex(
                name: "IX_vol_logs_tenant_id_support_recipient_id",
                table: "vol_logs",
                columns: new[] { "tenant_id", "support_recipient_id" });

            migrationBuilder.CreateIndex(
                name: "ux_vol_logs_active_caring_relationship",
                table: "vol_logs",
                columns: new[] { "tenant_id", "user_id", "caring_support_relationship_id", "date_logged" },
                unique: true,
                filter: "\"status\" NOT IN ('declined', 'rejected') AND \"caring_support_relationship_id\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_vol_logs_active_with_opportunity",
                table: "vol_logs",
                columns: new[] { "tenant_id", "user_id", "organization_id", "date_logged", "opportunity_id" },
                unique: true,
                filter: "\"status\" NOT IN ('declined', 'rejected') AND \"opportunity_id\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_vol_logs_active_without_opportunity",
                table: "vol_logs",
                columns: new[] { "tenant_id", "user_id", "organization_id", "date_logged" },
                unique: true,
                filter: "\"status\" NOT IN ('declined', 'rejected') AND \"opportunity_id\" IS NULL AND \"caring_support_relationship_id\" IS NULL AND \"organization_id\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerLogs_Hours",
                table: "vol_logs",
                sql: "\"hours\" >= 0 AND \"hours\" <= 24 AND (\"caring_support_relationship_id\" IS NOT NULL OR \"hours\" >= 0.25)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerLogs_OpportunityOrganisation",
                table: "vol_logs",
                sql: "\"opportunity_id\" IS NULL OR \"organization_id\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerLogs_Status",
                table: "vol_logs",
                sql: "\"status\" IN ('pending', 'approved', 'declined', 'rejected')");

            migrationBuilder.CreateIndex(
                name: "ux_transactions_volunteer_log",
                table: "transactions",
                columns: new[] { "TenantId", "VolunteerLogId" },
                unique: true,
                filter: "\"VolunteerLogId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_tenant_id_coordinator_id",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "coordinator_id" });

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_tenant_id_organization_id",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "organization_id" });

            migrationBuilder.Sql(
                """
                ALTER TABLE caring_support_relationships
                    ADD CONSTRAINT "FK_caring_support_relationships_users_tenant_id_coordinator_id"
                    FOREIGN KEY (tenant_id, coordinator_id)
                    REFERENCES users ("TenantId", "Id")
                    ON DELETE SET NULL (coordinator_id);
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_support_relationships_users_tenant_id_recipient_id",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "recipient_id" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_support_relationships_users_tenant_id_supporter_id",
                table: "caring_support_relationships",
                columns: new[] { "tenant_id", "supporter_id" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql(
                """
                ALTER TABLE caring_support_relationships
                    ADD CONSTRAINT "FK_caring_support_relationships_vol_organizations_tenant_id_or~"
                    FOREIGN KEY (tenant_id, organization_id)
                    REFERENCES vol_organizations (tenant_id, id)
                    ON DELETE SET NULL (organization_id);
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE transactions
                    ADD CONSTRAINT "FK_transactions_vol_logs_TenantId_VolunteerLogId"
                    FOREIGN KEY ("TenantId", "VolunteerLogId")
                    REFERENCES vol_logs (tenant_id, id)
                    ON DELETE SET NULL ("VolunteerLogId");
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_caring_support_relationships_tenant_id_caring_supp~"
                    FOREIGN KEY (tenant_id, caring_support_relationship_id)
                    REFERENCES caring_support_relationships (tenant_id, id)
                    ON DELETE SET NULL (caring_support_relationship_id);
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_users_tenant_id_assigned_to"
                    FOREIGN KEY (tenant_id, assigned_to)
                    REFERENCES users ("TenantId", "Id")
                    ON DELETE SET NULL (assigned_to);
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_users_tenant_id_support_recipient_id"
                    FOREIGN KEY (tenant_id, support_recipient_id)
                    REFERENCES users ("TenantId", "Id")
                    ON DELETE SET NULL (support_recipient_id);
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_vol_logs_users_tenant_id_user_id",
                table: "vol_logs",
                columns: new[] { "tenant_id", "user_id" },
                principalTable: "users",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_vol_organizations_tenant_id_organization_id"
                    FOREIGN KEY (tenant_id, organization_id)
                    REFERENCES vol_organizations (tenant_id, id)
                    ON DELETE SET NULL (organization_id);
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_logs
                    ADD CONSTRAINT "FK_vol_logs_volunteer_opportunities_tenant_id_opportunity_id"
                    FOREIGN KEY (tenant_id, opportunity_id)
                    REFERENCES volunteer_opportunities ("TenantId", "Id")
                    ON DELETE SET NULL (opportunity_id);
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE vol_org_transactions
                    ADD CONSTRAINT "FK_vol_org_transactions_users_tenant_id_user_id"
                    FOREIGN KEY (tenant_id, user_id)
                    REFERENCES users ("TenantId", "Id")
                    ON DELETE SET NULL (user_id);

                ALTER TABLE vol_org_transactions
                    ADD CONSTRAINT "FK_vol_org_transactions_vol_logs_tenant_id_vol_log_id"
                    FOREIGN KEY (tenant_id, vol_log_id)
                    REFERENCES vol_logs (tenant_id, id)
                    ON DELETE SET NULL (vol_log_id);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new System.NotSupportedException(
                "VolunteerHoursLedgerParity is forward-only because rolling it back would remove immutable feedback and ledger evidence. Restore a verified pre-migration backup instead.");
#if false
            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_tenant_id_coordinator_id",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_tenant_id_recipient_id",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_users_tenant_id_supporter_id",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_caring_support_relationships_vol_organizations_tenant_id_or~",
                table: "caring_support_relationships");

            migrationBuilder.DropForeignKey(
                name: "FK_transactions_vol_logs_TenantId_VolunteerLogId",
                table: "transactions");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_caring_support_relationships_tenant_id_caring_supp~",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_users_tenant_id_assigned_to",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_users_tenant_id_support_recipient_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_users_tenant_id_user_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_vol_organizations_tenant_id_organization_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_logs_volunteer_opportunities_tenant_id_opportunity_id",
                table: "vol_logs");

            migrationBuilder.DropForeignKey(
                name: "FK_vol_org_transactions_vol_logs_tenant_id_vol_log_id",
                table: "vol_org_transactions");

            migrationBuilder.DropIndex(
                name: "ux_xp_logs_volunteer_hour_reference",
                table: "xp_logs");

            migrationBuilder.DropIndex(
                name: "ux_volunteer_opportunities_tenant_org_id",
                table: "volunteer_opportunities");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_vol_logs_tenant_id_id",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "idx_vol_logs_tenant_org_opportunity",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "idx_vol_logs_tenant_status_created",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "IX_vol_logs_tenant_id_assigned_to",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "IX_vol_logs_tenant_id_caring_support_relationship_id",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "IX_vol_logs_tenant_id_opportunity_id",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "IX_vol_logs_tenant_id_support_recipient_id",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "ux_vol_logs_active_caring_relationship",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "ux_vol_logs_active_with_opportunity",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "ux_vol_logs_active_without_opportunity",
                table: "vol_logs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerLogs_Hours",
                table: "vol_logs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerLogs_OpportunityOrganisation",
                table: "vol_logs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerLogs_Status",
                table: "vol_logs");

            migrationBuilder.DropIndex(
                name: "ux_transactions_volunteer_log",
                table: "transactions");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_caring_support_relationships_tenant_id_id",
                table: "caring_support_relationships");

            migrationBuilder.DropIndex(
                name: "IX_caring_support_relationships_tenant_id_coordinator_id",
                table: "caring_support_relationships");

            migrationBuilder.DropIndex(
                name: "IX_caring_support_relationships_tenant_id_organization_id",
                table: "caring_support_relationships");

            migrationBuilder.DropColumn(
                name: "feedback",
                table: "vol_logs");

            migrationBuilder.DropColumn(
                name: "VolunteerLogId",
                table: "transactions");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_coordinator_id",
                table: "caring_support_relationships",
                column: "coordinator_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_recipient_id",
                table: "caring_support_relationships",
                column: "recipient_id");

            migrationBuilder.CreateIndex(
                name: "IX_caring_support_relationships_supporter_id",
                table: "caring_support_relationships",
                column: "supporter_id");

            migrationBuilder.AddForeignKey(
                name: "FK_caring_support_relationships_users_coordinator_id",
                table: "caring_support_relationships",
                column: "coordinator_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_support_relationships_users_recipient_id",
                table: "caring_support_relationships",
                column: "recipient_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_caring_support_relationships_users_supporter_id",
                table: "caring_support_relationships",
                column: "supporter_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_vol_logs_caring_support_relationships_caring_support_relati~",
                table: "vol_logs",
                column: "caring_support_relationship_id",
                principalTable: "caring_support_relationships",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_vol_logs_users_support_recipient_id",
                table: "vol_logs",
                column: "support_recipient_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_vol_logs_users_user_id",
                table: "vol_logs",
                column: "user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
#endif
        }
    }
}
