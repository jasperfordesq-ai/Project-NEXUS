<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'manage' => [
        'title' => 'Gérez vos crédits',
        'caption' => 'Crédits de temps',
        'description' => 'Consultez vos crédits en attente en un coup d\'œil, envoyez des crédits à un membre ou faites un don au fonds communautaire.',
        'back_to_wallet' => 'Retour à votre portefeuille',
    ],
    'balance' => [
        'heading' => 'Votre solde',
        'label' => 'Solde disponible',
        'pending_badge_in' => '{0} Aucun crédit en attente|{1} En attente dans : :count heure|[2,*] En attente dans : :count heures',
        'no_pending' => 'Aucun crédit en attente',
    ],
    'stats' => [
        'heading' => 'Résumé',
        'earned' => 'Gagné',
        'spent' => 'Dépensé',
        'pending' => 'En attente',
        'earned_value' => '+:value heures',
        'spent_value' => '-:value heures',
        'pending_value' => ':value heures',

        'pending_in' => 'En attente — entrants',

        'pending_out' => 'En attente — sortants',
        'pending_hint' => 'Crédits entrants et sortants qui ne sont pas encore terminés.',
    ],
    'hours_value' => ':value heures',
    'member_since' => 'Membre depuis :date',
    'transfer' => [
        'heading' => 'Envoyer des crédits à un membre',
        'description' => 'Recherchez un membre par son nom, puis choisissez le nombre d\'heures à envoyer.',
        'prefill_notice' => 'Un destinataire a été présélectionné à partir de votre lien. Vérifiez les détails avant d\'envoyer.',
        'search_label' => 'Rechercher un membre',
        'search_hint' => 'Tapez un nom et sélectionnez Rechercher.',
        'search_button' => 'Recherche',
        'search_empty' => 'Aucun membre ne correspond à votre recherche.',
        'recipient_heading' => 'Membres correspondants',
        'amount_label' => 'Montant en heures',
        'amount_hint' => 'Par exemple, 1 ou 2,5. Vous pouvez envoyer jusqu\'à 1000 heures.',
        'note_label' => 'Ajouter une note (facultatif)',
        'note_hint' => 'Le destinataire le verra avec le transfert.',
        'send_button' => 'Envoyer des crédits à :name',
    ],
    'donate' => [
        'heading' => 'Faire un don de crédits',
        'description' => 'Donnez une partie de vos crédits temps au fonds communautaire, ou directement à un autre membre.',
        'credits_not_money' => 'Cela fait don de vos crédits de temps à un pool communautaire partagé. Il ne s\'agit pas d\'un don d\'argent.',
        'warning' => 'Les dons déplacent les crédits dans un sens et ne peuvent être annulés.',
        'target_legend' => 'À qui souhaiteriez-vous faire un don ?',
        'target_fund' => 'Le fonds communautaire',
        'target_fund_hint' => 'Un pool partagé sur lequel tout membre peut puiser.',
        'target_member' => 'Un membre spécifique',
        'target_member_hint' => 'Recherchez le membre ci-dessous avant de faire un don.',
        'fund_balance_label' => 'Solde du fonds communautaire',
        'fund_donated_label' => 'Total des dons des membres',
        'recipient_required' => 'Recherchez et sélectionnez un membre à qui faire un don en premier.',
        'amount_label' => 'Montant en heures',
        'amount_hint' => 'Heures entières seulement, jusqu\'à 1000.',
        'message_label' => 'Ajouter un message (facultatif)',
        'message_hint' => 'Un petit mot pour accompagner votre don.',
        'button_fund' => 'Faire un don au fonds communautaire',
        'button_member' => 'Faire un don à :name',
    ],
    'states' => [
        'success_title' => 'Succès',
        'error_title' => 'Il y a un problème',
        'warning' => 'Avertissement',
        'transfer_sent' => 'Vos crédits ont été envoyés.',
        'donate_sent' => 'Merci. Votre don a été effectué.',
    ],
    'errors' => [
        'invalid' => 'Entrez un montant et un destinataire valides.',
        'insufficient' => 'Vous n\'avez pas assez de crédits pour cela.',
        'not_found' => 'Ce membre est introuvable.',
        'self' => 'Vous ne pouvez pas vous envoyer de crédits.',
        'inactive' => 'Ce membre ne peut pas recevoir de crédits pour le moment.',
        'too_large' => 'Ce montant est trop important.',
        'decimals' => 'Les dons doivent durer des heures entières.',
        'failed' => 'Quelque chose s\'est mal passé. Veuillez réessayer.',
    ],
    'footer' => [
        'wallet_link' => 'Consultez votre portefeuille complet et l\'historique de vos transactions',
    ],
    'nav' => [
        'manage' => 'Gérez vos crédits',
    ],
];
