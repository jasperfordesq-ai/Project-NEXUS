<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Matching;

/**
 * MatchConcepts — groups of words that ask for, or offer, the same kind of
 * help, in the platform's European languages.
 *
 * Without an AI model the matcher only sees shared WORDS, and most genuine
 * pairs share none: "babysitter" / "childcare", "my laptop is slow" /
 * "computer repair", "lifts to hospital" / "I can drive you to the doctor".
 * KeywordExtractor adds a concept token ("~childcare") for every word found
 * here, so such pairs overlap.
 *
 * Rules for editing:
 *  - One word per entry. Written as people write it: KeywordExtractor folds
 *    accents and trims word endings on both sides, so "jardín", "jardines"
 *    and "Jardin" all land on the same stem.
 *  - Two-word phrases are matched as one joined word ("flat pack" →
 *    "flatpack"), so list them joined.
 *  - Leave out words that commonly mean something else. "piano" is not in
 *    ~music because "help moving a piano" is not a music request; "car" is
 *    not in ~transport because "car repair" is not a lift; "kinder" is left
 *    out because its stem is the English word "kind". A missing word costs a
 *    weaker match; a wrong word introduces strangers who cannot help.
 *  - Arabic and Japanese are not covered: Japanese is not written with
 *    spaces between words, so word matching cannot work for it at all.
 */
