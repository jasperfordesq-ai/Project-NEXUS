// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Production-readiness round 7 — tests for the request correlation
 * middleware and the new /api/admin/system/diagnostics endpoint.
 */

using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Nexus.Api.Services.Scheduled;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

[Collection("Integration")]
public class RequestCorrelationAndDiagnosticsTests : IntegrationTestBase
{
    public RequestCorrelationAndDiagnosticsTests(NexusWebApplicationFactory factory) : base(factory) { }

    // ─── Correlation middleware ───────────────────────────────────────────

    [Fact]
    public async Task RequestCorrelation_NoIncomingHeader_ServerGeneratesAndReturnsId()
    {
        ClearAuthToken();
        var resp = await Client.GetAsync("/health");
        // HTTP header names are case-insensitive (RFC 7230 §3.2). Use TryGetValues
        // rather than ContainKey on the underlying dictionary.
        resp.Headers.TryGetValues("X-Request-Id", out var values).Should().BeTrue();
        var id = values?.FirstOrDefault();
        id.Should().NotBeNullOrEmpty();
        // Server-generated ids are GUID-N (32 hex chars).
        id!.Length.Should().Be(32);
        id.Should().MatchRegex("^[0-9a-f]{32}$");
    }

    [Fact]
    public async Task RequestCorrelation_IncomingHeader_PassedThroughVerbatim()
    {
        ClearAuthToken();
        using var req = new HttpRequestMessage(HttpMethod.Get, "/health");
        req.Headers.TryAddWithoutValidation("X-Request-Id", "trace-from-upstream-12345");
        var resp = await Client.SendAsync(req);
        resp.Headers.GetValues("X-Request-Id").Should().Contain("trace-from-upstream-12345");
    }

    [Fact]
    public async Task RequestCorrelation_FallbackHeader_AlsoAccepted()
    {
        ClearAuthToken();
        using var req = new HttpRequestMessage(HttpMethod.Get, "/health");
        req.Headers.TryAddWithoutValidation("X-Correlation-Id", "alt-trace-id");
        var resp = await Client.SendAsync(req);
        resp.Headers.GetValues("X-Request-Id").Should().Contain("alt-trace-id");
    }

    [Fact]
    public async Task RequestCorrelation_SanitizesControlChars()
    {
        ClearAuthToken();
        using var req = new HttpRequestMessage(HttpMethod.Get, "/health");
        // ASCII tab (\t) + newline (\n) should be stripped; surviving printable chars kept.
        req.Headers.TryAddWithoutValidation("X-Request-Id", "abc\t123\nXYZ");
        var resp = await Client.SendAsync(req);
        var id = resp.Headers.GetValues("X-Request-Id").First();
        id.Should().Be("abc123XYZ");
    }

    // ─── Diagnostics endpoint ─────────────────────────────────────────────

    [Fact]
    public async Task Diagnostics_AsAdmin_ReturnsVerdictPayload()
    {
        await AuthenticateAsAdminAsync();
        var resp = await Client.GetAsync("/api/admin/system/diagnostics");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadAsStringAsync();
        body.Should().Contain("\"verdict\"");
        body.Should().Contain("\"database\"");
        body.Should().Contain("\"hosted_services\"");
        body.Should().Contain("\"external_services\"");
        body.Should().Contain("\"process\"");
    }

    [Fact]
    public async Task Diagnostics_Member_Returns403()
    {
        await AuthenticateAsMemberAsync();
        var resp = await Client.GetAsync("/api/admin/system/diagnostics");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Diagnostics_Anonymous_Returns401()
    {
        ClearAuthToken();
        var resp = await Client.GetAsync("/api/admin/system/diagnostics");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ─── ScheduledJobsRegistry ─────────────────────────────────────────────

    [Fact]
    public void ScheduledJobsRegistry_RecordsLifecycle()
    {
        var registry = Factory.Services.GetRequiredService<ScheduledJobsRegistry>();
        registry.RecordStart("TestJobA");
        registry.RecordSuccess("TestJobA", TimeSpan.FromMilliseconds(123));

        var snapshot = registry.Snapshot();
        var entry = snapshot.FirstOrDefault(j => j.JobName == "TestJobA");
        entry.Should().NotBeNull();
        entry!.Status.Should().Be("idle");
        entry.LastDurationMs.Should().BeApproximately(123, 1);
        entry.ConsecutiveFailures.Should().Be(0);
    }

    [Fact]
    public void ScheduledJobsRegistry_ConsecutiveFailures_Increment()
    {
        var registry = Factory.Services.GetRequiredService<ScheduledJobsRegistry>();
        registry.RecordFailure("TestJobB", new InvalidOperationException("first"));
        registry.RecordFailure("TestJobB", new InvalidOperationException("second"));
        registry.RecordFailure("TestJobB", new InvalidOperationException("third"));

        var entry = registry.Snapshot().First(j => j.JobName == "TestJobB");
        entry.Status.Should().Be("failing");
        entry.ConsecutiveFailures.Should().Be(3);
        entry.LastFailureMessage.Should().Be("third");
    }

    [Fact]
    public void ScheduledJobsRegistry_SuccessAfterFailure_ResetsCounter()
    {
        var registry = Factory.Services.GetRequiredService<ScheduledJobsRegistry>();
        registry.RecordFailure("TestJobC", new InvalidOperationException("bad"));
        registry.RecordFailure("TestJobC", new InvalidOperationException("bad again"));
        registry.RecordSuccess("TestJobC", TimeSpan.FromMilliseconds(10));

        var entry = registry.Snapshot().First(j => j.JobName == "TestJobC");
        entry.Status.Should().Be("idle");
        entry.ConsecutiveFailures.Should().Be(0, "success must reset the consecutive failure counter");
    }

    // ─── /diagnostics/probe + /sentry-test ─────────────────────────────────

    [Fact]
    public async Task Probe_AsAdmin_ReturnsResultPerExternalService()
    {
        await AuthenticateAsAdminAsync();
        var resp = await Client.GetAsync("/api/admin/system/diagnostics/probe");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await resp.Content.ReadAsStringAsync();
        body.Should().Contain("\"probes\"");
        // Each probe row carries the exact contract the page renders.
        body.Should().Contain("\"name\":\"database\"");
        body.Should().Contain("\"name\":\"stripe\"");
        body.Should().Contain("\"name\":\"ai_active_provider\"");
        body.Should().Contain("\"name\":\"sendgrid_reachable\"");
        body.Should().Contain("\"latency_ms\"");
    }

    [Fact]
    public async Task Probe_Member_Returns403()
    {
        await AuthenticateAsMemberAsync();
        var resp = await Client.GetAsync("/api/admin/system/diagnostics/probe");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task SentryTest_AsAdminWithoutDsn_Returns400WithGuidance()
    {
        // Test fixture doesn't configure Sentry:Dsn → endpoint should refuse
        // gracefully with a hint rather than silently no-op.
        await AuthenticateAsAdminAsync();
        var resp = await Client.PostAsync("/api/admin/system/diagnostics/sentry-test", new StringContent(""));
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await resp.Content.ReadAsStringAsync();
        body.Should().Contain("sentry_dsn_not_configured");
    }
}
