// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

/// <summary>
/// Safeguarding regressions found by the 2026-08-15 audit and fixed the same day.
/// Each test pins a defect that shipped, so it cannot quietly return:
///   1. a guardian consent token resolved against EVERY community, because the
///      anonymous lookup ran with IgnoreQueryFilters() and no tenant predicate;
///   2. the consent expired 24 hours after it was requested regardless of when
///      the event actually ran, so a guardian's approval lapsed before the event
///      and the minor was blocked;
///   3. a minor could grant their own guardian consent.
/// Laravel's equivalents: EventGuardianConsentService.php:371,382-385 (tenant
/// binding), :196-203 (expiry outlasts the event), :389-400 (self-grant refused).
/// </summary>
[Collection("Integration")]
public sealed class EventGuardianConsentSecurityTests : IntegrationTestBase
{
    public EventGuardianConsentSecurityTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string GuardianEmail = "cross.tenant.guardian@example.test";

    private static string Sha256Hex(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private HttpClient ClientForTenant(int tenantId)
    {
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Tenant-ID", tenantId.ToString());
        return client;
    }

    /// <summary>
    /// The grant endpoint requires an Idempotency-Key; without one every request
    /// is refused as invalid. Omitting it made the security assertions below pass
    /// for the wrong reason until the control test exposed it.
    /// </summary>
    private static Task<HttpResponseMessage> GrantAsync(HttpClient client, string token, string email)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post, "/api/v2/events/safety/guardian-consents/grant")
        {
            Content = JsonContent.Create(new { token, guardian_email = email }),
        };
        request.Headers.Add("Idempotency-Key", $"guardian-grant-{Guid.NewGuid():N}");
        return client.SendAsync(request);
    }

    /// <summary>
    /// Seed a pending consent directly, so the raw token is known to the test.
    /// The real token is emailed and never returned by the API.
    /// </summary>
    private async Task<(string Token, long ConsentId, int MinorUserId)> SeedPendingConsentAsync()
    {
        var token = "nxgc_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();

        var minor = new User
        {
            TenantId = TestData.Tenant1.Id,
            Email = $"minor-{Guid.NewGuid():N}@test.com",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Minor",
            LastName = "Attendee",
            Role = "member",
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow,
        };
        db.Users.Add(minor);
        await db.SaveChangesAsync();

        var consent = new EventGuardianConsent
        {
            TenantId = TestData.Tenant1.Id,
            EventId = 0,
            MinorUserId = minor.Id,
            GuardianEmailCiphertext = "sealed",
            GuardianIdentityCiphertext = "sealed",
            GuardianEmailBlindHash = Sha256Hex(GuardianEmail),
            GuardianLocale = "en",
            RelationshipCode = "parent",
            ConsentTextHash = Sha256Hex("guardian-consent-v1"),
            PolicyBindingHash = Sha256Hex("policy"),
            TokenHash = Sha256Hex(token),
            RequestedByUserId = minor.Id,
            RequestIdempotencyHash = Sha256Hex(Guid.NewGuid().ToString()),
            RequestHash = Sha256Hex("request"),
            Status = "pending",
            ExpiresAt = DateTime.UtcNow.AddDays(20),
        };
        db.EventGuardianConsents.Add(consent);
        await db.SaveChangesAsync();

        return (token, consent.Id, minor.Id);
    }

    [Fact]
    public async Task GuardianConsentToken_IssuedByOneCommunity_IsRefusedByAnother()
    {
        var (token, consentId, _) = await SeedPendingConsentAsync();

        var otherTenant = ClientForTenant(TestData.Tenant2.Id);
        var response = await GrantAsync(otherTenant, token, GuardianEmail);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "a consent token belongs to the community that issued it");
        (await response.Content.ReadAsStringAsync())
            .Should().Contain("EVENT_GUARDIAN_CONSENT_INVALID");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.EventGuardianConsents.IgnoreQueryFilters()
            .SingleAsync(x => x.Id == consentId);
        row.Status.Should().Be("pending", "the cross-tenant attempt must not have granted anything");
    }

    [Fact]
    public async Task Minor_CannotGrantTheirOwnGuardianConsent()
    {
        var (token, consentId, minorUserId) = await SeedPendingConsentAsync();

        // Authenticate as the minor, then present their own consent token.
        var client = ClientForTenant(TestData.Tenant1.Id);
        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = (await MinorEmailAsync(minorUserId)),
            password = TestDataSeeder.TestPassword,
            tenant_slug = TestData.Tenant1.Slug,
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var accessToken = (await login.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("access_token").GetString();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);

        var response = await GrantAsync(client, token, GuardianEmail);

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity,
            "a minor must never approve their own guardian consent");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.EventGuardianConsents.IgnoreQueryFilters()
            .SingleAsync(x => x.Id == consentId);
        row.Status.Should().Be("pending");
    }

    /// <summary>
    /// The control case. Without this the two tests above could pass for the
    /// wrong reason — e.g. if the grant refused every request — and would be
    /// worthless as evidence.
    /// </summary>
    [Fact]
    public async Task GuardianConsentToken_IsAcceptedByTheCommunityThatIssuedIt()
    {
        var (token, consentId, _) = await SeedPendingConsentAsync();

        var issuingTenant = ClientForTenant(TestData.Tenant1.Id);
        var response = await GrantAsync(issuingTenant, token, GuardianEmail);

        response.StatusCode.Should().Be(HttpStatusCode.OK,
            "tenant scoping must not block the legitimate guardian");

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var row = await db.EventGuardianConsents.IgnoreQueryFilters()
            .SingleAsync(x => x.Id == consentId);
        row.Status.Should().Be("active");
    }

    private async Task<string> MinorEmailAsync(int userId)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        return await db.Users.IgnoreQueryFilters()
            .Where(u => u.Id == userId).Select(u => u.Email).SingleAsync();
    }
}
