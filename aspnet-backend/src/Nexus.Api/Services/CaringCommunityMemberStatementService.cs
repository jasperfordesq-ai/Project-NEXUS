// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed class CaringCommunityMemberStatementService
{
    private const string FeatureFlagKey = "features.caring_community";
    private const string WorkflowPrefix = "caring_community.workflow.";

    private readonly NexusDbContext _db;

    public CaringCommunityMemberStatementService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == FeatureFlagKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public async Task<CaringMemberStatement?> StatementAsync(
        int tenantId,
        int userId,
        CaringMemberStatementFilters filters,
        CancellationToken ct)
    {
        var user = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId && u.Id == userId)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.Email
            })
            .FirstOrDefaultAsync(ct);

        if (user is null)
        {
            return null;
        }

        var policy = await PolicyAsync(tenantId, ct);
        var period = Period(filters, policy.MonthlyStatementDay);
        var supportLogs = await SupportLogsAsync(tenantId, userId, period, ct);
        var walletTransactions = await WalletTransactionsAsync(tenantId, userId, period, ct);
        var currentBalance = await CurrentBalanceAsync(tenantId, userId, ct);
        var summary = Summary(supportLogs, walletTransactions, currentBalance, policy.DefaultHourValueChf);

        return new CaringMemberStatement(
            new CaringMemberStatementUser(
                user.Id,
                DisplayName(user.FirstName, user.LastName, user.Email),
                user.Email,
                Round(currentBalance)),
            period,
            new CaringMemberStatementPolicy(
                policy.MonthlyStatementDay,
                policy.DefaultHourValueChf,
                policy.IncludeSocialValueEstimate),
            summary,
            SupportHoursByOrganisation(supportLogs),
            supportLogs,
            walletTransactions);
    }

    public async Task<CaringMemberStatementCsv?> CsvAsync(
        int tenantId,
        int userId,
        CaringMemberStatementFilters filters,
        CancellationToken ct)
    {
        var statement = await StatementAsync(tenantId, userId, filters, ct);
        if (statement is null)
        {
            return null;
        }

        var rows = new List<string[]>
        {
            new[] { "Date", "Type", "Partner", "Description", "Hours", "Status" }
        };

        rows.AddRange(statement.SupportLogs.Select(log => new[]
        {
            log.Date,
            "support_hours",
            log.OrganisationName,
            log.Description,
            FormatNumber(log.Hours),
            log.Status
        }));

        rows.AddRange(statement.WalletTransactions.Select(transaction => new[]
        {
            transaction.Date,
            transaction.Direction,
            transaction.CounterpartyName,
            transaction.Description,
            FormatNumber(transaction.SignedAmount),
            transaction.Status
        }));

        return new CaringMemberStatementCsv(
            $"caring-community-statement-{statement.User.Id}-{statement.Period.Start}-{statement.Period.End}.csv",
            ToCsv(rows),
            statement);
    }

    private async Task<CaringWorkflowPolicy> PolicyAsync(int tenantId, CancellationToken ct)
    {
        var keys = new[]
        {
            WorkflowPrefix + "monthly_statement_day",
            WorkflowPrefix + "default_hour_value_chf",
            WorkflowPrefix + "include_social_value_estimate"
        };

        var rows = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && keys.Contains(c.Key))
            .ToDictionaryAsync(c => c.Key, c => c.Value, ct);

        return new CaringWorkflowPolicy(
            Clamp(ParseInt(rows.GetValueOrDefault(WorkflowPrefix + "monthly_statement_day"), 1), 1, 28),
            Clamp(ParseInt(rows.GetValueOrDefault(WorkflowPrefix + "default_hour_value_chf"), 35), 0, 500),
            ParseBool(rows.GetValueOrDefault(WorkflowPrefix + "include_social_value_estimate")) ?? true);
    }

    private static CaringMemberStatementPeriod Period(CaringMemberStatementFilters filters, int statementDay)
    {
        var end = NormaliseDate(filters.EndDate) ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var start = NormaliseDate(filters.StartDate);

        if (start is null)
        {
            var anchor = new DateOnly(end.Year, end.Month, Math.Min(statementDay, DateTime.DaysInMonth(end.Year, end.Month)));
            if (anchor > end)
            {
                var priorMonth = end.AddMonths(-1);
                anchor = new DateOnly(
                    priorMonth.Year,
                    priorMonth.Month,
                    Math.Min(statementDay, DateTime.DaysInMonth(priorMonth.Year, priorMonth.Month)));
            }

            start = anchor;
        }

        if (start > end)
        {
            (start, end) = (end, start.Value);
        }

        return new CaringMemberStatementPeriod(
            start.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            statementDay);
    }

    private static DateOnly? NormaliseDate(string? date)
    {
        if (string.IsNullOrWhiteSpace(date))
        {
            return null;
        }

        return DateTime.TryParse(
            date,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? DateOnly.FromDateTime(parsed)
            : null;
    }

    private async Task<List<CaringSupportLogRow>> SupportLogsAsync(
        int tenantId,
        int userId,
        CaringMemberStatementPeriod period,
        CancellationToken ct)
    {
        var start = DateOnly.ParseExact(period.Start, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var end = DateOnly.ParseExact(period.End, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var rows = await _db.VolunteerCheckIns
            .IgnoreQueryFilters()
            .Include(c => c.Shift)
            .ThenInclude(s => s!.Opportunity)
            .Where(c => c.TenantId == tenantId
                && c.UserId == userId
                && (c.HoursLogged.HasValue || c.TransactionId.HasValue))
            .ToListAsync(ct);

        return rows
            .Select(c =>
            {
                var logDate = DateOnly.FromDateTime(
                    (c.CheckedOutAt ?? c.CheckedInAt ?? c.CreatedAt).Date);
                var status = c.CheckedOutAt.HasValue ? "approved" : "pending";
                var organisationName = c.Shift?.Title;
                if (string.IsNullOrWhiteSpace(organisationName))
                {
                    organisationName = c.Shift?.Opportunity?.Title ?? string.Empty;
                }

                return new
                {
                    CheckIn = c,
                    LogDate = logDate,
                    Status = status,
                    OrganisationName = organisationName
                };
            })
            .Where(row => row.LogDate >= start && row.LogDate <= end)
            .OrderByDescending(row => row.LogDate)
            .ThenByDescending(row => row.CheckIn.Id)
            .Select(row => new CaringSupportLogRow(
                row.CheckIn.Id,
                row.LogDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Round(row.CheckIn.HoursLogged ?? 0m),
                row.Status,
                row.CheckIn.Notes ?? string.Empty,
                row.OrganisationName ?? string.Empty,
                row.CheckIn.Shift?.Opportunity?.Title ?? string.Empty,
                row.CheckIn.CreatedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)))
            .ToList();
    }

    private async Task<List<CaringWalletTransactionRow>> WalletTransactionsAsync(
        int tenantId,
        int userId,
        CaringMemberStatementPeriod period,
        CancellationToken ct)
    {
        var start = DateOnly.ParseExact(period.Start, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var end = DateOnly.ParseExact(period.End, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var userIds = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == tenantId)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.Email })
            .ToDictionaryAsync(u => u.Id, u => DisplayName(u.FirstName, u.LastName, u.Email), ct);

        var rows = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
                && (t.SenderId == userId || t.ReceiverId == userId))
            .ToListAsync(ct);

        return rows
            .Select(t => new
            {
                Transaction = t,
                Date = DateOnly.FromDateTime(t.CreatedAt.ToUniversalTime())
            })
            .Where(row => row.Date >= start && row.Date <= end)
            .OrderByDescending(row => row.Transaction.CreatedAt)
            .ThenByDescending(row => row.Transaction.Id)
            .Select(row =>
            {
                var transaction = row.Transaction;
                var earned = transaction.ReceiverId == userId;
                var counterpartyId = earned ? transaction.SenderId : transaction.ReceiverId;
                var amount = Round(transaction.Amount);
                return new CaringWalletTransactionRow(
                    transaction.Id,
                    row.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    earned ? "earned" : "spent",
                    counterpartyId.HasValue
                        ? userIds.GetValueOrDefault(counterpartyId.Value, string.Empty)
                        : "Volunteer organisation",
                    amount,
                    earned ? amount : -amount,
                    transaction.Description ?? string.Empty,
                    transaction.Status.ToString().ToLowerInvariant(),
                    "transfer",
                    transaction.CreatedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
            })
            .ToList();
    }

    private async Task<decimal> CurrentBalanceAsync(int tenantId, int userId, CancellationToken ct)
    {
        var earned = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId
                && t.ReceiverId == userId
                && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount, ct) ?? 0m;

        var spent = await _db.Transactions
            .IgnoreQueryFilters()
            .Where(t => t.TenantId == tenantId
                && t.SenderId == userId
                && t.Status == TransactionStatus.Completed)
            .SumAsync(t => (decimal?)t.Amount, ct) ?? 0m;

        return earned - spent;
    }

    private static CaringMemberStatementSummary Summary(
        IReadOnlyList<CaringSupportLogRow> supportLogs,
        IReadOnlyList<CaringWalletTransactionRow> walletTransactions,
        decimal currentBalance,
        int hourValueChf)
    {
        var approvedHours = supportLogs
            .Where(log => log.Status == "approved")
            .Sum(log => log.Hours);
        var pendingHours = supportLogs
            .Where(log => log.Status == "pending")
            .Sum(log => log.Hours);
        var declinedCount = supportLogs.Count(log => log.Status == "declined");
        var earned = walletTransactions
            .Where(transaction => transaction.Direction == "earned")
            .Sum(transaction => transaction.Amount);
        var spent = walletTransactions
            .Where(transaction => transaction.Direction == "spent")
            .Sum(transaction => transaction.Amount);

        return new CaringMemberStatementSummary(
            Round(approvedHours),
            Round(pendingHours),
            declinedCount,
            Round(earned),
            Round(spent),
            Round(earned - spent),
            Round(currentBalance),
            Round(approvedHours * hourValueChf));
    }

    private static List<CaringSupportHoursByOrganisation> SupportHoursByOrganisation(
        IReadOnlyList<CaringSupportLogRow> supportLogs)
    {
        return supportLogs
            .GroupBy(log => string.IsNullOrWhiteSpace(log.OrganisationName)
                ? "Unknown partner"
                : log.OrganisationName)
            .Select(group => new CaringSupportHoursByOrganisation(
                group.Key,
                Round(group.Where(log => log.Status == "approved").Sum(log => log.Hours)),
                Round(group.Where(log => log.Status == "pending").Sum(log => log.Hours)),
                group.Count()))
            .ToList();
    }

    private static string DisplayName(string? firstName, string? lastName, string email)
    {
        var fullName = string.Join(" ", new[] { firstName, lastName }
            .Where(value => !string.IsNullOrWhiteSpace(value)))
            .Trim();

        return string.IsNullOrWhiteSpace(fullName) ? email : fullName;
    }

    private static string ToCsv(IEnumerable<string[]> rows)
    {
        var builder = new StringBuilder();
        foreach (var row in rows)
        {
            builder
                .AppendJoin(',', row.Select(EscapeCsv))
                .Append('\n');
        }

        return builder.ToString();
    }

    private static string EscapeCsv(string value)
    {
        return "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static string FormatNumber(decimal value)
    {
        return value.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static decimal Round(decimal value)
    {
        return Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }

    private static int ParseInt(string? raw, int fallback)
    {
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
    }

    private static int Clamp(int value, int min, int max)
    {
        return Math.Max(min, Math.Min(max, value));
    }

    private static bool? ParseBool(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        if (bool.TryParse(raw, out var parsed))
        {
            return parsed;
        }

        return raw.Trim() switch
        {
            "1" => true,
            "0" => false,
            _ => null
        };
    }
}

public sealed record CaringMemberStatementFilters(string? StartDate, string? EndDate);

public sealed record CaringMemberStatementCsv(
    [property: JsonPropertyName("filename")]
    string Filename,
    [property: JsonPropertyName("csv")]
    string Csv,
    [property: JsonPropertyName("statement")]
    CaringMemberStatement Statement);

public sealed record CaringMemberStatement(
    [property: JsonPropertyName("user")]
    CaringMemberStatementUser User,
    [property: JsonPropertyName("period")]
    CaringMemberStatementPeriod Period,
    [property: JsonPropertyName("policy")]
    CaringMemberStatementPolicy Policy,
    [property: JsonPropertyName("summary")]
    CaringMemberStatementSummary Summary,
    [property: JsonPropertyName("support_hours_by_organisation")]
    IReadOnlyList<CaringSupportHoursByOrganisation> SupportHoursByOrganisation,
    [property: JsonPropertyName("support_logs")]
    IReadOnlyList<CaringSupportLogRow> SupportLogs,
    [property: JsonPropertyName("wallet_transactions")]
    IReadOnlyList<CaringWalletTransactionRow> WalletTransactions);

public sealed record CaringMemberStatementUser(
    [property: JsonPropertyName("id")]
    int Id,
    [property: JsonPropertyName("name")]
    string Name,
    [property: JsonPropertyName("email")]
    string Email,
    [property: JsonPropertyName("current_balance")]
    decimal CurrentBalance);

public sealed record CaringMemberStatementPeriod(
    [property: JsonPropertyName("start")]
    string Start,
    [property: JsonPropertyName("end")]
    string End,
    [property: JsonPropertyName("statement_day")]
    int StatementDay);

public sealed record CaringMemberStatementPolicy(
    [property: JsonPropertyName("monthly_statement_day")]
    int MonthlyStatementDay,
    [property: JsonPropertyName("hour_value_chf")]
    int HourValueChf,
    [property: JsonPropertyName("include_social_value_estimate")]
    bool IncludeSocialValueEstimate);

public sealed record CaringMemberStatementSummary(
    [property: JsonPropertyName("approved_support_hours")]
    decimal ApprovedSupportHours,
    [property: JsonPropertyName("pending_support_hours")]
    decimal PendingSupportHours,
    [property: JsonPropertyName("declined_support_logs")]
    int DeclinedSupportLogs,
    [property: JsonPropertyName("wallet_hours_earned")]
    decimal WalletHoursEarned,
    [property: JsonPropertyName("wallet_hours_spent")]
    decimal WalletHoursSpent,
    [property: JsonPropertyName("wallet_net_change")]
    decimal WalletNetChange,
    [property: JsonPropertyName("current_balance")]
    decimal CurrentBalance,
    [property: JsonPropertyName("estimated_social_value_chf")]
    decimal EstimatedSocialValueChf);

public sealed record CaringSupportHoursByOrganisation(
    [property: JsonPropertyName("organisation_name")]
    string OrganisationName,
    [property: JsonPropertyName("approved_hours")]
    decimal ApprovedHours,
    [property: JsonPropertyName("pending_hours")]
    decimal PendingHours,
    [property: JsonPropertyName("log_count")]
    int LogCount);

public sealed record CaringSupportLogRow(
    [property: JsonPropertyName("id")]
    int Id,
    [property: JsonPropertyName("date")]
    string Date,
    [property: JsonPropertyName("hours")]
    decimal Hours,
    [property: JsonPropertyName("status")]
    string Status,
    [property: JsonPropertyName("description")]
    string Description,
    [property: JsonPropertyName("organisation_name")]
    string OrganisationName,
    [property: JsonPropertyName("opportunity_title")]
    string OpportunityTitle,
    [property: JsonPropertyName("created_at")]
    string CreatedAt);

public sealed record CaringWalletTransactionRow(
    [property: JsonPropertyName("id")]
    int Id,
    [property: JsonPropertyName("date")]
    string Date,
    [property: JsonPropertyName("direction")]
    string Direction,
    [property: JsonPropertyName("counterparty_name")]
    string CounterpartyName,
    [property: JsonPropertyName("amount")]
    decimal Amount,
    [property: JsonPropertyName("signed_amount")]
    decimal SignedAmount,
    [property: JsonPropertyName("description")]
    string Description,
    [property: JsonPropertyName("status")]
    string Status,
    [property: JsonPropertyName("transaction_type")]
    string TransactionType,
    [property: JsonPropertyName("created_at")]
    string CreatedAt);

internal sealed record CaringWorkflowPolicy(
    int MonthlyStatementDay,
    int DefaultHourValueChf,
    bool IncludeSocialValueEstimate);
