<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'caption' => 'Lieux',
    'index' => [
        'title' => 'Lieux partenaires',
        'intro' => 'Lieux locaux qui accueillent votre pass membre. Toute offre présentée est gérée par le lieu lui-même.',
        'my_pass' => 'Montrer mon pass',
        'empty' => 'Aucun lieu partenaire n\'a encore été ajouté.',
        'website' => 'Visiter le site Web (ouvre le propre site du lieu)',
        'how_it_works' => 'Présentez votre pass à la caisse. Un membre du personnel le scanne avec son téléphone pour enregistrer votre visite : rien n\'est facturé et aucun détail de paiement n\'est impliqué.',
    ],
    'pass' => [
        'title' => 'Mon pass salle',
        'back' => 'Retour aux lieux partenaires',
        'intro' => 'Présentez ce code dans un lieu partenaire. Le personnel le scanne avec l\'appareil photo de son téléphone pour enregistrer votre visite.',
        'qr_alt' => 'Code QR de votre pass personnel pour salle',
        'privacy' => 'Votre pass vous identifie uniquement auprès du personnel du site connecté à cette communauté. Ce n\'est pas une carte de paiement et ne contient pas d\'argent.',
        'rotate_hint' => 'Si quelqu\'un a photographié votre code, procurez-vous-en un nouveau : l\'ancien code cesse de fonctionner immédiatement.',
        'rotate_button' => 'Obtenez un nouveau code',
        'rotated_notice' => 'Votre pass a un nouveau code. Le code précédent ne fonctionne plus.',
        'visits_title' => 'Vos visites enregistrées',
        'visits_empty' => 'Aucune visite enregistrée pour l\'instant.',
    ],
    'checkin' => [
        'title' => 'Enregistrer la visite d\'un membre',
        'intro' => 'Vous êtes sur le point d\'enregistrer la visite d\'un membre dans votre établissement. Rien n\'a encore été enregistré — confirmez ci-dessous.',
        'confirm' => 'Enregistrez cette visite',
        'choose_venue' => 'Pour quel lieu s\'adresse cette visite ?',
        'recorded' => 'Visite enregistrée pour :member à :venue.',
        'already_recorded' => 'Une visite pour :member a déjà été enregistrée aujourd\'hui.',
        'visits_this_month' => 'Visites ce mois-ci : :count',
        'challenge_completed' => 'Défi terminé : :title',
        'done' => 'Fait',
        'forbidden_title' => 'Vous ne pouvez pas enregistrer les visites',
        'forbidden_body' => 'Seul le personnel d\'un lieu partenaire peut enregistrer les visites, et le personnel ne peut pas enregistrer sa propre visite. Demandez à un administrateur de la communauté de vous ajouter au personnel du lieu.',
        'invalid_title' => 'Ce pass n\'est pas valide',
        'invalid_body' => 'Le pass scanné n\'existe pas ou a été révoqué. Demandez au membre d’ouvrir à nouveau son pass et de le scanner à nouveau.',
    ],
];
