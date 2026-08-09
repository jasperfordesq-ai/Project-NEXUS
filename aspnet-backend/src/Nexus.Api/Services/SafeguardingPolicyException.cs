// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

/// <summary>
/// Stable, controller-mappable failure raised by the safeguarding policy domain.
/// </summary>
public sealed class SafeguardingPolicyException : Exception
{
    public SafeguardingPolicyException(string reasonCode, string? message = null, Exception? innerException = null)
        : base(message ?? reasonCode, innerException)
    {
        ReasonCode = reasonCode;
    }

    public string ReasonCode { get; }
}
