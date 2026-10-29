<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'イベントチケット',
    'intro' => '利用可能なチケットの種類を確認し、無料の場所を申請し、確認済みの独自の無料チケットを管理します。',
    'load_error' => 'イベント チケット カタログをロードできませんでした。',
    'validation_error' => 'チケットの詳細を確認して、もう一度お試しください。',
    'allocate_error' => '無料チケットを割り当てることができませんでした。登録、資格、残りの割り当てを確認してください。',
    'cancel_error' => '無料チケットはキャンセルできませんでした。カタログを更新して再試行してください。',
    'allocated' => '無料チケットが割り当てられました。',
    'cancelled' => '無料チケットはキャンセルされ、割り当てに戻されました。',
    'back_to_event' => 'イベントに戻る',
    'back_to_tickets' => 'イベントチケットに戻る',
    'gateway_disabled' => '有料およびタイムクレジット チェックアウトは利用できません。このページではお金や時間クレジットを請求することはなく、ウォレットを変更することもありません。',
    'my_tickets' => '私のチケット',
    'no_tickets' => 'このイベントのチケットをお持ちではありません。',
    'ticket_fallback' => 'イベントチケット',
    'units' => '数量',
    'status_label' => 'ステータス',
    'status' => [
        'confirmed' => '確認済み',
        'cancelled' => 'キャンセルされました',
    ],
    'cancel_ticket' => 'チケットをキャンセルする',
    'time_credit_cancel_disabled' => 'この無料専用ワークフローでは、タイムクレジット チケットのキャンセルは利用できません。ウォレットアクションは実行されていません。',
    'catalogue' => '利用可能なチケット',
    'catalogue_empty' => 'このイベントではチケットの種類はありません。',
    'kind' => [
        'free' => '無料',
        'time_credit' => 'タイムクレジット',
    ],
    'remaining' => '残りの割り当て',
    'member_limit' => 'メンバーごとの制限',
    'time_credit_disabled' => 'このタイプには :credits 時間クレジットがかかりますが、承認されたウォレット ゲートウェイが接続されるまでチェックアウトは無効になります。クレジットは引き落とされません。',
    'units_to_claim' => '無料チケットの枚数',
    'reconcile' => '調整の実行',
    'reconciliation_clear' => 'チケットの在庫と台帳の記録が照合されます。',
    'reconciliation_warnings' => '{1} :count 調整警告|[2,*] :count 調整警告',
    'reconciliation_error' => 'チケットの照合を完了できませんでした。',
    'units_hint' => 'この割り当てでは、最大 :count を請求できます。',
    'claim_free' => '無料チケットを請求する',
    'registration_required' => '無料チケットを取得するには、確認済みのイベント登録が必要です。',
    'not_eligible' => '現在、このチケット タイプの資格規則を満たしていません。',
    'sales_closed' => 'このチケット タイプは現在割り当てが受け付けられていません。',
    'sold_out' => 'この割り当てには無料チケットが残っていません。',
    'cancel_title' => 'この無料チケットをキャンセルしますか?',
    'cancel_intro' => '主催者にキャンセル理由を伝えてください。数量は無料割り当てに戻されます。',
    'cancel_free_only' => 'この操作により、無料の権利のみがキャンセルされます。払い戻しを行ったり、ウォレットの残高を変更したりすることはありません。',
    'reason_label' => 'キャンセルの理由',
    'reason_hint' => '個人情報や機密情報は含めないでください。最大 500 文字。',
    'confirm_cancel' => '無料チケットをキャンセルする',
];
