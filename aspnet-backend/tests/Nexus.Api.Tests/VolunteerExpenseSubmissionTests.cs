// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
/// Submitting a volunteering expense claim.
///
/// 🔴 The LIST already read the real store while the SUBMIT wrote an opaque
/// blob into tenant config — so a volunteer submitted a claim, was told
/// "Expense submitted", and their own list stayed empty while no reviewer saw
/// it. It could not have worked in any case: the handler took a JSON body while
/// the screen sends multipart form data with a receipt.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerExpenseSubmissionTests : IntegrationTestBase
{
    public VolunteerExpenseSubmissionTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static MultipartFormDataContent Claim(
        string amount = "12.34",
        string description = "Bus fare to the community garden",
        string expenseType = "travel",
        bool withReceipt = true)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(amount), "amount" },
            { new StringContent(description), "description" },
            { new StringContent(expenseType), "expense_type" },
            { new StringContent("EUR"), "currency" },
        };

        if (withReceipt)
        {
            var file = new ByteArrayContent(Encoding.UTF8.GetBytes("%PDF-1.4 receipt"));
            file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(file, "receipt", "receipt.pdf");
        }

        return form;
    }

    [Fact]
    public async Task ASubmittedClaim_AppearsInTheVolunteersOwnList()
    {
        await AuthenticateAsMemberAsync();

        var submit = await Client.PostAsync("/api/v2/volunteering/expenses", Claim());
        submit.StatusCode.Should().Be(HttpStatusCode.OK,
            "the old handler took a JSON body while the screen sends multipart, so it never bound");

        var list = await Client.GetAsync("/api/v2/volunteering/expenses");
        list.StatusCode.Should().Be(HttpStatusCode.OK);
        (await list.Content.ReadAsStringAsync())
            .Should().Contain("Bus fare to the community garden",
                "the claim went into a config blob before, so this list stayed empty");
    }

    [Fact]
    public async Task AClaimIsSubmitted_NeverApproved()
    {
        await AuthenticateAsMemberAsync();

        var submit = await Client.PostAsync("/api/v2/volunteering/expenses", Claim(amount: "9.99"));
        var id = (await submit.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var stored = await db.Set<VolunteerExpense>().IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(e => e.Id == id);

        stored.Status.Should().Be(VolunteerExpenseStatus.Submitted,
            "approval is a reviewer's decision, and money moves on the back of it");
        stored.Amount.Should().Be(9.99m);
        stored.ReceiptUrl.Should().NotBeNullOrWhiteSpace("the receipt is the evidence for the claim");
    }

    [Fact]
    public async Task AClaimWithoutAnAmountOrDescription_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        var noAmount = new MultipartFormDataContent
        {
            { new StringContent("Something"), "description" },
        };
        (await Client.PostAsync("/api/v2/volunteering/expenses", noAmount))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var noDescription = new MultipartFormDataContent
        {
            { new StringContent("10.00"), "amount" },
        };
        (await Client.PostAsync("/api/v2/volunteering/expenses", noDescription))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest,
                "a reviewer cannot approve a claim that does not say what it is for");
    }

    [Fact]
    public async Task AnImpossibleAmount_IsRefused()
    {
        await AuthenticateAsMemberAsync();

        foreach (var amount in new[] { "0", "-4.00", "250000" })
        {
            (await Client.PostAsync("/api/v2/volunteering/expenses", Claim(amount: amount, withReceipt: false)))
                .StatusCode.Should().Be(HttpStatusCode.BadRequest,
                    $"{amount} would reach a reimbursement queue for someone to explain");
        }
    }

    [Fact]
    public async Task AClaimWithoutAReceipt_IsStillAccepted()
    {
        await AuthenticateAsMemberAsync();

        var submit = await Client.PostAsync("/api/v2/volunteering/expenses", Claim(withReceipt: false));
        submit.StatusCode.Should().Be(HttpStatusCode.OK,
            "not every expense has a receipt, and refusing the claim outright would push people "
            + "to submit nothing rather than submit it unevidenced");

        var id = (await submit.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("data").GetProperty("id").GetInt32();

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await db.Set<VolunteerExpense>().IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == id))
            .ReceiptUrl.Should().BeNull("and the absence must be visible to the reviewer, not faked");
    }

    [Fact]
    public async Task OneVolunteersClaims_AreNotListedForAnother()
    {
        await AuthenticateAsMemberAsync();
        await Client.PostAsync("/api/v2/volunteering/expenses",
            Claim(description: "Private claim detail", withReceipt: false));

        await AuthenticateAsOtherTenantUserAsync();
        var theirs = await Client.GetAsync("/api/v2/volunteering/expenses");
        (await theirs.Content.ReadAsStringAsync()).Should().NotContain("Private claim detail");
    }
}
