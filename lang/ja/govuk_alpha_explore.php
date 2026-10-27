<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Accessible Explore page (web-uk) — parity with React's ExplorePage.
// Most strings reuse react-frontend/public/locales/<locale>/explore.json.

return [
    'tabs_label' => 'コンテンツタブを探索',
    'tabs' => [
        'all' => 'すべて',
        'for_you' => 'あなたのために',
        'listings' => 'リスティング',
        'people' => '人',
        'events' => 'イベント',
        'groups' => 'グループ',
    ],
    'search_label' => 'スキル、イベント、グループを発見',
    'search_button' => '検索',
    'categories_heading' => 'カテゴリ別にリストを見る',
    'see_all' => 'すべて表示',
    'stats' => [
        'heading' => '数字で見るコミュニティ',
        'members' => 'メンバー',
        'exchanges_this_month' => '今月の交換',
        'hours_exchanged' => '交換された時間',
        'active_listings' => 'アクティブなリスト',
    ],
    'sections' => [
        'trending_posts' => [
            'title' => 'トレンドの投稿',
            'subtitle' => '今週の最もエンゲージメントの高い投稿',
        ],
        'popular_listings' => [
            'title' => '人気のリスト',
            'subtitle' => '最も閲覧されたオファーとリクエスト',
        ],
        'upcoming_events' => [
            'title' => '今後のイベント',
            'subtitle' => 'あなたのコミュニティに参加しましょう',
        ],
        'active_groups' => [
            'title' => 'アクティブなグループ',
            'subtitle' => '志を同じくするメンバーとつながりましょう',
        ],
        'top_contributors' => [
            'title' => 'トップ貢献者',
            'subtitle' => '経験によるコミュニティリーダー',
        ],
        'trending_hashtags' => [
            'title' => 'トレンドのハッシュタグ',
            'subtitle' => 'あなたのコミュニティで人気のトピック',
        ],
        'recommended' => [
            'title' => 'あなたへのおすすめ',
            'subtitle' => 'あなたの興味と活動に基づいて',
        ],
        'near_you' => [
            'title' => 'あなたの近く',
            'subtitle' => 'あなたの位置に近いリスト',
        ],
        'suggested_connections' => [
            'title' => 'あなたが知っているかもしれない人々',
            'subtitle' => 'あなたの興味を共有するメンバーとつながりましょう',
        ],
        'blog_posts' => [
            'title' => 'ブログから',
            'subtitle' => 'あなたのコミュニティの最新のストーリー',
        ],
        'volunteering' => [
            'title' => 'ボランティアの機会',
            'subtitle' => 'あなたのコミュニティに変化をもたらしましょう',
        ],
        'polls' => [
            'title' => 'アクティブな投票',
            'subtitle' => 'コミュニティのトピックについて意見を述べましょう',
        ],
        'in_demand_skills' => [
            'title' => '需要のあるスキル',
            'subtitle' => 'あなたのコミュニティで最もリクエストされているスキル',
        ],
        'organisations' => [
            'title' => '組織',
            'subtitle' => '影響を与えるコミュニティパートナー',
        ],
        'jobs' => [
            'title' => '仕事の機会',
            'subtitle' => 'コミュニティパートナーからの最新の求人',
        ],
        'resources' => [
            'title' => '特集リソース',
            'subtitle' => 'あなたのコミュニティのためのガイドと資料',
        ],
        'new_members' => [
            'title' => '新しいメンバーを歓迎します',
            'subtitle' => '最近参加した人に挨拶しましょう',
        ],
        'featured_challenges' => [
            'title' => '注目のチャレンジ',
            'subtitle' => 'あなたのアイデアを共有して影響を与えましょう',
        ],
    ],
    'meta' => [
        'attending' => ':count が参加中',
        'members' => ':count メンバー',
        'level' => 'レベル :level',
        'match' => ':score% マッチ',
        'by_author' => ':nameによって',
        'distance' => ':distance km離れています',
        'read_time' => ':count分で読めます',
        'applications' => ':count件応募済み',
        'votes' => ':count票',
        'closes' => '締切 :date',
        'requesting' => ':count リクエスト中',
        'offering' => ':count 提供中',
        'opportunities' => ':count件の機会',
        'deadline' => '締切: :date',
        'ideas' => ':count アイデア',
        'ends' => '終了 :date',
    ],
    'content_types' => [
        'listing' => 'リスト',
        'post' => '投稿',
        'event' => 'イベント',
        'group' => 'グループ',
        'member' => 'メンバー',
        'blog' => 'ブログ記事',
    ],
    'dismiss' => '興味なし',
    'dismissed' => 'このリストを今後おすすめしません。',
    'dismiss_failed' => 'このおすすめを非表示にできませんでした。後でもう一度お試しください。',
    'for_you' => [
        'empty' => 'リスティング、投稿、イベントと対話して、パーソナライズされたおすすめを受け取りましょう。',
        'end_of_feed' => 'すべての情報をキャッチアップしました！',
        'load_more' => 'おすすめをもっと表示',
        'load_error' => 'あなた向けのおすすめを読み込めませんでした。後でもう一度お試しください。',
    ],
    'load_error' => '発見セクションを読み込めませんでした。一時的な問題の可能性があります。後でもう一度お試しください。',
    'empty' => [
        'listings' => '表示するリスティングはまだありません。最初に作成してみましょう！',
        'people' => '表示するメンバーはまだいません。誰かを招待して参加させましょう！',
        'events' => '今後のイベントはありません。コミュニティを集めるために作成しましょう！',
        'groups' => 'まだアクティブなグループはありません。あなたの興味に基づいてグループを始めましょう！',
    ],
    'create_listing' => 'リスティングを作成',
    'create_group' => 'グループを作成',
];
