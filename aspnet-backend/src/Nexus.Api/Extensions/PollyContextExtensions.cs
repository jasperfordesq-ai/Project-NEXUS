// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Polly;

namespace Nexus.Api.Extensions;

/// <summary>
/// Extension methods for Polly Context to support logging.
/// </summary>
public static class PollyContextExtensions
{
    private const string LoggerKey = "ILogger";

    /// <summary>
    /// Gets the logger from the Polly context.
    /// </summary>
    public static ILogger? GetLogger(this Context context)
    {
        if (context.TryGetValue(LoggerKey, out var logger))
        {
            return logger as ILogger;
        }
        return null;
    }

    /// <summary>
    /// Sets the logger in the Polly context.
    /// </summary>
    public static Context WithLogger(this Context context, ILogger logger)
    {
        context[LoggerKey] = logger;
        return context;
    }
}
