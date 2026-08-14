// Copyright (c) 2024-2026 Jasper Ford
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
using Nexus.Api.Services;
using Nexus.Api.Support.Safeguarding;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Pins the staff attestation surface against Laravel's
/// SupportActionAttestationTest: the broker-or-admin gate, the required
/// channel (phone | in_person | paper), the optional witness, execution with
/// attested_offline provenance, the supported member's notification, and the
/// authority re-check refusing attestation after a downgrade.
/// </summary>
[Collection("Integration")]
public class SupportActionAttestationTests : IntegrationTestBase
{
    public SupportActionAttestationTests(NexusWebApplicationFactory factory) : base(factory) { }

    private async Task<(int RelationshipId, int ActionId)> SeedPendingListingActionAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var supporter = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"attest-supporter-{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Attest",
            LastName = "Supporter",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(supporter);
        await db.SaveChangesAsync();

        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = supporter.Id,
            ChildUserId = TestData.MemberUser.Id,
            RelationshipType = "carer",
            Permissions = AccountRelationshipService.StorePermissions(
                new Dictionary<string, string> { ["listings"] = SupportTiers.CoDecide }),
            Status = AccountRelationship.StatusActive,
            ApprovedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();

        var action = new SupportPendingAction
        {
            TenantId = TestData.Tenant1.Id,
            RelationshipId = relationship.Id,
            SupportedUserId = TestData.MemberUser.Id,
            SupporterUserId = supporter.Id,
            ActionType = SupportPendingAction.TypeListingCreate,
            Payload = "{\"title\":\"Attested garden help\",\"type\":\"request\"}",
            Status = SupportPendingAction.StatusPending,
            TokenHash = SupportPendingActionService.HashToken(SupportPendingActionService.NewToken()),
            ExpiresAt = DateTime.UtcNow.AddDays(14),
            CreatedAt = DateTime.UtcNow
        };
        db.SupportPendingActions.Add(action);
        await db.SaveChangesAsync();
        return (relationship.Id, action.Id);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    [Fact]
    public async Task PlainMember_CannotSeeTheQueueOrAttest()
    {
        var (_, actionId) = await SeedPendingListingActionAsync();
        await AuthenticateAsMemberAsync();

        (await Client.GetAsync("/api/v2/admin/safeguarding/support-actions"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/support-actions/{actionId}/attest",
            new { channel = "phone" }))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Queue_ShowsBothNames_AndAdminCanReadIt()
    {
        await SeedPendingListingActionAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/admin/safeguarding/support-actions");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var action = (await ReadJsonAsync(response)).GetProperty("data").GetProperty("actions")[0];
        action.GetProperty("supporter_name").GetString().Should().Be("Attest Supporter");
        action.GetProperty("supported_name").GetString().Should().NotBeNullOrEmpty();
        action.TryGetProperty("payload", out _).Should().BeFalse(
            "staff see the summary, never the raw payload");
    }

    [Fact]
    public async Task UnknownChannel_IsRefused_WithNothingExecuted()
    {
        var (_, actionId) = await SeedPendingListingActionAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/support-actions/{actionId}/attest",
            new { channel = "telepathy" });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("VALIDATION_ERROR");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.SupportPendingActions.IgnoreQueryFilters()
            .SingleAsync(a => a.Id == actionId)).Status.Should().Be("pending");
    }

    [Fact]
    public async Task PhoneAttestation_ExecutesWithProvenance_AndTellsTheMember()
    {
        var (_, actionId) = await SeedPendingListingActionAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/support-actions/{actionId}/attest",
            new { channel = "phone", witness = "Session support worker" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var listingId = (await ReadJsonAsync(response)).GetProperty("data")
            .GetProperty("result_id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var action = await db.SupportPendingActions.IgnoreQueryFilters()
            .SingleAsync(a => a.Id == actionId);
        action.Status.Should().Be("confirmed");
        action.ConfirmedVia.Should().Be("attested_offline");
        action.AttestedByUserId.Should().Be(TestData.AdminUser.Id);
        action.AttestedChannel.Should().Be("phone");
        action.AttestedWitness.Should().Be("Session support worker");

        var listing = await db.Listings.IgnoreQueryFilters().SingleAsync(l => l.Id == listingId);
        listing.UserId.Should().Be(TestData.MemberUser.Id);
        listing.Title.Should().Be("Attested garden help");

        (await db.Notifications.IgnoreQueryFilters().AnyAsync(n =>
            n.UserId == TestData.MemberUser.Id && n.Type == "support_action_attested"))
            .Should().BeTrue("the supported member must always learn an offline approval was recorded");
    }

    [Fact]
    public async Task TierDowngrade_BlocksAttestation()
    {
        var (relationshipId, actionId) = await SeedPendingListingActionAsync();
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var relationship = await db.AccountRelationships.IgnoreQueryFilters()
                .SingleAsync(r => r.Id == relationshipId);
            relationship.Permissions = AccountRelationshipService.StorePermissions(
                new Dictionary<string, string> { ["listings"] = SupportTiers.Assist });
            await db.SaveChangesAsync();
        }

        await AuthenticateAsAdminAsync();
        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/support-actions/{actionId}/attest",
            new { channel = "in_person" });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("code")
            .GetString().Should().Be("AUTHORITY_CHANGED");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.SupportPendingActions.IgnoreQueryFilters()
            .SingleAsync(a => a.Id == actionId)).Status.Should().Be("cancelled");
        (await verifyDb.Listings.IgnoreQueryFilters()
            .AnyAsync(l => l.Title == "Attested garden help")).Should().BeFalse();
    }
}
