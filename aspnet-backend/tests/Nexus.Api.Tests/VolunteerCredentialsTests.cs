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
/// A volunteer's credentials (R-27).
///
/// 🔴 There was no table. The only handler stored the uploaded file and
/// recorded nothing about it, and there was no way to list or delete — so a
/// volunteer uploaded their first-aid certificate, was told it worked, and saw
/// an empty list for ever, indistinguishable from having uploaded nothing.
///
/// Two rules carry real weight here and each has its own test: police-check and
/// vetting documents must be refused by the SERVER (the browser refuses them
/// too, but a client-side rule is a suggestion), and one member must never be
/// able to delete another's safeguarding evidence.
/// </summary>
[Collection("Integration")]
public sealed class VolunteerCredentialsTests : IntegrationTestBase
{
    public VolunteerCredentialsTests(NexusWebApplicationFactory factory) : base(factory) { }

    private static MultipartFormDataContent Upload(string type, string? expiresAt = null, string fileName = "cert.pdf")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(type), "credential_type" },
        };
        if (expiresAt is not null) form.Add(new StringContent(expiresAt), "expires_at");
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("%PDF-1.4 fixture"));
        // The upload service checks the declared content type, so a part with
        // none is refused as "not allowed" — which is correct of it.
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", fileName);
        return form;
    }

    private async Task<JsonElement> ListAsync()
    {
        var response = await Client.GetAsync("/api/v2/volunteering/credentials");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("credentials");
    }

    [Fact]
    public async Task UploadingACredential_MakesItAppearInMyList()
    {
        await AuthenticateAsMemberAsync();

        var upload = await Client.PostAsync("/api/v2/volunteering/credentials", Upload("first_aid", "2030-06-01"));
        upload.StatusCode.Should().Be(HttpStatusCode.OK);

        var listed = await ListAsync();
        var mine = listed.EnumerateArray()
            .Where(c => c.GetProperty("type").GetString() == "first_aid")
            .ToList();

        mine.Should().NotBeEmpty("the upload said it worked, so it must be there");
        var credential = mine[0];
        credential.GetProperty("document_name").GetString().Should().Be("cert.pdf");
        credential.GetProperty("expiry_date").GetString().Should().Be("2030-06-01",
            "a certificate expires on a day, not at an instant");
        credential.GetProperty("status").GetString().Should().Be("pending");
        credential.GetProperty("type_label").GetString().Should().Be("First Aid");
    }

    [Fact]
    public async Task PoliceCheckDocuments_AreRefusedByTheServer()
    {
        await AuthenticateAsMemberAsync();

        foreach (var prohibited in new[] { "dbs_enhanced", "garda_vetting", "police_check", "pvg_scotland" })
        {
            var response = await Client.PostAsync("/api/v2/volunteering/credentials", Upload(prohibited));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
                $"'{prohibited}' must never be stored here, and the browser refusing it is only a suggestion");
        }

        var listed = await ListAsync();
        listed.EnumerateArray().Select(c => c.GetProperty("type").GetString())
            .Should().NotContain(t => t == "garda_vetting" || t == "police_check",
                "nothing prohibited may reach the table by any route");
    }

    [Fact]
    public async Task AnExpiredCredential_ReadsAsExpiredEvenThoughNothingSweepsTheTable()
    {
        await AuthenticateAsMemberAsync();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            db.Set<VolunteerCredential>().Add(new VolunteerCredential
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.MemberUser.Id,
                CredentialType = "safeguarding",
                FileName = "lapsed.pdf",
                // Stored as verified, and lapsed yesterday.
                Status = VolunteerCredential.Statuses.Verified,
                ExpiresAt = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
                CreatedAt = DateTime.UtcNow.AddYears(-2),
            });
            await db.SaveChangesAsync();
        }

        var listed = await ListAsync();
        var lapsed = listed.EnumerateArray()
            .Single(c => c.GetProperty("document_name").GetString() == "lapsed.pdf");

        lapsed.GetProperty("status").GetString().Should().Be("expired",
            "nothing sweeps this table, so a lapsed credential would otherwise still read 'verified' — "
            + "and 'verified' is what a coordinator relies on when deciding who may work with children");
    }

    [Fact]
    public async Task OneMember_CannotDeleteAnothersCredential()
    {
        int victimCredentialId;
        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var credential = new VolunteerCredential
            {
                TenantId = TestData.Tenant1.Id,
                UserId = TestData.AdminUser.Id,
                CredentialType = "first_aid",
                FileName = "not-yours.pdf",
                CreatedAt = DateTime.UtcNow,
            };
            db.Set<VolunteerCredential>().Add(credential);
            await db.SaveChangesAsync();
            victimCredentialId = credential.Id;
        }

        await AuthenticateAsMemberAsync();

        var attempt = await Client.DeleteAsync($"/api/v2/volunteering/credentials/{victimCredentialId}");
        attempt.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "404 rather than 403 — the answer must not confirm that someone else's credential exists");

        using var check = Factory.Services.CreateScope();
        var readBack = check.ServiceProvider.GetRequiredService<NexusDbContext>();
        (await readBack.Set<VolunteerCredential>().IgnoreQueryFilters().AsNoTracking()
            .AnyAsync(c => c.Id == victimCredentialId))
            .Should().BeTrue("deleting another member's safeguarding evidence is the whole risk here");
    }

    [Fact]
    public async Task DeletingMyOwnCredential_Works()
    {
        await AuthenticateAsMemberAsync();
        await Client.PostAsync("/api/v2/volunteering/credentials", Upload("food_hygiene"));

        var listed = await ListAsync();
        var id = listed.EnumerateArray()
            .First(c => c.GetProperty("type").GetString() == "food_hygiene")
            .GetProperty("id").GetInt32();

        (await Client.DeleteAsync($"/api/v2/volunteering/credentials/{id}"))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        var after = await ListAsync();
        after.EnumerateArray().Select(c => c.GetProperty("id").GetInt32())
            .Should().NotContain(id);
    }

    [Fact]
    public async Task AnUploadMustSayWhatItIs_AndCarryAFile()
    {
        await AuthenticateAsMemberAsync();

        var typelessFile = new ByteArrayContent(Encoding.UTF8.GetBytes("x"));
        typelessFile.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        var noType = new MultipartFormDataContent { { typelessFile, "file", "cert.pdf" } };
        (await Client.PostAsync("/api/v2/volunteering/credentials", noType))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var noFile = new MultipartFormDataContent
        {
            { new StringContent("first_aid"), "credential_type" },
        };
        (await Client.PostAsync("/api/v2/volunteering/credentials", noFile))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var badDate = Upload("first_aid", "not-a-date");
        (await Client.PostAsync("/api/v2/volunteering/credentials", badDate))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest,
                "an unparseable expiry silently stored as null would make a lapsed certificate look permanent");
    }
}
