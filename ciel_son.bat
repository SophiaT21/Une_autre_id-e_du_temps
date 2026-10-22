@echo off
rem Ouvre l'ecran du ciel dans Chrome, en plein ecran (muet : les sons sont
rem joues par l'ordinateur emetteur, voir serveur.py).
rem
rem ADRESSE : adresse du PC qui lance serveur.py (celle qu'il affiche au
rem demarrage), ou localhost si c'est ce PC-ci.
set ADRESSE=localhost

rem Profil Chrome separe : l'option du son s'applique meme si Chrome est deja
rem ouvert. Alt+F4 pour fermer.
start "" chrome --autoplay-policy=no-user-gesture-required --kiosk --user-data-dir="%TEMP%\chrome-ciel" --no-first-run "http://%ADRESSE%:8000/ciel.html"
