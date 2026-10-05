<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Impossibile trovare questa campagna di raccolta fondi.',
    'organisation_locked' => 'Questa campagna ha già ricevuto donazioni, quindi l’organizzazione per cui raccoglie fondi non può più essere cambiata.',
    'organisation_not_eligible' => 'Solo le organizzazioni approvate possono gestire campagne di raccolta fondi.',
    'not_your_campaign' => 'Puoi gestire solo le campagne della tua organizzazione.',
    'handover_not_found' => 'Impossibile trovare questo trasferimento.',
    'handover_amount_positive' => 'Inserisci un importo maggiore di zero.',
    'handover_exceeds_held' => 'È più di quanto questa campagna detenga ancora (:held).',
    'handover_method_invalid' => 'Scegli come è stato trasferito il denaro.',
    'handover_reference_required' => 'Inserisci un riferimento di pagamento in modo che il trasferimento possa essere rintracciato.',
    'handover_date_invalid' => 'Inserisci la data in cui il denaro è stato trasferito. Non può essere nel futuro.',
    'handover_campaign_has_no_organisation' => 'Questa campagna è per l’intera comunità, quindi non c’è alcuna organizzazione a cui trasferire il denaro.',
    'handover_already_closed' => 'Questo trasferimento è già stato confermato o annullato.',
    'cancel_reason_required' => 'Indica un motivo per l’annullamento di questo trasferimento.',
    'email' => [
        'handover_subject' => ':community ha trasferito :amount per :campaign',
        'handover_title' => 'Denaro trasferito a :organisation',
        'handover_body' => ':community ha registrato il trasferimento di :amount raccolti dalla campagna ":campaign" il :date (riferimento :reference). Verifica che siano arrivati e confermalo nella dashboard della tua organizzazione.',
        'handover_cta' => 'Conferma ricezione',
        'handover_bell' => ':community ha trasferito :amount per :campaign. Conferma di averli ricevuti.',
    ],
];
