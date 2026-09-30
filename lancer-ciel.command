#!/bin/sh
# Ouvre l'écran du ciel dans Chrome (Mac), en plein écran, avec le son
# autorisé sans clic (le son de la tempête part tout seul quand le parapluie
# s'ouvre). Double-clic pour lancer ; Cmd+Q pour fermer.
#
# ADRESSE : adresse du poste qui lance serveur.py, ou localhost si c'est
# ce Mac.
ADRESSE=localhost

# Profil Chrome séparé : l'option du son s'applique même si Chrome est déjà
# ouvert.
open -na "Google Chrome" --args \
  --autoplay-policy=no-user-gesture-required \
  --kiosk \
  --user-data-dir="$TMPDIR/chrome-ciel" \
  --no-first-run \
  "http://$ADRESSE:8000/ciel.html"
