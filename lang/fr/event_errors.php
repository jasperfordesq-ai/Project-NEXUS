<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Les données d’inscription ne peuvent être examinées en vue de leur suppression qu’après la fin de l’événement. Choisissez une date postérieure à la fin de l’événement.',
        'settings_required' => 'Enregistrez d’abord les paramètres d’inscription de cet événement. Ils déterminent la durée de conservation des données d’inscription.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Cette heure d’envoi est déjà passée. Choisissez une heure future ou envoyez le message maintenant.',
        'post_event_too_early' => 'Un message destiné à l’après-événement ne peut être envoyé qu’une fois l’événement terminé. Choisissez une heure postérieure à la fin de l’événement.',
        'audience_empty' => 'Personne ne recevrait ce message. Choisissez un public qui comprend au moins une personne.',
        'channel_empty' => 'Choisissez au moins un moyen d’envoyer ce message.',
        'body_invalid' => 'Rédigez un message de :max caractères au maximum.',
    ],
];
