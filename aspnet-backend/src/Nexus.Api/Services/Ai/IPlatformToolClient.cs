// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Tool-calling LLM client. Distinct from <see cref="IAiProvider"/> (which
/// is a simple system+user → text shape) because tool use requires a
/// multi-turn message list with assistant tool_calls and tool_results.
/// </summary>
public interface IPlatformToolClient
{
    string Name { get; }
    string Model { get; }
    bool IsConfigured { get; }

    /// <summary>True iff the underlying API natively supports tool calling.</summary>
    bool SupportsTools { get; }

    /// <summary>
    /// Send the full turn list + tool catalogue and return the model's next
    /// response (either text content, tool calls, or both).
    /// </summary>
    Task<AiChatResult> ChatAsync(
        IReadOnlyList<AiTurn> turns,
        IReadOnlyList<AiToolDefinition> tools,
        CancellationToken ct = default);
}

/// <summary>Picks the best available tool client.</summary>
public interface IPlatformToolClientFactory
{
    IPlatformToolClient Resolve();
}
