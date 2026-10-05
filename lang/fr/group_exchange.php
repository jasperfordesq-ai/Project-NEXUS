<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Choisissez l’un des cinq types d’échange de groupe.',
        'no_givers' => 'Ajoutez au moins une personne qui donne du temps.',
        'no_receivers' => 'Ajoutez au moins une personne qui reçoit du temps.',
        'hours_missing' => 'Indiquez pour chaque personne un nombre d’heures supérieur à zéro.',
        'earned_exceeds_paid' => 'Les personnes qui donnent du temps gagneraient :earned heures, mais les participants ne paieraient que :paid. Dans un atelier ou un cours, chaque participant paie le temps qu’il reçoit, il doit donc payer au moins autant que ce qui est gagné. Si plusieurs personnes donnent leur temps à une seule personne, choisissez plutôt « Une équipe aide quelqu’un ».',
        'unbalanced' => 'Les heures gagnées (:earned) doivent être égales aux heures payées (:paid). Modifiez certains chiffres pour qu’ils correspondent.',
    ],
    'ledger' => [
        'to_fund' => 'Échange de groupe « :title » – heures restantes au Fonds communautaire',
    ],
    'fund' => [
        'description' => 'Heures restantes de l’échange de groupe « :title »',
    ],
];
