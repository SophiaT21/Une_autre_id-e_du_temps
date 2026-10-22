# Une autre idée du temps

Installation interactive : deux écrans de flaque d'eau reliés (un clic crée une onde qui passe d'un écran à l'autre), et un écran de ciel.

| Page | Rôle |
|---|---|
| `flaque.html` | Flaque 1 — écran de **gauche** |
| `flaque2.html` | Flaque 2 — écran de **droite** |
| `ciel.html` | Ciel (un clic fait tomber une goutte) |

Les trois écrans sont **muets** : tous les sons (gouttes, pluie, vent, tonnerre, ambiance) sont joués par `serveur.py`, donc sortent de l'ordinateur émetteur.

Tout fonctionne **hors ligne** : Three.js est inclus dans `vendor/`.

## Montage : un ordinateur émetteur + trois écrans

Tous les ordinateurs doivent être sur le **même réseau** (même box / wifi, ou reliés par câble).

**Ordinateur émetteur** (serveur + sons, branché aux enceintes)

1. Installer Python depuis <https://www.python.org/downloads/> (sur Windows, cocher « Add python.exe to PATH »), puis, une seule fois, la bibliothèque des sons :
   ```
   py -m pip install pygame
   ```
   (sur Mac : `python3 -m pip install pygame`).
2. Dans le dossier du projet, lancer :
   ```
   py serveur.py
   ```
   (sur Mac : `python3 serveur.py`). Au premier lancement, autoriser le pare-feu pour les **réseaux privés**.
3. Noter l'adresse affichée, par exemple `http://192.168.1.20:8000/…`.
4. Vérifier que le serveur affiche « Sons : joués par cet ordinateur. ». S'il affiche « AUCUN SON », pygame n'est pas installé (étape 1).

**Les trois écrans** (rien à installer)

Dans chaque lanceur, remplacer `localhost` par l'adresse de l'ordinateur émetteur (ligne `ADRESSE=`), puis double-cliquer dessus :

| Écran | Windows | Mac |
|---|---|---|
| Flaque de gauche | `flaque1_son.bat` | — |
| Flaque de droite | `flaque2_son.bat` | — |
| Ciel | `ciel_son.bat` | `lancer-ciel.command` |

Ou ouvrir dans Chrome **http://ADRESSE-DE-L-EMETTEUR:8000/flaque.html** (ou `flaque2.html`, `ciel.html`), puis **F11** (plein écran).

Le serveur relie les écrans (les ondes passent de l'un à l'autre), leur donne la même heure (vent, houle et ondes synchronisés) et transmet à la page des sons tout ce qui se passe.

## À savoir

- Les deux flaques doivent avoir **la même résolution** pour que les arbres et la houle se raccordent.
- L'adresse de l'ordinateur émetteur peut changer d'un jour à l'autre : vérifier celle affichée par le serveur à chaque montage.
- Sur un seul ordinateur, ouvrir les pages avec `http://localhost:8000/…` suffit.
- Les volumes se règlent en haut de `sons.py`. Le son sort à un niveau un peu plus bas qu'avant dans le navigateur : monter le volume des enceintes.
