<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Não foi possível encontrar essa campanha de angariação.',
    'organisation_locked' => 'Esta campanha já recebeu donativos, pelo que a organização para a qual angaria fundos já não pode ser alterada.',
    'organisation_not_eligible' => 'Apenas organizações aprovadas podem realizar campanhas de angariação.',
    'not_your_campaign' => 'Só pode gerir campanhas da sua própria organização.',
    'handover_not_found' => 'Não foi possível encontrar essa entrega.',
    'handover_amount_positive' => 'Introduza um valor superior a zero.',
    'handover_exceeds_held' => 'Isso é mais do que esta campanha ainda detém (:held).',
    'handover_method_invalid' => 'Escolha como o dinheiro foi entregue.',
    'handover_reference_required' => 'Introduza uma referência de pagamento para que a transferência possa ser rastreada.',
    'handover_date_invalid' => 'Introduza a data em que o dinheiro foi entregue. Não pode ser no futuro.',
    'handover_campaign_has_no_organisation' => 'Esta campanha é para toda a comunidade, por isso não há nenhuma organização a quem entregar o dinheiro.',
    'handover_already_closed' => 'Esta entrega já foi confirmada ou cancelada.',
    'cancel_reason_required' => 'Indique um motivo para cancelar esta entrega.',
    'email' => [
        'handover_subject' => ':community entregou :amount da campanha :campaign',
        'handover_title' => 'Dinheiro entregue a :organisation',
        'handover_body' => ':community registou a entrega de :amount angariados pela campanha ":campaign" em :date (referência :reference). Verifique se chegou e confirme no painel da sua organização.',
        'handover_cta' => 'Confirmar receção',
        'handover_bell' => ':community entregou :amount da campanha :campaign. Confirme que chegou.',
    ],
];
