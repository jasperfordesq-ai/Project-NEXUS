using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nexus.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReviewTransactionLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_reviews_TenantId_ReviewerId_TargetUserId",
                table: "reviews");

            migrationBuilder.AddColumn<int>(
                name: "TransactionId",
                table: "reviews",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_reviews_TenantId_ReviewerId_TransactionId",
                table: "reviews",
                columns: new[] { "TenantId", "ReviewerId", "TransactionId" },
                unique: true,
                filter: "\"TransactionId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_reviews_TransactionId",
                table: "reviews",
                column: "TransactionId");

            migrationBuilder.AddForeignKey(
                name: "FK_reviews_transactions_TransactionId",
                table: "reviews",
                column: "TransactionId",
                principalTable: "transactions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_reviews_transactions_TransactionId",
                table: "reviews");

            migrationBuilder.DropIndex(
                name: "IX_reviews_TenantId_ReviewerId_TransactionId",
                table: "reviews");

            migrationBuilder.DropIndex(
                name: "IX_reviews_TransactionId",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "TransactionId",
                table: "reviews");

            migrationBuilder.CreateIndex(
                name: "IX_reviews_TenantId_ReviewerId_TargetUserId",
                table: "reviews",
                columns: new[] { "TenantId", "ReviewerId", "TargetUserId" },
                unique: true,
                filter: "\"TargetUserId\" IS NOT NULL");
        }
    }
}
