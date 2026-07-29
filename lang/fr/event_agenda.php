<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'withdraw_confirmation' => 'Je comprends que ma place pour :title sera libérée et pourra être attribuée à une autre personne.',
    'capacity_label' => 'Capacité de la séance',
    'capacity_hint' => 'Laissez vide pour un nombre de places illimité. Les places de séance ne modifient ni l’inscription à l’événement ni les billets.',
    'capacity_unlimited' => ':registered inscrits · sans limite',
    'capacity_limited' => ':registered inscrits sur :limit',
    'resources_title' => 'Ressources de la séance',
    'resources_hint' => 'Ajoutez les liens HTTPS dans l’ordre d’affichage. Les diffusions et enregistrements doivent être réservés aux personnes inscrites ou au personnel.',
    'resource_number' => 'Ressource :number',
    'resource_type' => 'Type de ressource',
    'resource_visibility' => 'Personnes autorisées',
    'resource_title' => 'Titre de la ressource',
    'resource_url' => 'URL HTTPS sécurisée',
    'resource_url_hint' => 'Utilisez une adresse complète commençant par https://.',
    'resource_types' => [
        'link' => 'Lien',
        'document' => 'Document',
        'slides' => 'Diapositives',
        'download' => 'Téléchargement',
        'stream' => 'Diffusion en direct',
        'recording' => 'Enregistrement',
    ],
    'opens_new_window' => 'S’ouvre dans une nouvelle fenêtre',
    'resource_unavailable' => 'Lien indisponible',
    'registered_success' => 'Vous êtes inscrit à la séance.',
    'withdrawn_success' => 'Vous vous êtes désinscrit de la séance.',
    'register_action' => 'S’inscrire à la séance',
    'withdraw_action' => 'Se désinscrire de la séance',
    'registered_state' => 'Inscription confirmée pour cette séance',
    'ineligible_state' => 'Votre inscription à l’événement ne donne plus accès à cette séance.',
    'full_state' => 'Cette séance est complète.',
    'session_full_error' => 'Il ne reste aucune place pour cette séance.',
    'eligibility_error' => 'Confirmez votre inscription à l’événement avant de vous inscrire à une séance.',
];
