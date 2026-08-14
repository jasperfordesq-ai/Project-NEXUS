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
/// Pins the guardian arrangement contract against Laravel's
/// GuardianConsentRecordingTest / GuardianArrangementResponseTest /
/// GuardianTierGrantTest / SupportAuthorityAttestationTest: only the ward
/// answers; declining/withdrawing resets powers and cancels open actions;
/// answers are idempotent; the guardian's read is minimal; tier grants come
/// only from the ward; and authority attestations are encrypted records with
/// closed vocabularies that never grant anything.
/// </summary>
[Collection("Integration")]
public class GuardianArrangementTests : IntegrationTestBase
{
    public GuardianArrangementTests(NexusWebApplicationFactory factory) : base(factory) { }

    /// <summary>AdminUser proposes AdminUser? No — staff proposes AdminUser as guardian for MemberUser.</summary>
    private async Task<int> SeedArrangementAsync(
        string status = AccountRelationship.StatusPending,
        Dictionary<string, string>? tiers = null,
        DateTime? declinedAt = null, DateTime? withdrawnAt = null)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = TestData.AdminUser.Id,      // the guardian
            ChildUserId = TestData.MemberUser.Id,      // the ward
            RelationshipType = "guardian",
            Permissions = AccountRelationshipService.StorePermissions(
                SupportTiers.Resolve(null, tiers ?? new Dictionary<string, string>())),
            Status = status,
            ProposedByUserId = TestData.AdminUser.Id,  // staff-proposed
            StaffNotes = "Recorded at the drop-in session",
            ApprovedAt = status == AccountRelationship.StatusActive ? DateTime.UtcNow : null,
            DeclinedAt = declinedAt,
            WithdrawnAt = withdrawnAt,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();
        return relationship.Id;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
        => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());

    private async Task<AccountRelationship> RowAsync(int id)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.AccountRelationships.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(r => r.Id == id);
    }

    [Fact]
    public async Task Ward_SeesTheProposal_AndPendingCount()
    {
        await SeedArrangementAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.GetAsync("/api/v2/safeguarding/my-guardians");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(response)).GetProperty("data");
        data.GetProperty("pending_count").GetInt32().Should().Be(1);
        var guardian = data.GetProperty("guardians")[0];
        guardian.GetProperty("guardian_name").GetString().Should().NotBeNullOrEmpty();
        guardian.GetProperty("state").GetString().Should().Be("pending");
        guardian.GetProperty("consent_given").GetBoolean().Should().BeFalse();
        guardian.GetProperty("tiers").GetProperty("messages").GetString().Should().Be("none");
    }

    [Fact]
    public async Task Consent_IsRecorded_AndIdempotent()
    {
        var id = await SeedArrangementAsync();
        await AuthenticateAsMemberAsync();

        var consent = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/consent-to-guardian", new { assignment_id = id });
        consent.StatusCode.Should().Be(HttpStatusCode.OK);
        var data = (await ReadJsonAsync(consent)).GetProperty("data");
        data.GetProperty("state").GetString().Should().Be("consented");
        data.GetProperty("consent_given").GetBoolean().Should().BeTrue();
        data.GetProperty("already_given").GetBoolean().Should().BeFalse();
        (await RowAsync(id)).Status.Should().Be(AccountRelationship.StatusActive);

        var again = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/consent-to-guardian", new { assignment_id = id });
        var againData = (await ReadJsonAsync(again)).GetProperty("data");
        againData.GetProperty("already").GetBoolean().Should().BeTrue();
        againData.GetProperty("already_given").GetBoolean().Should().BeTrue();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.AccountRelationshipEvents.IgnoreQueryFilters()
            .CountAsync(e => e.RelationshipId == id && e.Action == "approved"))
            .Should().Be(1, "an idempotent repeat writes nothing");
    }

    [Fact]
    public async Task Guardian_CannotAnswerForTheWard()
    {
        var id = await SeedArrangementAsync();
        await AuthenticateAsAdminAsync();

        var response = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/consent-to-guardian", new { assignment_id = id });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "not-yours and not-live are indistinguishable so nobody can probe arrangements");
        (await RowAsync(id)).ApprovedAt.Should().BeNull();
    }

    [Fact]
    public async Task Withdraw_ResetsPowers_AndCancelsOpenActions()
    {
        var id = await SeedArrangementAsync(
            status: AccountRelationship.StatusActive,
            tiers: new() { ["listings"] = SupportTiers.CoDecide });
        int openActionId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var action = new SupportPendingAction
            {
                TenantId = TestData.Tenant1.Id,
                RelationshipId = id,
                SupportedUserId = TestData.MemberUser.Id,
                SupporterUserId = TestData.AdminUser.Id,
                ActionType = SupportPendingAction.TypeListingCreate,
                Payload = "{\"title\":\"open ask\"}",
                Status = SupportPendingAction.StatusPending,
                TokenHash = SupportPendingActionService.HashToken(SupportPendingActionService.NewToken()),
                ExpiresAt = DateTime.UtcNow.AddDays(14),
                CreatedAt = DateTime.UtcNow
            };
            db.SupportPendingActions.Add(action);
            await db.SaveChangesAsync();
            openActionId = action.Id;
        }

        await AuthenticateAsMemberAsync();
        var withdraw = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/withdraw-guardian-consent",
            new { assignment_id = id, reason = "  I changed my mind  " });

        withdraw.StatusCode.Should().Be(HttpStatusCode.OK);
        var row = await RowAsync(id);
        row.WithdrawnAt.Should().NotBeNull();
        row.ApprovedAt.Should().BeNull("withdrawing nulls the consent timestamp");
        row.Status.Should().Be(AccountRelationship.StatusPending,
            "declined/withdrawn keep status pending — revoked is the staff exit only");
        row.ResponseReason.Should().Be("I changed my mind", "the reason is trimmed");
        AccountRelationshipService.ResolvedTiers(row).Values
            .Should().OnlyContain(t => t == SupportTiers.None, "ending consent resets all powers");

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.SupportPendingActions.IgnoreQueryFilters()
            .SingleAsync(a => a.Id == openActionId)).Status.Should().Be("cancelled");
    }

    [Fact]
    public async Task WithdrawWithoutConsent_IsAnInvalidTransition()
    {
        var id = await SeedArrangementAsync();
        await AuthenticateAsMemberAsync();

        var response = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/withdraw-guardian-consent", new { assignment_id = id });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        (await ReadJsonAsync(response)).GetProperty("errors")[0].GetProperty("message")
            .GetString().Should().Be("That response is not available for this arrangement.");
    }

    [Fact]
    public async Task MalformedAssignmentId_Is422WithTheResourceNotFoundMessage()
    {
        await AuthenticateAsMemberAsync();
        var response = await Client.PostAsJsonAsync(
            "/api/v2/safeguarding/consent-to-guardian", new { assignment_id = "not-a-number" });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var error = (await ReadJsonAsync(response)).GetProperty("errors")[0];
        error.GetProperty("code").GetString().Should().Be("VALIDATION_ERROR");
        error.GetProperty("message").GetString().Should().Be("Resource not found");
        error.GetProperty("field").GetString().Should().Be("assignment_id");
    }

    [Fact]
    public async Task MyWards_IsDeliberatelyMinimal()
    {
        await SeedArrangementAsync(status: AccountRelationship.StatusActive);
        await AuthenticateAsAdminAsync();

        var response = await Client.GetAsync("/api/v2/safeguarding/my-wards");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var ward = (await ReadJsonAsync(response)).GetProperty("data").GetProperty("wards")[0];
        ward.GetProperty("ward_name").GetString().Should().NotBeNullOrEmpty();
        ward.GetProperty("state").GetString().Should().Be("consented");
        ward.TryGetProperty("tiers", out _).Should().BeFalse();
        ward.TryGetProperty("notes", out _).Should().BeFalse();
        ward.TryGetProperty("ward_response_reason", out _).Should().BeFalse();
    }

    [Fact]
    public async Task Ward_GrantsAndTakesBackTiers_MessagesSilentlyStripped()
    {
        var id = await SeedArrangementAsync(status: AccountRelationship.StatusActive);
        await AuthenticateAsMemberAsync();

        var grant = await Client.PostAsJsonAsync("/api/v2/safeguarding/guardian-permissions",
            new { assignment_id = id, tiers = new { listings = "co_decide", messages = "assist" } });
        grant.StatusCode.Should().Be(HttpStatusCode.OK);
        var tiers = (await ReadJsonAsync(grant)).GetProperty("data").GetProperty("tiers");
        tiers.GetProperty("listings").GetString().Should().Be("co_decide");
        tiers.GetProperty("messages").GetString().Should().Be("none",
            "staff-recorded guardians never hold messages; the key is stripped silently");

        var messagesOnly = await Client.PostAsJsonAsync("/api/v2/safeguarding/guardian-permissions",
            new { assignment_id = id, tiers = new { messages = "assist" } });
        messagesOnly.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "with messages stripped the payload is empty");

        var takeBack = await Client.PostAsJsonAsync("/api/v2/safeguarding/guardian-permissions",
            new { assignment_id = id, tiers = new { listings = "none" } });
        takeBack.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(takeBack)).GetProperty("data").GetProperty("tiers")
            .GetProperty("listings").GetString().Should().Be("none");
    }

    [Fact]
    public async Task TierGrant_OnUnconsentedArrangement_Is404_AndNoOpWritesNoHistory()
    {
        var id = await SeedArrangementAsync();
        await AuthenticateAsMemberAsync();
        (await Client.PostAsJsonAsync("/api/v2/safeguarding/guardian-permissions",
            new { assignment_id = id, tiers = new { listings = "co_decide" } }))
            .StatusCode.Should().Be(HttpStatusCode.NotFound,
                "an unconsented arrangement grants nothing");

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            await db.AccountRelationships.IgnoreQueryFilters()
                .Where(r => r.Id == id)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(r => r.Status, AccountRelationship.StatusActive)
                    .SetProperty(r => r.ApprovedAt, DateTime.UtcNow));
        }

        // Setting none over none is a no-op success that writes no history.
        (await Client.PostAsJsonAsync("/api/v2/safeguarding/guardian-permissions",
            new { assignment_id = id, tiers = new { listings = "none" } }))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.AccountRelationshipEvents.IgnoreQueryFilters()
            .CountAsync(e => e.RelationshipId == id && e.Action == "permissions_changed"))
            .Should().Be(0, "a no-op writes no history");
    }

    // ─── Authority attestations ─────────────────────────────────────

    private async Task<int> SeedRepresentRelationshipAsync()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var relationship = new AccountRelationship
        {
            TenantId = TestData.Tenant1.Id,
            ParentUserId = TestData.AdminUser.Id,
            ChildUserId = TestData.MemberUser.Id,
            RelationshipType = "carer",
            Permissions = AccountRelationshipService.StorePermissions(
                new Dictionary<string, string> { ["credits"] = SupportTiers.Represent }),
            Status = AccountRelationship.StatusActive,
            ApprovedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.AccountRelationships.Add(relationship);
        await db.SaveChangesAsync();
        return relationship.Id;
    }

    [Fact]
    public async Task Attestation_RefusesEvidenceFields_AndRequiresAcknowledgement()
    {
        var relationshipId = await SeedRepresentRelationshipAsync();
        await AuthenticateAsAdminAsync();

        var withEvidence = await Client.PostAsJsonAsync(
            "/api/v2/admin/safeguarding/authority-attestations",
            new
            {
                relationship_id = relationshipId,
                authority_type = "power_of_attorney",
                acknowledged_sighted = true,
                certificate_number = "EPA-1234"
            });
        withEvidence.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var evidenceError = (await ReadJsonAsync(withEvidence)).GetProperty("errors")[0];
        evidenceError.GetProperty("field").GetString().Should().Be("certificate_number");

        var unacknowledged = await Client.PostAsJsonAsync(
            "/api/v2/admin/safeguarding/authority-attestations",
            new { relationship_id = relationshipId, authority_type = "power_of_attorney" });
        unacknowledged.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.SupportAuthorityAttestations.IgnoreQueryFilters().AnyAsync())
            .Should().BeFalse("refused attestations write nothing");
    }

    [Fact]
    public async Task Attest_Revoke_ReAttest_ReusesOneRowWithFullHistory()
    {
        var relationshipId = await SeedRepresentRelationshipAsync();
        await AuthenticateAsAdminAsync();

        var attest = await Client.PostAsJsonAsync(
            "/api/v2/admin/safeguarding/authority-attestations",
            new
            {
                relationship_id = relationshipId,
                authority_type = "power_of_attorney",
                acknowledged_sighted = true,
                scope_summary = "Financial decisions only."
            });
        attest.StatusCode.Should().Be(HttpStatusCode.OK);
        var attestationId = (await ReadJsonAsync(attest)).GetProperty("data").GetProperty("id").GetInt64();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var row = await db.SupportAuthorityAttestations.IgnoreQueryFilters()
                .SingleAsync(a => a.Id == attestationId);
            row.ScopeSummaryEncrypted.Should().NotBeNull();
            row.ScopeSummaryEncrypted.Should().NotContain("Financial",
                "free text is encrypted at rest");
        }

        var badReason = await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/authority-attestations/{attestationId}/revoke",
            new { reason_code = "because" });
        badReason.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "revocation reasons are a closed vocabulary");

        var revoke = await Client.PostAsJsonAsync(
            $"/api/v2/admin/safeguarding/authority-attestations/{attestationId}/revoke",
            new { reason_code = "authority_ended" });
        revoke.StatusCode.Should().Be(HttpStatusCode.OK);

        var reAttest = await Client.PostAsJsonAsync(
            "/api/v2/admin/safeguarding/authority-attestations",
            new
            {
                relationship_id = relationshipId,
                authority_type = "power_of_attorney",
                acknowledged_sighted = true
            });
        reAttest.StatusCode.Should().Be(HttpStatusCode.OK);

        using var verifyScope = Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await verifyDb.SupportAuthorityAttestations.IgnoreQueryFilters().CountAsync())
            .Should().Be(1, "re-attestation reuses the row");
        var events = await verifyDb.SupportAuthorityAttestationEvents.IgnoreQueryFilters()
            .OrderBy(e => e.Id).Select(e => e.EventType).ToListAsync();
        events.Should().Equal("attested", "revoked", "re_attested");

        // Revocation never touched the relationship's tiers.
        var relationship = await verifyDb.AccountRelationships.IgnoreQueryFilters()
            .SingleAsync(r => r.Id == relationshipId);
        AccountRelationshipService.ResolvedTiers(relationship)["credits"]
            .Should().Be(SupportTiers.Represent, "an attestation is a record, never authorisation");
    }

    [Fact]
    public async Task AttestationList_FiltersToRepresent_AndDecryptsScope()
    {
        var relationshipId = await SeedRepresentRelationshipAsync();
        await AuthenticateAsAdminAsync();
        (await Client.PostAsJsonAsync("/api/v2/admin/safeguarding/authority-attestations",
            new
            {
                relationship_id = relationshipId,
                authority_type = "dmr_court_order",
                acknowledged_sighted = true,
                scope_summary = "Court-appointed representative."
            })).StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await Client.GetAsync("/api/v2/admin/safeguarding/authority-attestations");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var relationships = (await ReadJsonAsync(list)).GetProperty("data").GetProperty("relationships");
        relationships.GetArrayLength().Should().Be(1);
        var attestation = relationships[0].GetProperty("attestations")[0];
        attestation.GetProperty("scope_summary").GetString()
            .Should().Be("Court-appointed representative.", "the list decrypts the scope");
        relationships[0].GetProperty("attestations")[0]
            .TryGetProperty("private_notes", out _).Should().BeFalse("private notes are never returned");

        (await Client.PostAsJsonAsync("/api/v2/admin/safeguarding/authority-attestations",
            new { relationship_id = 999999, authority_type = "dmr_court_order", acknowledged_sighted = true }))
            .StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
                "attest NOT_FOUND is returned as 422, never 404");
    }

    [Fact]
    public async Task OrdinaryMember_CannotTouchAttestations()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/v2/admin/safeguarding/authority-attestations"))
            .StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
