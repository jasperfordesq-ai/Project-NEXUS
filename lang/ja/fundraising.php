<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'その募金キャンペーンが見つかりませんでした。',
    'organisation_locked' => 'このキャンペーンにはすでに寄付が寄せられているため、募金先の団体を変更することはできません。',
    'organisation_not_eligible' => '募金キャンペーンを実施できるのは承認済みの団体のみです。',
    'not_your_campaign' => '管理できるのは自分の団体のキャンペーンのみです。',
    'handover_not_found' => 'その引き渡し記録が見つかりませんでした。',
    'handover_amount_positive' => '0より大きい金額を入力してください。',
    'handover_exceeds_held' => 'このキャンペーンがまだ保有している額（:held）を超えています。',
    'handover_method_invalid' => 'お金をどのように引き渡したか選択してください。',
    'handover_reference_required' => '送金を追跡できるよう、支払い参照番号を入力してください。',
    'handover_date_invalid' => 'お金を引き渡した日付を入力してください。未来の日付は指定できません。',
    'handover_campaign_has_no_organisation' => 'このキャンペーンはコミュニティ全体のためのものなので、お金を引き渡す団体はありません。',
    'handover_already_closed' => 'この引き渡しはすでに確認済みまたは取り消し済みです。',
    'cancel_reason_required' => 'この引き渡しを取り消す理由を入力してください。',
    'email' => [
        'handover_subject' => ':communityが:campaignの:amountを引き渡しました',
        'handover_title' => ':organisationにお金が引き渡されました',
        'handover_body' => ':communityは、キャンペーン「:campaign」で集まった:amountを:dateに引き渡したことを記録しました（参照番号 :reference）。入金を確認し、団体のダッシュボードで受領を確認してください。',
        'handover_cta' => '受領を確認',
        'handover_bell' => ':communityが:campaignの:amountを引き渡しました。受領を確認してください。',
    ],
];
