# Lacets — appli moto

Appli web installable sur le téléphone (PWA) pour :

- **lire des GPX** : traces, routes à étapes (y compris les routes Garmin BaseCamp avec le tracé détaillé `gpxx:rpt`), points d'intérêt, GPX 1.0 et 1.1, plusieurs fichiers ou un `.zip` d'un coup. Pour chaque parcours : distance, durées, vitesses, dénivelés, et un profil altimétrique interactif (glisse le doigt dessus pour voir la pente et le point sur la carte). Si le fichier n'a pas d'altitudes, l'appli peut estimer le dénivelé.
- **planifier des parcours moto** : touche la carte pour poser les étapes, déplace-les, touche le tracé pour insérer un point. Trois profils : *Virolos* (routes sinueuses, ni autoroute ni péage), *Balade*, *Rapide*. Options : éviter autoroutes, péages, chemins non goudronnés, ferries. Boucle, inversion, annuler/rétablir, recherche de lieux, profil et dénivelé. Export GPX (trace + étapes) compatible Garmin, TomTom, Calimoto, etc.
- **rouler** : enregistrement de la balade (écran maintenu allumé, reprise si l'appli est fermée par erreur), guidage le long d'un parcours avec consignes vocales en français, panneau façon signalisation française, alerte « hors parcours » et itinéraire pour rejoindre le tracé, mode simulation pour tester à la maison.
- **photos** : ajoutées pendant la balade (appareil photo) ou après coup depuis la galerie. Elles sont placées sur la carte grâce au GPS de la photo, sinon d'après l'heure de prise de vue, sinon à la main.
- **communauté** : sorties proposées (date, rendez-vous, rythme, parcours joint, « Je participe »), photos, dangers signalés (gravillons, huile, travaux, animaux…) affichés sur la carte et annoncés à l'approche pendant le guidage.
- **hors connexion** : l'appli fonctionne sans réseau, la carte déjà vue reste en cache, et un parcours peut être préparé hors ligne avant de partir.

Tout est en HTML/CSS/JavaScript, sans étape de compilation.

## Installer l'appli sur ton téléphone

L'appli doit être servie en **HTTPS** (obligatoire pour le GPS et l'installation). Le plus simple et gratuit : **GitHub Pages**.

1. Crée un dépôt public sur github.com, par exemple `lacets`.
2. Envoie le **contenu** du dossier `lacets/` à la racine du dépôt (`index.html` doit être à la racine) : bouton *Add file → Upload files*, ou `git push`.
3. Dans le dépôt : *Settings → Pages → Build and deployment → Source : Deploy from a branch*, branche `main`, dossier `/ (root)`, puis *Save*.
4. Une à deux minutes plus tard, l'appli est en ligne sur `https://<ton-pseudo>.github.io/lacets/`.
5. Ouvre cette adresse dans **Chrome sur ton téléphone**, puis menu ⋮ → **Installer l'application** (ou *Ajouter à l'écran d'accueil*).

Une fois installée sur Android, Lacets apparaît aussi dans le menu **Partager** : un GPX reçu par WhatsApp, mail ou Drive s'ouvre directement dedans.

