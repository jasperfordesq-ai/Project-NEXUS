<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'この会話はコミュニティの安全保護ルールにより一時停止されています。このメンバーにメッセージを送るには、コミュニティが有効な :types ステータスを記録している必要があります。ブローカーまたはコミュニティ管理者に、メタデータのみの確認として記録するよう依頼してください。審査書類を送信またはアップロードしないでください。',
        'vetting_required_title' => 'Anzen kakunin ga hitsuyo desu',
        'vetting_required_detail' => 'この種の連絡を行えるのは、コミュニティが有効な :types ステータスを記録しているメンバーのみです。記録はメタデータのみであり、書類を送信またはアップロードしないでください。',
        'vetting_required_action' => 'Herupu o hiraku',
        'contact_restricted' => 'Kono menba wa koordineeta ga dairi de renraku wo seiri suru koto wo kibou shite imasu. Messeji wa soshin saremasen deshita. Tsugi no anzen na tejun no tame, buroka mata wa komyuniti kanrisha ni renraku shite kudasai.',
        'contact_restricted_title' => 'Koordineeta no tehai ga hitsuyo desu',
        'contact_restricted_detail' => 'このメンバーのセーフガーディング設定により、ダイレクトメッセージはご利用いただけません。連絡を取るにはコーディネーターによる仲介が必要です。コーディネーターに連絡の調整をご依頼いただけます。',
        'contact_restricted_action' => 'Herupu o hiraku',
        'coordination_not_required' => 'このメンバーへの直接連絡は現在ご利用いただけます。コーディネーターによる調整は必要ありません。ページを更新して、メッセージの送信をお試しください。',
        'coordination_request_failed' => '現在、コーディネーターへの依頼を送信できませんでした。しばらくしてからもう一度お試しください。',
        'vetting_check_failed' => '現在、審査状況を確認できませんでした。しばらくしてからもう一度お試しください。',
        'policy_unavailable' => '現時点ではコミュニティ保護ポリシーを確認できません。メッセージは送信されていません。しばらくしてからもう一度お試しください。',
        'blocked_interaction' => 'このメンバーとはやり取りできません。',
        'interaction_not_allowed' => '受信者のコミュニティ保護ポリシーでは、このような直接的なやり取りは許可されていません。コーディネーターに助けを求めてください。',
        'policy_unavailable_title' => '保護チェックは一時的に利用できません',
        'policy_unavailable_detail' => 'Project NEXUS は連絡ポリシーを安全に評価できなかったため、このやり取りは一時停止されました。',
        'policy_unavailable_action' => 'もう一度確認してください',
        'listing_role_confirmation_required' => 'このリストには、この役割に関してコミュニティで確認された別の拡張 DBS 決定が必要です。メッセンジャーの連絡確認は、役割固有の保護要件を満たしていません。',
        'listing_role_feature_unavailable' => 'ここでは、役割固有の犯罪歴の調査をまだ有効にすることができません。メッセンジャーの連絡先確認は、役割のクリアランスとして意図的に再利用されません。',
        'compliance_policy_unavailable' => '現時点では、このリストの保護要件を安全に確認することができません。後でもう一度試すか、ブローカーに問い合わせてください。',
        'statement_required' => 'このコミュニティが子供や弱い立場にある大人に対して活動していることを宣言するには、子供の安全保護に関する声明 PDF が必要です。続行するには、1 つアップロードしてください。',
        'invalid_file' => 'アップロードされたファイルを読み取れませんでした。有効な PDF を使用して再試行してください。',
        'pdf_required' => '安全保護に関する声明は PDF ファイルである必要があります。',
        'file_too_large' => '安全保護ステートメント ファイルが大きすぎます。最大サイズは10MBです。',
        'storage_failed' => 'アップロードされたファイルを保存できませんでした。もう一度試してください。',
        'statement_missing' => 'このコミュニティには安全保護に関する声明は登録されていません。',
        'file_missing' => '安全保護ステートメント ファイルがサーバー上に見つかりませんでした。もう一度アップロードしてください。',
        'revoke_failed' => 'その優先順位を取り消すことはできませんでした。すでに取り消されている可能性があります。',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBSベーシック',
        'dbs_standard' => 'DBS標準',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'ガルダの審査',
        'access_ni' => 'アクセスNI',
        'pvg_scotland' => 'PVG スコットランド',
        'international' => '国際的な身元調査',
        'other' => 'その他の審査チェック',
        'uk_safeguarding_clearance' => '英国の安全防護措置許可',
    ],
    'jurisdictions' => [
        'unconfigured' => '保護管轄区域が構成されていません',
        'united_kingdom' => 'イギリス — 国の方針パッケージ',
        'england_wales' => 'イングランドとウェールズ',
        'scotland' => 'スコットランド',
        'northern_ireland' => '北アイルランド',
        'ireland' => 'アイルランド共和国',
        'custom' => '税関管轄区域',
    ],
    'attestations' => [
        'dbs_enhanced' => '強化された DBS により、メンバーとの接触が保護されることが確認されました',
        'pvg_scotland' => '保護されたメンバーの連絡先について PVG ステータスが確認されました',
        'access_ni' => '保護されたメンバーの連絡先について AccessNI ステータスが確認されました',
        'garda_vetting' => 'Garda Vettingは安全に保護されたメンバーとの接触を確認',
        'uk_safeguarding_clearance' => '英国の保護対象メンバーとの接触に関する安全保護許可が確認されました',
    ],
    'confirmation' => [
        'title' => '保護設定が保存されました',
        'intro' => '共有していただきありがとうございます。ここでは、何を選択したか、誰がそれを見ることができるか、その結果何がアクティブになるかをまとめます。',
        'your_selections' => 'あなたの選択',
        'no_selections' => '保護オプションを選択しませんでした。',
        'who_can_see_heading' => '誰がこれを見ることができますか',
        'who_can_see_body' => 'これらの設定を表示できるのは、コミュニティ コーディネーターと管理者だけです。他のメンバーはできません。すべてのアクセスはログに記録されます。',
        'what_activates_heading' => 'その結果何が活性化するのか',
        'activation_broker_review' => 'コーディネーターは、選択した設定で必要な場合、保護されたマッチングまたは交換を検討して承認します。これにより、メッセージの内容にアクセスできるようになりません。',
        'activation_match_approval' => 'コーディネーターは、あなたが参加する試合を他のメンバーに提案する前に承認します。',
        'activation_discovery_hidden' => 'このコミュニティによって記録された審査を受けていないメンバーは、あなたにメッセージを送ったり、返信したり、タイム クレジットを送信したり、あなたと交換を開始したりすることはできません。',
        'activation_notification' => 'コーディネーターに通知があり、どのようにお手伝いできるかについてご連絡させていただきます。',
        'activation_none' => 'これらの選択からは自動保護は有効になりません。あなたの好みはコーディネーターが認識できるように記録されます。',
        'revoke_heading' => 'これらをいつでも変更または取り消す方法',
        'revoke_body' => 'これらの設定は、プロファイル設定からいつでも確認したり取り消したりできます。管理者にこれを行うよう依頼する必要はありません。',
        'revoke_cta' => '保護設定に移動します',
        'continue_cta' => '続く',
    ],
    'settings' => [
        'page_title' => '設定の保護',
        'intro' => 'オンボーディング中に設定した安全保護設定を確認または取り消します。コーディネーターはこれらを表示できますが、他のメンバーは表示できません。',
        'no_preferences' => 'アクティブな保護設定がありません。これらは、安全保護のヘルプ ページからいつでも設定できます。',
        'selected_on' => ':date で選択されました',
        'revoke_button' => '取り消す',
        'revoke_confirm_title' => 'この設定を取り消しますか?',
        'revoke_confirm_body' => 'この設定はアカウントには適用されなくなります。変更はコーディネーターに通知されます。',
        'revoke_confirm_yes' => 'はい、取り消します',
        'revoke_confirm_no' => 'そのままにしておいてください',
        'revoked_toast' => '優先権が取り消されました。',
        'revoke_error_toast' => '何か問題が発生しました。もう一度試してください。',
        'switch_heading' => 'より穏やかなオプションが利用可能です',
        'switch_body' => 'このコミュニティが精査を記録したメンバーのみから連絡を受けることを選択しました。これにより、ほとんどすべての人があなたに連絡できなくなります。コーディネーターがあなたのやり取りを監視し、代わりにメンバーを紹介するように切り替えると、他のメンバーが再びあなたにメッセージを送信できるようになります。',
        'switch_button' => 'コーディネーター紹介に切り替える',
        'switched_toast' => '終わり。コーディネーターがあなたのやり取りを監視し、メンバーは再度メッセージを送信することができます。',
        'switch_not_held' => '精査されたメンバーのみの設定がないため、切り替える必要はありません。',
        'switch_unavailable' => 'このコミュニティではまだコーディネーターの紹介を利用できません。コーディネーターにご相談ください。',
    ],
    'effects' => [
        'broker_approval' => 'コーディネーターは、お客様が手配した交換を実行前に確認します。彼らはあなたのメッセージを読むことができません。',
        'restricts_messaging' => '他のメンバーはあなたに直接メッセージを送信することはできません。コーディネーターが連絡先を手配します。',
        'restricts_matching' => 'あなたと他のメンバーの間で提案された一致は、最初にコーディネーターによってチェックされます。',
        'vetted_only' => 'このコミュニティが :vetting 記録しているメンバーのみが、あなたにメッセージを送ったり、返信したり、タイム クレジットを送信したり、あなたとの交換を開始したりできます。他の人は全員ブロックされています。',
        'vetted_count' => '{0} 現在、ここに :vetting を記録しているメンバーはいないため、この機能がオンになっている間は誰もあなたに連絡できません。|{1} 現在、ここに :vetting を記録しているメンバーは 1 人だけです。|[2,*] :count のメンバーは現在、ここに :vetting を記録しています。',
        'notify_coordinator' => 'コーディネーターがあなたの選択について説明しますので、何か必要な場合は連絡してください。',
        'no_home_visits' => 'コーディネーターは、自分が手配しない限り、あなたが自宅訪問を望まないことを知っています。',
        'informational' => '他のメンバーにとっては何も変わりません。あなたの回答は、コーディネーターのサポートに役立ちます。',
        'declined' => '何も変わりません。コーディネーターは、あなたがこのステップを確認したことを確認できます。',
        'vetting_fallback' => '審査する',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'このコミュニティは安全対策に真剣に取り組んでいます。タイムバンクの使用中に特別な配慮が必要な場合は、下記までお知らせください。コーディネーターがお手伝いいたします。それぞれの選択肢は、選択する前にそれが何をするかを正確に示します。',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => '私は自分自身を弱い立場にある大人だと考えているので、特別なサポートが必要です',
                    'description' => 'コーディネーターがご連絡し、私たちがどのようにお手伝いできるかについて話し合い、交換や試合を検討させていただきます。他のメンバーは引き続きメッセージを送信できます。',
                ],
                'coordinator_introductions' => [
                    'label' => 'コーディネーターに私のやり取りを監視してもらい、メンバーを紹介してもらいたい',
                    'description' => '切断されずに安心感が欲しい場合に最適です。他のメンバーは引き続きメッセージを送信できます。',
                ],
                'requires_vetted_partners' => [
                    'label' => 'このコミュニティの精査が記録されているメンバーのみが私に連絡することができます',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'メンバーが私に直接メッセージを送るのではなく、コーディネーターにすべての連絡先を手配してもらいたいのですが',
                    'description' => 'コーディネーターがお客様に代わって連絡ややり取りを手配します。他のメンバーはあなたに直接メッセージを送信することはできません。',
                ],
                'no_home_visits' => [
                    'label' => 'コーディネーターが手配しない限り、メンバーに自宅を訪問してほしくない',
                    'description' => 'コーディネーターがあなたの自宅への訪問を手配し、適切な安全対策が講じられていることを確認するお手伝いをします。',
                ],
                'works_with_children' => [
                    'label' => '子どもまたは若者（18歳未満）が関わる可能性のあるサービスを提供する予定です',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => '支援を必要とする成人が関わる可能性のあるサービスを提供する予定です',
                ],
                'none_apply' => [
                    'label' => 'いずれも私には当てはまりません',
                    'description' => '上記の選択肢を確認しましたが、私の状況に当てはまるものはありません。この手順を確認し検討したことがコーディネーターに分かるよう記録されます。',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'アイルランド',
            'vetting_authority' => '国家審査局',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'アイルランドでは、ガルダ審査は特定の役割を担う組織を通じて手配されます。ここでは、このコミュニティが記録したことを精査することのみが考慮され、誰かがその仕事や他のグループを通じて得たものは精査されません。',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'コーディネーターがお客様に代わって連絡ややり取りを手配します。他のメンバーはあなたに直接メッセージを送信することはできません。',
                ],
                'works_with_children' => [
                    'description' => 'コーディネーターがGarda Vettingの要件についてご説明する場合があります。アイルランドでは、2012年国家審査局法により、子どもが関わる特定の活動には審査が必要です。',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'コーディネーターが、あなたの計画に Garda Vetting が必要かどうかについてお話しする場合があります。 2012 年国家審査局法に基づき、主に弱い立場にある人々を扱う一部の業務では、登録組織による審査が必要です。',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'イギリス',
            'vetting_authority' => 'DBS、ディスクロージャー・スコットランド、AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => '英国全土では、このコミュニティが記録した拡張 DBS、PVG、または AccessNI チェックを意味します。誰かが自分の仕事や他のグループを通じて得た小切手は、ここではカウントされません。',
                ],
                'works_with_children' => [
                    'description' => 'コーディネーターは、どの安全対策チェックが法的に適切であるかを決定する前に、その役割と該当する英国の管轄区域を評価します。',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'コーディネーターは、どの安全対策チェックが法的に適切であるかを決定する前に、役割、関与する大人、および該当する英国の管轄区域を評価します。',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'イングランドおよびウェールズ',
            'vetting_authority' => '犯罪記録・就業制限照会サービス',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'イングランドとウェールズでは、これはこのコミュニティが記録した拡張 DBS チェックを意味します。誰かが自分の仕事や他のグループを通じて得た小切手は、ここではカウントされません。',
                ],
                'works_with_children' => [
                    'description' => 'コーディネーターがDBSチェックの要件についてご説明する場合があります。',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'コーディネーターが、あなたの計画に DBS チェックが必要かどうかについて相談する場合があります。',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'スコットランド',
            'vetting_authority' => 'Disclosure Scotland（PVG制度）',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => '私は支援または保護を必要とする成人であり、追加の安全保護支援が必要になる可能性があります',
                ],
                'requires_vetted_partners' => [
                    'description' => 'スコットランドでは、これはこのコミュニティが記録した PVG スキームのメンバーシップを意味します。誰かが仕事や別のグループを通じて持っているメンバーシップは、ここではカウントされません。',
                ],
                'works_with_children' => [
                    'description' => 'コーディネーターがPVG制度への加入についてご説明する場合があります。',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => '保護を必要とする成人が関わる可能性のあるサービスを提供する予定です',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => '北アイルランド',
            'vetting_authority' => 'アクセスNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => '北アイルランドでは、これはこのコミュニティが記録した AccessNI 小切手を意味します。誰かが自分の仕事や他のグループを通じて得た小切手は、ここではカウントされません。',
                ],
                'works_with_children' => [
                    'description' => 'コーディネーターがAccessNIチェックについてご説明する場合があります。',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'コーディネーターが、あなたの計画に AccessNI チェックが必要かどうかについて相談する場合があります。',
                ],
            ],
        ],
        'custom' => [
            'name' => 'カスタム',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'あなたのコミュニティはその保護管轄区域を変更しました。既存の保護は引き続き有効ですが、[設定] で更新された文言を確認してください。',
        'jurisdiction_changed_staff' => '保護管轄が変わりました。影響を受けるメンバーの保護は引き続き有効であり、メンバーによるレビューが必要になります。',
        'attestation_policy_rotated_member' => 'あなたのコミュニティは安全保護ポリシーのレビューを開始しました。ブローカーはあなたのプライベートコンタクトステータスを再確認する必要があります。これは証明書の有効期限ではありません。',
        'reminder_subject' => '保護設定を確認してください',
        'reminder_title' => '保護設定を見直す時期が来ました',
        'reminder_body' => ':community の保護設定を行ってから 1 年以上が経過しました。少し時間をとって内容を確認し、引き続き適用されることを確認するか、適用されなくなったものは取り消してください。',
        'reminder_cta' => 'レビュー設定',
        'escalation_subject' => 'メンバー保護のレビューが未処理です',
        'escalation_title' => '年次安全保護審査が未完了',
        'escalation_body' => ':name は、保護設定の見直しリクエストに 30 日間応じていません。メンバーの設定は有効のままです。メンバーはそれらを保持する権利を有します。チェックインをご希望の場合は直接ご連絡ください。',
        'escalation_cta' => '安全保護ダッシュボードでメンバーを表示する',
    ],
];
