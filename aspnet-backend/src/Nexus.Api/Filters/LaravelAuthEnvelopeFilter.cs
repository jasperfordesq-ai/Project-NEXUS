// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Nexus.Api.Filters;

/// <summary>
/// Gives every 401 the same body Laravel sends.
///
/// 🔴 Why this exists. This backend had THREE different 401 envelopes depending
/// on how each endpoint happened to be protected:
///
/// <list type="number">
/// <item><description>Policy-protected endpoints —
/// <c>NexusAuthorizationResultHandler</c> already wrote Laravel's
/// <c>{"errors":[{"code","message"}],"success":false}</c>. Correct.</description></item>
/// <item><description>Actions returning a bare <c>Unauthorized()</c> — rendered
/// as RFC ProblemDetails: <c>{"type","title","status","traceId"}</c>.</description></item>
/// <item><description>Actions returning <c>Unauthorized(new { error = "..." })</c>
/// — a third shape again.</description></item>
/// </list>
///
/// A client that branches on the error envelope cannot treat those as the same
/// failure, and the React client does branch on it (it reads
/// <c>errors[0].code</c>). Found by diffing the accessible frontend's paths
/// against both backends: seven endpoints differed from Laravel purely in the
/// shape of their 401.
///
/// This runs as an always-run result filter rather than as middleware because
/// rewriting a response body after the fact is fragile — the same technique that
/// made <c>SurnamePrivacyMiddleware</c> quietly rename groups. Replacing the
/// result before it executes keeps the change inside MVC, where it can be
/// reasoned about.
///
/// 🔴 It deliberately does NOT touch a 401 that already carries an
/// <c>errors</c> array, so the policy handler's richer messages ("Admin access
/// required", "God access required") survive untouched.
/// </summary>
public sealed class LaravelAuthEnvelopeFilter : IAlwaysRunResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (DeclaresOwnContract(context))
        {
            return;
        }

        switch (context.Result)
        {
            case UnauthorizedResult:
                context.Result = Envelope();
                return;

            case UnauthorizedObjectResult existing:
                // Leave anything already in Laravel's shape alone.
                if (!AlreadyLaravelShaped(existing.Value))
                {
                    context.Result = Envelope();
                }
                return;

            case ObjectResult { StatusCode: StatusCodes.Status401Unauthorized } other:
                if (!AlreadyLaravelShaped(other.Value))
                {
                    context.Result = Envelope();
                }
                return;
        }
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
        // Nothing to do once the result has run.
    }

    /// <summary>
    /// True when the body already carries Laravel's <c>errors</c> array, so the
    /// policy handler's richer messages ("Admin access required") survive.
    /// </summary>
    private static bool AlreadyLaravelShaped(object? value)
        => value?.GetType().GetProperty("errors") is not null;

    /// <summary>
    /// True when the endpoint declares its errors are its own contract.
    ///
    /// 🔴 Declared, never inferred. Two attempts to infer it from the response
    /// body failed in opposite directions: keying on `errors` overwrote the
    /// prerender control plane's machine envelope, and keying on `code` then
    /// spared group-exchanges, which Laravel DOES serve with the errors shape.
    /// No property of a body distinguishes them — the real question is whether
    /// Laravel serves that interface, which only a human knows.
    /// </summary>
    private static bool DeclaresOwnContract(FilterContext context)
        => context.ActionDescriptor.EndpointMetadata.OfType<OwnErrorContractAttribute>().Any();
    private static ObjectResult Envelope() => new(new
    {
        errors = new[]
        {
            new { code = "auth_required", message = "Authentication required" },
        },
        success = false,
    })
    {
        StatusCode = StatusCodes.Status401Unauthorized,
    };
}
