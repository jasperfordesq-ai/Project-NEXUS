// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringKpiBaselineService
{
    private static readonly string[] ComparisonKeys =
    [
        "information_distribution_effort_hours",
        "volunteer_hours",
        "member_count",
        "recipient_count",
        "active_relationships",
        "total_exchanges",
        "avg_response_hours",
        "engagement_rate_pct",
        "satisfaction_score"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly NexusDbContext _db;

    public CaringKpiBaselineService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<IReadOnlyList<KpiBaselineRow>> ListBaselinesAsync(int tenantId, CancellationToken ct)
    {
        var rows = await _db.CaringKpiBaselines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row => row.TenantId == tenantId)
            .OrderByDescending(row => row.CapturedAt)
            .ThenByDescending(row => row.Id)
            .ToListAsync(ct);

        return rows.Select(RowToDto).ToArray();
    }

    public async Task<KpiBaselineRow> CaptureBaselineAsync(
        int tenantId,
        int? adminUserId,
        JsonElement payload,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var label = ReadString(payload, "label")?.Trim();
        if (string.IsNullOrWhiteSpace(label))
        {
            label = $"Baseline {now:yyyy-MM-dd}";
        }

        var period = ReadPeriod(payload, now);
        var notes = ReadString(payload, "notes");
        if (notes == string.Empty)
        {
            notes = null;
        }

        var metrics = await CaptureCurrentMetricsAsync(tenantId, ct);
        MergeMetricOverrides(metrics, payload);

        var baseline = new CaringKpiBaseline
        {
            TenantId = tenantId,
            Label = label,
            BaselinePeriod = JsonSerializer.Serialize(period, JsonOptions),
            CapturedAt = now,
            Metrics = JsonSerializer.Serialize(metrics, JsonOptions),
            Notes = notes,
            CapturedBy = adminUserId,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.CaringKpiBaselines.Add(baseline);
        await _db.SaveChangesAsync(ct);

        return RowToDto(baseline);
    }

    public async Task<KpiBaselineComparisonResult?> CompareWithBaselineAsync(
        long baselineId,
        int tenantId,
        CancellationToken ct)
    {
        var row = await _db.CaringKpiBaselines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(baseline => baseline.Id == baselineId && baseline.TenantId == tenantId, ct);

        if (row is null)
        {
            return null;
        }

        var baseline = RowToDto(row);
        var baselineMetrics = baseline.Metrics;
        var currentMetrics = await CaptureCurrentMetricsAsync(tenantId, ct);
        var comparison = new Dictionary<string, KpiComparisonMetric>(StringComparer.Ordinal);

        foreach (var key in ComparisonKeys)
        {
            baselineMetrics.TryGetValue(key, out var baselineValue);
            currentMetrics.TryGetValue(key, out var currentValue);
            var delta = baselineValue.HasValue && currentValue.HasValue
                ? Round(currentValue.Value - baselineValue.Value, 2)
                : (decimal?)null;
            var pctChange = delta.HasValue && baselineValue is > 0m
                ? Round((delta.Value / baselineValue.Value) * 100m, 1)
                : (decimal?)null;

            comparison[key] = new KpiComparisonMetric(
                Baseline: baselineValue,
                Current: currentValue,
                Delta: delta,
                PctChange: pctChange);
        }

        var claimTargets = BuildClaimTargets(comparison);

        return new KpiBaselineComparisonResult(
            Baseline: baseline,
            Current: currentMetrics,
            Comparison: comparison,
            PilotClaimTargets: claimTargets,
            AgorisClaimTargets: claimTargets);
    }

    private async Task<Dictionary<string, decimal?>> CaptureCurrentMetricsAsync(int tenantId, CancellationToken ct)
    {
        var rangeStart = DateTime.UtcNow.AddDays(-90);
        var volunteerHours = await VolunteerHoursAsync(tenantId, rangeStart, ct);
        var memberCount = await _db.Users
            .IgnoreQueryFilters()
            .CountAsync(user => user.TenantId == tenantId && user.IsActive, ct);
        var participatingMembers = await CountParticipatingMembersAsync(tenantId, rangeStart, ct);
        var engagementRate = memberCount > 0
            ? Round(((decimal)participatingMembers / memberCount) * 100m, 1)
            : (decimal?)null;
        var relationshipMetrics = await RelationshipMetricsAsync(tenantId, ct);

        return new Dictionary<string, decimal?>(StringComparer.Ordinal)
        {
            ["information_distribution_effort_hours"] = null,
            ["volunteer_hours"] = volunteerHours,
            ["member_count"] = memberCount,
            ["recipient_count"] = relationshipMetrics.RecipientCount,
            ["active_relationships"] = relationshipMetrics.ActiveRelationships,
            ["total_exchanges"] = await _db.Exchanges.IgnoreQueryFilters().CountAsync(e => e.TenantId == tenantId, ct),
            ["avg_response_hours"] = null,
            ["engagement_rate_pct"] = engagementRate,
            ["satisfaction_score"] = null
        };
    }

    private async Task<decimal> VolunteerHoursAsync(int tenantId, DateTime rangeStart, CancellationToken ct)
    {
        if (!await HasColumnsAsync("vol_logs", ["tenant_id", "status", "date_logged", "hours"], ct))
        {
            return 0m;
        }

        return await ScalarDecimalAsync(
            """
            SELECT COALESCE(SUM(hours), 0)
            FROM vol_logs
            WHERE tenant_id = @tenant_id
              AND status = 'approved'
              AND date_logged >= @range_start
            """,
            ct,
            ("tenant_id", tenantId),
            ("range_start", rangeStart)) ?? 0m;
    }

    private async Task<int> CountParticipatingMembersAsync(int tenantId, DateTime rangeStart, CancellationToken ct)
    {
        var ids = new HashSet<int>();

        var transactions = await _db.Transactions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(t => t.TenantId == tenantId
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
                && t.CreatedAt >= rangeStart)
            .Select(t => new { t.SenderId, t.ReceiverId })
            .ToListAsync(ct);

        foreach (var transaction in transactions)
        {
            if (transaction.SenderId.HasValue)
                ids.Add(transaction.SenderId.Value);
            if (transaction.ReceiverId.HasValue)
                ids.Add(transaction.ReceiverId.Value);
        }

        if (await HasColumnsAsync("vol_logs", ["tenant_id", "status", "date_logged", "user_id"], ct))
        {
            foreach (var id in await QueryIntColumnAsync(
                """
                SELECT DISTINCT user_id
                FROM vol_logs
                WHERE tenant_id = @tenant_id
                  AND status = 'approved'
                  AND date_logged >= @range_start
                  AND user_id IS NOT NULL
                """,
                ct,
                ("tenant_id", tenantId),
                ("range_start", rangeStart)))
            {
                ids.Add(id);
            }
        }

        return ids.Count;
    }

    private async Task<(decimal? RecipientCount, decimal? ActiveRelationships)> RelationshipMetricsAsync(
        int tenantId,
        CancellationToken ct)
    {
        if (!await HasColumnsAsync("caring_support_relationships", ["tenant_id", "recipient_id", "status"], ct))
        {
            return (null, null);
        }

        var recipientCount = await ScalarDecimalAsync(
            """
            SELECT COUNT(DISTINCT recipient_id)
            FROM caring_support_relationships
            WHERE tenant_id = @tenant_id
              AND status = 'active'
              AND recipient_id IS NOT NULL
            """,
            ct,
            ("tenant_id", tenantId));
        var activeRelationships = await ScalarDecimalAsync(
            """
            SELECT COUNT(*)
            FROM caring_support_relationships
            WHERE tenant_id = @tenant_id
              AND status = 'active'
            """,
            ct,
            ("tenant_id", tenantId));

        return (recipientCount, activeRelationships);
    }

    private static KpiBaselineRow RowToDto(CaringKpiBaseline row)
    {
        return new KpiBaselineRow(
            Id: row.Id,
            TenantId: row.TenantId,
            Label: row.Label,
            BaselinePeriod: ParseObject(row.BaselinePeriod),
            CapturedAt: FormatDate(row.CapturedAt),
            Metrics: ParseMetrics(row.Metrics),
            Notes: row.Notes,
            CapturedBy: row.CapturedBy,
            CreatedAt: FormatDate(row.CreatedAt),
            UpdatedAt: FormatDate(row.UpdatedAt));
    }

    private static Dictionary<string, string?> ReadPeriod(JsonElement payload, DateTime now)
    {
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty("period", out var period)
            && period.ValueKind == JsonValueKind.Object)
        {
            var output = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var property in period.EnumerateObject())
            {
                output[property.Name] = property.Value.ValueKind == JsonValueKind.Null
                    ? null
                    : property.Value.ToString();
            }

            return output;
        }

        return new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["start"] = now.AddYears(-1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["end"] = now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        };
    }

    private static void MergeMetricOverrides(Dictionary<string, decimal?> metrics, JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("metrics", out var overrides)
            || overrides.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        foreach (var key in ComparisonKeys)
        {
            if (overrides.TryGetProperty(key, out var value))
            {
                metrics[key] = ReadDecimal(value);
            }
        }
    }

    private static string? ReadString(JsonElement payload, string property)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty(property, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static Dictionary<string, string?> ParseObject(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return [];
            }

            var output = new Dictionary<string, string?>(StringComparer.Ordinal);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                output[property.Name] = property.Value.ValueKind == JsonValueKind.Null
                    ? null
                    : property.Value.ToString();
            }

            return output;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static Dictionary<string, decimal?> ParseMetrics(string? raw)
    {
        var output = ComparisonKeys.ToDictionary(key => key, _ => (decimal?)null, StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return output;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return output;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                output[property.Name] = ReadDecimal(property.Value);
            }
        }
        catch (JsonException)
        {
            return output;
        }

        return output;
    }

    private static decimal? ReadDecimal(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
        {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String
            && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static IReadOnlyList<KpiClaimTarget> BuildClaimTargets(
        IReadOnlyDictionary<string, KpiComparisonMetric> comparison)
    {
        return
        [
            new(
                Key: "information_distribution_effort",
                MetricKey: "information_distribution_effort_hours",
                TargetPctChange: -30m,
                TargetDelta: null,
                Direction: "decrease",
                Baseline: comparison["information_distribution_effort_hours"].Baseline,
                Current: comparison["information_distribution_effort_hours"].Current,
                PctChange: comparison["information_distribution_effort_hours"].PctChange,
                Delta: null,
                Achieved: TargetAchieved(comparison["information_distribution_effort_hours"], -30m, "decrease")),
            new(
                Key: "volunteer_engagement",
                MetricKey: "engagement_rate_pct",
                TargetPctChange: 25m,
                TargetDelta: null,
                Direction: "increase",
                Baseline: comparison["engagement_rate_pct"].Baseline,
                Current: comparison["engagement_rate_pct"].Current,
                PctChange: comparison["engagement_rate_pct"].PctChange,
                Delta: null,
                Achieved: TargetAchieved(comparison["engagement_rate_pct"], 25m, "increase")),
            new(
                Key: "satisfaction",
                MetricKey: "satisfaction_score",
                TargetPctChange: null,
                TargetDelta: 0.01m,
                Direction: "increase",
                Baseline: comparison["satisfaction_score"].Baseline,
                Current: comparison["satisfaction_score"].Current,
                PctChange: null,
                Delta: comparison["satisfaction_score"].Delta,
                Achieved: TargetAchieved(comparison["satisfaction_score"], 0.01m, "increase_delta"))
        ];
    }

    private static bool TargetAchieved(KpiComparisonMetric metric, decimal target, string direction)
    {
        if (direction == "increase_delta")
        {
            return metric.Delta.HasValue && metric.Delta.Value >= target;
        }

        if (!metric.PctChange.HasValue)
        {
            return false;
        }

        return direction == "decrease"
            ? metric.PctChange.Value <= target
            : metric.PctChange.Value >= target;
    }

    private async Task<bool> HasColumnsAsync(string tableName, IReadOnlyList<string> columnNames, CancellationToken ct)
    {
        if (!_db.Database.IsRelational())
        {
            return false;
        }

        foreach (var column in columnNames)
        {
            var result = await ScalarObjectAsync(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = ANY (current_schemas(false))
                      AND table_name = @table_name
                      AND column_name = @column_name
                )
                """,
                ct,
                ("table_name", tableName),
                ("column_name", column));

            if (result is not bool exists || !exists)
            {
                return false;
            }
        }

        return true;
    }

    private async Task<decimal?> ScalarDecimalAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        var result = await ScalarObjectAsync(sql, ct, parameters);
        return result switch
        {
            null or DBNull => null,
            decimal value => value,
            double value => (decimal)value,
            float value => (decimal)value,
            int value => value,
            long value => value,
            _ when decimal.TryParse(Convert.ToString(result, CultureInfo.InvariantCulture), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => null
        };
    }

    private async Task<IReadOnlyList<int>> QueryIntColumnAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return [];
        }

        var connection = _db.Database.GetDbConnection();
        await using var _ = await EnsureOpenAsync(connection, ct);
        await using var command = BuildCommand(connection, sql, parameters);
        var output = new List<int>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            if (!reader.IsDBNull(0))
            {
                output.Add(Convert.ToInt32(reader.GetValue(0), CultureInfo.InvariantCulture));
            }
        }

        return output;
    }

    private async Task<object?> ScalarObjectAsync(
        string sql,
        CancellationToken ct,
        params (string Name, object? Value)[] parameters)
    {
        if (!_db.Database.IsRelational())
        {
            return null;
        }

        var connection = _db.Database.GetDbConnection();
        await using var _ = await EnsureOpenAsync(connection, ct);
        await using var command = BuildCommand(connection, sql, parameters);
        return await command.ExecuteScalarAsync(ct);
    }

    private static DbCommand BuildCommand(
        DbConnection connection,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = "@" + name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        return command;
    }

    private static async Task<IAsyncDisposable> EnsureOpenAsync(DbConnection connection, CancellationToken ct)
    {
        if (connection.State == System.Data.ConnectionState.Open)
        {
            return NoopAsyncDisposable.Instance;
        }

        await connection.OpenAsync(ct);
        return new ConnectionCloser(connection);
    }

    private static decimal Round(decimal value, int decimals) =>
        Math.Round(value, decimals, MidpointRounding.AwayFromZero);

    private static string? FormatDate(DateTime? value) =>
        value?.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" or "enabled" => true,
            "false" or "0" or "no" or "off" or "disabled" => false,
            _ => null
        };
    }

    private sealed class ConnectionCloser : IAsyncDisposable
    {
        private readonly DbConnection _connection;

        public ConnectionCloser(DbConnection connection)
        {
            _connection = connection;
        }

        public ValueTask DisposeAsync()
        {
            return new ValueTask(_connection.CloseAsync());
        }
    }

    private sealed class NoopAsyncDisposable : IAsyncDisposable
    {
        public static readonly NoopAsyncDisposable Instance = new();

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

public sealed record KpiBaselineRow(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("tenant_id")] int TenantId,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("baseline_period")] IReadOnlyDictionary<string, string?> BaselinePeriod,
    [property: JsonPropertyName("captured_at")] string? CapturedAt,
    [property: JsonPropertyName("metrics")] IReadOnlyDictionary<string, decimal?> Metrics,
    [property: JsonPropertyName("notes")] string? Notes,
    [property: JsonPropertyName("captured_by")] int? CapturedBy,
    [property: JsonPropertyName("created_at")] string? CreatedAt,
    [property: JsonPropertyName("updated_at")] string? UpdatedAt);

public sealed record KpiBaselineComparisonResult(
    [property: JsonPropertyName("baseline")] KpiBaselineRow Baseline,
    [property: JsonPropertyName("current")] IReadOnlyDictionary<string, decimal?> Current,
    [property: JsonPropertyName("comparison")] IReadOnlyDictionary<string, KpiComparisonMetric> Comparison,
    [property: JsonPropertyName("pilot_claim_targets")] IReadOnlyList<KpiClaimTarget> PilotClaimTargets,
    [property: JsonPropertyName("agoris_claim_targets")] IReadOnlyList<KpiClaimTarget> AgorisClaimTargets);

public sealed record KpiComparisonMetric(
    [property: JsonPropertyName("baseline")] decimal? Baseline,
    [property: JsonPropertyName("current")] decimal? Current,
    [property: JsonPropertyName("delta")] decimal? Delta,
    [property: JsonPropertyName("pct_change")] decimal? PctChange);

public sealed record KpiClaimTarget(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("metric_key")] string MetricKey,
    [property: JsonPropertyName("target_pct_change")] decimal? TargetPctChange,
    [property: JsonPropertyName("target_delta")] decimal? TargetDelta,
    [property: JsonPropertyName("direction")] string Direction,
    [property: JsonPropertyName("baseline")] decimal? Baseline,
    [property: JsonPropertyName("current")] decimal? Current,
    [property: JsonPropertyName("pct_change")] decimal? PctChange,
    [property: JsonPropertyName("delta")] decimal? Delta,
    [property: JsonPropertyName("achieved")] bool Achieved);
