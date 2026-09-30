@echo off
rem Ouvre la flaque 2 dans Chrome, en plein ecran, avec le son autorise
rem sans clic (bruit des gouttes qui tombent dans l'eau).
rem
rem ADRESSE : adresse du PC qui lance serveur.py (celle qu'il affiche au
rem demarrage), ou localhost si c'est ce PC-ci.
set ADRESSE=localhost

rem Profil Chrome separe : l'option du son s'applique meme si Chrome est deja
rem ouvert. Alt+F4 pour fermer.
start "" chrome --autoplay-policy=no-user-gesture-required --kiosk --user-data-dir="%TEMP%\chrome-flaque2" --no-first-run "http://%ADRESSE%:8000/flaque2.html"
