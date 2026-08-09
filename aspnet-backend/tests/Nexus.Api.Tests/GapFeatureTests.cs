// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class GapFeatureTests : IntegrationTestBase
{
    public GapFeatureTests(NexusWebApplicationFactory factory) : base(factory) { }

    [Fact]
    public async Task SubmitContact_ValidData_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/contact", new { name="U", email="u@e.com", subject="S", message="M" });
        r.StatusCode.Should().Be(HttpStatusCode.OK);
    }
    [Fact]
    public async Task GetAdminContact_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        (await Client.GetAsync("/api/admin/contact")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetAdminContact_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/admin/contact")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetAdminContact_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/admin/contact")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetAdminContactById_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/admin/contact/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ResolveContact_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        (await Client.PutAsJsonAsync("/api/admin/contact/999999/resolve", new { note="x" })).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteContact_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        (await Client.DeleteAsync("/api/admin/contact/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetEmergencyAlerts_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        (await Client.GetAsync("/api/volunteer/emergency-alerts")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetEmergencyAlerts_AsMember_ReturnsOk()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/volunteer/emergency-alerts")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GetEmergencyAlerts_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/volunteer/emergency-alerts?active_only=false")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task CreateEmergencyAlert_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/volunteer/emergency-alerts", new { title="T", description="D", urgency="high" });
        r.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CreateEmergencyAlert_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/volunteer/emergency-alerts", new { title="Test Alert", description="Integration test", urgency="medium" });
        r.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task GetEmergencyAlert_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/volunteer/emergency-alerts/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ResolveEmergencyAlert_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsAdminAsync();
        (await Client.PutAsJsonAsync("/api/volunteer/emergency-alerts/999999/resolve", new { })).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetMessageAttachments_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        (await Client.GetAsync("/api/messages/1/attachments")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetMessageAttachments_NonExistentMessage_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/messages/999999/attachments")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task AddMessageAttachment_NonExistentMessage_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        var r = await Client.PostAsJsonAsync("/api/messages/999999/attachments", new { file_upload_id=1 });
        r.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteMessageAttachment_NonExistent_ReturnsNotFound()
    {
        await AuthenticateAsMemberAsync();
        (await Client.DeleteAsync("/api/messages/999999/attachments/999999")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task BulkActivate_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/activate", new { user_ids=new[]{1} })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task BulkActivate_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/activate", new { user_ids=new[]{1} })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task BulkActivate_AsPlatformSuperAdmin_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/activate", new { user_ids=new[]{999999} })).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task BulkSuspend_AsPlatformSuperAdmin_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/suspend", new { user_ids=new[]{999999} })).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task BulkDeleteListings_AsPlatformSuperAdmin_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/delete-listings", new { listing_ids=new[]{999999} })).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task BulkAssignRole_AsPlatformSuperAdmin_InvalidRole_ReturnsBadRequest()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        var r = await Client.PostAsJsonAsync("/api/super-admin/bulk/assign-role", new { user_ids=new[]{1}, role="superuser" });
        r.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task BulkAssignRole_AsPlatformSuperAdmin_ValidRole_ReturnsOk()
    {
        await AuthenticateAsPlatformSuperAdminAsync();
        (await Client.PostAsJsonAsync("/api/super-admin/bulk/assign-role", new { user_ids=new[]{999999}, role="member" })).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task HealthMonitor_WithoutAuth_ReturnsUnauthorized()
    {
        ClearAuthToken();
        (await Client.GetAsync("/api/admin/monitor/health")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task HealthMonitor_AsMember_ReturnsForbidden()
    {
        await AuthenticateAsMemberAsync();
        (await Client.GetAsync("/api/admin/monitor/health")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task HealthMonitor_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/admin/monitor/health")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task DatabaseMonitor_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/admin/monitor/database")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SystemMonitor_AsAdmin_ReturnsOk()
    {
        await AuthenticateAsAdminAsync();
        (await Client.GetAsync("/api/admin/monitor/system")).StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
