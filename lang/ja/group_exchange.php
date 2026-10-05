<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => '5種類のグループ交換のうち、どれか1つを選んでください。',
        'no_givers' => '時間を提供する人を1人以上追加してください。',
        'no_receivers' => '時間を受け取る人を1人以上追加してください。',
        'hours_missing' => 'すべての人に0より大きい時間数を入力してください。',
        'earned_exceeds_paid' => '時間を提供する人は:earned時間を得ますが、参加者が支払うのは:paid時間だけです。ワークショップや講座では、参加者は受け取った時間分を支払うため、得られる時間以上を支払う必要があります。複数の人が1人のために時間を提供する場合は、「チームで誰かを手伝う」を選んでください。',
        'unbalanced' => '得る時間（:earned）と支払う時間（:paid）は同じでなければなりません。数字を変更して一致させてください。',
        'too_many_participants' => 'グループ交換に参加できるのは最大:max人です。',
    ],
    'ledger' => [
        'to_fund' => 'グループ交換「:title」— 余った時間をコミュニティ基金へ',
    ],
    'fund' => [
        'description' => 'グループ交換「:title」で余った時間',
    ],
];
