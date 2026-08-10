// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.RegularExpressions;

namespace Nexus.Api.Services.Ai;

/// <summary>Result of a safety pass on raw user input.</summary>
public record SafetyVerdict(bool Allowed, string Reason, string SanitisedInput);

/// <summary>
/// Lightweight prompt-injection guard. Strips control characters, caps
/// input length, and rejects messages that look like prompt-injection
/// attempts. Not a silver bullet — defence in depth, plus the orchestrator
/// always re-emits the user message inside &lt;user_message&gt; tags so the
/// model knows to treat it as data.
/// </summary>
public class AiSafetyGuard
{
    private const int MaxChars = 8000;
    private static readonly TimeSpan RegexTimeout = TimeSpan.FromMilliseconds(50);

    private static readonly Regex[] InjectionPatterns = new[]
    {
        new Regex(@"ignore\s+previous\s+instructions", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"disregard\s+(?:above|prior|previous)", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"forget\s+everything", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"you\s+are\s+now\s+a", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"new\s+(?:system|persona|character|role)", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"act\s+as\s+(?:developer|admin|root|jailbroken)", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout),
        new Regex(@"reveal\s+(?:your|the)\s+(?:prompt|instructions|system[-\s]?message)", RegexOptions.IgnoreCase | RegexOptions.Compiled, RegexTimeout)
    };

    public SafetyVerdict Evaluate(string input)
    {
        if (string.IsNullOrEmpty(input)) return new SafetyVerdict(false, "empty_input", string.Empty);

        // Strip control chars, keep \n and \t.
        var sb = new StringBuilder(input.Length);
        foreach (var ch in input)
        {
            if (ch == '\n' || ch == '\t') { sb.Append(ch); continue; }
            if (char.IsControl(ch)) continue;
            sb.Append(ch);
        }
        var cleaned = sb.ToString();
        if (cleaned.Length > MaxChars) cleaned = cleaned.Substring(0, MaxChars);

        try
        {
            foreach (var rx in InjectionPatterns)
            {
                if (rx.IsMatch(cleaned))
                    return new SafetyVerdict(false, $"injection_pattern:{rx}", cleaned);
            }
        }
        catch (RegexMatchTimeoutException)
        {
            return new SafetyVerdict(false, "regex_timeout", cleaned);
        }

        return new SafetyVerdict(true, "ok", cleaned);
    }

    /// <summary>
    /// Wrap the (sanitised) user message in &lt;user_message&gt; tags so the
    /// model can be reliably told to treat it as data, not instructions.
    /// Escapes angle brackets in the body to prevent tag injection.
    /// </summary>
    public static string QuoteForPrompt(string input)
    {
        var escaped = (input ?? string.Empty).Replace("<", "&lt;").Replace(">", "&gt;");
        return $"<user_message>\n{escaped}\n</user_message>";
    }
}
