<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'Le montant des frais doit être supérieur à zéro.',
        'invalid_billing_cycle' => 'Le cycle de facturation doit être l\'un des suivants : annuel, biennal ou mensuel.',
        'fee_not_configured' => 'Aucun frais d\'adhésion actif n\'est configuré pour ce Verein.',
        'organization_not_found' => 'Verein introuvable.',
        'organization_not_club' => 'Cette organisation n\'est pas un Verein.',
        'organization_required' => 'Organization_id est requis.',
        'dues_not_found' => 'Dossier de cotisation introuvable.',
        'cannot_waive_paid' => 'Impossible de renoncer à une ligne de cotisation déjà payée.',
        'cannot_remind_status' => 'Les rappels ne peuvent être envoyés que pour les cotisations en attente ou en retard.',
        'cannot_pay_status' => 'Cette ligne de cotisations n\'est pas dans un état payable.',
        'payment_intent_failed' => 'Impossible de démarrer le processus de paiement. Veuillez réessayer plus tard.',
        'waive_reason_required' => 'Un motif de renonciation est requis.',
    ],
];
