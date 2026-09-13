# Guide complet — Paris Tennis / Tenibotty

[← Retour à la présentation](../README.md)

Réserver et gérer des courts sur [Paris Tennis](https://tennis.paris.fr/), depuis un terminal ou avec le **pilotage agentique d’Hermes dans Telegram sur un VPS**.

Ce fork de [bertrandda/par-ici-tennis](https://github.com/bertrandda/par-ici-tennis) ajoute le tarif **Gratuité**, la vérification des clubs dans le catalogue officiel, les commandes de gestion du compte et les demandes de réservation programmées avec Hermes.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Configuration](#configuration)
- [Trouver un club](#trouver-un-club)
- [Tester et réserver](#tester-et-réserver)
- [Consulter et annuler une réservation](#consulter-et-annuler-une-réservation)
- [Utiliser Hermes et Telegram](#utiliser-hermes-et-telegram)
- [Gérer les demandes programmées](#gérer-les-demandes-programmées)
- [CAPTCHA et Hugging Face](#captcha-et-hugging-face)
- [Calendrier et notifications](#calendrier-et-notifications)
- [Variables et fichiers locaux](#variables-et-fichiers-locaux)
- [GitHub Actions](#github-actions)
- [Diagnostic et validation](#diagnostic-et-validation)
- [Contribuer](#contribuer)

## Fonctionnalités

| Besoin | Commande ou interface principale |
| --- | --- |
| Trouver un club et son libellé exact | `npm run clubs:find -- --query "max rousie"` |
| Lister les clubs d’un arrondissement | `npm run clubs:list -- --arrondissement 18` |
| Tester une réservation sans la confirmer | `npm run start-dry-headed` |
| Réserver immédiatement avec la configuration locale | `npm start` |
| Lire les réservations présentes sur le compte | `npm run reservations:list` |
| Prévisualiser ou confirmer une annulation | `npm run reservations:cancel -- --id 'ID_RETOURNE'` |
| Lister les demandes de réservation programmées | `npm run booking:list` |
| Installer le skill Hermes | `npm run hermes:install` |
| Piloter les réservations en langage naturel | Discuter avec Hermes dans Telegram |

Une **réservation du compte** existe déjà sur Paris Tennis. Une **demande programmée** décrit une tentative future : elle ne garantit pas qu’un terrain sera disponible. Les commandes `reservations:*` et `booking:*` gèrent respectivement ces deux objets.

## Installation

Prérequis :

- Node.js 22.22.2 ou 24, versions utilisées pour la validation du projet.
- npm ; le dépôt déclare `npm@11.6.2` dans `packageManager`.
- Un compte Paris Tennis pour les opérations sur le compte et les réservations.
- Sous Linux, `flock` pour les scripts de lancement Hermes. Le mode navigateur visible nécessite une session graphique.

```sh
git clone https://github.com/RolandVrignon/paris-tennis-tenibotty.git
cd paris-tennis-tenibotty
npm ci
```

L’installation télécharge Chromium via le script `postinstall`. Sous Linux, si des bibliothèques système manquent :

```sh
npx playwright install --with-deps chromium
```

Pour une nouvelle configuration :

```sh
cp -n config.fixed.json.sample config.fixed.json
cp -n config.request.json.sample config.request.json
chmod 600 config.fixed.json config.request.json
```

Compléter les deux fichiers avant de réserver. La date et les partenaires des exemples doivent être remplacés par vos choix. Pour une installation qui possède déjà `config.json`, utiliser la migration ci-dessous avant de créer les fichiers séparés.

## Configuration

Les comptes nommés, partenaires par défaut et demandes de deux heures sont détaillés dans le [README](../README.md#comptes-nommés-et-partenaires-habituels).

### Compte et paramètres fixes

`config.fixed.json` contient les identifiants, le tarif accepté, les paramètres CAPTCHA et les notifications. Exemple pour un compte gratuit :

```json
{
  "account": {
    "email": "votre-adresse@example.com",
    "password": "VOTRE_MOT_DE_PASSE"
  },
  "priceType": ["Gratuité"],
  "ai": {
    "enable": true,
    "space": "Nischay103/captcha_recognition",
    "maxAttempts": 2,
    "timeoutMs": 30000
  },
  "ntfy": {
    "enable": false,
    "topic": "VOTRE_TOPIC"
  }
}
```

Les blocs `ai` et `ntfy` sont facultatifs. L’absence de `ai` conserve la reconnaissance automatique par défaut.

**Ne jamais committer `config.fixed.json`, `config.request.json` ou l’ancien `config.json`.** Ils sont ignorés par Git. Les partenaires sont aussi des données personnelles : conserver les fichiers de demande avec des permissions restrictives.

### Tarifs acceptés

Les libellés doivent correspondre exactement à ceux de Paris Tennis :

| Valeur dans `priceType` | Condition | Carnet nécessaire pour ce script |
| --- | --- | --- |
| `Tarif plein` | Compte au tarif plein | Oui, adapté au tarif et au type de court |
| `Tarif réduit` | Compte bénéficiant du tarif réduit | Oui, adapté au tarif et au type de court |
| `Gratuité` | Gratuité déjà activée sur le compte | Non |

Pour le tarif gratuit, utiliser **`"priceType": ["Gratuité"]`**. Les valeurs `Gratuit`, `gratuit` ou `free` ne correspondent pas. Ce paramètre filtre les créneaux ; il ne modifie pas les droits du compte.

Plusieurs valeurs peuvent être acceptées, mais leur ordre ne définit pas une priorité. Le parcours payant sélectionne la carte « J’utilise 1 heure de mon carnet en ligne » (`paymentMode="existingTicket"`), attend que « Etape suivante » soit activé par le site, puis valide. Il accepte le solde compatible proposé par le site, y compris les heures recréditées. Le parcours gratuit sélectionne de la même façon la carte « Gratuité ». Aucun champ caché ni bouton désactivé n’est forcé. Si le site ne propose pas le crédit attendu, le programme s’arrête sans paiement par carte bancaire.

### Préférences de réservation

`config.request.json` contient les paramètres variables :

```json
{
  "locations": ["Max Rousié", "Jesse Owens"],
  "hours": ["18", "19"],
  "courtType": ["Couvert"],
  "players": [
    { "firstName": "PRENOM_PARTENAIRE", "lastName": "NOM_PARTENAIRE" }
  ]
}
```

| Champ | Utilisation |
| --- | --- |
| `polling` | Option de recherche répétée : `intervalSeconds` (2 à 60), `durationSeconds` (au plus 600), `fallbackMode` (`after-window` par défaut ou `each-cycle`). Sans ce champ, un seul passage. |
| `fallbacks` | Liste ordonnée de replis : `sport` et `locations` obligatoires ; `hours` et `courtType` facultatifs, hérités du choix principal. |
| `sport` | `tennis` par défaut ; `padel` pour les pistes de padel. Le mode padel accepte un à trois partenaires. |
| `locations` | Clubs par ordre de préférence ; leurs noms sont vérifiés avant réservation. |
| `date` | Date du terrain au format `D/M/YYYY` ou `DD/MM/YYYY`. Facultative en lancement direct : sans date, le script cherche à J+6. Obligatoire pour une demande Hermes. |
| `hours` | Heures par ordre de préférence, par exemple `["18", "19"]`. |
| `courtType` | `Couvert`, `Découvert`, ou les deux. |
| `players` | Un à trois partenaires ; facultatif si le compte sélectionné possède `defaultPlayers`. Une valeur explicite remplace ce défaut. |
| `bookingAccount` | Identifiant du compte configuré : `main` par défaut, ou une clé de `bookingAccounts`. |
| `consecutive` | `{ "bookingAccount": "second" }` pour la deuxième heure sur le même terrain ; `players` peut y remplacer les partenaires par défaut du second compte. |

Le script parcourt d’abord les clubs dans l’ordre, puis les heures demandées dans chaque club. Pour limiter les courts d’un club, remplacer le tableau `locations` par un objet :

```json
{
  "locations": {
    "Max Rousié": [1, 2],
    "Suzanne Lenglen": []
  }
}
```

Les nombres désignent les numéros de courts ; `[]` accepte tous les courts du club. Les types de courts et tarifs restent filtrés.

Pour le lancement direct, le dry-run est activé **par la commande `--dry-run`**, pas par un champ dans `config.request.json`. Le booléen `dryRun` est pris en charge dans les demandes préparées pour Hermes.

### Migrer une ancienne configuration

Si seul `config.json` existe :

```sh
npm run config:migrate
```

Cette commande répartit les valeurs dans les deux fichiers, vérifie que leur fusion restitue la configuration initiale, puis **supprime le fichier source `config.json`**. Elle refuse d’écraser des fichiers séparés existants.

Pour conserver la source lors de la migration :

```sh
node scripts/migrate-config.js
```

Sans migration, `config.json` reste pris en charge tant que les fichiers séparés sont absents. Dès que l’un des deux fichiers séparés existe, le lancement direct exige les deux. La consultation du compte nécessite seulement les paramètres fixes ; la recherche de clubs ne nécessite aucun identifiant.

## Trouver un club

```sh
npm run clubs:list
npm run clubs:list -- --arrondissement 18
npm run clubs:find -- --query "max rousie"
npm run clubs:find -- --query "Owens" --arrondissement 18
```

Le catalogue est lu sur Paris Tennis à chaque appel. Les résultats indiquent le nom officiel, l’identifiant, l’arrondissement, l’adresse et les courts, avec leur caractère couvert ou découvert. Ce catalogue ne prouve pas la disponibilité d’un créneau.

La réponse contient `match` :

| Valeur | Signification |
| --- | --- |
| `all` | Liste complète ou filtrée par arrondissement. |
| `exact` | Correspondance exacte, sans tenir compte des accents ou de la casse ; un identifiant officiel est aussi accepté comme recherche. |
| `partial` | Le texte apparaît dans un ou plusieurs noms. Une seule dénomination distincte peut être résolue automatiquement. |
| `suggestions` | Noms proches proposés, ou liste vide. Choisir explicitement un libellé officiel avant de réserver. |

Ainsi, `max rousie` est résolu en **Max Rousié**. Plusieurs sites peuvent partager le même libellé : leurs adresses et identifiants restent visibles. Une ambiguïté entre plusieurs noms ou une simple suggestion bloque la préparation.

Le gestionnaire enregistre les identifiants et libellés vérifiés dans la demande. Au lancement, le script vérifie à nouveau le nom dans le catalogue de la page de recherche et sélectionne la suggestion exacte.

## Padel municipal

Utiliser [config.padel.json.sample](../config.padel.json.sample) comme modèle de préférences, avec `sport: "padel"`, le club exact `Padel Jules Ladoumègue` et **un à trois partenaires**. Les quatre pistes portent les numéros 1 à 4 ; leur sélection repose sur les identifiants officiels pour exclure les anciens courts de tennis présents sur la même fiche. Le sport est conservé dans les demandes Hermes et leur configuration temporaire.

```sh
cp -n config.padel.json.sample config.padel.json
chmod 600 config.padel.json
# Renseigner les vrais partenaires et les heures avant le test.
TENNIS_REQUEST_CONFIG_PATH=./config.padel.json npm run start-dry-headed
```

`config.padel.json` est ignoré par Git. Le compte, le tarif et les notifications restent dans `config.fixed.json`. Les créneaux padel consultés sur le site portent le type `Couvert` et proposent `Gratuité` pour un compte éligible. Les parcours payants conservent l’exigence d’un carnet compatible. Le programme ne modifie pas les droits du compte.

Pour une demande programmée, ajouter une date explicite et utiliser le même fichier variable avec `booking:manage prepare --input`. Pour un dry-run Hermes, ajouter le booléen `dryRun: true` ; pour un dry-run direct, utiliser la commande dédiée. Sans `sport`, les demandes existantes restent en tennis. Un club nommé Padel avec le mode tennis est refusé pour éviter une confusion.

## Replis entre sports

La configuration principale est essayée en premier, puis les entrées de `fallbacks` dans l’ordre. Chaque choix épuise ses clubs, puis leurs heures, avant de passer au suivant. Un repli peut être du même sport ou d’un autre sport.

Pour conserver une priorité padel puis tennis à 20 h, ajouter aux préférences padel :

```json
"fallbacks": [
  {
    "sport": "tennis",
    "locations": ["Edouard Pailleron"],
    "hours": ["20"],
    "courtType": ["Couvert"]
  }
]
```

Les heures et types de terrain peuvent différer par repli. En leur absence, les valeurs du choix principal s’appliquent. Les numéros de courts dans `locations` restent possibles. Les partenaires, le compte, le tarif, la date et le mode dry-run s’appliquent à tous les choix de la première réservation ; ils ne peuvent pas être remplacés dans un repli.

Hermes vérifie les noms de tous les clubs et conserve la liste complète dans la demande. Modifier une tâche existante avec `booking:manage edit --request-id <id> --input <fichier>` et la configuration complète ; fournir `fallbacks: []` pour supprimer les replis. L’horaire de lancement et le cron restent attachés à la même demande. Ne pas créer un second cron pour le tennis de secours.

Sans `polling`, l’absence de créneau compatible déclenche le repli immédiatement. Avec `polling.fallbackMode: "after-window"`, les choix principaux sont répétés jusqu’à la fin de la fenêtre avant un passage unique sur les replis. Dès qu’un créneau est sélectionné, le checkout doit aboutir ou la tâche échoue ; les erreurs ne déclenchent pas de repli. Après confirmation, ou après annulation réussie du dry-run, la recherche s’arrête. Les logs indiquent le sport et la priorité ; le fichier ICS porte le sport effectivement réservé.

## Tester et réserver

Commencer par un dry-run avec navigateur visible :

```sh
npm run start-dry-headed
```

Le test se connecte, cherche un créneau et va jusqu’à l’étape de paiement. Il sélectionne la carte du crédit existant (ou de gratuité), vérifie que le bouton suivant s’active, puis annule la réservation temporaire sans cliquer sur ce bouton. Ce parcours est commun aux tarifs gratuit et payants.

| Commande | Usage |
| --- | --- |
| `npm run start-dry` | Dry-run headless, sans fenêtre. |
| `npm run start-dry-headed` | Dry-run visible, avec saisie manuelle du CAPTCHA en secours. |
| `npm run start-dry-debug` | Dry-run headless avec diagnostic détaillé. |
| `npm run start-dry-headed-debug` | Dry-run visible avec diagnostic détaillé. |
| `npm start` | Réservation réelle immédiate, en headless. |
| `npm start -- --headed` | Réservation réelle immédiate, avec navigateur visible. |

Pour un compte gratuit, le journal doit contenir `Free price detected`. En mode debug, `dry-run-cancelled status=200` confirme la réponse d’annulation du serveur. Le message « Fausse réservation faite » est affiché **avant** cette annulation : à lui seul, il ne prouve pas qu’elle a réussi.

Vérifier aussi le compte avant le premier lancement réel :

```sh
npm run reservations:list
```

`npm start` ne programme rien : il réserve dès son exécution. Pour une tentative future à l’ouverture, utiliser Hermes.

## Consulter et annuler une réservation

### Lire le compte

```sh
npm run reservations:list
npm run reservations:list -- --headed
```

La commande lit la page **Ma réservation**. La réponse comporte `source`, `fetchedAt` et un tableau `reservations`. Chaque élément contient :

- `id` : référence locale calculée à partir des détails affichés ; ce n’est pas un numéro de confirmation Paris Tennis ;
- `details` : détails de la réservation affichés par le site ;
- `cancellable` : possibilité d’annulation selon le contrôle présent sur la page.

Un tableau vide signifie que le site affiche explicitement l’absence de réservation en cours. Une erreur de connexion ou un format de page inconnu produit une erreur. Cette commande n’importe pas l’historique : l’adaptateur actuel traite la page de réservation courante et refuse une disposition d’annulation ambiguë.

### Annuler une réservation précise

Copier l’`id` retourné par la liste dans les commandes suivantes. Sans `--confirm`, la commande ne soumet aucune annulation :

```sh
npm run reservations:cancel -- --id 'ID_RETOURNE_PAR_LA_LISTE'
```

Pour annuler réellement cette réservation :

```sh
npm run reservations:cancel -- --id 'ID_RETOURNE_PAR_LA_LISTE' --confirm
```

Le script relit la réservation, vérifie sa référence et la disponibilité de l’annulation, ouvre la confirmation du site et soumet son formulaire une seule fois. Il contrôle ensuite l’absence de réservation. Le succès est indiqué par `status: "cancelled"` et `verified: true`.

Si la référence a changé, si le site interdit l’annulation ou si le résultat est incertain, consulter à nouveau le compte avant toute nouvelle action. L’annulation d’une réservation confirmée est distincte de la libération d’une réservation temporaire pendant un dry-run.

## Utiliser Hermes et Telegram

Hermes transforme une demande en langage naturel en opération contrôlée. Ce n’est pas un simple raccourci vers `npm start` : l’agent comprend l’intention, demande uniquement les informations manquantes, consulte les données Paris Tennis, conserve le contexte de la conversation et orchestre les commandes du dépôt.

Son parcours agentique est le suivant :

1. comprendre la demande, y compris les dates relatives et l’ordre des préférences ;
2. calculer la date minimale proposée pour une nouvelle demande programmée, à **J+7** en heure de Paris, lorsque la date manque ;
3. vérifier les clubs dans le catalogue officiel et signaler toute ambiguïté ;
4. compléter la demande au fil du dialogue sans redemander les informations déjà fournies ;
5. présenter un récapitulatif précis et obtenir la confirmation avant toute action réelle ;
6. préparer la configuration temporaire et programmer une seule exécution à l’ouverture ;
7. restituer le résultat dans le chat Telegram et indiquer clairement les situations à vérifier.

Une fois la demande validée, son exécution est volontairement déterministe : le job ponctuel utilise les paramètres confirmés avec `no_agent=true`. Aucun modèle ne réinterprète la réservation au moment critique.

### Installer le skill sur le VPS

Depuis le clone présent sur le VPS :

```sh
cd /chemin/vers/paris-tennis-tenibotty
npm run hermes:install
```

Le skill versionné se trouve dans [skills/tennis-booking/SKILL.md](../skills/tennis-booking/SKILL.md). L’installation copie ce fichier dans `~/.hermes/skills/tennis-booking/` et sauvegarde la version précédente. Elle ne crée ni cron ni message Telegram. Hermes et sa connexion Telegram doivent déjà être configurés.

Pour vérifier sa présence :

```sh
hermes skills list
```

L’installateur injecte automatiquement le chemin absolu du clone courant dans la copie locale du skill. Le fichier versionné reste donc portable et ne contient aucun chemin utilisateur. `HERMES_HOME` permet de choisir un autre dossier Hermes. Node.js et npm doivent être accessibles dans le `PATH` de l’utilisateur qui exécute l’installation.

### Exemples de conversations agentiques

#### Partir d’une demande incomplète

> **Vous —** Je peux réserver un terrain ?
>
> **Hermes —** Oui. Donne-moi :
>
> - **La date** (à partir du 18/09) et **les horaires souhaités**, par ordre de préférence.
> - Les **centres**, par ordre de préférence.
> - **Couvert, découvert ou indifférent**.
> - Le **prénom et le nom des partenaires** (1 à 3, sans te compter).

Dans cet exemple, la conversation a lieu le 11/09. Hermes ne conserve pas cette date en dur : il recalcule automatiquement le libellé « à partir du JJ/MM » à J+7 pour chaque nouvelle conversation.

#### Compléter, vérifier et confirmer

> **Vous —** Le 21 septembre à 18 h, sinon 19 h. Max Rousié, en couvert, avec Paul Dupont.
>
> **Hermes —** J’ai vérifié le libellé officiel **Max Rousié**. Je programmerai une tentative pour le **21/09 à 18 h**, puis **19 h** en second choix, en **couvert**, avec **Paul Dupont**. Les créneaux ouvrent le **15/09 à 8 h** ; le job sera préparé à **7 h 55**. Dois-je confirmer cette programmation ?

Hermes ne programme rien avant la confirmation. Une fois celle-ci reçue, il crée la demande protégée, programme le job ponctuel, attache son identifiant et confirme ce qui a réellement été enregistré.

#### Modifier une demande en conservant le contexte

> **Vous —** Finalement, mets 19 h en premier et ajoute Jesse Owens en deuxième choix.
>
> **Hermes —** Je conserve la date, le type de court et le partenaire. Nouvelle priorité des horaires : **19 h**, puis **18 h**. Ordre des centres : **Max Rousié**, puis **Jesse Owens**. Je vérifie le second club et te présente le récapitulatif avant de modifier la demande programmée.

L’agent réutilise les paramètres déjà confirmés, vérifie la nouvelle information et ne modifie que la demande identifiée. Un changement de date entraîne la création contrôlée d’un nouveau job plutôt que le déplacement silencieux de l’ancien.

#### Interroger et agir sur l’état réel

Quelques formulations possibles :

- « Quels clubs Paris Tennis sont dans le 18e ? »
- « Est-ce que Max Rousié existe ? »
- « Liste mes réservations sur Paris Tennis. »
- « Quelles demandes ai-je programmées ? »
- « Annule ma réservation de mardi à 18 h. »
- « Annule ma demande programmée pour le 21 septembre. »

Hermes distingue une réservation déjà présente sur le compte d’une tentative future programmée. Avant une action réelle, il résout précisément l’objet concerné, lève les ambiguïtés et s’appuie sur l’autorisation explicite de l’utilisateur. Il utilise les commandes sécurisées du dépôt plutôt que d’inventer son propre parcours de réservation.

### Recherche pendant la fenêtre d’ouverture

Exemple à ajouter à une demande padel avec repli tennis :

```json
"polling": { "intervalSeconds": 2, "durationSeconds": 600, "fallbackMode": "after-window" }
```

Le choix principal est recherché de 8 h à 8 h 10, puis les replis sont essayés une seule fois. L’intervalle est un minimum entre débuts de recherche : si la réponse et son affichage prennent plus de deux secondes, le script attend leur fin. Le calendrier pas encore ouvert est réessayé dans cette fenêtre. Une réponse HTTP en erreur ou une page non reconnue n’est pas assimilée à un résultat vide.

La fenêtre est ancrée sur l’ouverture stockée dans la demande, pas sur la fin de connexion. Le checkout d’un créneau sélectionné avant la limite et le passage final sur les replis peuvent finir après cette limite. Le mode `each-cycle` alterne les choix dans l’ordre pendant une seule fenêtre commune ; utiliser ce mode uniquement si une réservation de secours immédiate est souhaitée.

L’expiration est journalisée et enregistrée avec `openingReviewRequired: true`, y compris si le repli réussit. Le message Hermes invite à revérifier les horaires d’ouverture et la disponibilité. Un résultat vide ne démontre pas une mauvaise heure d’ouverture : les terrains peuvent être bloqués ou déjà réservés. Aucune reprogrammation ni nouveau monitoring n’est créé automatiquement.

### Déroulement d’une réservation programmée

1. Le helper valide la date, les clubs, les heures et les partenaires.
2. Il calcule l’ouverture **six jours calendaires avant la date du terrain**, en `Europe/Paris`, en recalculant les décalages été/hiver.
3. Hermes crée un job ponctuel pour **7 h 55**, avec `no_agent=true` : aucun modèle ne décide quoi réserver au moment du lancement.
4. Chromium démarre à **7 h 55**, se connecte et attend **8 h** avant de commencer la recherche.
5. Si `polling` est activé, les recherches se répètent au plus tôt à l’intervalle demandé, jusqu’à sélection ou expiration de la fenêtre. Chaque réponse et son affichage sont attendus ; une recherche lente retarde la suivante. En mode `after-window`, les replis sont essayés une fois après expiration.
6. Le résultat est remis au chat/topic Telegram d’origine via Hermes.

**8 h est l’heure prévue de début des recherches, pas une garantie de confirmation à 8 h.** Le réseau, la connexion, le CAPTCHA et la disponibilité du terrain influencent le résultat. Le lanceur refuse un départ plus de dix minutes avant l’ouverture, ou après la fin de la fenêtre si `polling` est activé (sinon, après une heure).

Les paramètres variables restent dans une demande protégée. La configuration complète contenant les identifiants est créée temporairement avec le mode `600` juste avant l’exécution, puis supprimée lors du nettoyage du lanceur. Les demandes terminées ou annulées ne peuvent pas être rejouées.

## Gérer les demandes programmées

### Préparer et attacher une demande

Créer un fichier de demande complet, avec une date explicite et, pour un test, le booléen `dryRun: true` :

```json
{
  "date": "21/09/2026",
  "locations": ["Max Rousié"],
  "hours": ["18", "19"],
  "courtType": ["Couvert"],
  "players": [{ "firstName": "PRENOM", "lastName": "NOM" }],
  "dryRun": true
}
```

Remplacer les exemples avant utilisation. Sans `dryRun`, la demande préparée est une demande de réservation réelle. Une chaîne comme `"true"` est refusée : utiliser un booléen JSON.

```sh
chmod 600 /chemin/demande.json
npm run booking:manage -- prepare --input /chemin/demande.json
```

`prepare` crée une demande locale et un script de lancement ; **il ne crée pas le cron Hermes**. La réponse fournit notamment `requestId`, `schedule`, `bookingOpensAt`, `cronName` et `script`.

Le [skill Hermes](../skills/tennis-booking/SKILL.md) décrit la création du cron avec ces valeurs, `no_agent=true`, le dossier de travail du dépôt et la livraison au chat d’origine. Une fois le cron créé :

```sh
npm run booking:manage -- attach --request-id 'ID_DE_DEMANDE' --cron-job-id 'ID_DU_CRON_HERMES'
```

L’option `prepare --consume` supprime le fichier d’entrée même si la préparation échoue. Elle est réservée aux fichiers `/tmp/tennis-booking-request-*.json` utilisés par Hermes.

### Lister, modifier et annuler

```sh
npm run booking:list
npm run booking:manage -- show --request-id 'ID_DE_DEMANDE'
npm run booking:manage -- edit --request-id 'ID_DE_DEMANDE' --input /chemin/demande-modifiee.json
npm run booking:manage -- cancel --request-id 'ID_DE_DEMANDE'
```

`edit` attend une demande complète, vérifie les clubs et conserve la même date d’ouverture et le même cron. Pour changer de date, annuler la demande puis en préparer et programmer une nouvelle. Une demande en cours ou terminée n’est pas modifiable.

`cancel` désactive l’exécution locale et conserve le dossier de suivi. Il faut aussi retirer le cron associé dans Hermes. Il ne supprime aucune réservation du compte et refuse d’interrompre une demande déjà en cours.

Si la création du cron a échoué, supprimer une demande encore `prepared` avec :

```sh
npm run booking:manage -- cleanup --request-id 'ID_DE_DEMANDE'
```

`booking:list` affiche les dossiers gérés par ce helper. Il ne recense pas les crons Linux ou les autres tâches Hermes. Utiliser le gestionnaire Hermes pour les nouvelles demandes.

### Comprendre les statuts

| Statut | Signification |
| --- | --- |
| `prepared` | Demande préparée ; cron pas encore attaché. |
| `scheduled` | Identifiant du cron enregistré. |
| `running` | Lanceur démarré, éventuellement encore en attente de 8 h. |
| `succeeded` | Réservation confirmée. |
| `succeeded_with_warnings` | Réservation confirmée, puis erreur dans une étape suivante. Ne pas réserver à nouveau. |
| `dry_run_succeeded` | Dry-run terminé avec annulation vérifiée. |
| `unavailable` | Exécution terminée sans réservation trouvée. |
| `failed` | Exécution en échec. Consulter le journal. |
| `partially_succeeded` | Première heure confirmée, deuxième non confirmée. Garder la première ; ne pas rejouer la demande. |
| `dry_run_partial` | Une seule heure a terminé son test avec annulation vérifiée. |
| `needs_reconciliation` | Résultat incertain, notamment après soumission ou interruption. Vérifier le compte avant une nouvelle tentative. |
| `cancelled` | Demande future désactivée localement. |

Le lanceur reçoit des événements structurés de confirmation et d’annulation. Une erreur d’écriture ICS après confirmation ne transforme donc pas une réservation réussie en réservation échouée.

Pour vérifier une demande sans lancer de navigateur ni modifier son statut :

```sh
node scripts/run-booking-request.js --request /chemin/vers/ID_DE_DEMANDE.json --check
```

## CAPTCHA et Hugging Face

La reconnaissance automatique traite les CAPTCHAs textuels LiveIdentity lorsqu’ils apparaissent. Le Space par défaut est [Nischay103/captcha_recognition](https://huggingface.co/spaces/Nischay103/captcha_recognition).

**Aucune clé API Hugging Face n’est configurée ni envoyée par l’intégration actuelle.** Elle utilise l’accès public au Space. Celui-ci peut être indisponible ou changer ses conditions d’accès ; ajouter arbitrairement une clé dans le JSON n’active pas une authentification.

Seule l’image du CAPTCHA est transmise au Space, pas les identifiants ni la page complète. Sans CAPTCHA, aucun appel de reconnaissance n’est effectué.

| Paramètre `ai` | Défaut | Rôle |
| --- | --- | --- |
| `enable` | `true` | `false` désactive la reconnaissance automatique. |
| `space` | `Nischay103/captcha_recognition` | Space Gradio compatible avec `/predict`, entrée image `input` et résultat textuel. |
| `maxAttempts` | `2` | Nombre de tentatives, plafonné à 3. |
| `timeoutMs` | `30000` | Délai d’appel au fournisseur, plafonné à 60 secondes. |

En headless, l’échec de reconnaissance arrête l’exécution. Avec `--headed`, le script laisse la possibilité de saisir la réponse manuellement dans la limite du délai de l’étape, jusqu’à cinq minutes.

Le script attend l’acceptation par le site et gère le remplacement ou le détachement de l’iframe pendant la navigation. Un CAPTCHA rejeté reste un échec de validation : la reconnaissance n’est garantie dans aucun mode. Les puzzles demandant de sélectionner des images ne sont pas pris en charge.

## Calendrier et notifications

Après confirmation, le script génère `event.ics` en exécution locale. Avec GitHub Actions, il n’écrit pas ce fichier sur disque. Les notifications ntfy peuvent transmettre le fichier ICS après réservation ou une capture lors d’une erreur.

Pour les activer, ajouter dans `config.fixed.json` un bloc `ntfy` :

```json
{
  "ntfy": {
    "enable": true,
    "topic": "VOTRE_TOPIC_DIFFICILE_A_DEVINER",
    "domain": "ntfy.sh"
  }
}
```

S’abonner au même topic depuis l’application ou le [site ntfy](https://ntfy.sh). Le topic peut contenir des informations de réservation ; choisir un nom difficile à deviner ou un serveur dont vous contrôlez l’accès. `domain` est facultatif et vaut `ntfy.sh` par défaut.

La livraison Telegram des jobs Hermes fonctionne séparément de ntfy. Le lanceur retourne un résumé ; Hermes assure sa livraison au chat d’origine.

## Variables et fichiers locaux

| Variable | Usage |
| --- | --- |
| `TENNIS_CONFIG_PATH` | Chemin vers une configuration complète, prioritaire sur les fichiers séparés. Utilisé par le lanceur pour la configuration temporaire. |
| `TENNIS_FIXED_CONFIG_PATH` | Chemin des paramètres fixes ; défaut : `config.fixed.json` à la racine du dépôt. |
| `TENNIS_REQUEST_CONFIG_PATH` | Chemin des préférences pour le lancement direct ; défaut : `config.request.json`. |
| `TENNIS_BOOKING_STATE_DIR` | Dossiers des demandes ; défaut : `~/.local/state/par-ici-tennis/bookings`. |
| `HERMES_HOME` | Dossier Hermes ; défaut : `~/.hermes`. |
| `HERMES_SCRIPTS_DIR` | Dossier des scripts de lancement Hermes ; défaut : `scripts/` dans le dossier Hermes. |
| `TENNIS_NODE_BINARY` | Exécutable Node utilisé dans les scripts générés ; défaut : celui de la préparation. |
| `ACCOUNT_EMAIL`, `ACCOUNT_PASSWORD` | Identifiants de secours si les valeurs correspondantes sont absentes de la configuration. |
| `NTFY_TOPIC`, `NTFY_DOMAIN` | Paramètres ntfy transmis par l’environnement, notamment dans les workflows GitHub. |

La préparation Hermes exige les identifiants dans les paramètres fixes. Elle ne remplace pas cette validation par les variables `ACCOUNT_*`.

Les demandes sont stockées en mode `600`, dans un dossier en mode `700`. Utiliser un même dossier d’état pour tous les comptes de cette installation afin de partager le verrou d’exécution. Les opérations de réservation et d’annulation confirmée sont sérialisées. Un verrou `.operation-lock` laissé après une interruption demande de vérifier le processus et le compte avant de le retirer.

| Fichier ou dossier | Contenu |
| --- | --- |
| `config.fixed.json` | Compte, tarifs, CAPTCHA et ntfy. |
| `config.request.json` | Préférences locales de réservation. |
| `logs/hermes/` | Journaux des demandes exécutées. |
| `img/failure.png` | Capture lors d’un échec du script de réservation. |
| `img/captcha/` | Images des CAPTCHAs enregistrées en mode debug. |
| `event.ics` | Événement calendrier après réservation. |

Ces fichiers du dépôt sont ignorés par Git. Les captures et journaux peuvent contenir des données du compte ; les relire avant de les partager.

## GitHub Actions

Les workflows restent disponibles en complément du VPS :

- [Tennis booking dry-run](../.github/workflows/book-tennis-dry.yml) : test lancé manuellement ;
- [Tennis booking](../.github/workflows/book-tennis.yml) : tentative réelle, déclenchement programmé déclaré à 7 h 45 `Europe/Paris`, puis attente jusqu’à 8 h ;
- [Pull request tests](../.github/workflows/pr-tests.yml) : installation des dépendances et ESLint. La suite `npm test` n’est pas exécutée par ce workflow actuel.

Dans **Settings → Secrets and variables → Actions**, renseigner :

| Type | Nom | Contenu |
| --- | --- | --- |
| Secret | `ACCOUNT_EMAIL` | Identifiant Paris Tennis. |
| Secret | `ACCOUNT_PASSWORD` | Mot de passe Paris Tennis. |
| Secret facultatif | `NTFY_TOPIC`, `NTFY_DOMAIN` | Configuration ntfy. |
| Variable | `CONFIG_JSON` | Configuration complète sans identifiants ni données secrètes, incluant notamment `priceType`, `locations`, `hours`, `courtType` et `players`. |

Les workflows écrivent cette variable dans un `config.json` temporaire au format historique. Omettre `date` pour chercher à J+6 ; ne jamais placer les identifiants dans `CONFIG_JSON`.

Tester avec le workflow dry-run avant d’activer le workflow réel. Le workflow réel tente de se désactiver après chaque exécution, y compris en cas d’échec ; le réactiver pour une autre tentative. **Un déclenchement manuel du workflow réel réserve immédiatement**, sans attente de 8 h. Les délais de démarrage GitHub et ceux du site empêchent de garantir une réservation à une seconde précise.

## Diagnostic et validation

```sh
npm run eslint
npm test
```

Les tests locaux couvrent notamment les correspondances de clubs, les tarifs via la configuration, les transitions CAPTCHA, les changements d’heure, les statuts du lanceur, le refus des relances et l’annulation sur formulaire simulé.

Pour diagnostiquer une recherche réelle sans confirmer de réservation :

```sh
npm run start-dry-debug
npm run start-dry-headed-debug
```

Le mode debug affiche les étapes, la navigation, les réponses CAPTCHA, les résultats de reconnaissance et la réponse d’annulation du dry-run. Il conserve aussi l’image exacte envoyée à Hugging Face.

| Symptôme | Vérification |
| --- | --- |
| Club inconnu ou ambigu | Relancer `clubs:find`, puis reprendre le libellé exact. |
| CAPTCHA refusé ou fournisseur indisponible | Examiner les logs ; essayer le mode visible pour une saisie manuelle. |
| Page inconnue ou erreur serveur | Vérifier le site et le compte ; une erreur n’est pas une preuve d’absence de réservation. |
| Demande déjà terminée | Lire son statut et les réservations du compte ; ne pas réinitialiser son statut pour la rejouer. |
| Résultat incertain après soumission | Lancer `reservations:list` et vérifier le compte avant une autre tentative. |
| Verrou présent | Vérifier le processus actif et la situation du compte avant intervention. |
| `npm` absent dans SSH | Charger le chemin de l’installation Node/npm utilisée sur le VPS. |

L’annulation d’une réservation confirmée dispose de tests en simulation. Une lecture réelle d’un compte vide valide le parcours de consultation, mais ne constitue pas un test réel d’annulation. Le dry-run, lui, vérifie la libération de sa réservation temporaire.

## Contribuer

Utiliser les onglets **Issues** ou **Pull requests** du dépôt qui héberge le fork. Exécuter ESLint et les tests adaptés aux changements, sans inclure de configuration privée, journal du compte ou capture personnelle.

Projet initial : [bertrandda/par-ici-tennis](https://github.com/bertrandda/par-ici-tennis). Licence MIT — voir [LICENSE](../LICENSE).


## Monitoring des ouvertures

La commande `npm run availability:monitor -- --club "Padel Jules Ladoumègue" --sport padel --date 20/09/2026 --start 2026-09-14T07:55:00+02:00 --end 2026-09-14T08:10:00+02:00 --interval-seconds 2` observe toutes les heures de cette journée. Elle ne lance pas `index.js`, ne sélectionne aucun créneau et bloque les endpoints de réservation et d’annulation sur sa page navigateur.

Elle utilise uniquement le compte fixe et le verrou partagé avec les opérations tennis. Les préférences de réservation et la tâche programmée restent indépendantes. Les fichiers `logs/monitoring/*.jsonl` et `*.report.json` sont privés (mode 600), hors Git. `--output-dir` permet de choisir un autre dossier privé ; `--check` valide seulement la configuration. Une fenêtre terminée ou des fichiers de preuve déjà existants ne sont pas rejoués ni écrasés.

Pour Hermes, programmer un seul cron `--no-agent` qui exécute un wrapper shell depuis le repo et délivre stdout dans le chat souhaité. Le wrapper doit appeler cette commande de monitoring, jamais le script de réservation. Prévoir `cron.script_timeout_seconds` supérieur à la durée de la fenêtre, avec une marge pour la connexion et le rapport. Le résumé final indique la première apparition, le dernier relevé vide, les erreurs et les chemins des preuves. Une erreur de connexion ou trois erreurs successives produisent un échec explicite.

Une transition vide → créneaux permet d’encadrer l’apparition observée, pas de certifier l’heure exacte du serveur. Un relevé positif initial signifie seulement « déjà disponible à cet instant ». Conserver séparément les slots affichés et les boutons accessibles au compte ; les droits du compte peuvent limiter la seconde catégorie. La règle de programmation n’est jamais modifiée automatiquement d’après une seule observation.


## Séparer le compte de monitoring du compte de réservation

`config.fixed.json` accepte le bloc optionnel `monitoringAccount: { "email": "...", "password": "..." }`. L’exemple versionné contient un bloc vide. Le compte principal reste dans `account` : il sert aux réservations, à leur consultation et à leur annulation. Les paramètres variables, les requêtes Hermes et les replis ne peuvent pas remplacer ces identifiants.

Si `monitoringAccount` est absent, nul ou entièrement vide, tous les parcours conservent le compte principal. S’il est renseigné, les deux valeurs sont obligatoires et l’adresse doit différer de celle du compte principal. Une configuration partielle ou un échec d’authentification du compte configuré arrête l’opération ; il n’y a pas de bascule silencieuse vers les identifiants principaux.

Au lancement programmé, le navigateur se connecte au compte de monitoring et attend l’ouverture prévue. Les recherches répétées et les détections de replis restent sur ce compte. Une disponibilité aux heures, pistes et types de terrain demandés déclenche la fermeture de ce contexte navigateur, puis une connexion dans un contexte neuf avec le compte principal. Le script refait la recherche et vérifie le tarif du principal avant de sélectionner un créneau. Aucune donnée de formulaire ni aucun cookie de monitoring n’est réutilisé pour réserver.

Si la seconde recherche ne trouve plus de créneau compatible, le script revient au compte de monitoring. Un délai de trente secondes par créneau évite de reconnecter le principal à chaque relevé identique ; la limite initiale de recherche reste applicable. Après sélection, une erreur de checkout arrête la tâche comme auparavant. Les tests dry-run utilisent également le principal pour la sélection et l’annulation temporaire.

`availability:monitor` choisit automatiquement le second compte lorsqu’il existe et n’effectue jamais de bascule pour réserver. `--check` annonce le rôle choisi ; le rapport conserve `accountRole` sans adresse ni mot de passe. Les fichiers fixes sont lus au lancement : compléter le bloc sur le VPS avant le démarrage du cron. Il est aussi accepté dans le fichier historique `config.json`.
