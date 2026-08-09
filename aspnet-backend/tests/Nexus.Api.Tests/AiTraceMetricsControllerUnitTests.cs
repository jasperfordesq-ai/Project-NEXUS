// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Controllers;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Tests;

public class AiTraceMetricsControllerUnitTests
{
    [Fact]
    public async Task TraceMetrics_ReturnsLaravelStyleTenantScopedAiTraceRollup()
    {
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(42);
        await using var db = CreateDbContext(tenantContext);
        var now = DateTime.UtcNow;

        db.AiRequestAuditLogs.AddRange(
            new AiRequestAuditLog
            {
                TenantId = 42,
                Provider = "openai",
                Model = "gpt-4o-mini",
                InputTokens = 1000,
                OutputTokens = 500,
                LatencyMs = 120,
                ToolsInvoked = "search,summarize,search",
                CreatedAt = now.AddDays(-1)
            },
            new AiRequestAuditLog
            {
                TenantId = 42,
                Provider = "openai",
                Model = "gpt-4o",
                InputTokens = 2000,
                OutputTokens = 1000,
                LatencyMs = 80,
                ToolsInvoked = "lookup",
                CreatedAt = now.AddDays(-2)
            },
            new AiRequestAuditLog
            {
                TenantId = 42,
                Provider = "openai",
                Model = "gpt-4o",
                InputTokens = 9999,
                OutputTokens = 9999,
                LatencyMs = 999,
                ToolsInvoked = "old_tool",
                CreatedAt = now.AddDays(-40)
            },
            new AiRequestAuditLog
            {
                TenantId = 7,
                Provider = "openai",
                Model = "gpt-4o",
                InputTokens = 9999,
                OutputTokens = 9999,
                LatencyMs = 999,
                ToolsInvoked = "other_tenant",
                CreatedAt = now.AddDays(-1)
            });
        db.AiMessageFeedbacks.AddRange(
            new AiMessageFeedback
            {
                TenantId = 42,
                AiMessageId = 1,
                UserId = 1,
                Score = 1,
                CreatedAt = now.AddDays(-1)
            },
            new AiMessageFeedback
            {
                TenantId = 42,
                AiMessageId = 2,
                UserId = 2,
                Score = -1,
                Comment = "Needs a better answer",
                CreatedAt = now.AddDays(-1)
            },
            new AiMessageFeedback
            {
                TenantId = 7,
                AiMessageId = 3,
                UserId = 3,
                Score = 1,
                CreatedAt = now.AddDays(-1)
            });
        await db.SaveChangesAsync();

        var controller = new AiKnowledgeController(
            db,
            null!,
            null!,
            null!,
            tenantContext,
            NullLogger<AiKnowledgeController>.Instance);
        var action = typeof(AiKnowledgeController).GetMethod(
            "TraceMetrics",
            BindingFlags.Instance | BindingFlags.Public);

        action.Should().NotBeNull("Laravel exposes GET /api/v2/admin/ai-traces/metrics");
        var traceMetricsAction = action ?? throw new InvalidOperationException("TraceMetrics action was not found.");
        traceMetricsAction.GetCustomAttributes<HttpGetAttribute>()
            .Select(attribute => attribute.Template)
            .Should().Contain("/api/admin/ai-traces/metrics");

        var resultTask = (Task<IActionResult>)traceMetricsAction.Invoke(controller, new object?[] { 7, CancellationToken.None })!;
        var result = await resultTask;

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var data = document.RootElement.GetProperty("data");

        data.GetProperty("window_days").GetInt32().Should().Be(7);
        data.GetProperty("turns").GetInt32().Should().Be(2);
        data.GetProperty("tokens_total").GetInt32().Should().Be(4500);
        data.GetProperty("cost_usd").GetDouble().Should().BeApproximately(0.01545, 0.000001);
        data.GetProperty("avg_latency_ms").GetInt32().Should().Be(100);
        data.GetProperty("thumbs_up").GetInt32().Should().Be(1);
        data.GetProperty("thumbs_down").GetInt32().Should().Be(1);

        var topTools = data.GetProperty("top_tools").EnumerateArray().ToArray();
        topTools[0].GetProperty("name").GetString().Should().Be("search");
        topTools[0].GetProperty("calls").GetInt32().Should().Be(2);
        topTools.Select(tool => tool.GetProperty("name").GetString()).Should().NotContain("old_tool");
        topTools.Select(tool => tool.GetProperty("name").GetString()).Should().NotContain("other_tenant");

        var unanswered = data.GetProperty("unanswered").EnumerateArray().ToArray();
        unanswered.Should().ContainSingle();
        unanswered[0].GetProperty("note").GetString().Should().Be("Needs a better answer");
    }

    private static NexusDbContext CreateDbContext(TenantContext tenantContext)
    {
        var options = new DbContextOptionsBuilder<NexusDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new NexusDbContext(options, tenantContext);
    }
}
