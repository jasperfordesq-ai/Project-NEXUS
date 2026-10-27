<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Page chrome for the PLATFORM's own legal documents (Project NEXUS, not a
// community) on the accessible frontend: /platform/terms, /platform/privacy and
// /platform/disclaimer. Ported from react-frontend/public/locales/<locale>/legal.json
// (platform, platform_terms, platform_privacy, platform_disclaimer, page_meta, hub).
// The documents' substantive text is canonically English and is NOT translated
// here — see web-uk/scripts/build-platform-legal-text.js.

return [
    'caption' => 'プロジェクトNEXUSプラットフォーム',
    'effective_date' => '有効 :date',
    'provider_notice_title' => 'プラットフォーム提供者のお知らせ',
    'provider_notice_body' => 'この文書は、あなたとプロジェクトNEXUS（プラットフォーム提供者）との関係を規定します。これは、:tenant（あなたのコミュニティオペレーター）によって定められた条件とは別のものです。',
    'authoritative_notice_title' => '正式な英語版',
    'authoritative_notice_body' => 'このページの実質的な法的本文は正式な英語版です。このお知らせは便宜のために翻訳されています。翻訳に相違がある場合は、英語の本文が優先されます。',
    'view_tenant_legal' => ':tenantの法的文書を表示',
    'contents' => 'コンテンツ',
    'related_documents' => '関連プラットフォーム文書',
    'cta_title' => 'この文書についての質問はありますか？',
    'cta_body' => 'このプラットフォームレベルの文書について質問がある場合は、プロジェクトNEXUSチームにお問い合わせください。あなたのコミュニティのポリシーについての質問は、直接:tenantにお問い合わせください。',
    'nexus_website' => 'プロジェクトNEXUSウェブサイト',
    'contact_tenant' => ':tenantに連絡',
    'documents' => [
        'terms' => [
            'page_title' => 'プラットフォーム利用規約',
            'title' => 'プラットフォーム利用規約',
            'subtitle' => 'プロジェクトNEXUSプラットフォームインフラを規定する条件',
            'meta_title' => 'プラットフォーム利用規約',
            'meta_description' => 'NEXUSコミュニティタイムバンキングプラットフォームの利用に関する規約。',
            'link_label' => 'プラットフォーム利用規約',
            'sections' => [
                'introduction' => 'はじめにと同意',
                'provider' => 'プラットフォーム提供者の身元',
                'definitions' => '定義',
                'operator-responsibilities' => '運営者の責務',
                'acceptable-use' => '許容される利用',
                'intellectual-property' => '知的財産',
                'limitation-of-liability' => '責任の制限',
                'indemnification' => '免責補償',
                'data-processing' => 'データの処理',
                'termination' => '終了',
                'changes' => '規約の変更',
                'governing-law' => '準拠法',
            ],
        ],
        'privacy' => [
            'page_title' => 'プラットフォームプライバシーポリシー',
            'title' => 'プラットフォームプライバシーポリシー',
            'subtitle' => 'プロジェクトNEXUSがプラットフォームインフラレベルでデータをどのように扱うか',
            'meta_title' => 'プラットフォームプライバシーポリシー',
            'meta_description' => 'NEXUSプラットフォームがあなたの個人データをどのように収集、処理、保護するか。',
            'link_label' => 'プラットフォームプライバシーポリシー',
            'sections' => [
                'introduction' => 'はじめに',
                'controller-processor' => '管理者と処理者の区別',
                'data-collected' => 'プラットフォーム側で収集するデータ',
                'legal-basis' => '処理の法的根拠',
                'data-sharing' => 'データの共有',
                'international-transfers' => 'データの国際移転',
                'retention' => 'データの保持',
                'your-rights' => 'GDPRに基づくお客様の権利',
                'security' => 'セキュリティ対策',
                'contact' => 'お問い合わせ',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'プラットフォーム免責事項',
            'title' => 'プラットフォーム免責事項',
            'subtitle' => 'プロジェクトNEXUSプラットフォームに関する重要な免責事項と責任制限',
            'meta_title' => 'プラットフォーム免責事項',
            'meta_description' => 'NEXUSコミュニティタイムバンキングプラットフォームの利用に関する重要な免責事項。',
            'link_label' => 'プラットフォーム免責事項',
            'sections' => [
                'no-warranty' => '無保証',
                'no-advice' => '法律・財務・規制に関する助言は行いません',
                'operator-independence' => 'コミュニティ運営者の独立性',
                'member-interactions' => 'メンバー間のやり取り',
                'content-uploads' => 'コンテンツおよびアップロード',
                'identity-verification' => '本人確認',
                'third-party' => '第三者サービス',
                'limitation-of-liability' => '責任の制限',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'プラットフォームプロバイダーの法務',
        'section_desc' => 'これらの文書は、Project NEXUS プラットフォーム インフラストラクチャを管理するものであり、コミュニティのポリシーとは別のものです。',
        'terms' => 'プラットフォーム規約',
        'privacy' => 'プラットフォームのプライバシー',
        'disclaimer' => '免責事項',
    ],
];
