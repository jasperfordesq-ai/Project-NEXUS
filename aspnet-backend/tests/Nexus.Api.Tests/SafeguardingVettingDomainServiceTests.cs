// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class SafeguardingVettingDomainServiceTests : IntegrationTestBase
{
    public SafeguardingVettingDomainServiceTests(NexusWebApplicationFactory factory)
        : base(factory) { }

    [Fact]
    public void PresetCatalog_MatchesCanonicalCountrySpecificTranslationKeys()
    {
        AssertPreset(
            "ireland",
            "safeguarding.presets.common.options.is_vulnerable_adult.label",
            "safeguarding.presets.ireland.options.requires_coordinator_contact.description",
            "safeguarding.presets.common.options.works_with_vulnerable_adults.label",
            "safeguarding.presets.ireland.options.works_with_vulnerable_adults.description");
        AssertPreset(
            "england_wales",
            "safeguarding.presets.common.options.is_vulnerable_adult.label",
            "safeguarding.presets.common.options.requires_coordinator_contact.description",
            "safeguarding.presets.common.options.works_with_vulnerable_adults.label",
            "safeguarding.presets.england_wales.options.works_with_children.description");
        AssertPreset(
            "scotland",
            "safeguarding.presets.scotland.options.is_vulnerable_adult.label",
            "safeguarding.presets.common.options.requires_coordinator_contact.description",
            "safeguarding.presets.scotland.options.works_with_vulnerable_adults.label",
            "safeguarding.presets.scotland.options.works_with_children.description");
        AssertPreset(
            "northern_ireland",
            "safeguarding.presets.common.options.is_vulnerable_adult.label",
            "safeguarding.presets.common.options.requires_coordinator_contact.description",
            "safeguarding.presets.common.options.works_with_vulnerable_adults.label",
            "safeguarding.presets.northern_ireland.options.works_with_children.description");
    }

    [Fact]
    public async Task CurrentPolicyWorkflow_IsIdempotentAppendOnlyAndNeverUsesLegacyVettingAuthority()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var interactions = scope.ServiceProvider.GetRequiredService<SafeguardingInteractionPolicy>();
        var tenantId = TestData.Tenant1.Id;

        await jurisdictions.ConfigureAsync(tenantId, "england_wales", TestData.AdminUser.Id);
        var protectedOption = await db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleAsync(option => option.TenantId == tenantId
                && option.OptionKey == "requires_vetted_partners");
        db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
        {
            TenantId = tenantId,
            UserId = TestData.AdminUser.Id,
            OptionId = protectedOption.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        db.VettingRecords.Add(new VettingRecord
        {
            TenantId = tenantId,
            UserId = TestData.MemberUser.Id,
            VettingType = "dbs_enhanced",
            Status = "verified",
            VerifiedById = TestData.AdminUser.Id,
            VerifiedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var legacyOnly = await interactions.EvaluateLocalContactAsync(
            TestData.MemberUser.Id,
            TestData.AdminUser.Id,
            tenantId);
        legacyOnly.Code.Should().Be("VETTING_REQUIRED");

        var first = await attestations.ConfirmForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        var repeat = await attestations.ConfirmForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        repeat.Id.Should().Be(first.Id);
        (await db.MemberVettingAttestationEvents.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == tenantId && row.UserId == TestData.MemberUser.Id))
            .Should().Be(1, "an idempotent current-policy confirmation appends no duplicate event");
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .IsAllowed.Should().BeTrue();

        await attestations.RevokeForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        await attestations.RevokeForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        (await db.MemberVettingAttestationEvents.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == tenantId && row.UserId == TestData.MemberUser.Id))
            .Should().Be(2, "an idempotent revocation appends no duplicate event");
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("VETTING_REQUIRED");

        await attestations.ConfirmForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        (await db.MemberVettingAttestationEvents.IgnoreQueryFilters()
                .CountAsync(row => row.TenantId == tenantId && row.UserId == TestData.MemberUser.Id))
            .Should().Be(3);
    }

    [Fact]
    public async Task ReviewRotationAndLivePreferenceReads_FailClosedWithoutTriggerSynchronization()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var interactions = scope.ServiceProvider.GetRequiredService<SafeguardingInteractionPolicy>();
        var tenantId = TestData.Tenant1.Id;

        await jurisdictions.ConfigureAsync(tenantId, "england_wales", TestData.AdminUser.Id);
        var option = await db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == tenantId && row.OptionKey == "requires_vetted_partners");
        var preference = new UserSafeguardingPreference
        {
            TenantId = tenantId,
            UserId = TestData.AdminUser.Id,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.UserSafeguardingPreferences.Add(preference);
        await db.SaveChangesAsync();

        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("VETTING_REQUIRED");
        preference.RevokedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .IsAllowed.Should().BeTrue("the evaluator reads live preferences and has no trigger-cache activation dependency");
        preference.RevokedAt = null;
        await db.SaveChangesAsync();

        await attestations.ConfirmForCurrentPolicyAsync(
            tenantId,
            TestData.MemberUser.Id,
            TestData.AdminUser.Id);
        var requested = await attestations.RequestReviewAsync(tenantId, TestData.MemberUser.Id);
        var duplicate = await attestations.RequestReviewAsync(tenantId, TestData.MemberUser.Id);
        duplicate.Id.Should().Be(requested.Id);
        Func<Task> invalidResolution = () => attestations.ResolveReviewAsync(
            tenantId,
            requested.Id,
            TestData.AdminUser.Id,
            "confirmed");
        await invalidResolution.Should().ThrowAsync<SafeguardingPolicyException>()
            .WithMessage("INVALID_VETTING_REVIEW_RESOLUTION");

        var review = await db.SafeguardingVettingReviewRequests.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == tenantId && row.Id == requested.Id);
        var historicalCreatedAt = DateTime.UtcNow.AddDays(-7);
        review.CreatedAt = historicalCreatedAt;
        await db.SaveChangesAsync();
        var before = await jurisdictions.GetPolicyAsync(tenantId);
        var rotation = await jurisdictions.RotatePolicyVersionAsync(
            tenantId,
            TestData.AdminUser.Id,
            "scheduled_review");
        rotation.AffectedMemberCount.Should().Be(1);
        rotation.Policy.PolicyVersion.Should().NotBe(before.PolicyVersion);
        await db.Entry(review).ReloadAsync();
        review.CreatedAt.Should().NotBeNull();
        review.CreatedAt!.Value.Should().BeAfter(historicalCreatedAt,
            "Laravel updateOrInsert refreshes created_at when rotation reuses a review row");
        review.RequestSource.Should().Be("policy_rotation");
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("VETTING_REQUIRED", "the old policy version cannot authorize after rotation");
    }

    [Fact]
    public async Task ListMembers_PrioritizesPendingReviewsBeforePagination()
    {
        using var scope = Factory.Services.CreateScope();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var tenantId = TestData.Tenant1.Id;

        await jurisdictions.ConfigureAsync(tenantId, "england_wales", TestData.AdminUser.Id);
        await attestations.RequestReviewAsync(tenantId, TestData.MemberUser.Id);

        var firstPage = await attestations.ListMembersAsync(
            tenantId,
            status: null,
            search: null,
            page: 1,
            perPage: 1);

        firstPage.Data.Should().ContainSingle();
        firstPage.Data.Single().UserId.Should().Be(TestData.MemberUser.Id,
            "pending-review priority must be applied by the database before Skip/Take");
        firstPage.Data.Single().ReviewStatus.Should().Be(SafeguardingVettingReviewRequest.PendingStatus);
    }

    [Fact]
    public async Task MemberVisibility_IncludesSuspendedAndPendingButExcludesDeactivated()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var attestations = scope.ServiceProvider.GetRequiredService<MemberVettingAttestationService>();
        var tenantId = TestData.Tenant1.Id;
        db.Users.AddRange(
            TestMember("suspended-vetting@test.local", false, RegistrationStatus.Active, DateTime.UtcNow),
            TestMember("pending-vetting@test.local", false, RegistrationStatus.PendingAdminReview, null),
            TestMember("deactivated-vetting@test.local", false, RegistrationStatus.Active, null));
        await db.SaveChangesAsync();

        var result = await attestations.ListMembersAsync(tenantId, perPage: 100);

        result.Data.Select(row => row.Email).Should().Contain("suspended-vetting@test.local");
        result.Data.Select(row => row.Email).Should().Contain("pending-vetting@test.local");
        result.Data.Select(row => row.Email).Should().NotContain("deactivated-vetting@test.local");

        User TestMember(
            string email,
            bool isActive,
            RegistrationStatus registrationStatus,
            DateTime? suspendedAt) => new()
        {
            TenantId = tenantId,
            Email = email,
            PasswordHash = TestData.MemberUser.PasswordHash,
            FirstName = "Vetting",
            LastName = "Visibility",
            Role = "member",
            IsActive = isActive,
            RegistrationStatus = registrationStatus,
            SuspendedAt = suspendedAt,
            CreatedAt = DateTime.UtcNow
        };
    }

    [Fact]
    public async Task UnavailablePolicyTransition_PreservesSelectedProtectionAndMarksReview()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        var interactions = scope.ServiceProvider.GetRequiredService<SafeguardingInteractionPolicy>();
        var tenantId = TestData.Tenant1.Id;

        await jurisdictions.ConfigureAsync(tenantId, "england_wales", TestData.AdminUser.Id);
        var option = await db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == tenantId && row.OptionKey == "requires_vetted_partners");
        var preference = new UserSafeguardingPreference
        {
            TenantId = tenantId,
            UserId = TestData.AdminUser.Id,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        db.UserSafeguardingPreferences.Add(preference);
        await db.SaveChangesAsync();

        var changed = await jurisdictions.ConfigureAsync(
            tenantId,
            "custom",
            TestData.AdminUser.Id);
        changed.Policy.ContactPolicyAvailable.Should().BeFalse();
        changed.PreferenceTransition.Preserved.Should().Contain("requires_vetted_partners");
        changed.PreferenceTransition.Deactivated.Should().NotContain("requires_vetted_partners");
        await db.Entry(option).ReloadAsync();
        await db.Entry(preference).ReloadAsync();
        option.IsActive.Should().BeTrue();
        preference.RevokedAt.Should().BeNull();
        preference.PolicyReviewRequiredAt.Should().NotBeNull();
        preference.PolicyReviewReasonCode.Should().Be("jurisdiction_changed");
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("SAFEGUARDING_POLICY_UNAVAILABLE");
    }

    [Fact]
    public async Task HistoricalTruthyTriggerEncoding_RemainsProtectiveLikeLaravel()
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var jurisdictions = scope.ServiceProvider.GetRequiredService<SafeguardingJurisdictionService>();
        var interactions = scope.ServiceProvider.GetRequiredService<SafeguardingInteractionPolicy>();
        var tenantId = TestData.Tenant1.Id;

        await jurisdictions.ConfigureAsync(tenantId, "england_wales", TestData.AdminUser.Id);
        var option = await db.SafeguardingOptions.IgnoreQueryFilters()
            .SingleAsync(row => row.TenantId == tenantId && row.OptionKey == "requires_vetted_partners");
        option.TriggersJson = """{"requires_vetted_interaction":"true","vetting_type_required":"dbs_enhanced"}""";
        db.UserSafeguardingPreferences.Add(new UserSafeguardingPreference
        {
            TenantId = tenantId,
            UserId = TestData.AdminUser.Id,
            OptionId = option.Id,
            SelectedValue = "true",
            ConsentGivenAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("VETTING_REQUIRED",
                "Laravel treats a non-empty historical string trigger as enabled");

        option.TriggersJson = """{"restricts_messaging":1}""";
        await db.SaveChangesAsync();
        (await interactions.EvaluateLocalContactAsync(
                TestData.MemberUser.Id,
                TestData.AdminUser.Id,
                tenantId))
            .Code.Should().Be("SAFEGUARDING_CONTACT_RESTRICTED",
                "Laravel treats a non-zero historical numeric trigger as enabled");
    }

    private static void AssertPreset(
        string preset,
        string vulnerableLabel,
        string coordinatorDescription,
        string vulnerableProviderLabel,
        string vulnerableProviderDescription)
    {
        var options = SafeguardingVettingCatalog.PresetOptions(preset)
            .ToDictionary(option => option.OptionKey);
        options.Keys.Should().BeEquivalentTo(
            "is_vulnerable_adult",
            "requires_vetted_partners",
            "requires_coordinator_contact",
            "no_home_visits",
            "works_with_children",
            "works_with_vulnerable_adults",
            "none_apply");
        options["is_vulnerable_adult"].Label.Should().Be(vulnerableLabel);
        options["requires_coordinator_contact"].Description.Should().Be(coordinatorDescription);
        options["works_with_vulnerable_adults"].Label.Should().Be(vulnerableProviderLabel);
        options["works_with_vulnerable_adults"].Description.Should().Be(vulnerableProviderDescription);
    }
}
