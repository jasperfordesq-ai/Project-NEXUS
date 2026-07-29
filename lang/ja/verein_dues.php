<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => '手数料金額はゼロより大きくなければなりません。',
        'invalid_billing_cycle' => '請求サイクルは、年次、隔年、月次のいずれかである必要があります。',
        'fee_not_configured' => 'この Verein には有効なメンバーシップ料金は設定されていません。',
        'organization_not_found' => 'ヴェラインが見つかりません。',
        'organization_not_club' => 'この組織は Verein ではありません。',
        'organization_required' => '組織 ID は必須です。',
        'dues_not_found' => '会費の記録が見つかりません。',
        'cannot_waive_paid' => 'すでに支払われた会費を放棄することはできません。',
        'cannot_remind_status' => 'リマインダーは、保留中の会費または期限を過ぎた会費に対してのみ送信できます。',
        'cannot_pay_status' => 'この会費行は支払い可能な状態ではありません。',
        'payment_intent_failed' => '支払いプロセスを開始できませんでした。後でもう一度試してください。',
        'waive_reason_required' => '放棄理由が必要です。',
    ],
];
