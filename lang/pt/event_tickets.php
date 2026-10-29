<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Ingressos para eventos',
    'intro' => 'Revise os tipos de ingressos disponíveis, reivindique vagas gratuitas e gerencie seus próprios ingressos gratuitos confirmados.',
    'load_error' => 'Não foi possível carregar o catálogo de ingressos do evento.',
    'validation_error' => 'Verifique os detalhes do ticket e tente novamente.',
    'allocate_error' => 'O ingresso gratuito não pôde ser alocado. Verifique sua inscrição, elegibilidade e a alocação restante.',
    'cancel_error' => 'O bilhete gratuito não pôde ser cancelado. Atualize o catálogo e tente novamente.',
    'allocated' => 'Seu ingresso grátis foi alocado.',
    'cancelled' => 'Seu ingresso gratuito foi cancelado e devolvido à alocação.',
    'back_to_event' => 'Voltar ao evento',
    'back_to_tickets' => 'Voltar aos ingressos do evento',
    'gateway_disabled' => 'O check-out pago e com crédito a prazo não está disponível. Esta página nunca cobra dinheiro ou créditos de tempo e não altera sua carteira.',
    'my_tickets' => 'Meus ingressos',
    'no_tickets' => 'Você não tem ingresso para este evento.',
    'ticket_fallback' => 'Bilhete do evento',
    'units' => 'Quantidade',
    'status_label' => 'Estado',
    'status' => [
        'confirmed' => 'Confirmado',
        'cancelled' => 'Cancelado',
    ],
    'cancel_ticket' => 'Cancelar ingresso',
    'time_credit_cancel_disabled' => 'O cancelamento do bilhete com crédito de tempo não está disponível neste fluxo de trabalho gratuito. Nenhuma ação na carteira foi realizada.',
    'catalogue' => 'Ingressos disponíveis',
    'catalogue_empty' => 'Nenhum tipo de ingresso está disponível para este evento.',
    'kind' => [
        'free' => 'Grátis',
        'time_credit' => 'Créditos de tempo',
    ],
    'remaining' => 'Alocação restante',
    'member_limit' => 'Limite por membro',
    'time_credit_disabled' => 'Este tipo custa :credits créditos de tempo, mas o checkout fica desativado até que o gateway de carteira aprovado seja conectado. Nenhum crédito será debitado.',
    'units_to_claim' => 'Número de ingressos grátis',
    'reconcile' => 'Executar reconciliação',
    'reconciliation_clear' => 'O inventário de tickets e os registros contábeis são reconciliados.',
    'reconciliation_warnings' => '{1} :count aviso de reconciliação|[2,*] :count avisos de reconciliação',
    'reconciliation_error' => 'Não foi possível concluir a reconciliação do ticket.',
    'units_hint' => 'Você pode reivindicar até :count nesta alocação.',
    'claim_free' => 'Solicite ingresso grátis',
    'registration_required' => 'Você precisa de uma inscrição confirmada no evento antes de poder reivindicar um ingresso grátis.',
    'not_eligible' => 'No momento, você não atende às regras de elegibilidade deste tipo de ingresso.',
    'sales_closed' => 'Este tipo de ticket não está atualmente aberto para alocação.',
    'sold_out' => 'Não restam ingressos grátis para você nesta alocação.',
    'cancel_title' => 'Cancelar este ingresso grátis?',
    'cancel_intro' => 'Diga ao organizador por que você está cancelando. A quantidade será devolvida à alocação gratuita.',
    'cancel_free_only' => 'Esta ação cancela apenas um direito gratuito. Não emite reembolso nem altera qualquer saldo da carteira.',
    'reason_label' => 'Motivo do cancelamento',
    'reason_hint' => 'Não inclua informações privadas ou confidenciais. Máximo de 500 caracteres.',
    'confirm_cancel' => 'Cancelar ingresso grátis',
];
