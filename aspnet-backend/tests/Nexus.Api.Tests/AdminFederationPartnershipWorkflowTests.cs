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
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class AdminFederationPartnershipWorkflowTests : IntegrationTestBase
{
    public AdminFederationPartnershipWorkflowTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task CanonicalActions_RequireAdminAuthentication()
    {
        ClearAuthToken();
        var anonymous = await Client.PostAsJsonAsync(
            "/api/v2/admin/federation/partnerships/1/approve",
            new { });
        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await AuthenticateAsMemberAsync();
        var member = await Client.PostAsJsonAsync(
            "/api/v2/admin/federation/partnerships/1/reject",
            new { });
        member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Receiver_CanListAndApproveIncomingPendingPartnership_WithAuditAndNotification()
    {
        var scenario = await PrepareIncomingAsync();
        await AuthenticateAsReceiverAdminAsync(scenario.ReceiverAdminEmail);

        var listResponse = await Client.GetAsync("/api/v2/admin/federation/partnerships");
        listResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var list = await ReadJsonAsync(listResponse);
        list.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();
        var row = list.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == scenario.PartnershipId);
        row.GetProperty("status").GetString().Should().Be("pending");
        row.GetProperty("tenant_id").GetInt32().Should().Be(TestData.Tenant1.Id);
        row.GetProperty("partner_tenant_id").GetInt32().Should().Be(TestData.Tenant2.Id);
        row.GetProperty("partner_name").GetString().Should().Be(TestData.Tenant1.Name);

        var response = await Client.PostAsJsonAsync(
            $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/approve",
            new { });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await ReadJsonAsync(response);
        body.GetProperty("data").GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        body.GetProperty("meta").GetProperty("base_url").GetString().Should().NotBeNullOrWhiteSpace();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.FederationPartners.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.PartnershipId);
        stored.Status.Should().Be(PartnerStatus.Active);
        stored.ApprovedById.Should().Be(scenario.ReceiverAdminId);
        stored.ApprovedAt.Should().NotBeNull();

        var audit = await db.FederationAuditLogs.IgnoreQueryFilters()
            .SingleAsync(row =>
                row.EntityId == scenario.PartnershipId &&
                row.Action == "partnership_approved");
        audit.TenantId.Should().Be(TestData.Tenant2.Id);
        audit.PartnerTenantId.Should().Be(TestData.Tenant1.Id);

        var notification = await db.Notifications.IgnoreQueryFilters()
            .SingleAsync(row =>
                row.UserId == TestData.AdminUser.Id &&
                row.Type == "federation_partnership_approved" &&
                row.Data != null &&
                row.Data.Contains($"\"partnership_id\":{scenario.PartnershipId}"));
        notification.TenantId.Should().Be(TestData.Tenant1.Id);
    }

    [Fact]
    public async Task SenderCannotDecide_AndMissingPartnershipUsesCanonicalErrors()
    {
        var scenario = await PrepareIncomingAsync();

        await AuthenticateAsAdminAsync();
        var senderResponse = await Client.PostAsJsonAsync(
            $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/approve",
            new { });
        senderResponse.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var senderBody = await ReadJsonAsync(senderResponse);
        senderBody.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("APPROVE_FAILED");

        await AuthenticateAsReceiverAdminAsync(scenario.ReceiverAdminEmail);
        var missingResponse = await Client.PostAsJsonAsync(
            "/api/v2/admin/federation/partnerships/2147483000/reject",
            new { });
        missingResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var missingBody = await ReadJsonAsync(missingResponse);
        missingBody.GetProperty("errors")[0].GetProperty("code").GetString()
            .Should().Be("REJECT_FAILED");
    }

    [Fact]
    public async Task Receiver_CanRejectOnce_WithReasonAuditAndNotification()
    {
        var scenario = await PrepareIncomingAsync();
        await AuthenticateAsReceiverAdminAsync(scenario.ReceiverAdminEmail);

        var first = await Client.PostAsJsonAsync(
            $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/reject",
            new { reason = "Not aligned with our safeguarding policy" });
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        var second = await Client.PostAsJsonAsync(
            $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/reject",
            new { reason = "duplicate" });
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.FederationPartners.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.PartnershipId);
        stored.Status.Should().Be(PartnerStatus.Rejected);

        var audits = await db.FederationAuditLogs.IgnoreQueryFilters()
            .Where(row =>
                row.EntityId == scenario.PartnershipId &&
                row.Action == "partnership_rejected")
            .ToListAsync();
        audits.Should().ContainSingle();
        audits[0].TenantId.Should().Be(TestData.Tenant2.Id);
        audits[0].PartnerTenantId.Should().Be(TestData.Tenant1.Id);
        audits[0].Details.Should().Contain("Not aligned with our safeguarding policy");

        var notifications = await db.Notifications.IgnoreQueryFilters()
            .Where(row =>
                row.UserId == TestData.AdminUser.Id &&
                row.Type == "federation_partnership_rejected" &&
                row.Data != null &&
                row.Data.Contains($"\"partnership_id\":{scenario.PartnershipId}"))
            .ToListAsync();
        notifications.Should().ContainSingle();
    }

    [Fact]
    public async Task ConcurrentApprovals_HaveOneWinnerAndOneSideEffectSet()
    {
        var scenario = await PrepareIncomingAsync();
        await AuthenticateAsReceiverAdminAsync(scenario.ReceiverAdminEmail);

        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync(
                $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/approve",
                new { }),
            Client.PostAsJsonAsync(
                $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/approve",
                new { }));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.FederationAuditLogs.IgnoreQueryFilters().CountAsync(row =>
            row.EntityId == scenario.PartnershipId &&
            row.Action == "partnership_approved")).Should().Be(1);
        (await db.Notifications.IgnoreQueryFilters().CountAsync(row =>
            row.UserId == TestData.AdminUser.Id &&
            row.Type == "federation_partnership_approved" &&
            row.Data != null &&
            row.Data.Contains($"\"partnership_id\":{scenario.PartnershipId}"))).Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentApproveAndReject_CommitExactlyOneDecisionAndMatchingSideEffects()
    {
        var scenario = await PrepareIncomingAsync();
        await AuthenticateAsReceiverAdminAsync(scenario.ReceiverAdminEmail);

        var responses = await Task.WhenAll(
            Client.PostAsJsonAsync(
                $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/approve",
                new { }),
            Client.PostAsJsonAsync(
                $"/api/v2/admin/federation/partnerships/{scenario.PartnershipId}/reject",
                new { reason = "Competing decision" }));

        responses.Select(response => response.StatusCode)
            .Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.FederationPartners.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == scenario.PartnershipId);
        stored.Status.Should().BeOneOf(PartnerStatus.Active, PartnerStatus.Rejected);

        var audits = await db.FederationAuditLogs.IgnoreQueryFilters()
            .Where(row =>
                row.EntityId == scenario.PartnershipId &&
                (row.Action == "partnership_approved" || row.Action == "partnership_rejected"))
            .ToListAsync();
        audits.Should().ContainSingle();
        audits[0].Action.Should().Be(
            stored.Status == PartnerStatus.Active
                ? "partnership_approved"
                : "partnership_rejected");

        var notifications = await db.Notifications.IgnoreQueryFilters()
            .Where(row =>
                row.UserId == TestData.AdminUser.Id &&
                (row.Type == "federation_partnership_approved" ||
                 row.Type == "federation_partnership_rejected") &&
                row.Data != null &&
                row.Data.Contains($"\"partnership_id\":{scenario.PartnershipId}"))
            .ToListAsync();
        notifications.Should().ContainSingle();
        notifications[0].Type.Should().Be(
            stored.Status == PartnerStatus.Active
                ? "federation_partnership_approved"
                : "federation_partnership_rejected");
    }

    private async Task<IncomingScenario> PrepareIncomingAsync()
    {
        var receiverAdminEmail = $"federation-receiver-{Guid.NewGuid():N}@test.local";

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var existing = await db.FederationPartners.IgnoreQueryFilters()
            .Where(row =>
                (row.TenantId == TestData.Tenant1.Id && row.PartnerTenantId == TestData.Tenant2.Id) ||
                (row.TenantId == TestData.Tenant2.Id && row.PartnerTenantId == TestData.Tenant1.Id))
            .ToListAsync();
        db.FederationPartners.RemoveRange(existing);

        var receiverAdmin = new User
        {
            TenantId = TestData.Tenant2.Id,
            Email = receiverAdminEmail,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(TestDataSeeder.TestPassword),
            FirstName = "Federation",
            LastName = "Receiver",
            Role = "admin",
            IsAdmin = true,
            IsActive = true,
            RegistrationStatus = RegistrationStatus.Active,
            CreatedAt = DateTime.UtcNow
        };
        db.Users.Add(receiverAdmin);
        await db.SaveChangesAsync();

        var partnership = new FederationPartner
        {
            TenantId = TestData.Tenant1.Id,
            PartnerTenantId = TestData.Tenant2.Id,
            Status = PartnerStatus.Pending,
            SharedListings = true,
            SharedEvents = true,
            SharedMembers = false,
            CreditExchangeRate = 1m,
            RequestedById = TestData.AdminUser.Id,
            CreatedAt = DateTime.UtcNow
        };
        db.FederationPartners.Add(partnership);
        await db.SaveChangesAsync();

        return new IncomingScenario(partnership.Id, receiverAdmin.Id, receiverAdminEmail);
    }

    private async Task AuthenticateAsReceiverAdminAsync(string email)
    {
        SetAuthToken(await GetAccessTokenAsync(email, TestData.Tenant2.Slug));
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private sealed record IncomingScenario(
        int PartnershipId,
        int ReceiverAdminId,
        string ReceiverAdminEmail);
}
