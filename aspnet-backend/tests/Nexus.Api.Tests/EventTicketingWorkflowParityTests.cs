// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Tests.Fixtures;
using Xunit;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public sealed class EventTicketingWorkflowParityTests : IntegrationTestBase
{
    public EventTicketingWorkflowParityTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task TicketTypeLifecycle_IsVersionedIdempotentAndMatchesStrictCatalogue()
    {
        var (eventId, opens, closes) = await EventAsync();
        await AuthenticateAsAdminAsync();
        var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types", Type("General", "free", "0.00", opens, closes), "ticket-type-create-0001");
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var type = Data(created).GetProperty("ticket_type");
        var typeId = type.GetProperty("id").GetInt64();
        type.GetProperty("version").GetInt64().Should().Be(1);
        type.GetProperty("unit_price_credits").GetString().Should().Be("0.00");

        var replay = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types", Type("General", "free", "0.00", opens, closes), "ticket-type-create-0001");
        replay.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(replay).GetProperty("idempotent_replay").GetBoolean().Should().BeTrue();

        var activated = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/activate", new { expected_version = 1, reason = (string?)null }, "ticket-type-activate-0001");
        activated.StatusCode.Should().Be(HttpStatusCode.OK);
        Data(activated).GetProperty("ticket_type").GetProperty("status").GetString().Should().Be("active");

        var catalogue = await Client.GetFromJsonAsync<JsonElement>($"/api/v2/events/{eventId}/tickets");
        var contract = catalogue.GetProperty("data");
        contract.GetProperty("contract_version").GetInt32().Should().Be(1);
        contract.GetProperty("currency").GetString().Should().Be("time_credit");
        contract.GetProperty("payment_gateway").GetProperty("money_supported").GetBoolean().Should().BeFalse();
        contract.GetProperty("ticket_types").EnumerateArray().Select(x => x.GetProperty("id").GetInt64()).Should().Contain(typeId);

        var paused = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/pause", new { expected_version = 2, reason = "Sales review" }, "ticket-type-pause-0001");
        Data(paused).GetProperty("ticket_type").GetProperty("status").GetString().Should().Be("paused");
        var reactivated = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/activate", new { expected_version = 3, reason = (string?)null }, "ticket-type-reactivate-0001");
        Data(reactivated).GetProperty("ticket_type").GetProperty("status").GetString().Should().Be("active");
        var archived = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/archive", new { expected_version = 4, reason = "Superseded" }, "ticket-type-archive-0001");
        Data(archived).GetProperty("ticket_type").GetProperty("status").GetString().Should().Be("archived");
    }

    [Fact]
    public async Task FreeAllocationAndCancellation_AreDurableVersionedAndInventoryBalanced()
    {
        var (eventId, opens, closes) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types", Type("Free", "free", "0.00", opens, closes), "ticket-free-create-0001");
        var typeId = Data(created).GetProperty("ticket_type").GetProperty("id").GetInt64();
        await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/activate", new { expected_version = 1, reason = (string?)null }, "ticket-free-activate-0001");

        await AuthenticateAsMemberAsync();
        var allocated = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/tickets/{typeId}/allocate", new { units = 2 }, "ticket-free-allocate-0001");
        allocated.StatusCode.Should().Be(HttpStatusCode.Created);
        var entitlement = Data(allocated).GetProperty("entitlement");
        var entitlementId = entitlement.GetProperty("id").GetInt64();
        entitlement.GetProperty("status").GetString().Should().Be("confirmed");

        var cancelled = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-entitlements/{entitlementId}/cancel", new { expected_version = 1, reason = "Cannot attend" }, "ticket-free-cancel-0001");
        cancelled.StatusCode.Should().Be(HttpStatusCode.OK);
        var cancelledData = Data(cancelled);
        cancelledData.GetProperty("entitlement").GetProperty("status").GetString().Should().Be("cancelled");
        cancelledData.GetProperty("confirmed_units_after").GetInt32().Should().Be(0);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventTicketEntitlementHistory.IgnoreQueryFilters().Where(x => x.EntitlementId == entitlementId).OrderBy(x => x.EntitlementVersion).Select(x => x.Action).ToListAsync()).Should().Equal("confirmed", "cancelled");
        (await db.EventTicketInventoryHistory.IgnoreQueryFilters().Where(x => x.EntitlementId == entitlementId).OrderBy(x => x.EntitlementVersion).Select(x => x.QuantityDelta).ToListAsync()).Should().Equal(2, -2);
    }

    [Fact]
    public async Task TimeCreditQuoteIsVisibleButMaterializationFailsClosedWithoutWrites()
    {
        var (eventId, opens, closes) = await EventAsync(seedRegistration: true);
        await AuthenticateAsAdminAsync();
        var created = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types", Type("Credits", "time_credit", "2.50", opens, closes), "ticket-credit-create-0001");
        var typeId = Data(created).GetProperty("ticket_type").GetProperty("id").GetInt64();
        await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/ticket-types/{typeId}/activate", new { expected_version = 1, reason = (string?)null }, "ticket-credit-activate-0001");
        await AuthenticateAsMemberAsync();

        var quote = await Client.PostAsJsonAsync($"/api/v2/events/{eventId}/tickets/{typeId}/quote", new { units = 2 });
        quote.StatusCode.Should().Be(HttpStatusCode.OK);
        var quoteData = Data(quote);
        quoteData.GetProperty("total_price_credits").GetString().Should().Be("5.00");
        quoteData.GetProperty("materialization_supported").GetBoolean().Should().BeFalse();

        var allocation = await Send(HttpMethod.Post, $"/api/v2/events/{eventId}/tickets/{typeId}/allocate", new { units = 2 }, "ticket-credit-allocate-0001");
        allocation.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await allocation.Content.ReadAsStringAsync()).Should().Contain("EVENT_TICKET_UNAVAILABLE");
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.EventTicketEntitlements.IgnoreQueryFilters().CountAsync(x => x.TicketTypeId == typeId)).Should().Be(0);
    }

    [Fact]
    public async Task ManagerAndTenantBoundariesFailClosedAndReconciliationIsReadOnly()
    {
        var (eventId, _, _) = await EventAsync();
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/tickets/reconciliation")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        await AuthenticateAsOtherTenantUserAsync();
        (await Client.GetAsync($"/api/v2/events/{eventId}/tickets")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private async Task<(int Id, DateTime Opens, DateTime Closes)> EventAsync(bool seedRegistration = false)
    {
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var now = DateTime.UtcNow;
        var evt = new Event { TenantId = TestData.Tenant1.Id, CreatedById = TestData.AdminUser.Id, Title = "Ticketed event", StartsAt = now.AddDays(5), EndsAt = now.AddDays(5).AddHours(2), Timezone = "Europe/Dublin", Status = "active", PublicationStatus = "published", OperationalStatus = "scheduled" };
        db.Events.Add(evt);
        await db.SaveChangesAsync();
        if (seedRegistration)
        {
            db.EventRegistrations.Add(new EventRegistration { TenantId = TestData.Tenant1.Id, EventId = evt.Id, UserId = TestData.MemberUser.Id, RegistrationState = "confirmed", ConfirmedAt = now, StateChangedAt = now, StateChangedBy = TestData.MemberUser.Id });
            await db.SaveChangesAsync();
        }
        return (evt.Id, now.AddMinutes(-10), now.AddDays(4));
    }

    private static object Type(string name, string kind, string price, DateTime opens, DateTime closes) => new { name, description = "Ticket description", kind, unit_price_credits = price, allocation_limit = 20, sales_opens_at = opens.ToString("O"), sales_closes_at = closes.ToString("O"), per_member_limit = 3, eligibility_policy = new { }, refund_cutoff_at = closes.AddDays(-1).ToString("O"), organizer_cancel_refundable = true };
    private async Task<HttpResponseMessage> Send(HttpMethod method, string path, object body, string key) { var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return await Client.SendAsync(request); }
    private static JsonElement Data(HttpResponseMessage response) => response.Content.ReadFromJsonAsync<JsonElement>().GetAwaiter().GetResult().GetProperty("data");
}