final class MatchConcepts
{
    /** @var array<string, string[]> concept => words */
    public const GROUPS = [
        'gardening' => [
            'garden', 'gardens', 'gardening', 'gardener', 'lawn', 'lawns', 'mow', 'mowing', 'mower', 'lawnmower',
            'grass', 'hedge', 'hedges', 'weeding', 'weeds', 'pruning', 'prune', 'allotment', 'planting', 'plants',
            'jardín', 'jardines', 'jardinería', 'césped', 'jardinage', 'jardiner', 'pelouse', 'tondre', 'garten',
            'gartenarbeit', 'rasen', 'rasenmähen', 'giardino', 'giardinaggio', 'jardim', 'jardinagem', 'relva',
            'tuin', 'tuinieren', 'tuinman', 'maaien', 'ogród', 'ogrodzie', 'ogrodnictwo', 'trawa', 'trawy',
            'koszenie', 'gairdín', 'garraíodóireacht', 'féar',
        ],
        'childcare' => [
            'childcare', 'babysit', 'babysitter', 'babysitting', 'nanny', 'childminder', 'childminding', 'kids',
            'children', 'child', 'toddler', 'toddlers', 'creche', 'niñera', 'canguro', 'niños', 'guardería', 'nounou',
            'enfants', 'kinderbetreuung', 'babysitten', 'bambini', 'babá', 'crianças', 'oppas', 'oppassen',
            'kinderopvang', 'kinderen', 'opiekunka', 'niania', 'dzieci', 'páistí', 'leanaí',
        ],
        'older_people' => [
            'elderly', 'older', 'senior', 'seniors', 'pensioner', 'pensioners', 'companionship', 'companion',
            'befriending', 'befriend', 'lonely', 'loneliness', 'mayores', 'ancianos', 'acompañamiento', 'compañía',
            'âgées', 'compagnie', 'accompagnement', 'senioren', 'begleitung', 'anziani', 'compagnia', 'idosos',
            'companhia', 'ouderen', 'gezelschap', 'seniorzy', 'starsi', 'towarzystwo', 'seanóirí', 'comhluadar',
        ],
        'pets' => [
            'dog', 'dogs', 'puppy', 'cat', 'cats', 'kitten', 'pet', 'pets', 'dogwalking', 'petsitting', 'perro',
            'perros', 'mascota', 'mascotas', 'gato', 'gatos', 'chien', 'chiens', 'hund', 'hunde', 'katze',
            'haustier', 'gatto', 'animali', 'cão', 'cachorro', 'hond', 'honden', 'huisdier', 'kot', 'koty', 'madra',
        ],
        'transport' => [
            'lift', 'lifts', 'driving', 'drive', 'driver', 'ride', 'rides', 'transport', 'taxi', 'carpool',
            'conducir', 'transporte', 'conduire', 'covoiturage', 'chauffeur', 'fahren', 'fahrdienst', 'mitfahrt',
            'mitnehmen', 'passaggio', 'guidare', 'trasporto', 'boleia', 'carona', 'conduzir', 'rijden', 'vervoer',
            'podwózka', 'podwiezienie', 'kierowca', 'síob', 'tiomáint',
        ],
        'health' => [
            'hospital', 'doctor', 'gp', 'appointment', 'appointments', 'clinic', 'dentist', 'pharmacy',
            'prescription', 'prescriptions', 'médico', 'cita', 'hôpital', 'médecin', 'arzt', 'krankenhaus',
            'ospedale', 'ziekenhuis', 'huisarts', 'afspraak', 'szpital', 'lekarz', 'wizyta', 'ospidéal', 'dochtúir',
            'coinne',
        ],
        'shopping' => [
            'shopping', 'groceries', 'grocery', 'errands', 'errand', 'compras', 'recados', 'supermercado',
            'einkaufen', 'einkauf', 'besorgungen', 'spesa', 'commissioni', 'boodschappen', 'zakupy',
            'siopadóireacht',
        ],
        'diy' => [
            'diy', 'handyman', 'shelf', 'shelves', 'shelving', 'drill', 'drilling', 'flatpack', 'assembly',
            'assemble', 'furniture', 'ikea', 'bricolage', 'montaje', 'muebles', 'bricoler', 'meubles', 'heimwerken',
            'möbel', 'aufbauen', 'montaggio', 'mobili', 'montagem', 'móveis', 'klusjes', 'klussen', 'meubels',
            'montaż', 'meble', 'troscán',
        ],
        'plumbing' => [
            'plumber', 'plumbing', 'leak', 'leaking', 'leaky', 'tap', 'taps', 'sink', 'toilet', 'pipe', 'pipes',
            'drain', 'fontanero', 'fontanería', 'grifo', 'plombier', 'plomberie', 'fuite', 'robinet', 'klempner',
            'wasserhahn', 'idraulico', 'rubinetto', 'canalizador', 'torneira', 'loodgieter', 'kraan', 'lekkage',
            'hydraulik', 'pluiméir', 'sconna',
        ],
        'electrical' => [
            'electrician', 'electrical', 'electric', 'wiring', 'socket', 'sockets', 'fuse', 'electricista',
            'électricien', 'elektriker', 'elettricista', 'eletricista', 'elektricien', 'elektryk', 'leictreoir',
        ],
        'decorating' => [
            'painting', 'paint', 'painter', 'decorating', 'decorator', 'wallpaper', 'wallpapering', 'pintar',
            'pintura', 'peindre', 'peinture', 'streichen', 'maler', 'tapezieren', 'imbiancare', 'schilderen',
            'schilder', 'behangen', 'behanger', 'malowanie', 'malarz', 'péinteáil',
        ],
        'moving' => [
            'moving', 'removal', 'removals', 'packing', 'unpacking', 'mudanza', 'déménagement', 'déménager', 'umzug',
            'umziehen', 'trasloco', 'mudança', 'verhuizen', 'verhuizing', 'przeprowadzka',
        ],
        'computers' => [
            'computer', 'computers', 'laptop', 'laptops', 'pc', 'tablet', 'ipad', 'iphone', 'smartphone', 'android',
            'email', 'emails', 'internet', 'wifi', 'printer', 'software', 'tech', 'technology', 'ordenador',
            'portátil', 'computadora', 'informática', 'ordinateur', 'informatique', 'rechner', 'informatica',
            'computador', 'komputer', 'laptopa', 'ríomhaire', 'ríomhaireacht',
        ],
        'languages' => [
            'language', 'languages', 'conversation', 'idioma', 'idiomas', 'conversación', 'langue', 'langues',
            'sprache', 'sprachen', 'konversation', 'lingua', 'lingue', 'conversazione', 'língua', 'conversação',
            'taal', 'talen', 'język', 'teanga',
        ],
        'lang_english' => ['english', 'inglés', 'anglais', 'englisch', 'inglese', 'inglês', 'engels', 'angielski', 'béarla'],
        'lang_french' => ['french', 'francés', 'français', 'französisch', 'francese', 'francês', 'frans', 'francuski', 'fraincis'],
        'lang_spanish' => ['spanish', 'español', 'espagnol', 'spanisch', 'spagnolo', 'espanhol', 'spaans', 'hiszpański', 'spáinnis'],
        'lang_german' => ['german', 'alemán', 'allemand', 'deutsch', 'tedesco', 'alemão', 'duits', 'niemiecki', 'gearmáinis'],
        'lang_italian' => ['italian', 'italiano', 'italien', 'italienisch', 'italiaans', 'włoski', 'iodáilis'],
        'lang_irish' => ['irish', 'gaelic', 'gaeilge', 'irlandés', 'irlandais', 'irisch', 'irlandese', 'iers', 'irlandzki'],
        'teaching' => [
            'tutor', 'tutoring', 'tuition', 'homework', 'lesson', 'lessons', 'teach', 'teaching', 'teacher',
            'class', 'classes', 'course', 'cours', 'exam', 'exams', 'maths', 'math', 'mathematics', 'clase', 'clases',
            'profesor', 'enseñar', 'deberes', 'matemáticas', 'leçon', 'leçons', 'professeur', 'devoirs',
            'nachhilfe', 'unterricht', 'lehrer', 'hausaufgaben', 'mathe', 'lezione', 'lezioni', 'ripetizioni',
            'insegnante', 'compiti', 'aulas', 'explicações', 'professor', 'bijles', 'huiswerk', 'korepetycje',
            'lekcja', 'lekcje', 'nauczyciel', 'ceacht', 'ceachtanna', 'múinteoir',
        ],
        'music' => [
            'music', 'musical', 'guitar', 'violin', 'drums', 'singing', 'choir', 'ukulele', 'flute', 'música',
            'guitarra', 'cantar', 'musique', 'guitare', 'chanter', 'chorale', 'musik', 'gitarre', 'singen', 'chor',
            'musica', 'chitarra', 'cantare', 'violão', 'muziek', 'gitaar', 'zingen', 'koor', 'muzyka', 'gitara',
            'śpiew', 'ceol', 'giotár', 'amhránaíocht',
        ],
        'arts' => [
            'art', 'arts', 'craft', 'crafts', 'crafting', 'drawing', 'sketching', 'watercolour', 'pottery',
            'manualidades', 'dibujo', 'artisanat', 'dessin', 'basteln', 'zeichnen', 'kunst', 'disegno',
            'artigianato', 'artesanato', 'desenho', 'knutselen', 'tekenen', 'rękodzieło', 'rysunek', 'ealaín',
            'ceardaíocht',
        ],
        'sewing' => [
            'sewing', 'sew', 'alterations', 'mending', 'mend', 'hemming', 'knitting', 'knit', 'crochet',
            'embroidery', 'quilting', 'costura', 'coser', 'arreglos', 'tejer', 'couture', 'coudre', 'retouches',
            'tricot', 'tricoter', 'nähen', 'stricken', 'häkeln', 'cucito', 'cucire', 'uncinetto', 'tricô', 'crochê',
            'naaien', 'breien', 'szycie', 'szydełkowanie', 'fuáil', 'cniotáil',
        ],
        'hair_beauty' => [
            'haircut', 'haircuts', 'hairdresser', 'hairdressing', 'hair', 'barber', 'nails', 'manicure', 'makeup',
            'beauty', 'peluquería', 'peluquero', 'coiffure', 'coiffeur', 'cheveux', 'friseur', 'haare',
            'haarschnitt', 'parrucchiere', 'capelli', 'cabeleireiro', 'cabelo', 'kapper', 'fryzjer', 'włosy',
            'gruagaire', 'gruaig',
        ],
        'fitness' => [
            'fitness', 'exercise', 'exercises', 'gym', 'jogging', 'hiking', 'swimming', 'sport', 'sports',
            'pilates', 'dance', 'dancing', 'ejercicio', 'deporte', 'gimnasio', 'baile', 'exercice', 'danse',
            'tanzen', 'esercizio', 'ginnastica', 'palestra', 'danza', 'exercício', 'ginásio', 'dança', 'sporten',
            'dansen', 'ćwiczenia', 'taniec', 'aclaíocht', 'damhsa', 'spórt',
        ],
        'wellbeing' => [
            'yoga', 'meditation', 'mindfulness', 'massage', 'reiki', 'relaxation', 'meditación', 'masaje',
            'méditation', 'entspannung', 'meditazione', 'massaggio', 'meditação', 'massagem', 'meditatie',
            'ontspanning', 'medytacja', 'masaż',
        ],
        'cooking' => [
            'cooking', 'cook', 'meal', 'meals', 'baking', 'bake', 'cake', 'cakes', 'bread', 'dinner', 'dinners',
            'lunch', 'recipe', 'recipes', 'chef', 'cocinar', 'comida', 'hornear', 'repostería', 'recetas',
            'cuisiner', 'repas', 'pâtisserie', 'recette', 'kochen', 'backen', 'rezept', 'cucinare', 'pasti',
            'ricette', 'cozinhar', 'bolos', 'refeição', 'receitas', 'koken', 'bakken', 'maaltijd', 'gotowanie',
            'pieczenie', 'posiłki', 'cócaireacht', 'bácáil', 'béile',
        ],
        'cleaning' => [
            'cleaning', 'clean', 'cleaner', 'hoovering', 'hoover', 'vacuum', 'vacuuming', 'dusting', 'housework',
            'tidy', 'tidying', 'declutter', 'decluttering', 'laundry', 'ironing', 'limpieza', 'limpiar', 'planchar',
            'colada', 'ménage', 'nettoyage', 'nettoyer', 'repassage', 'putzen', 'reinigung', 'bügeln', 'wäsche',
            'aufräumen', 'pulizia', 'pulire', 'stirare', 'bucato', 'limpeza', 'limpar', 'schoonmaken', 'poetsen',
            'strijken', 'sprzątanie', 'prasowanie', 'pranie', 'glanadh', 'iarnáil',
        ],
        'paperwork' => [
            'paperwork', 'letters', 'admin', 'administration', 'bills', 'typing', 'filing', 'papeleo',
            'formularios', 'trámites', 'formulaires', 'démarches', 'formulare', 'papierkram', 'behörden', 'moduli',
            'pratiche', 'burocrazia', 'papelada', 'formulários', 'papierwerk', 'formulieren', 'administratie',
            'formularze', 'foirmeacha', 'páipéarachas',
        ],
        'jobs' => [
            'cv', 'resume', 'curriculum', 'job', 'jobs', 'interview', 'interviews', 'career', 'careers',
            'employment', 'currículum', 'empleo', 'entrevista', 'emploi', 'entretien', 'candidature',
            'lebenslauf', 'bewerbung', 'vorstellungsgespräch', 'colloquio', 'candidatura', 'currículo', 'emprego',
            'sollicitatie', 'sollicitatiegesprek', 'życiorys', 'agallamh',
        ],
        'money' => [
            'budget', 'budgeting', 'money', 'finances', 'finance', 'tax', 'taxes', 'accounts', 'accounting',
            'bookkeeping', 'presupuesto', 'finanzas', 'impuestos', 'contabilidad', 'impôts', 'comptabilité',
            'finanzen', 'steuern', 'buchhaltung', 'finanze', 'contabilità', 'orçamento', 'finanças', 'impostos',
            'contabilidade', 'financiën', 'belasting', 'boekhouding', 'budżet', 'finanse', 'podatki', 'księgowość',
            'buiséad', 'cáin',
        ],
        'photography' => [
            'photography', 'photo', 'photos', 'photographer', 'camera', 'fotografía', 'fotos', 'photographie',
            'fotografie', 'fotografia', 'zdjęcia', 'grianghrafadóireacht',
        ],
        'writing' => [
            'writing', 'write', 'editing', 'proofreading', 'proofread', 'copywriting', 'escribir', 'redacción',
            'écrire', 'rédaction', 'relecture', 'schreiben', 'korrekturlesen', 'scrittura', 'escrita', 'schrijven',
            'redactie', 'pisanie', 'korekta', 'scríbhneoireacht',
        ],
        'translation' => [
            'translation', 'translate', 'translating', 'interpreter', 'interpreting', 'traducción', 'traducir',
            'intérprete', 'traduction', 'traduire', 'übersetzung', 'übersetzen', 'dolmetscher', 'traduzione',
            'tradurre', 'tradução', 'traduzir', 'vertaling', 'vertalen', 'tłumaczenie', 'tłumacz', 'aistriúchán',
        ],
        'bikes' => [
            'bike', 'bikes', 'bicycle', 'bicycles', 'puncture', 'bici', 'bicicleta', 'vélo', 'fahrrad',
            'bicicletta', 'fiets', 'rower', 'rothar',
        ],
        'car_repair' => [
            'mechanic', 'vehicle', 'tyre', 'tyres', 'tire', 'tires', 'mecánico', 'mécanicien', 'werkstatt',
            'meccanico', 'mecânico', 'monteur', 'samochód', 'mechanik', 'gluaisteán',
        ],
    ];
}
