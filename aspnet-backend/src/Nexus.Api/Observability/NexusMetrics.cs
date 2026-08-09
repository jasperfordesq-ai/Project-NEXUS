// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics.Metrics;

namespace Nexus.Api.Observability;

/// <summary>
/// Custom OpenTelemetry meter + instruments for Nexus.Api.
/// Meter name "Nexus.Api" is the source registered by the OTel pipeline in Program.cs.
/// </summary>
public static class NexusMetrics
{
    public const string MeterName = "Nexus.Api";

    public static readonly Meter Meter = new(MeterName, "1.0.0");

    /// <summary>
    /// Count of exchanges that reached the Completed state (with successful credit transfer).
    /// Tag: tenant_id.
    /// </summary>
    public static readonly Counter<long> ExchangesCompleted =
        Meter.CreateCounter<long>(
            name: "nexus.exchanges.completed",
            unit: "{exchange}",
            description: "Number of exchanges completed with credit transfer.");

    /// <summary>
    /// Count of wallet credit transfers that succeeded.
    /// Tag: tenant_id.
    /// </summary>
    public static readonly Counter<long> WalletTransfers =
        Meter.CreateCounter<long>(
            name: "nexus.wallet.transfers",
            unit: "{transfer}",
            description: "Number of wallet credit transfers that succeeded.");

    /// <summary>
    /// Duration of the CompleteExchangeAsync code path in seconds.
    /// Explicit buckets cover 10ms..30s.
    /// </summary>
    public static readonly Histogram<double> ExchangeCompletionDuration =
        Meter.CreateHistogram<double>(
            name: "nexus.exchange.completion.duration",
            unit: "s",
            description: "Duration of ExchangeService.CompleteExchangeAsync (success path) in seconds.");

    /// <summary>
    /// Explicit histogram buckets matching the latency range we care about for exchanges.
    /// Used via ExplicitBucketHistogramConfiguration in the OTel pipeline.
    /// </summary>
    public static readonly double[] DurationBucketsSeconds =
    {
        0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30
    };
}
