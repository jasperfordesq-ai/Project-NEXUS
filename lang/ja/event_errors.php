<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'イベントが終了するまで、登録データを削除対象として確認することはできません。イベント終了後の日付を選択してください。',
        'settings_required' => '先にこのイベントの登録設定を保存してください。登録データの保存期間はそこで設定されます。',
    ],
    'broadcast' => [
        'schedule_in_past' => 'その送信時刻はすでに過ぎています。未来の時刻を選択するか、今すぐ送信してください。',
        'post_event_too_early' => 'イベント後のメッセージは、イベント終了後にのみ送信できます。イベント終了後の時刻を選択してください。',
        'audience_empty' => 'このメッセージを受け取る人がいません。少なくとも1人が含まれる対象者を選択してください。',
        'channel_empty' => 'このメッセージの送信方法を少なくとも1つ選択してください。',
        'body_invalid' => ':max文字以内でメッセージを入力してください。',
    ],
];
