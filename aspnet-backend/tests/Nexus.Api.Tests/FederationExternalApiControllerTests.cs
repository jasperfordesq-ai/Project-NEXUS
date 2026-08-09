// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class FederationExternalApiControllerTests : IntegrationTestBase
{
    public FederationExternalApiControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<decimal> GetBalanceAsync(int tenantId, int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var wallet = scope.ServiceProvider.GetRequiredService<PersonalWalletLedgerService>();
        return await wallet.GetBalanceAsync(tenantId, userId);
    }

    [Fact]
    public async Task GetInfo_WithoutFederationAuth_ReturnsOk()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/v1/federation");
        // GetApiInfo() is a public endpoint (no auth required), path is excluded from tenant middleware
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetTimebanks_WithoutFederationAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/v1/federation/timebanks");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetListings_WithoutFederationAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/v1/federation/listings");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetMembers_WithoutFederationAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/v1/federation/members");
        r.StatusCode.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetHealth_WithoutFederationAuth_ReturnsOk()
    {
        ClearFederationHeaders();

        var response = await Client.GetAsync("/api/v1/federation/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        json.GetProperty("status").GetString().Should().Be("ok");
    }

    [Fact]
    public async Task GetListings_WithV15ApiKeyHeader_ReturnsPartnerTenantListings()
    {
        UseFederationApiKeyHeader();

        var response = await Client.GetAsync("/api/v1/federation/listings");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data").EnumerateArray().ToList();
        data.Should().Contain(item =>
            item.GetProperty("id").GetInt32() == TestData.PartnerListing.Id &&
            item.GetProperty("tenant_id").GetInt32() == TestData.Tenant2.Id);
    }

    [Fact]
    public async Task GetMembers_WithRawBearerApiKey_ReturnsOptedInPartnerMembers()
    {
        UseFederationBearerApiKey();

        var response = await Client.GetAsync("/api/v1/federation/members");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = json.GetProperty("data").EnumerateArray().ToList();
        data.Should().Contain(item =>
            item.GetProperty("id").GetInt32() == TestData.OtherTenantUser.Id &&
            item.GetProperty("tenant_id").GetInt32() == TestData.Tenant2.Id);
    }

    [Fact]
    public async Task PartnerReads_EnforceConsentSuspensionBlocksVisibilityAndTenantMatching()
    {
        int blockedUserId;
        int unoptedUserId;
        int suspendedUserId;
        int mismatchedConsentUserId;
        int profileHiddenUserId;
        int listingHiddenUserId;
        int blockedListingId;
        int unoptedListingId;
        int suspendedListingId;
        int mismatchedConsentListingId;
        int profileHiddenListingId;
        int listingHiddenListingId;

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var suffix = Guid.NewGuid().ToString("N");
            var blocked = NewPartnerUser(TestData.Tenant2.Id, "Blocked", suffix);
            var unopted = NewPartnerUser(TestData.Tenant2.Id, "Unopted", suffix);
            var suspended = NewPartnerUser(TestData.Tenant2.Id, "Suspended", suffix);
            suspended.SuspendedAt = DateTime.UtcNow.AddMinutes(-1);
            var mismatchedConsent = NewPartnerUser(TestData.Tenant2.Id, "Mismatched", suffix);
            var profileHidden = NewPartnerUser(TestData.Tenant2.Id, "ProfileHidden", suffix);
            var listingHidden = NewPartnerUser(TestData.Tenant2.Id, "ListingHidden", suffix);
            db.Users.AddRange(blocked, unopted, suspended, mismatchedConsent, profileHidden, listingHidden);
            await db.SaveChangesAsync();

            db.FederationUserSettings.AddRange(
                NewFederationSetting(blocked, federationOptIn: true, profileVisible: true, listingsVisible: true,
                    blockedPartnerTenants: $"{TestData.Tenant2.Id}, {TestData.Tenant1.Id}"),
                NewFederationSetting(unopted, federationOptIn: false, profileVisible: true, listingsVisible: true),
                NewFederationSetting(suspended, federationOptIn: true, profileVisible: true, listingsVisible: true),
                new FederationUserSetting
                {
                    TenantId = TestData.Tenant1.Id,
                    UserId = mismatchedConsent.Id,
                    FederationOptIn = true,
                    ProfileVisible = true,
                    ListingsVisible = true
                },
                NewFederationSetting(profileHidden, federationOptIn: true, profileVisible: false, listingsVisible: true),
                NewFederationSetting(listingHidden, federationOptIn: true, profileVisible: true, listingsVisible: false));

            var blockedListing = NewPartnerListing(blocked);
            var unoptedListing = NewPartnerListing(unopted);
            var suspendedListing = NewPartnerListing(suspended);
            var mismatchedConsentListing = NewPartnerListing(mismatchedConsent);
            var profileHiddenListing = NewPartnerListing(profileHidden);
            var listingHiddenListing = NewPartnerListing(listingHidden);
            db.Listings.AddRange(
                blockedListing,
                unoptedListing,
                suspendedListing,
                mismatchedConsentListing,
                profileHiddenListing,
                listingHiddenListing);
            await db.SaveChangesAsync();

            blockedUserId = blocked.Id;
            unoptedUserId = unopted.Id;
            suspendedUserId = suspended.Id;
            mismatchedConsentUserId = mismatchedConsent.Id;
            profileHiddenUserId = profileHidden.Id;
            listingHiddenUserId = listingHidden.Id;
            blockedListingId = blockedListing.Id;
            unoptedListingId = unoptedListing.Id;
            suspendedListingId = suspendedListing.Id;
            mismatchedConsentListingId = mismatchedConsentListing.Id;
            profileHiddenListingId = profileHiddenListing.Id;
            listingHiddenListingId = listingHiddenListing.Id;
        }

        UseFederationKey();

        var listingsResponse = await Client.GetAsync("/api/v1/federation/listings?limit=100");
        listingsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var listingIds = (await listingsResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetInt32())
            .ToArray();
        listingIds.Should().Contain(TestData.PartnerListing.Id);
        listingIds.Should().NotContain([
            blockedListingId,
            unoptedListingId,
            suspendedListingId,
            mismatchedConsentListingId,
            profileHiddenListingId,
            listingHiddenListingId
        ]);

        foreach (var hiddenListingId in new[]
                 {
                     blockedListingId,
                     unoptedListingId,
                     suspendedListingId,
                     mismatchedConsentListingId,
                     profileHiddenListingId,
                     listingHiddenListingId
                 })
        {
            (await Client.GetAsync($"/api/v1/federation/listings/{hiddenListingId}"))
                .StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        var membersResponse = await Client.GetAsync("/api/v1/federation/members?limit=50");
        membersResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var memberIds = (await membersResponse.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data")
            .EnumerateArray()
            .Select(item => item.GetProperty("id").GetInt32())
            .ToArray();
        memberIds.Should().Contain(TestData.OtherTenantUser.Id);
        memberIds.Should().Contain(listingHiddenUserId,
            "profile visibility is independent from listing visibility");
        memberIds.Should().NotContain([
            blockedUserId,
            unoptedUserId,
            suspendedUserId,
            mismatchedConsentUserId,
            profileHiddenUserId
        ]);

        foreach (var hiddenUserId in new[]
                 {
                     blockedUserId,
                     unoptedUserId,
                     suspendedUserId,
                     mismatchedConsentUserId,
                     profileHiddenUserId
                 })
        {
            (await Client.GetAsync($"/api/v1/federation/members/{hiddenUserId}"))
                .StatusCode.Should().Be(HttpStatusCode.NotFound);
        }
        (await Client.GetAsync($"/api/v1/federation/members/{listingHiddenUserId}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ImpersonatingMessageAndReviewWrites_FailClosedWithoutAnyMutation()
    {
        UseFederationKey();
        var memberBalanceBefore = await GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
        var partnerBalanceBefore = await GetBalanceAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id);
        int messagesBefore;
        int conversationsBefore;
        int reviewsBefore;
        int transactionsBefore;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            messagesBefore = await db.Messages.IgnoreQueryFilters().CountAsync();
            conversationsBefore = await db.Conversations.IgnoreQueryFilters().CountAsync();
            reviewsBefore = await db.Reviews.IgnoreQueryFilters().CountAsync();
            transactionsBefore = await db.Transactions.IgnoreQueryFilters().CountAsync();
        }

        var message = await Client.PostAsJsonAsync("/api/v1/federation/messages", new
        {
            sender_id = TestData.OtherTenantUser.Id,
            recipient_id = TestData.MemberUser.Id,
            subject = "Caller-controlled impersonation",
            body = "This must never be persisted"
        }, JsonOptions);
        var review = await Client.PostAsJsonAsync("/api/v1/federation/reviews", new
        {
            reviewer_id = TestData.OtherTenantUser.Id,
            reviewee_id = TestData.MemberUser.Id,
            rating = 5,
            comment = "This must never be persisted"
        }, JsonOptions);

        message.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        review.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await message.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString().Should().Be("FEDERATION_IDENTITY_UNAVAILABLE");
        (await review.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString().Should().Be("FEDERATION_IDENTITY_UNAVAILABLE");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            (await db.Messages.IgnoreQueryFilters().CountAsync()).Should().Be(messagesBefore);
            (await db.Conversations.IgnoreQueryFilters().CountAsync()).Should().Be(conversationsBefore);
            (await db.Reviews.IgnoreQueryFilters().CountAsync()).Should().Be(reviewsBefore);
            (await db.Transactions.IgnoreQueryFilters().CountAsync()).Should().Be(transactionsBefore);
        }
        (await GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id))
            .Should().Be(memberBalanceBefore);
        (await GetBalanceAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id))
            .Should().Be(partnerBalanceBefore);
    }

    [Fact]
    public async Task SendTimeCredits_WhileDurableSagaIsUnavailable_FailsClosedWithoutLedgerMutation()
    {
        UseFederationKey();
        var senderBefore = await GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id);
        var recipientBefore = await GetBalanceAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id);
        var description = $"Disabled federation settlement {Guid.NewGuid():N}";

        var response = await Client.PostAsJsonAsync("/api/v1/federation/transactions", new
        {
            sender_id = TestData.MemberUser.Id,
            recipient_id = TestData.OtherTenantUser.Id,
            amount = 1,
            description,
            idempotency_key = $"federation-disabled-{Guid.NewGuid():N}"
        }, JsonOptions);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("code").GetString().Should().Be("FEDERATION_SETTLEMENT_UNAVAILABLE");
        (await GetBalanceAsync(TestData.Tenant1.Id, TestData.MemberUser.Id))
            .Should().Be(senderBefore);
        (await GetBalanceAsync(TestData.Tenant2.Id, TestData.OtherTenantUser.Id))
            .Should().Be(recipientBefore);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Transactions.IgnoreQueryFilters()
            .AnyAsync(transaction => transaction.Description == description))
            .Should().BeFalse();
    }

    [Fact]
    public async Task GetListings_WithHmacSignature_ClaimsNonceAndRejectsReplay()
    {
        ClearFederationHeaders();
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var nonce = Guid.NewGuid().ToString("N");
        var path = "/api/v1/federation/listings";
        var stringToSign = string.Join("\n", "GET", path, timestamp, nonce, string.Empty);
        var signature = Convert.ToHexString(HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(TestDataSeeder.Tenant1FederationApiKey),
            Encoding.UTF8.GetBytes(stringToSign))).ToLowerInvariant();

        Client.DefaultRequestHeaders.Add("X-Federation-Key", TestDataSeeder.Tenant1FederationApiKey);
        Client.DefaultRequestHeaders.Add("X-Federation-Timestamp", timestamp);
        Client.DefaultRequestHeaders.Add("X-Federation-Nonce", nonce);
        Client.DefaultRequestHeaders.Add("X-Federation-Signature", signature);

        var response = await Client.GetAsync(path);
        var replay = await Client.GetAsync(path);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        replay.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await replay.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("error").GetString().Should().Contain("nonce has already been used");
    }

    private void UseFederationKey()
    {
        ClearFederationHeaders();
        Client.DefaultRequestHeaders.Add("X-Federation-Key", TestDataSeeder.Tenant1FederationApiKey);
    }

    private void UseFederationApiKeyHeader()
    {
        ClearFederationHeaders();
        Client.DefaultRequestHeaders.Add("X-API-Key", TestDataSeeder.Tenant1FederationApiKey);
    }

    private void UseFederationBearerApiKey()
    {
        ClearFederationHeaders();
        Client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", TestDataSeeder.Tenant1FederationApiKey);
    }

    private void ClearFederationHeaders()
    {
        ClearAuthToken();
        Client.DefaultRequestHeaders.Remove("X-Federation-Key");
        Client.DefaultRequestHeaders.Remove("X-API-Key");
        Client.DefaultRequestHeaders.Remove("X-Federation-Timestamp");
        Client.DefaultRequestHeaders.Remove("X-Federation-Nonce");
        Client.DefaultRequestHeaders.Remove("X-Federation-Signature");
    }

    private static User NewPartnerUser(int tenantId, string label, string suffix) => new()
    {
        TenantId = tenantId,
        Email = $"federation-{label.ToLowerInvariant()}-{suffix}@example.test",
        PasswordHash = "not-used-by-federation-tests",
        FirstName = label,
        LastName = "Partner",
        Role = "member",
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };

    private static FederationUserSetting NewFederationSetting(
        User user,
        bool federationOptIn,
        bool profileVisible,
        bool listingsVisible,
        string? blockedPartnerTenants = null) => new()
    {
        TenantId = user.TenantId,
        UserId = user.Id,
        FederationOptIn = federationOptIn,
        ProfileVisible = profileVisible,
        ListingsVisible = listingsVisible,
        BlockedPartnerTenants = blockedPartnerTenants
    };

    private static Listing NewPartnerListing(User owner) => new()
    {
        TenantId = owner.TenantId,
        UserId = owner.Id,
        Title = $"Federation privacy listing {owner.FirstName}",
        Description = "Privacy boundary regression fixture",
        Type = ListingType.Offer,
        Status = ListingStatus.Active,
        CreatedAt = DateTime.UtcNow
    };
}
