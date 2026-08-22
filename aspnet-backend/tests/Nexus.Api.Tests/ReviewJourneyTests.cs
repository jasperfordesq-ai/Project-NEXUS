// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// Ledger row 4.29 — "leave a review" on the accessible site, end to end at the API.
/// </summary>
/// <remarks>
/// 🔴 These exist because the sibling file ReviewTrustControllerTests only asserted
/// status codes: it called /api/reviews/pending as a member, got 200, and passed —
/// while the response was omitting receiver_id and POST /api/reviews was a stub that
/// wrote nothing and answered 200 with an invented id. Both endpoints were "green" for
/// months. A test that asserts a status code proves the door is locked; it says nothing
/// about whether there is a room behind it. Assert the FIELDS the client reads and the
/// EFFECT on the database.
/// </remarks>
[Collection("Integration")]
public class ReviewJourneyTests : IntegrationTestBase
{
    public ReviewJourneyTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<int> SeedCompletedTransactionAsync(int senderId, int receiverId, string description)
    {
        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var transaction = new Transaction
        {
            TenantId = TestData.Tenant1.Id,
            SenderId = senderId,
            ReceiverId = receiverId,
            Amount = 2.0m,
            Description = description,
            TransactionType = "transfer",
            Status = TransactionStatus.Completed,
            CreatedAt = DateTime.UtcNow
        };

        db.Transactions.Add(transaction);
        await db.SaveChangesAsync();
        return transaction.Id;
    }

    private static JsonElement[] Rows(JsonElement body) => body.GetProperty("data").EnumerateArray().ToArray();

    // 🔴 The whole of ledger row 4.29's first fault. web-uk puts receiver_id into a
    // hidden field on the review form (normalizePendingReview, reviews.js:180-188);
    // without it the form posts receiver_id=0 and the review is addressed to nobody.
    // The response was a valid 200 with correct values in every field it did send.
    [Fact]
    public async Task PendingReviews_CarryTheRecipientTheReviewFormNeeds()
    {
        var marker = $"pending-{Guid.NewGuid():N}";
        var transactionId = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, marker);

        await AuthenticateAsMemberAsync();
        var response = await Client.GetAsync("/api/reviews/pending");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var row = Rows(body).FirstOrDefault(r => r.GetProperty("transaction_id").GetInt32() == transactionId);
        row.ValueKind.Should().NotBe(JsonValueKind.Undefined, "the seeded completed transaction is unreviewed and must be offered");

        row.GetProperty("receiver_id").GetInt32().Should().Be(TestData.AdminUser.Id,
            "the counterparty is the person the review is ABOUT, and the form cannot be built without them");
        row.GetProperty("receiver_name").GetString().Should().NotBeNullOrWhiteSpace();
        row.GetProperty("exchange_title").GetString().Should().Be(marker);
        body.GetProperty("meta").GetProperty("total").GetInt32().Should().BeGreaterThan(0);
    }

    // Row 4.29's second fault: the POST was a do-nothing stub that answered
    // {data:{id, created:true}} and wrote nothing, so web-uk redirected to
    // ?status=review-submitted over an empty reviews page. Assert the ROW, not the 200.
    [Fact]
    public async Task CreateReview_ActuallyPersistsTheReview()
    {
        var marker = $"review-{Guid.NewGuid():N}";
        var transactionId = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, marker);

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.AdminUser.Id,
            rating = 5,
            comment = marker,
            transaction_id = transactionId
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>();
        var reviewId = payload.GetProperty("data").GetProperty("id").GetInt32();
        reviewId.Should().BeGreaterThan(0);

        using var scope = Factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetTenant(TestData.Tenant1.Id);
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Reviews.AsNoTracking().IgnoreQueryFilters().SingleAsync(r => r.Id == reviewId);

        stored.ReviewerId.Should().Be(TestData.MemberUser.Id);
        stored.TargetUserId.Should().Be(TestData.AdminUser.Id);
        stored.TransactionId.Should().Be(transactionId);
        stored.Rating.Should().Be(5);
        stored.Comment.Should().Be(marker);
    }

    // The two halves of the journey have to agree: once reviewed, the transaction must
    // stop being offered. A pending list that keeps re-offering a reviewed exchange is
    // how a member ends up submitting the same review until the duplicate check refuses.
    [Fact]
    public async Task ReviewedTransaction_DropsOutOfPending()
    {
        var marker = $"drops-{Guid.NewGuid():N}";
        var transactionId = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, marker);

        await AuthenticateAsMemberAsync();

        var before = await (await Client.GetAsync("/api/reviews/pending")).Content.ReadFromJsonAsync<JsonElement>();
        Rows(before).Should().Contain(r => r.GetProperty("transaction_id").GetInt32() == transactionId);

        var created = await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.AdminUser.Id,
            rating = 4,
            comment = marker,
            transaction_id = transactionId
        });
        created.StatusCode.Should().Be(HttpStatusCode.OK);

        var after = await (await Client.GetAsync("/api/reviews/pending")).Content.ReadFromJsonAsync<JsonElement>();
        Rows(after).Should().NotContain(r => r.GetProperty("transaction_id").GetInt32() == transactionId);
    }

    [Fact]
    public async Task CreateReview_SecondReviewOfTheSameTransaction_IsRefused()
    {
        var transactionId = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, $"dup-{Guid.NewGuid():N}");

        await AuthenticateAsMemberAsync();
        var body = new { receiver_id = TestData.AdminUser.Id, rating = 5, comment = "first", transaction_id = transactionId };

        (await Client.PostAsJsonAsync("/api/reviews", body)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await Client.PostAsJsonAsync("/api/reviews", body)).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    // 🔴 The reason the old unique index on (TenantId, ReviewerId, TargetUserId) had to
    // go. Laravel counts one review per TRANSACTION, so a second exchange with the same
    // member earns a second review. Under the old index this failed at the database.
    [Fact]
    public async Task CreateReview_SecondExchangeWithTheSamePerson_IsAllowed()
    {
        var first = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, $"first-{Guid.NewGuid():N}");
        var second = await SeedCompletedTransactionAsync(TestData.MemberUser.Id, TestData.AdminUser.Id, $"second-{Guid.NewGuid():N}");

        await AuthenticateAsMemberAsync();

        (await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.AdminUser.Id, rating = 5, comment = "first exchange", transaction_id = first
        })).StatusCode.Should().Be(HttpStatusCode.OK);

        (await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.AdminUser.Id, rating = 4, comment = "second exchange", transaction_id = second
        })).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // The check that stops review-bombing: without it any member could attach a review
    // of anyone to any transaction id in the tenant and cycle through ids to bypass the
    // one-review-per-transaction rule.
    [Fact]
    public async Task CreateReview_AgainstATransactionYouWereNotPartTo_IsRefused()
    {
        var transactionId = await SeedCompletedTransactionAsync(TestData.AdminUser.Id, TestData.OtherTenantUser.Id, $"outsider-{Guid.NewGuid():N}");

        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.AdminUser.Id,
            rating = 1,
            comment = "not my exchange",
            transaction_id = transactionId
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateReview_OfYourself_IsRefused()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync("/api/reviews", new
        {
            receiver_id = TestData.MemberUser.Id,
            rating = 5,
            comment = "self"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateReview_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var response = await Client.PostAsJsonAsync("/api/reviews", new { receiver_id = 1, rating = 5 });
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
