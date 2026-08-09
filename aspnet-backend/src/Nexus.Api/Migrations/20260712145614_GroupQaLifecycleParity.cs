using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class GroupQaLifecycleParity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Score",
                table: "group_answers",
                newName: "VoteCount");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "group_questions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<int>(
                name: "AnswerCount",
                table: "group_questions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsClosed",
                table: "group_questions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "group_questions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP");

            migrationBuilder.AddColumn<int>(
                name: "ViewCount",
                table: "group_questions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "VoteCount",
                table: "group_questions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsAccepted",
                table: "group_answers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "UpdatedAt",
                table: "group_answers",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "CURRENT_TIMESTAMP");

            migrationBuilder.Sql("UPDATE group_questions SET \"UpdatedAt\" = \"CreatedAt\"");
            migrationBuilder.Sql("UPDATE group_answers SET \"UpdatedAt\" = \"CreatedAt\"");

            migrationBuilder.CreateIndex(
                name: "IX_group_questions_GroupId_TenantId",
                table: "group_questions",
                columns: new[] { "GroupId", "TenantId" });

            migrationBuilder.CreateIndex(
                name: "IX_group_questions_GroupId_VoteCount",
                table: "group_questions",
                columns: new[] { "GroupId", "VoteCount" });

            migrationBuilder.CreateIndex(
                name: "IX_group_answers_QuestionId",
                table: "group_answers",
                column: "QuestionId");

            migrationBuilder.CreateIndex(
                name: "IX_group_answers_QuestionId_VoteCount",
                table: "group_answers",
                columns: new[] { "QuestionId", "VoteCount" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_group_questions_GroupId_TenantId",
                table: "group_questions");

            migrationBuilder.DropIndex(
                name: "IX_group_questions_GroupId_VoteCount",
                table: "group_questions");

            migrationBuilder.DropIndex(
                name: "IX_group_answers_QuestionId",
                table: "group_answers");

            migrationBuilder.DropIndex(
                name: "IX_group_answers_QuestionId_VoteCount",
                table: "group_answers");

            migrationBuilder.DropColumn(
                name: "AnswerCount",
                table: "group_questions");

            migrationBuilder.DropColumn(
                name: "IsClosed",
                table: "group_questions");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "group_questions");

            migrationBuilder.DropColumn(
                name: "ViewCount",
                table: "group_questions");

            migrationBuilder.DropColumn(
                name: "VoteCount",
                table: "group_questions");

            migrationBuilder.DropColumn(
                name: "IsAccepted",
                table: "group_answers");

            migrationBuilder.DropColumn(
                name: "UpdatedAt",
                table: "group_answers");

            migrationBuilder.RenameColumn(
                name: "VoteCount",
                table: "group_answers",
                newName: "Score");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "group_questions",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500);
        }
    }
}
