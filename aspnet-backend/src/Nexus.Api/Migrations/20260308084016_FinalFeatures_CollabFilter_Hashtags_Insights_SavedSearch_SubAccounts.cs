using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class FinalFeatures_CollabFilter_Hashtags_Insights_SavedSearch_SubAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "hashtags",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    Tag = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    UsageCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hashtags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_hashtags_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "match_feedbacks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    MatchResultId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    FeedbackType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Comment = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_match_feedbacks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_match_feedbacks_match_results_MatchResultId",
                        column: x => x.MatchResultId,
                        principalTable: "match_results",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_match_feedbacks_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_match_feedbacks_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "personal_insights",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    InsightType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: true),
                    Period = table.Column<string>(type: "text", nullable: true),
                    CalculatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_personal_insights", x => x.Id);
                    table.ForeignKey(
                        name: "FK_personal_insights_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_personal_insights_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "saved_searches",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SearchType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    QueryJson = table.Column<string>(type: "text", nullable: false),
                    NotifyOnNewResults = table.Column<bool>(type: "boolean", nullable: false),
                    LastResultCount = table.Column<int>(type: "integer", nullable: true),
                    LastRunAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_saved_searches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_saved_searches_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_saved_searches_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sub_accounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    PrimaryUserId = table.Column<int>(type: "integer", nullable: false),
                    SubUserId = table.Column<int>(type: "integer", nullable: false),
                    Relationship = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: true),
                    CanTransact = table.Column<bool>(type: "boolean", nullable: false),
                    CanMessage = table.Column<bool>(type: "boolean", nullable: false),
                    CanJoinGroups = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sub_accounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sub_accounts_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_sub_accounts_users_PrimaryUserId",
                        column: x => x.PrimaryUserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_sub_accounts_users_SubUserId",
                        column: x => x.SubUserId,
                        principalTable: "users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "user_interactions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    InteractionType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetId = table.Column<int>(type: "integer", nullable: false),
                    Score = table.Column<decimal>(type: "numeric", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_interactions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_interactions_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_user_interactions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_similarities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    UserAId = table.Column<int>(type: "integer", nullable: false),
                    UserBId = table.Column<int>(type: "integer", nullable: false),
                    SimilarityScore = table.Column<decimal>(type: "numeric", nullable: false),
                    Algorithm = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CommonInteractions = table.Column<int>(type: "integer", nullable: false),
                    CalculatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_similarities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_similarities_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_user_similarities_users_UserAId",
                        column: x => x.UserAId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_similarities_users_UserBId",
                        column: x => x.UserBId,
                        principalTable: "users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "hashtag_usages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TenantId = table.Column<int>(type: "integer", nullable: false),
                    HashtagId = table.Column<int>(type: "integer", nullable: false),
                    TargetType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetId = table.Column<int>(type: "integer", nullable: false),
                    CreatedById = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hashtag_usages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_hashtag_usages_hashtags_HashtagId",
                        column: x => x.HashtagId,
                        principalTable: "hashtags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_hashtag_usages_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hashtag_usages_users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_hashtag_usages_CreatedById",
                table: "hashtag_usages",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_hashtag_usages_HashtagId_TargetType_TargetId",
                table: "hashtag_usages",
                columns: new[] { "HashtagId", "TargetType", "TargetId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_hashtag_usages_TenantId",
                table: "hashtag_usages",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_hashtags_TenantId_Tag",
                table: "hashtags",
                columns: new[] { "TenantId", "Tag" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_hashtags_TenantId_UsageCount",
                table: "hashtags",
                columns: new[] { "TenantId", "UsageCount" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_match_feedbacks_MatchResultId_UserId",
                table: "match_feedbacks",
                columns: new[] { "MatchResultId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_match_feedbacks_TenantId",
                table: "match_feedbacks",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_match_feedbacks_UserId",
                table: "match_feedbacks",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_personal_insights_TenantId_UserId_InsightType_Period",
                table: "personal_insights",
                columns: new[] { "TenantId", "UserId", "InsightType", "Period" });

            migrationBuilder.CreateIndex(
                name: "IX_personal_insights_UserId",
                table: "personal_insights",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_saved_searches_TenantId_UserId",
                table: "saved_searches",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_saved_searches_UserId",
                table: "saved_searches",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_sub_accounts_PrimaryUserId",
                table: "sub_accounts",
                column: "PrimaryUserId");

            migrationBuilder.CreateIndex(
                name: "IX_sub_accounts_SubUserId",
                table: "sub_accounts",
                column: "SubUserId");

            migrationBuilder.CreateIndex(
                name: "IX_sub_accounts_TenantId_PrimaryUserId_SubUserId",
                table: "sub_accounts",
                columns: new[] { "TenantId", "PrimaryUserId", "SubUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_interactions_TenantId_UserId_TargetType_TargetId",
                table: "user_interactions",
                columns: new[] { "TenantId", "UserId", "TargetType", "TargetId" });

            migrationBuilder.CreateIndex(
                name: "IX_user_interactions_UserId",
                table: "user_interactions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_user_similarities_TenantId_UserAId_UserBId",
                table: "user_similarities",
                columns: new[] { "TenantId", "UserAId", "UserBId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_similarities_UserAId",
                table: "user_similarities",
                column: "UserAId");

            migrationBuilder.CreateIndex(
                name: "IX_user_similarities_UserBId",
                table: "user_similarities",
                column: "UserBId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "hashtag_usages");

            migrationBuilder.DropTable(
                name: "match_feedbacks");

            migrationBuilder.DropTable(
                name: "personal_insights");

            migrationBuilder.DropTable(
                name: "saved_searches");

            migrationBuilder.DropTable(
                name: "sub_accounts");

            migrationBuilder.DropTable(
                name: "user_interactions");

            migrationBuilder.DropTable(
                name: "user_similarities");

            migrationBuilder.DropTable(
                name: "hashtags");
        }
    }
}
