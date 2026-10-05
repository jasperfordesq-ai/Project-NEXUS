<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Cette campagne de collecte est introuvable.',
    'organisation_locked' => 'Cette campagne a déjà reçu des dons : l’organisation pour laquelle elle collecte ne peut donc plus être modifiée.',
    'organisation_not_eligible' => 'Seules les organisations approuvées peuvent mener des campagnes de collecte.',
    'not_your_campaign' => 'Vous ne pouvez gérer que les campagnes de votre propre organisation.',
    'handover_not_found' => 'Ce versement est introuvable.',
    'handover_amount_positive' => 'Saisissez un montant supérieur à zéro.',
    'handover_exceeds_held' => 'C’est plus que ce que cette campagne détient encore (:held).',
    'handover_method_invalid' => 'Choisissez comment l’argent a été reversé.',
    'handover_reference_required' => 'Saisissez une référence de paiement pour que le virement puisse être retrouvé.',
    'handover_date_invalid' => 'Saisissez la date à laquelle l’argent a été reversé. Elle ne peut pas être dans le futur.',
    'handover_campaign_has_no_organisation' => 'Cette campagne concerne toute la communauté : il n’y a donc aucune organisation à qui reverser l’argent.',
    'handover_already_closed' => 'Ce versement a déjà été confirmé ou annulé.',
    'paused_by_community' => 'Un administrateur de la communauté a mis cette campagne en pause : seule la communauté peut la relancer.',
    'cancel_reason_required' => 'Indiquez la raison de l’annulation de ce versement.',
    'email' => [
        'handover_subject' => ':community a reversé :amount pour :campaign',
        'handover_title' => 'Argent reversé à :organisation',
        'handover_body' => ':community a enregistré le reversement de :amount collectés par la campagne « :campaign », le :date (référence :reference). Vérifiez que la somme est bien arrivée et confirmez-le sur le tableau de bord de votre organisation.',
        'handover_cta' => 'Confirmer la réception',
        'handover_bell' => ':community a reversé :amount pour :campaign. Veuillez confirmer la réception.',
    ],
];
