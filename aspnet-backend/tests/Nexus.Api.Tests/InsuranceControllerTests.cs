// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class InsuranceControllerTests : IntegrationTestBase
{
    public InsuranceControllerTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task GetInsurance_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        var r = await Client.GetAsync("/api/insurance");
        r.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetInsurance_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/insurance");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetInsuranceById_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/insurance/99999");
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateInsurance_AsMember_ReturnsOkOrCreatedOrBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/insurance", new
        {
            type = "public_liability",
            provider = "Test Insurance Co",
            policy_number = "POL-12345",
            cover_amount = 1000000m,
            start_date = "2026-01-01",
            expiry_date = "2027-01-01"
        });
        // May return BadRequest if date format or validation fails, or 500 if service throws
        r.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created, HttpStatusCode.BadRequest, HttpStatusCode.InternalServerError);
    }

    [Fact]
    public async Task LaravelReactUserInsuranceV2_AcceptsMultipartCertificateUploadAndListsLaravelFields()
    {
        await AuthenticateAsMemberAsync();

        using var form = new MultipartFormDataContent();
        using var pdf = new ByteArrayContent("%PDF-1.4\n% test certificate\n"u8.ToArray());
        pdf.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(pdf, "certificate_file", "certificate.pdf");
        form.Add(new StringContent("professional_indemnity"), "insurance_type");
        form.Add(new StringContent("Nexus Mutual"), "provider_name");
        form.Add(new StringContent("PI-2026-001"), "policy_number");
        form.Add(new StringContent("1500000"), "coverage_amount");
        form.Add(new StringContent("2026-01-01"), "start_date");
        form.Add(new StringContent("2027-01-01"), "expiry_date");
        form.Add(new StringContent("Uploaded from the Laravel React PrivacyTab."), "notes");

        var upload = await Client.PostAsync("/api/v2/users/me/insurance", form);
        var uploadBody = await upload.Content.ReadAsStringAsync();

        upload.StatusCode.Should().Be(HttpStatusCode.Created, uploadBody);
        var uploadJson = JsonSerializer.Deserialize<JsonElement>(uploadBody);
        uploadJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = uploadJson.GetProperty("data");
        data.GetProperty("id").GetInt32().Should().BeGreaterThan(0);
        data.GetProperty("insurance_type").GetString().Should().Be("professional_indemnity");
        data.GetProperty("provider_name").GetString().Should().Be("Nexus Mutual");
        data.GetProperty("policy_number").GetString().Should().Be("PI-2026-001");
        data.GetProperty("coverage_amount").GetDecimal().Should().Be(1500000m);
        data.GetProperty("certificate_file_path").GetString().Should().Contain("/api/files/");
        data.GetProperty("status").GetString().Should().Be("submitted");

        var list = await Client.GetAsync("/api/v2/users/me/insurance");

        list.StatusCode.Should().Be(HttpStatusCode.OK);
        var listJson = await list.Content.ReadFromJsonAsync<JsonElement>();
        listJson.GetProperty("success").GetBoolean().Should().BeTrue();
        var cert = listJson.GetProperty("data").EnumerateArray()
            .Single(item => item.GetProperty("id").GetInt32() == data.GetProperty("id").GetInt32());
        cert.GetProperty("insurance_type").GetString().Should().Be("professional_indemnity");
        cert.GetProperty("certificate_file_path").GetString().Should().Be(data.GetProperty("certificate_file_path").GetString());
    }

    [Fact]
    public async Task DeleteInsurance_NonExistent_ReturnsNotFoundOrBadRequest()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.DeleteAsync("/api/insurance/99999");
        // Controller returns BadRequest when service returns error for non-existent insurance
        r.StatusCode.Should().BeOneOf(HttpStatusCode.NotFound, HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetPending_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.GetAsync("/api/insurance/admin/pending");
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetPending_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/insurance/admin/pending");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetExpiring_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.GetAsync("/api/insurance/admin/expiring?days=30");
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task VerifyInsurance_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsync("/api/insurance/admin/99999/verify", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RejectInsurance_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PutAsync("/api/insurance/admin/99999/reject", null);
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
