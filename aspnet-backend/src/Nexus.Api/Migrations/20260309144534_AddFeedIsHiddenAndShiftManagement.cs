using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFeedIsHiddenAndShiftManagement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RecurringPatternId",
                table: "volunteer_shifts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsHidden",
                table: "feed_posts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "badge_collections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    IconUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    BadgeIds = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_badge_collections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_badge_collections_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "badge_showcases",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    BadgeId = table.Column<int>(type: "integer", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_badge_showcases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_badge_showcases_badges_BadgeId",
                        column: x => x.BadgeId,
                        principalTable: "badges",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_badge_showcases_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_badge_showcases_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "daily_reward_logs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    DayNumber = table.Column<int>(type: "integer", nullable: false),
                    XpAwarded = table.Column<int>(type: "integer", nullable: false),
                    BonusAwarded = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_daily_reward_logs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_daily_reward_logs_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_daily_reward_logs_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "feed_reports",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PostId = table.Column<int>(type: "integer", nullable: false),
                    ReporterId = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Details = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReviewedByAdminId = table.Column<int>(type: "integer", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feed_reports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_feed_reports_feed_posts_PostId",
                        column: x => x.PostId,
                        principalTable: "feed_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_feed_reports_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_feed_reports_users_ReporterId",
                        column: x => x.ReporterId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "gamification_challenges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ActionType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    TargetCount = table.Column<int>(type: "integer", nullable: false),
                    XpReward = table.Column<int>(type: "integer", nullable: false),
                    BadgeReward = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_gamification_challenges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_gamification_challenges_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "hidden_posts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PostId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    HiddenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hidden_posts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_hidden_posts_feed_posts_PostId",
                        column: x => x.PostId,
                        principalTable: "feed_posts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_hidden_posts_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hidden_posts_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "muted_users",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    MutedUserId = table.Column<int>(type: "integer", nullable: false),
                    MutedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_muted_users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_muted_users_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_muted_users_users_MutedUserId",
                        column: x => x.MutedUserId,
                        principalTable: "users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_muted_users_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RecurringShiftPatterns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    OpportunityId = table.Column<int>(type: "integer", nullable: false),
                    CreatedBy = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Frequency = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DaysOfWeek = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    StartTime = table.Column<TimeSpan>(type: "interval", nullable: false),
                    EndTime = table.Column<TimeSpan>(type: "interval", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    MaxOccurrences = table.Column<int>(type: "integer", nullable: true),
                    OccurrencesGenerated = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatorId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurringShiftPatterns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecurringShiftPatterns_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecurringShiftPatterns_users_CreatorId",
                        column: x => x.CreatorId,
                        principalTable: "users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_RecurringShiftPatterns_volunteer_opportunities_OpportunityId",
                        column: x => x.OpportunityId,
                        principalTable: "volunteer_opportunities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ShiftGroupReservations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ShiftId = table.Column<int>(type: "integer", nullable: false),
                    GroupId = table.Column<int>(type: "integer", nullable: false),
                    ReservedBy = table.Column<int>(type: "integer", nullable: false),
                    ReservedSlots = table.Column<int>(type: "integer", nullable: false),
                    FilledSlots = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReserverId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftGroupReservations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftGroupReservations_groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftGroupReservations_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftGroupReservations_users_ReserverId",
                        column: x => x.ReserverId,
                        principalTable: "users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ShiftGroupReservations_volunteer_shifts_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "volunteer_shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ShiftSwapRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    FromUserId = table.Column<int>(type: "integer", nullable: false),
                    ToUserId = table.Column<int>(type: "integer", nullable: true),
                    FromShiftId = table.Column<int>(type: "integer", nullable: false),
                    ToShiftId = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    RequiresAdminApproval = table.Column<bool>(type: "boolean", nullable: false),
                    Message = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    AdminId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftSwapRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftSwapRequests_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftSwapRequests_users_FromUserId",
                        column: x => x.FromUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftSwapRequests_users_ToUserId",
                        column: x => x.ToUserId,
                        principalTable: "users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ShiftSwapRequests_volunteer_shifts_FromShiftId",
                        column: x => x.FromShiftId,
                        principalTable: "volunteer_shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftSwapRequests_volunteer_shifts_ToShiftId",
                        column: x => x.ToShiftId,
                        principalTable: "volunteer_shifts",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "ShiftWaitlistEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ShiftId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NotifiedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PromotedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftWaitlistEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftWaitlistEntries_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftWaitlistEntries_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftWaitlistEntries_volunteer_shifts_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "volunteer_shifts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shop_items",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ItemKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ImageUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    XpCost = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    StockLimit = table.Column<int>(type: "integer", nullable: true),
                    PurchasedCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shop_items", x => x.Id);
                    table.ForeignKey(
                        name: "FK_shop_items_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "challenge_progresses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ChallengeId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CurrentCount = table.Column<int>(type: "integer", nullable: false),
                    IsCompleted = table.Column<bool>(type: "boolean", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_challenge_progresses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_challenge_progresses_gamification_challenges_ChallengeId",
                        column: x => x.ChallengeId,
                        principalTable: "gamification_challenges",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_challenge_progresses_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_challenge_progresses_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ShiftGroupMembers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ReservationId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftGroupMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftGroupMembers_ShiftGroupReservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "ShiftGroupReservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ShiftGroupMembers_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "shop_purchases",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    ShopItemId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    XpSpent = table.Column<int>(type: "integer", nullable: false),
                    PurchasedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shop_purchases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_shop_purchases_shop_items_ShopItemId",
                        column: x => x.ShopItemId,
                        principalTable: "shop_items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_shop_purchases_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_shop_purchases_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_volunteer_shifts_RecurringPatternId",
                table: "volunteer_shifts",
                column: "RecurringPatternId");

            migrationBuilder.CreateIndex(
                name: "IX_badge_collections_IsActive",
                table: "badge_collections",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_badge_collections_TenantId",
                table: "badge_collections",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_badge_showcases_BadgeId",
                table: "badge_showcases",
                column: "BadgeId");

            migrationBuilder.CreateIndex(
                name: "IX_badge_showcases_TenantId",
                table: "badge_showcases",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_badge_showcases_TenantId_UserId_BadgeId",
                table: "badge_showcases",
                columns: new[] { "TenantId", "UserId", "BadgeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_badge_showcases_UserId",
                table: "badge_showcases",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_challenge_progresses_ChallengeId",
                table: "challenge_progresses",
                column: "ChallengeId");

            migrationBuilder.CreateIndex(
                name: "IX_challenge_progresses_TenantId",
                table: "challenge_progresses",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_challenge_progresses_TenantId_ChallengeId_UserId",
                table: "challenge_progresses",
                columns: new[] { "TenantId", "ChallengeId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_challenge_progresses_UserId",
                table: "challenge_progresses",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_daily_reward_logs_ClaimedAt",
                table: "daily_reward_logs",
                column: "ClaimedAt");

            migrationBuilder.CreateIndex(
                name: "IX_daily_reward_logs_TenantId",
                table: "daily_reward_logs",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_daily_reward_logs_UserId",
                table: "daily_reward_logs",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_feed_reports_CreatedAt",
                table: "feed_reports",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_feed_reports_PostId",
                table: "feed_reports",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "IX_feed_reports_ReporterId",
                table: "feed_reports",
                column: "ReporterId");

            migrationBuilder.CreateIndex(
                name: "IX_feed_reports_Status",
                table: "feed_reports",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_feed_reports_TenantId",
                table: "feed_reports",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_gamification_challenges_EndsAt",
                table: "gamification_challenges",
                column: "EndsAt");

            migrationBuilder.CreateIndex(
                name: "IX_gamification_challenges_IsActive",
                table: "gamification_challenges",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_gamification_challenges_StartsAt",
                table: "gamification_challenges",
                column: "StartsAt");

            migrationBuilder.CreateIndex(
                name: "IX_gamification_challenges_TenantId",
                table: "gamification_challenges",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_hidden_posts_PostId",
                table: "hidden_posts",
                column: "PostId");

            migrationBuilder.CreateIndex(
                name: "IX_hidden_posts_TenantId",
                table: "hidden_posts",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_hidden_posts_TenantId_PostId_UserId",
                table: "hidden_posts",
                columns: new[] { "TenantId", "PostId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_hidden_posts_UserId",
                table: "hidden_posts",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_muted_users_MutedUserId",
                table: "muted_users",
                column: "MutedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_muted_users_TenantId",
                table: "muted_users",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_muted_users_TenantId_UserId_MutedUserId",
                table: "muted_users",
                columns: new[] { "TenantId", "UserId", "MutedUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_muted_users_UserId",
                table: "muted_users",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_CreatorId",
                table: "RecurringShiftPatterns",
                column: "CreatorId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_OpportunityId",
                table: "RecurringShiftPatterns",
                column: "OpportunityId");

            migrationBuilder.CreateIndex(
                name: "IX_RecurringShiftPatterns_TenantId",
                table: "RecurringShiftPatterns",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupMembers_ReservationId",
                table: "ShiftGroupMembers",
                column: "ReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupMembers_UserId",
                table: "ShiftGroupMembers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupReservations_GroupId",
                table: "ShiftGroupReservations",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupReservations_ReserverId",
                table: "ShiftGroupReservations",
                column: "ReserverId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupReservations_ShiftId",
                table: "ShiftGroupReservations",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftGroupReservations_TenantId",
                table: "ShiftGroupReservations",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftSwapRequests_FromShiftId",
                table: "ShiftSwapRequests",
                column: "FromShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftSwapRequests_FromUserId",
                table: "ShiftSwapRequests",
                column: "FromUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftSwapRequests_TenantId",
                table: "ShiftSwapRequests",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftSwapRequests_ToShiftId",
                table: "ShiftSwapRequests",
                column: "ToShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftSwapRequests_ToUserId",
                table: "ShiftSwapRequests",
                column: "ToUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftWaitlistEntries_ShiftId",
                table: "ShiftWaitlistEntries",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftWaitlistEntries_TenantId",
                table: "ShiftWaitlistEntries",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftWaitlistEntries_UserId",
                table: "ShiftWaitlistEntries",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_shop_items_IsActive",
                table: "shop_items",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_shop_items_TenantId",
                table: "shop_items",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_shop_items_Type",
                table: "shop_items",
                column: "Type");

            migrationBuilder.CreateIndex(
                name: "IX_shop_purchases_PurchasedAt",
                table: "shop_purchases",
                column: "PurchasedAt");

            migrationBuilder.CreateIndex(
                name: "IX_shop_purchases_ShopItemId",
                table: "shop_purchases",
                column: "ShopItemId");

            migrationBuilder.CreateIndex(
                name: "IX_shop_purchases_TenantId",
                table: "shop_purchases",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_shop_purchases_UserId",
                table: "shop_purchases",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_volunteer_shifts_RecurringShiftPatterns_RecurringPatternId",
                table: "volunteer_shifts",
                column: "RecurringPatternId",
                principalTable: "RecurringShiftPatterns",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_volunteer_shifts_RecurringShiftPatterns_RecurringPatternId",
                table: "volunteer_shifts");

            migrationBuilder.DropTable(
                name: "badge_collections");

            migrationBuilder.DropTable(
                name: "badge_showcases");

            migrationBuilder.DropTable(
                name: "challenge_progresses");

            migrationBuilder.DropTable(
                name: "daily_reward_logs");

            migrationBuilder.DropTable(
                name: "feed_reports");

            migrationBuilder.DropTable(
                name: "hidden_posts");

            migrationBuilder.DropTable(
                name: "muted_users");

            migrationBuilder.DropTable(
                name: "RecurringShiftPatterns");

            migrationBuilder.DropTable(
                name: "ShiftGroupMembers");

            migrationBuilder.DropTable(
                name: "ShiftSwapRequests");

            migrationBuilder.DropTable(
                name: "ShiftWaitlistEntries");

            migrationBuilder.DropTable(
                name: "shop_purchases");

            migrationBuilder.DropTable(
                name: "gamification_challenges");

            migrationBuilder.DropTable(
                name: "ShiftGroupReservations");

            migrationBuilder.DropTable(
                name: "shop_items");

            migrationBuilder.DropIndex(
                name: "IX_volunteer_shifts_RecurringPatternId",
                table: "volunteer_shifts");

            migrationBuilder.DropColumn(
                name: "RecurringPatternId",
                table: "volunteer_shifts");

            migrationBuilder.DropColumn(
                name: "IsHidden",
                table: "feed_posts");
        }
    }
}
