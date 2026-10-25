<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Esta conversa está pausada por uma regra de proteção da comunidade. A sua comunidade deve ter registado uma confirmação atual do estado :types antes de poder enviar mensagens a este membro. Peça à pessoa mediadora ou à equipa de administração da comunidade que registe este estado apenas como metadados. Não envie nem carregue qualquer documento de verificação.',
        'vetting_required_title' => 'Verificacao de protecao necessaria',
        'vetting_required_detail' => 'Este membro só pode ser contactado para este tipo de interação por pessoas cuja comunidade tenha registado um estado :types atual. O registo contém apenas metadados; não deve ser enviado nem carregado qualquer documento.',
        'vetting_required_action' => 'Abrir ajuda',
        'contact_restricted' => 'Este membro só pode ser contatado através de um coordenador. Nada foi enviado. Você pode pedir a um coordenador para entrar em contato com você.',
        'contact_restricted_title' => 'Contato através de um coordenador',
        'contact_restricted_detail' => 'O contato com esse membro é feito por meio de um coordenador. Você pode pedir a um coordenador para entrar em contato com você.',
        'contact_via_coordinator' => 'Você optou por que um coordenador providenciasse contato para você, então nada foi enviado. Peça a um coordenador para colocá-lo em contato com esse membro.',
        'contact_via_coordinator_title' => 'Peça a um coordenador para colocá-lo em contato',
        'contact_via_coordinator_detail' => 'Você optou por ter um coordenador para providenciar contato para você. Pergunte a um coordenador e, depois que ele aprovar esse membro, vocês poderão conversar entre si.',
        'contact_restricted_action' => 'Abrir ajuda',
        'coordination_not_required' => 'O contacto direto com este membro está atualmente disponível — não necessita de um coordenador para o organizar. Por favor, atualize a página e tente enviar uma mensagem novamente.',
        'coordination_request_failed' => 'Não foi possível enviar o seu pedido ao coordenador neste momento. Por favor, tente novamente em breve.',
        'vetting_check_failed' => 'Não foi possível confirmar o seu estado de verificação neste momento. Por favor, tente novamente em breve.',
        'policy_unavailable' => 'Não podemos confirmar a política de salvaguarda da comunidade neste momento. Nenhuma mensagem foi enviada. Por favor, tente novamente em breve.',
        'blocked_interaction' => 'Não pode interagir com este membro.',
        'interaction_not_allowed' => 'A política de salvaguarda da comunidade do destinatário não permite esta interação direta. Peça ajuda a um coordenador.',
        'policy_unavailable_title' => 'Verificação de proteção temporariamente indisponível',
        'policy_unavailable_detail' => 'O Projeto NEXUS não conseguiu avaliar com segurança a política de contato, portanto esta interação foi pausada.',
        'policy_unavailable_action' => 'Verifique novamente',
        'listing_role_confirmation_required' => 'Esta listagem requer uma decisão separada de DBS Avançado confirmada pela comunidade para esta função. Uma confirmação de contato do mensageiro não atende aos requisitos de proteção específicos da função.',
        'listing_role_feature_unavailable' => 'A verificação de antecedentes criminais específica da função ainda não pode ser habilitada aqui. A confirmação de contato do Messenger não é reutilizada deliberadamente como liberação de função.',
        'compliance_policy_unavailable' => 'Não podemos confirmar com segurança os requisitos de proteção para esta listagem neste momento. Tente novamente mais tarde ou entre em contato com seu corretor.',
        'statement_required' => 'É necessário um PDF da Declaração de Proteção à Criança antes de você declarar que esta comunidade trabalha com crianças ou adultos vulneráveis. Faça upload de um para continuar.',
        'invalid_file' => 'O arquivo enviado não pôde ser lido. Tente novamente com um PDF válido.',
        'pdf_required' => 'A declaração de salvaguarda deve ser um arquivo PDF.',
        'file_too_large' => 'O arquivo da declaração de salvaguarda é muito grande. O tamanho máximo é 10MB.',
        'storage_failed' => 'Não foi possível salvar o arquivo enviado. Por favor, tente novamente.',
        'statement_missing' => 'Nenhuma declaração de salvaguarda está arquivada para esta comunidade.',
        'file_missing' => 'O arquivo da instrução de salvaguarda não foi encontrado no servidor. Faça upload novamente.',
        'revoke_failed' => 'Não poderíamos revogar essa preferência. Pode já ter sido revogado.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Básico',
        'dbs_standard' => 'Padrão DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Verificação da polícia',
        'access_ni' => 'AcessoNI',
        'pvg_scotland' => 'PVG Escócia',
        'international' => 'Verificação de antecedentes internacionais',
        'other' => 'Outra verificação de verificação',
        'uk_safeguarding_clearance' => 'Autorização de salvaguarda do Reino Unido',
    ],
    'jurisdictions' => [
        'unconfigured' => 'A jurisdição de salvaguarda não está configurada',
        'united_kingdom' => 'Reino Unido — pacote de políticas nacionais',
        'england_wales' => 'Inglaterra e País de Gales',
        'scotland' => 'Escócia',
        'northern_ireland' => 'Irlanda do Norte',
        'ireland' => 'República da Irlanda',
        'custom' => 'Jurisdição personalizada',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS aprimorado confirmado para contato protegido dos membros',
        'pvg_scotland' => 'Status PVG confirmado para contato protegido de membros',
        'access_ni' => 'Status do AccessNI confirmado para contato protegido de membros',
        'garda_vetting' => 'Garda Vetting confirmada para contato protegido de membros',
        'uk_safeguarding_clearance' => 'Autorização de salvaguarda do Reino Unido confirmada para contato de membro protegido',
    ],
    'confirmation' => [
        'title' => 'Suas preferências de proteção foram salvas',
        'intro' => 'Obrigado por compartilhar isso. Aqui está um resumo do que você escolheu, quem pode ver e o que é ativado como resultado.',
        'your_selections' => 'Suas seleções',
        'no_selections' => 'Você não selecionou nenhuma opção de proteção.',
        'who_can_see_heading' => 'Quem pode ver isso',
        'who_can_see_body' => 'Somente os coordenadores e administradores da comunidade podem ver essas preferências. Outros membros não podem. Todos os acessos são registrados.',
        'what_activates_heading' => 'O que é ativado como resultado',
        'activation_broker_review' => 'Um coordenador analisará e aprovará correspondências ou trocas protegidas quando sua preferência selecionada assim o exigir. Isso não lhes dá acesso ao conteúdo da mensagem.',
        'activation_match_approval' => 'Um coordenador aprovará partidas envolvendo você antes de serem sugeridas ao outro membro.',
        'activation_discovery_hidden' => 'Membros sem verificação registrados por esta comunidade não podem enviar mensagens, responder, enviar créditos de tempo ou iniciar uma troca com você.',
        'activation_notification' => 'Um coordenador foi notificado e entrará em contato para discutir como podemos ajudar.',
        'activation_none' => 'Nenhuma proteção automática é ativada nessas seleções. Suas preferências são registradas para conhecimento do coordenador.',
        'revoke_heading' => 'Como alterá-los ou revogá-los a qualquer momento',
        'revoke_body' => 'Você pode revisar ou revogar qualquer uma dessas preferências a qualquer momento nas configurações do seu perfil. Você não precisa pedir a um administrador para fazer isso.',
        'revoke_cta' => 'Vá para as configurações de proteção',
        'continue_cta' => 'Continuar',
    ],
    'settings' => [
        'page_title' => 'Salvaguardando preferências',
        'intro' => 'Revise ou revogue as preferências de proteção definidas durante a integração. Seus coordenadores podem ver isso, mas outros membros não.',
        'no_preferences' => 'Você não tem preferências de proteção ativas. Você pode defini-los a qualquer momento na página de ajuda de proteção.',
        'selected_on' => 'Selecionado em :date',
        'revoke_button' => 'Revogar',
        'revoke_confirm_title' => 'Revogar esta preferência?',
        'revoke_confirm_body' => 'Esta preferência não se aplicará mais à sua conta. Seus coordenadores serão notificados da mudança.',
        'revoke_confirm_yes' => 'Sim, revogar',
        'revoke_confirm_no' => 'Mantenha-o',
        'revoked_toast' => 'Preferência revogada.',
        'revoke_error_toast' => 'Algo deu errado. Por favor, tente novamente.',
        'switch_heading' => 'Uma opção mais suave está disponível',
        'switch_body' => 'Você optou por ser contatado apenas por membros cuja verificação esta comunidade tenha registrado. Isso impede que quase todo mundo chegue até você. Você pode passar a ter um coordenador para ficar de olho em suas trocas e apresentá-lo aos membros, e outros membros poderão enviar mensagens para você novamente.',
        'switch_button' => 'Mudar para apresentações do coordenador',
        'switched_toast' => 'Feito. Um coordenador ficará de olho nas suas trocas e os membros poderão enviar mensagens para você novamente.',
        'switch_not_held' => 'Você não tem a configuração somente para membros avaliados, então não há nada para mudar.',
        'switch_unavailable' => 'As apresentações do coordenador ainda não estão disponíveis nesta comunidade. Entre em contato com um coordenador.',
    ],
    'approved_contacts' => [
        'invalid_contact' => 'Escolha outro membro desta comunidade.',
        'not_found' => 'Essa aprovação não foi encontrada. Pode já ter sido retirado.',
    ],
    'effects' => [
        'broker_approval' => 'Um coordenador examina qualquer intercâmbio que você organizar antes de prosseguir. Eles não podem ler suas mensagens.',
        'restricts_messaging' => 'Outros membros não podem enviar-lhe mensagens, iniciar uma troca consigo ou mencioná-lo, a menos que um coordenador os tenha aprovado. Os coordenadores sempre podem entrar em contato com você. Para entrar em contato com alguém, pergunte a um coordenador. Os grupos aos quais você pertence funcionam normalmente.',
        'restricts_matching' => 'As correspondências sugeridas entre você e outros membros são verificadas primeiro por um coordenador.',
        'vetted_only' => 'Somente membros cujos :vetting esta comunidade gravou podem enviar mensagens para você, responder, enviar créditos de tempo ou iniciar uma troca com você. Todos os outros estão bloqueados.',
        'vetted_count' => '{0} Nenhum membro :vetting gravou aqui no momento, então ninguém pode entrar em contato com você enquanto isso estiver ativado.|{1} Apenas 1 membro tem :vetting gravado aqui no momento.|[2,*] :count membros têm :vetting gravado aqui no momento.',
        'notify_coordinator' => 'Um coordenador é informado sobre sua escolha, para que possa entrar em contato caso precise de alguma coisa.',
        'no_home_visits' => 'Os coordenadores sabem que você não deseja visitas domiciliares, a menos que eles as organizem.',
        'check_before_helping' => 'Um coordenador será informado e confirmará se a verificação (:vetting) é necessária. Até que isso aconteça, não providencie ajuda que envolva crianças ou adultos vulneráveis ​​através do banco de tempo.',
        'informational' => 'Nada muda para os outros membros. Sua resposta ajuda os coordenadores a apoiá-lo.',
        'declined' => 'Nada muda. Os coordenadores podem ver que você deu uma olhada nesta etapa.',
        'vetting_fallback' => 'verificação',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Esta comunidade leva a proteção a sério. Se desejar cuidados extras ao usar o banco de tempo, informe-nos abaixo e nossos coordenadores irão ajudá-lo. Cada escolha diz exatamente o que faz antes de você escolhê-la.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Considero-me um adulto vulnerável e gostaria de apoio extra',
                    'description' => 'Para mantê-lo seguro, outros membros não poderão contatá-lo diretamente. Um coordenador entrará em contato, providenciará contato com outros membros para você e poderá aprovar membros específicos para entrarem em contato com você.',
                ],
                'coordinator_introductions' => [
                    'label' => 'Gostaria que um coordenador ficasse de olho nas minhas trocas e me ajudasse a me apresentar aos membros',
                    'description' => 'Bom se você quiser alguma garantia sem ser interrompido. Outros membros ainda podem enviar mensagens para você.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Somente membros cuja verificação desta comunidade tenha sido registrada podem entrar em contato comigo',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Gostaria que um coordenador organizasse todos os contatos para mim, em vez de os membros me enviarem mensagens diretamente',
                    'description' => 'Um coordenador organizará contatos e trocas em seu nome e poderá aprovar membros específicos para entrar em contato com você. Outros membros não poderão contatá-lo diretamente.',
                ],
                'no_home_visits' => [
                    'label' => 'Não quero que membros visitem minha casa, a menos que um coordenador tenha organizado isso',
                    'description' => 'Os coordenadores são informados, para que possam ajudar a organizar qualquer visita à sua casa e garantir que as proteções corretas estejam em vigor.',
                ],
                'works_with_children' => [
                    'label' => 'Planeio oferecer serviços que possam envolver crianças ou jovens (com menos de 18 anos)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Pretendo oferecer ajuda que envolva crianças ou adultos vulneráveis ​​(por exemplo, dar aulas particulares ao filho de um membro ou cuidados pessoais)',
                ],
                'none_apply' => [
                    'label' => 'Nenhuma destas situações se aplica a mim',
                    'description' => 'Revi as opções acima e nenhuma se aplica à minha situação. Isto fica registado para que a equipa de coordenação saiba que vi e considerei este passo.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlanda',
            'vetting_authority' => 'Gabinete Nacional de Verificação',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Na Irlanda, o Garda Vetting é organizado através de uma organização para uma função específica. Apenas a verificação do que esta comunidade registrou conta aqui, não a verificação de alguém por meio de seu trabalho ou de outro grupo.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Um coordenador organizará contatos e trocas em seu nome e poderá aprovar membros específicos para entrar em contato com você. Outros membros não poderão contatá-lo diretamente.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre os requisitos da Garda Vetting. Na Irlanda, determinadas atividades que envolvem crianças exigem verificação ao abrigo da Lei do Gabinete Nacional de Verificação de 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Um coordenador será informado. Na Irlanda, algum trabalho regular com crianças ou pessoas vulneráveis ​​necessita de Garda Vetting, que apenas uma organização registada pode providenciar, e o ensino, treino ou orientação de crianças sempre o faz. Por favor, não providencie esse tipo de ajuda através do banco de tempo até que um coordenador confirme o que é necessário.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Reino Unido',
            'vetting_authority' => 'DBS, Disclosure Scotland e AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Em todo o Reino Unido, isso significa uma verificação Enhanced DBS, PVG ou AccessNI que esta comunidade registrou. Um cheque que alguém recebeu através de seu trabalho ou de outro grupo não conta aqui.',
                ],
                'works_with_children' => [
                    'description' => 'Um coordenador avaliará a função e a jurisdição aplicável no Reino Unido antes de decidir qual verificação de salvaguarda é legalmente apropriada.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Um coordenador será informado e confirmará se uma verificação Enhanced DBS, PVG ou AccessNI é necessária para o que você planeja fazer. Por favor, não providencie esse tipo de ajuda através do banco de tempo até que eles o façam.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Inglaterra e País de Gales',
            'vetting_authority' => 'Serviço de Divulgação e Impedimento',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Na Inglaterra e no País de Gales, isso significa uma verificação de DBS aprimorada que esta comunidade registrou. Um cheque que alguém recebeu através de seu trabalho ou de outro grupo não conta aqui.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre os requisitos da verificação DBS.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Um coordenador será informado e confirmará se uma verificação DBS é necessária para o que você planeja fazer. Por favor, não providencie esse tipo de ajuda através do banco de tempo até que eles o façam.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Escócia',
            'vetting_authority' => 'Disclosure Scotland (regime PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Considero-me uma pessoa adulta vulnerável ou protegida e posso precisar de apoio adicional de proteção',
                ],
                'requires_vetted_partners' => [
                    'description' => 'Na Escócia, isto significa adesão ao esquema PVG que esta comunidade registou. A associação de alguém por meio de seu trabalho ou de outro grupo não conta aqui.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre a adesão ao regime PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Pretendo oferecer ajuda que envolva crianças ou adultos protegidos (por exemplo, dar aulas particulares ao filho de um membro ou cuidar pessoalmente)',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlanda do Norte',
            'vetting_authority' => 'AcessoNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Na Irlanda do Norte, isto significa uma verificação do AccessNI que esta comunidade registou. Um cheque que alguém recebeu através de seu trabalho ou de outro grupo não conta aqui.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre a verificação AccessNI.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Um coordenador será informado e confirmará se uma verificação do AccessNI é necessária para o que você planeja fazer. Por favor, não providencie esse tipo de ajuda através do banco de tempo até que eles o façam.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Personalizado',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'A sua comunidade mudou a sua jurisdição de salvaguarda. Sua proteção existente permanece ativa, mas revise o texto atualizado em Configurações.',
        'jurisdiction_changed_staff' => 'A jurisdição de salvaguarda mudou. As proteções dos membros afetados permanecem ativas e agora exigem revisão dos membros.',
        'attestation_policy_rotated_member' => 'Sua comunidade iniciou uma revisão da política de proteção. Seu corretor deve reconfirmar seu status de contato privado; isso não é uma expiração de certificado.',
        'reminder_subject' => 'Revise suas preferências de proteção',
        'reminder_title' => 'É hora de revisar suas preferências de proteção',
        'reminder_body' => 'Já se passou mais de um ano desde que você definiu suas preferências de proteção para :community. Reserve um momento para revisá-los e confirmar se eles ainda se aplicam ou revogue aqueles que não se aplicam mais.',
        'reminder_cta' => 'Revise as preferências',
        'escalation_subject' => 'Revisão de proteção de membros pendente',
        'escalation_title' => 'Revisão anual de salvaguarda pendente',
        'escalation_body' => ':name não respondeu a uma solicitação para revisar suas preferências de proteção há 30 dias. As suas preferências permanecem ativas – o membro tem o direito de mantê-las. Entre em contato diretamente se desejar fazer o check-in.',
        'escalation_cta' => 'Ver membro no painel de proteção',
    ],
];
