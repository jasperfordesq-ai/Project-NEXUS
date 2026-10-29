<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Billets d\'événement',
    'intro' => 'Passez en revue les types de billets disponibles, réclamez des places gratuites et gérez vos propres billets gratuits confirmés.',
    'load_error' => 'Le catalogue de billets d\'événement n\'a pas pu être chargé.',
    'validation_error' => 'Vérifiez les détails du billet et réessayez.',
    'allocate_error' => 'Le billet gratuit n\'a pas pu être attribué. Vérifiez votre inscription, votre éligibilité et l’allocation restante.',
    'cancel_error' => 'Le billet gratuit n\'a pas pu être annulé. Actualisez le catalogue et réessayez.',
    'allocated' => 'Votre billet gratuit a été attribué.',
    'cancelled' => 'Votre billet gratuit a été annulé et renvoyé dans l\'allocation.',
    'back_to_event' => 'Retour à l\'événement',
    'back_to_tickets' => 'Retour aux billets d\'événement',
    'gateway_disabled' => 'Le paiement payant et avec crédit de temps n\'est pas disponible. Cette page ne facture jamais d\'argent ni de crédits de temps et ne change pas votre portefeuille.',
    'my_tickets' => 'Mes billets',
    'no_tickets' => 'Vous n\'avez pas de billet pour cet événement.',
    'ticket_fallback' => 'Billet d\'événement',
    'units' => 'Quantité',
    'status_label' => 'Statut',
    'status' => [
        'confirmed' => 'Confirmé',
        'cancelled' => 'Annulé',
    ],
    'cancel_ticket' => 'Annuler le billet',
    'time_credit_cancel_disabled' => 'L’annulation d’un ticket avec crédit de temps n’est pas disponible dans ce flux de travail gratuit uniquement. Aucune action sur le portefeuille n\'a été entreprise.',
    'catalogue' => 'Billets disponibles',
    'catalogue_empty' => 'Aucun type de billet n\'est disponible pour cet événement.',
    'kind' => [
        'free' => 'Gratuit',
        'time_credit' => 'Crédits de temps',
    ],
    'remaining' => 'Allocation restante',
    'member_limit' => 'Limite par membre',
    'time_credit_disabled' => 'Ce type coûte :credits crédits de temps, mais le paiement est désactivé jusqu\'à ce que la passerelle de portefeuille approuvée soit connectée. Aucun crédit ne sera débité.',
    'units_to_claim' => 'Nombre de billets gratuits',
    'reconcile' => 'Exécuter la réconciliation',
    'reconciliation_clear' => 'L\'inventaire des billets et les enregistrements du grand livre sont rapprochés.',
    'reconciliation_warnings' => '{1} :count avertissement de rapprochement|[2,*] :count avertissements de rapprochement',
    'reconciliation_error' => 'Le rapprochement des tickets n\'a pas pu être effectué.',
    'units_hint' => 'Vous pouvez réclamer jusqu\'à :count dans cette allocation.',
    'claim_free' => 'Réclamez un billet gratuit',
    'registration_required' => 'Vous avez besoin d\'une inscription confirmée à l\'événement avant de pouvoir réclamer un billet gratuit.',
    'not_eligible' => 'Vous ne répondez pas actuellement aux règles d’éligibilité de ce type de billet.',
    'sales_closed' => 'Ce type de billet n\'est actuellement pas ouvert à l\'attribution.',
    'sold_out' => 'Il ne vous reste aucun billet gratuit dans cette allocation.',
    'cancel_title' => 'Annuler ce billet gratuit ?',
    'cancel_intro' => 'Dites à l\'organisateur pourquoi vous annulez. La quantité sera reversée dans l\'allocation gratuite.',
    'cancel_free_only' => 'Cette action annule uniquement un droit gratuit. Il n’émet pas de remboursement ni ne modifie le solde du portefeuille.',
    'reason_label' => 'Raison de l\'annulation',
    'reason_hint' => 'N’incluez pas d’informations privées ou sensibles. 500 caractères maximum.',
    'confirm_cancel' => 'Annuler le billet gratuit',
];