Autre option : [Netlify Drop](https://app.netlify.com/drop), en glissant le dossier `lacets/` (compte gratuit nécessaire pour garder le site en ligne).

### Tester sur ton PC

```bash
cd lacets
python3 -m http.server 8080
```

Puis ouvre <http://localhost:8080>. Le GPS marche sur `localhost` ; sur une autre adresse en `http://`, il faut du HTTPS.

## Prise en main

- **Carte** : vue d'ensemble de tous tes parcours (magenta : planifiés, bleu : balades enregistrées, vert : GPX importés). Touche un tracé pour l'ouvrir.
- **Planifier** : touche la carte pour placer le départ (D), puis les étapes ; le dernier point est l'arrivée (A). Fais glisser un point pour le déplacer, touche-le pour le supprimer ou le renommer. Touche le tracé pour insérer une étape. Le brouillon est gardé même si tu fermes l'appli.
- **Rouler** : choisis « Balade libre » ou un parcours à suivre, puis *Démarrer*. Le bouton rouge en haut de la carte ramène au tableau de bord si tu quittes l'écran. *Simuler le trajet* fait avancer une position fictive le long du parcours, pour entendre le guidage avant de partir.
- **Parcours** : liste, recherche, filtres, fiche détaillée, photos, notes, export GPX, préparation hors ligne (menu ⋯).
- **Réglages** (icône curseurs) : thème jour/nuit, voix, **sauvegarde complète** (un `.zip` avec tous les parcours, les photos et chaque parcours en GPX) et restauration.

## Activer le partage avec tes potes (Supabase, gratuit)

Sans configuration, l'onglet Communauté est en **mode démo** : des exemples marqués « exemple », et tes publications restent sur ton téléphone. Pour partager pour de vrai :

1. Crée un projet gratuit sur [supabase.com](https://supabase.com).
2. *SQL Editor → New query* : colle le contenu de `supabase/schema.sql`, puis *Run*. Le script crée les tables, les règles d'accès (chacun ne modifie que ses publications) et le dossier de photos.
3. *Authentication → Sign In / Providers* : active **Allow anonymous sign-ins**. Personne n'a besoin de créer de compte.
4. *Project Settings → API Keys* : copie l'**adresse du projet** (`https://xxxx.supabase.co`) et la **clé publique** (`sb_publishable_…`, ou l'ancienne clé `anon`). Ne mets jamais la clé secrète (`service_role` / `sb_secret_…`) dans l'appli.
5. Dans l'appli : *Communauté →* icône réglages → colle l'adresse et la clé, choisis ton pseudo, *Enregistrer*.
6. Donne ces deux valeurs à tes potes : ils les collent dans leur appli et vous voyez les mêmes sorties, photos et alertes.

À savoir : un projet gratuit se met en pause après une semaine sans activité (il se relance depuis le tableau de bord Supabase). Si l'adresse et la clé circulent au-delà de ton groupe, active aussi la protection CAPTCHA de Supabase pour limiter les abus.

## Limites à connaître

- **GPS en arrière-plan** : comme toute appli web, Lacets ne reçoit plus le GPS quand l'écran est éteint ou que l'appli passe en arrière-plan. Pendant une balade, garde le téléphone sur son support avec l'écran allumé (l'appli demande au téléphone de ne pas se mettre en veille). Pour enregistrer téléphone dans la poche, il faudra une version native (voir plus bas).
- **Services gratuits** : le routage (Valhalla et OSRM hébergés par FOSSGIS), la recherche (Photon de komoot), les altitudes (Open-Meteo) et la carte (OpenFreeMap, IGN, OpenTopoMap) sont des services publics gratuits, sans garantie de disponibilité. Le routage est limité à **une requête par seconde**, et l'appli respecte cette limite. Si Valhalla ne répond pas, l'appli bascule sur OSRM : l'itinéraire est alors un trajet voiture, sans les options moto et sans consignes vocales.
- **Tes données sont stockées dans le navigateur du téléphone.** Effacer les données de Chrome efface tes parcours : fais une sauvegarde de temps en temps (Réglages → Exporter une sauvegarde).
- **Couverture** : les fonds « Plan IGN » et « Satellite » couvrent la France uniquement ; « Routier », « Nuit » et « Relief » couvrent le monde entier.
- **iPhone** : l'appli s'installe depuis Safari (Partager → Sur l'écran d'accueil). Le maintien de l'écran allumé et la voix peuvent y être moins fiables que sur Android.

## Modifier l'appli

```
index.html             structure de la page et icônes
css/app.css            styles (variables de couleurs en tête de fichier)
js/main.js             démarrage, onglets, recherche, service worker
js/planner.js          planificateur
js/library.js          liste et fiche des parcours
js/ride.js             mode Rouler, guidage, voix
js/recorder.js         enregistrement GPS
js/community.js        communauté (démo et Supabase)
js/gpx.js              lecture / écriture GPX
js/services.js         routage, recherche, altitudes
js/offline.js          cache de carte hors ligne
sw.js                  service worker
supabase/schema.sql    base de données du partage
tools/stamp_sw.py      met à jour la liste des fichiers du service worker
```

Après chaque modification, lance `python3 tools/stamp_sw.py .` depuis le dossier de l'appli : sinon les téléphones gardent l'ancienne version en cache. Une fois en ligne, l'appli propose « Mettre à jour » quand une nouvelle version est disponible.

Dans la console du navigateur, `window.__lacets` donne accès à la carte (`__lacets.map`) et à l'état de l'appli pour déboguer.

## Pour aller plus loin

- **Version Android native** avec GPS en arrière-plan : emballer l'appli avec [Capacitor](https://capacitorjs.com) et le plugin `@capacitor-community/background-geolocation`, puis générer un APK avec Android Studio.
- **Guidage vocal sur un GPX importé** : l'API `trace_route` de Valhalla peut recaler une trace sur les routes et fournir les consignes.
- **Ton propre serveur Valhalla** (Docker) si vous êtes nombreux à l'utiliser : il suffit de changer l'adresse dans `js/services.js`.

## Crédits et licences

- Affichage de la carte : [MapLibre GL JS](https://maplibre.org) (BSD-3).
- Fonds de carte : [OpenFreeMap](https://openfreemap.org), [IGN Géoplateforme](https://geoservices.ign.fr) (Licence Ouverte Etalab 2.0), [OpenTopoMap](https://opentopomap.org) (CC-BY-SA). Données © les contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Itinéraires : [Valhalla](https://github.com/valhalla/valhalla) et OSRM, serveurs [FOSSGIS](https://fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/).
- Recherche : [Photon](https://photon.komoot.io) par komoot. Altitudes : [Open-Meteo](https://open-meteo.com) (CC BY 4.0), modèle Copernicus DEM.
- Partage : [supabase-js](https://github.com/supabase/supabase-js) (MIT). Police : Barlow (SIL Open Font License).
