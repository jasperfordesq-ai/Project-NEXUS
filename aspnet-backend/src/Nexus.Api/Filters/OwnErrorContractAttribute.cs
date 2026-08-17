// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Filters;

/// <summary>
/// Marks a controller or action whose error bodies are its OWN contract and must
/// not be normalised towards Laravel's.
///
/// 🔴 Why this is an explicit marker rather than a clever rule.
/// <see cref="LaravelAuthEnvelopeFilter"/> unifies 401 bodies so the client sees
/// one shape. Twice I tried to infer which responses to leave alone — first "has
/// an <c>errors</c> array", then "has a <c>code</c>" — and both guesses were
/// wrong in a way tests caught:
///
/// <list type="bullet">
/// <item><description>Too narrow, and it overwrote the prerender control
/// plane's <c>{success,error,code:"UNAUTHENTICATED"}</c> — a machine-to-machine
/// contract Laravel does not serve at all.</description></item>
/// <item><description>Too wide, and it spared <c>group-exchanges</c>, a
/// member endpoint that Laravel DOES serve with the <c>errors</c> envelope, so
/// it stayed divergent.</description></item>
/// </list>
///
/// There is no property of a response body that distinguishes those two cases.
/// The real question is "does Laravel serve this interface?", which only a human
/// knows — so it is declared here instead of guessed.
///
/// Apply this ONLY to interfaces with no Laravel counterpart: internal control
/// planes, machine webhooks, signed service-to-service endpoints. If Laravel
/// serves the path, it does not belong here.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class OwnErrorContractAttribute : Attribute
{
}
