// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Query boundary for ledger rows that adapt Laravel balance-only workflows.
/// These rows affect the derived .NET balance but must not appear as transfers,
/// activity, volume, gamification or statement history because Laravel creates
/// no corresponding transaction row.
/// </summary>
public static class TransactionLedgerQueryExtensions
{
    public static IQueryable<Transaction> ExcludeInternalWalletAdapters(
        this IQueryable<Transaction> query)
    {
        return query.Where(transaction =>
            transaction.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
            && transaction.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
            && transaction.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
            && transaction.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType);
    }
}
