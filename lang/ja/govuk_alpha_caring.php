<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => '思いやりのあるコミュニティ',
        'back_to_caring' => '思いやりのあるコミュニティに戻る',
        'back_to_caregiver' => '思いやりのある関係に戻りましょう',
        'success_title' => '成功',
        'error_title' => '問題があります',
        'unknown_member' => '不明なメンバー',
        'optional' => '(オプション)',
    ],
    'hub' => [
        'title' => '思いやりのあるコミュニティ',
        'caption' => 'ケアとサポート',
        'intro' => '他のメンバーの定期的なケアを手配したり、あなたのケアを依頼した人からのリクエストに応えたりします。',
        'caregiver_card_title' => 'あなたの思いやりのある関係',
        'caregiver_card_description' => 'あなたが求めた関係を確認し、あなたに関するリクエストに答え、承認された関係によってロックが解除されるツールを使用します。',
        'become_title' => '介護者になる',
        'become_description' => 'このコミュニティの他のメンバーに定期的なケアを提供するよう依頼してください。彼らが同意し、スタッフが確認するまでは何も発効しません。',
    ],
    'caregiver' => [
        'title' => 'あなたの思いやりのある関係',
        'caption' => '思いやりのあるコミュニティ',
        'intro' => 'あなたが求めてきた関係と、その現在の段階。',
        'none' => 'あなたはまだ誰の世話も頼んでいません。',
        'become_button' => '誰かの世話を頼む',
        'incoming_title' => 'あなたに関するリクエスト',
        'incoming_intro' => 'これらのメンバーはあなたの世話をするように頼んでいます。その意味を理解して受け入れる場合にのみ同意してください。',
        'incoming_explanation' => 'あなたが同意した場合、スタッフは関係が始まる前にリクエストを確認します。同意するだけでは始まりません。',
        'incoming_none' => '誰もあなたの世話を求めていません。',
        'confirm_button' => 'この関係に同意します',
        'reject_button' => '同意しません',
        'status_heading' => 'ステージ',
        'status_pending_recipient' => '他のメンバーの同意を待っています',
        'status_pending_staff' => 'スタッフの安全チェックを待っています',
        'status_active' => '承認され有効になっています',
        'status_rejected' => '承認されていません',
        'status_inactive' => '終了しました',
        'relationship_heading' => '関係',
        'relationship_family' => '家族',
        'relationship_friend' => '友達',
        'relationship_neighbour' => '近所の人',
        'relationship_professional' => 'プロの介護者',
        'started_heading' => 'ケアが始まりました',
        'reason_heading' => '与えられた理由',
        'pending_no_tools' => 'リクエストが待機している間は、このメンバーのケアの詳細にはアクセスできません。',
        'active_tools_title' => 'この関係によって何ができるのか',
        'request_on_behalf_link' => 'このメンバーに代わって助けを求める',
    ],
    'link' => [
        'title' => '誰かの世話を頼む',
        'caption' => '思いやりのあるコミュニティ',
        'intro' => 'このコミュニティの他のメンバーに定期的なケアを提供するよう依頼してください。',
        'consent_warning' => 'あなたが指名したメンバーは、同意するかどうか尋ねられます。スタッフがリクエストを確認します。両方が起こるまで、関係は始まりませんし、あなたに何も与えません。',
        'search_label' => 'お世話になりたいメンバーを見つけてください',
        'search_hint' => '名前の一部を入力し、結果から選択します。',
        'search_button' => '検索',
        'results_title' => 'メンバーを選択してください',
        'results_none' => 'その名前に一致するメンバーはいませんでした。別のスペルを試してください。',
        'choose_button' => '選ぶ',
        'chosen_label' => 'あなたが選んだメンバー',
        'change_button' => '変化',
        'relationship_label' => '彼らとあなたの関係',
        'start_date_label' => 'ケアを開始した日、またはこれから開始する日付',
        'start_date_hint' => 'たとえば、2026 年 3 月 27 日のようになります。',
        'notes_label' => 'スタッフが知っておくべきこと',
        'notes_hint' => 'オプション。これはリクエストを確認するスタッフに表示されます。',
        'submit_button' => 'リクエストの送信',
        'error_no_member' => '世話したいメンバーを選択してください',
        'error_no_relationship' => '彼らとの関係を選択してください',
        'error_no_start_date' => 'ケアが開始された、または開始される予定の日付を入力してください',
        'error_bad_start_date' => '実際の日付を入力します (例: 27 3 2026)。',
        'error_search_too_short' => '検索するには少なくとも 2 文字を入力してください',
    ],
    'on_behalf' => [
        'title' => '誰かに代わって助けを求める',
        'intro' => 'あなたが大切にしている会員のために実際的な助けをコミュニティに求めてください。リクエストは相手の名前で記録され、あなたがそれを行ったことを示します。',
        'for_member' => 'このリクエストは',
        'title_label' => 'どのような助けが必要ですか',
        'title_hint' => 'たとえば、病院へのエレベーター。',
        'description_label' => 'さらに詳しく',
        'when_label' => '必要なとき',
        'contact_label' => 'ヘルパーはどのように連絡すべきか',
        'contact_phone' => '電話で',
        'contact_message' => 'メッセージで',
        'contact_either' => 'どちらでもいいです',
        'submit_button' => 'リクエストの送信',
        'error_no_title' => '必要なサポートを入力してください',
        'error_not_active' => '関係が承認されたメンバーに代わってのみ助けを求めることができます',
    ],
    'review' => [
        'title' => '介護者が確認を求める',
        'caption' => '思いやりのあるコミュニティ',
        'intro' => '介護関係を承認する前に、介護を受ける人が同意していることを確認し、それをどのように確認したかを記録してください。',
        'none' => 'チェックを待っている介護者のリクエストはありません。',
        'requested_by' => 'リクエスト者',
        'requested_for' => '世話をする',
        'requested_on' => 'リクエスト日',
        'recipient_agreed' => 'メンバーが同意しました',
        'recipient_not_agreed' => 'メンバーはまだ同意していません',
        'blocked_until_agreed' => 'メンバーが同意するまで、このリクエストを承認することはできません。',
        'evidence_label' => '同意をどのように確認したか',
        'evidence_hint' => 'たとえば、2026 年 3 月 27 日のメンバー本人との電話です。',
        'attestation_label' => 'このメンバーの同意を私自身が確認したことを確認します',
        'approve_button' => '関係を承認する',
        'reject_label' => 'このリクエストを拒否する理由',
        'reject_hint' => 'これは記録され、質問したメンバーに示されます。',
        'reject_button' => 'リクエストを拒否する',
        'decided_approved' => '承認された',
        'decided_rejected' => '拒否した',
        'error_no_evidence' => '同意を確認した方法を入力してください',
        'error_no_attestation' => 'このメンバーの同意を自分で確認したことを確認してください',
        'error_no_reason' => 'このリクエストを拒否する理由を入力してください',
    ],
    'status' => [
        'link_requested' => 'リクエストは送信されました。他のメンバーが同意するのを待ってから、スタッフのチェックが行われます。',
        'link_failed' => 'リクエストを送信できませんでした。',
        'link_duplicate' => 'あなたはすでにそのメンバーとリクエストまたは承認された関係を持っています。',
        'incoming_confirmed' => 'あなたは同意しました。スタッフは関係が始まる前にリクエストを確認します。',
        'incoming_rejected' => 'あなたは拒否しました。関係は構築されていません。',
        'incoming_failed' => '回答を保存できませんでした。',
        'review_approved' => '思いやりのある関係が承認されました。',
        'review_rejected' => 'リクエストは拒否されました。',
        'review_not_agreed' => 'メンバーが同意していないため、そのリクエストは承認できません。',
        'review_failed' => 'その決断は救われなかった。',
        'review_not_found' => 'そのリクエストはこのコミュニティでは見つかりませんでした。',
        'on_behalf_sent' => '助けを求めるリクエストが送信されました。',
        'on_behalf_failed' => '助けを求めるリクエストを送信できませんでした。',
    ],
];
