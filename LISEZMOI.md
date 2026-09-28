# Une autre idée du temps

Installation interactive : deux écrans de flaque d'eau reliés (un clic crée une onde qui passe d'un écran à l'autre), et un écran de ciel.

| Page | Rôle |
|---|---|
| `flaque.html` | Flaque 1 — écran de **gauche** |
| `flaque2.html` | Flaque 2 — écran de **droite** |
| `ciel.html` | Ciel (un clic fait tomber une goutte) |

Tout fonctionne **hors ligne** : Three.js est inclus dans `vendor/`.

## Lancer sur deux PC

Les deux PC doivent être sur le **même réseau** (même box / wifi, ou reliés par câble).

**PC A** (fait serveur, affiche la flaque de gauche)

1. Installer Python depuis <https://www.python.org/downloads/> en cochant « Add python.exe to PATH ».
2. Dans le dossier du projet, lancer :
   ```
   py serveur.py
   ```
   (sur Mac : `python3 serveur.py`). Au premier lancement, autoriser le pare-feu pour les **réseaux privés**.
3. Noter l'adresse affichée, par exemple `http://192.168.1.20:8000/…`.
4. Ouvrir dans Chrome **http://localhost:8000/flaque.html**, puis **F11** (plein écran).

**PC B** (flaque de droite — rien à installer)

- Ouvrir dans Chrome **http://ADRESSE-DU-PC-A:8000/flaque2.html**, puis **F11**.

Le serveur relie les écrans (les ondes passent de l'un à l'autre) et leur donne la même heure (vent, houle et ondes synchronisés).

## À savoir

- Les deux écrans doivent avoir **la même résolution** pour que les arbres et la houle se raccordent.
- L'adresse du PC A peut changer d'un jour à l'autre : vérifier celle affichée par le serveur à chaque montage.
- Sur un seul ordinateur, ouvrir les deux pages avec `http://localhost:8000/…` suffit.
