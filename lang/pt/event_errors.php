<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Os dados de inscrição só podem ser revistos para eliminação depois de o evento terminar. Escolha uma data posterior ao fim do evento.',
        'settings_required' => 'Guarde primeiro as definições de inscrição deste evento. Estas definem durante quanto tempo os dados de inscrição são conservados.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Essa hora de envio já passou. Escolha uma hora futura ou envie a mensagem agora.',
        'post_event_too_early' => 'Uma mensagem para depois do evento só pode ser enviada quando o evento terminar. Escolha uma hora posterior ao fim do evento.',
        'audience_empty' => 'Ninguém receberia esta mensagem. Escolha um público que inclua pelo menos uma pessoa.',
        'channel_empty' => 'Escolha pelo menos uma forma de enviar esta mensagem.',
        'body_invalid' => 'Escreva uma mensagem com no máximo :max caracteres.',
    ],
];
