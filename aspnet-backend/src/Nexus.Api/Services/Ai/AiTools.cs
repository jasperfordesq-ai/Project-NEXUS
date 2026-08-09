// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;

namespace Nexus.Api.Services.Ai;

/// <summary>
/// Provider-agnostic shape of a tool definition. Each implementation
/// translates this to the wire format expected by its target API
/// (OpenAI's "functions" array, Anthropic's "tools" array, etc.).
/// </summary>
public record AiToolDefinition(string Name, string Description, JsonElement ParametersSchema);

/// <summary>One invocation request emitted by the model.</summary>
public record AiToolCall(string CallId, string Name, string ArgumentsJson);

/// <summary>One invocation result fed back to the model.</summary>
public record AiToolResult(string CallId, string Name, string ResultJson, bool IsError = false);

/// <summary>
/// One turn in a multi-turn conversation. Either a user/assistant message
/// or a batch of tool calls / tool results.
/// </summary>
public record AiTurn(
    string Role,
    string? Content,
    IReadOnlyList<AiToolCall>? ToolCalls = null,
    IReadOnlyList<AiToolResult>? ToolResults = null);

/// <summary>The single round-trip result of one <c>ChatAsync</c> call.</summary>
public record AiChatResult(
    string? Content,
    IReadOnlyList<AiToolCall> ToolCalls,
    int InputTokens,
    int OutputTokens,
    string ProviderName,
    string Model);
