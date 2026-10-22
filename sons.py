"""Tous les sons de l'installation, joués par l'ordinateur qui lance
serveur.py (branché aux enceintes). Les écrans (ciel, flaques) sont muets :
ils envoient au serveur ce qui se passe (gouttes, éclairs, tempête, vent) et
ce module en tire les sons.

Nécessite pygame (une seule fois, sur l'ordinateur émetteur) :
    py -m pip install pygame        (Windows)
    python3 -m pip install pygame   (Mac)
Sans pygame, le serveur marche quand même, mais sans aucun son.
"""

import heapq
import json
import queue
import random
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# --- Réglages ---------------------------------------------------------------

# Volumes relatifs (1 = volume du fichier). pygame ne sait pas amplifier
# au-delà de 1 : tous les volumes sont divisés par le plus fort
# (LOUDEST), il suffit de monter un peu le volume des enceintes.

# Tempête du parapluie : pluie sur le parapluie + pluie (plus bas, en
# dessous), lancées ensemble depuis le début à chaque ouverture du
# parapluie, en boucle. Leur volume suit la force de la tempête : il monte
# avec elle, baisse quand le ciel s'éclaircit, et les deux s'arrêtent
# ensemble quand la tempête est finie.
STORM_SOUNDS = [("rain-on-an-umbrella.mp3", 1.8), ("pluie.mp3", 0.25)]

# Ambiance : en boucle quand il n'y a ni tempête ni coup de vent. Elle
# s'efface quand la tempête arrive, et baisse seulement (AMBIENT_UNDER_WIND)
# pendant un coup de vent.
AMBIENT_SOUND = ("ambiance.mp3", 1.8)
# Volume de l'ambiance au plus fort d'un coup de vent (part de son volume).
AMBIENT_UNDER_WIND = 0.3

# Vent fort : en boucle, volume = force du coup de vent, arrêté au calme.
WIND_SOUND = ("vent.mp3", 1)

# Tonnerre : part THUNDER_DELAY s après chaque éclair, tiré au hasard
# (jamais deux fois le même de suite).
THUNDER_SOUND_FILES = ["foudre.mp3", "foudre2.mp3", "foudre3.mp3"]
THUNDER_SOUND_VOLUME = 1
THUNDER_DELAY = 3

# Gouttes qui tombent dans l'eau : un des trois sons au hasard, chacun avec
# sa propre intensité, tirée entre ces deux volumes.
DROP_SOUND_FILES = ["Goutte1.mp3", "Goutte2.mp3", "Goutte3.mp3"]
DROP_SOUND_MIN_VOLUME = 0.04
DROP_SOUND_MAX_VOLUME = 0.18
# Nombre maximum de sons de goutte en même temps.
MAX_DROP_SOUNDS = 8
# Aucun bruit de goutte dès que le ciel commence à s'assombrir, pendant la
# tempête et tant qu'il ne s'est pas complètement éclairci, ni pour une
# goutte partie pendant une tempête.
DROP_SOUND_STORM_THRESHOLD = 0.003

LOUDEST = 1.8


# --- Lecture ----------------------------------------------------------------


class Loop:
    """Un son en boucle sur sa propre voie, dont on règle le volume (0-1)."""

    def __init__(self, mixer, channel, file, volume):
        self.sound = mixer.Sound(str(ROOT / file))
        self.channel = mixer.Channel(channel)
        self.gain = volume / LOUDEST
        self.playing = False

    def start(self, level):
        self.channel.play(self.sound, loops=-1)
        self.playing = True
        self.set_level(level)

    def stop(self):
        self.channel.stop()
        self.playing = False

    def set_level(self, level):
        self.channel.set_volume(min(1, max(0, level)) * self.gain)

    # Démarre ou arrête la boucle selon son volume.
    def follow(self, level):
        if level < 0.01:
            if self.playing:
                self.stop()
        elif not self.playing:
            self.start(level)
        else:
            self.set_level(level)


class Sounds:
    def __init__(self, mixer):
        self.mixer = mixer
        mixer.set_num_channels(40)
        # Voies 0-3 réservées aux boucles, les autres pour les sons courts.
        mixer.set_reserved(4)
        self.storm = [Loop(mixer, i, f, v) for i, (f, v) in enumerate(STORM_SOUNDS)]
        self.ambient = Loop(mixer, 2, *AMBIENT_SOUND)
        self.wind = Loop(mixer, 3, *WIND_SOUND)
        self.thunders = [mixer.Sound(str(ROOT / f)) for f in THUNDER_SOUND_FILES]
        self.drops = [mixer.Sound(str(ROOT / f)) for f in DROP_SOUND_FILES]
        self.last_thunder = -1
        self.last_drop = -1
        self.drop_channels = []
        # État reçu de l'écran ciel : umbrella = force de la tempête du
        # parapluie (0-1), wind = force du coup de vent (0-1), storm =
        # assombrissement du ciel.
        self.umbrella_state = 0
        self.umbrella = 0
        self.wind_level = 0
        self.sky_storm = 0
        self.update_loops()

    def update_loops(self):
        # Tempête : volume = sa force ; arrêt quand elle est finie.
        finished = self.umbrella_state <= 0 and self.umbrella < 0.01
        for loop in self.storm:
            if not loop.playing:
                continue
            if finished:
                loop.stop()
            else:
                loop.set_level(self.umbrella)
        under_wind = 1 + (AMBIENT_UNDER_WIND - 1) * self.wind_level
        self.ambient.follow((1 - self.umbrella) * under_wind)
        self.wind.follow(self.wind_level)

    def start_storm(self):
        for loop in self.storm:
            loop.start(self.umbrella)

    # Un des sons (jamais deux fois le même de suite), sur une voie libre :
    # deux sons proches se superposent.
    def play_one_of(self, sounds, last, volume):
        i = random.randrange(len(sounds))
        if i == last and len(sounds) > 1:
            i = (i + 1) % len(sounds)
        channel = self.mixer.find_channel()
        if channel:
            channel.play(sounds[i])
            channel.set_volume(volume / LOUDEST)
        return i, channel

    def play_thunder(self):
        self.last_thunder, _ = self.play_one_of(self.thunders, self.last_thunder, THUNDER_SOUND_VOLUME)

    def play_drop(self, storm=0):
        self.drop_channels = [c for c in self.drop_channels if c.get_busy()]
        if len(self.drop_channels) >= MAX_DROP_SOUNDS:
            return
        if self.sky_storm > DROP_SOUND_STORM_THRESHOLD or storm > DROP_SOUND_STORM_THRESHOLD:
            return
        volume = random.uniform(DROP_SOUND_MIN_VOLUME, DROP_SOUND_MAX_VOLUME)
        self.last_drop, channel = self.play_one_of(self.drops, self.last_drop, volume)
        if channel:
            self.drop_channels.append(channel)

    # Message reçu par le serveur ; renvoie les sons à jouer plus tard
    # [(délai en s, fonction)].
    def receive(self, data):
        kind = data.get("type")
        if kind == "ciel":
            self.sky_storm = data.get("storm", 0)
            self.umbrella = data.get("umbrella", self.umbrella)
            self.wind_level = data.get("wind", self.wind_level)
            self.update_loops()
        elif kind == "umbrella":
            was_open = self.umbrella_state > 0
            self.umbrella_state = data.get("state", 0)
            if self.umbrella_state > 0 and not was_open:
                self.start_storm()
        elif kind == "eclair":
            return [(THUNDER_DELAY, self.play_thunder)]
        elif kind == "goutte":
            # Seulement si elle tombe dans une des flaques, au moment où
            # elle touche l'eau.
            if 0 <= data.get("x", -1) <= 1:
                storm = data.get("storm", 0)
                return [(max(0, data.get("delay", 0)), lambda: self.play_drop(storm))]
        elif kind is None and "bx" in data:
            # Clic sur une flaque.
            self.play_drop()
        return []


# Tous les appels à pygame se font dans un seul fil, qui reçoit les messages
# par cette file et garde les sons à jouer plus tard (tonnerre, gouttes).
messages = queue.Queue()
enabled = False


def run(sounds):
    later = []
    count = 0
    while True:
        timeout = max(0, later[0][0] - time.monotonic()) if later else None
        try:
            data = messages.get(timeout=timeout)
            for delay, action in sounds.receive(data):
                count += 1
                heapq.heappush(later, (time.monotonic() + delay, count, action))
        except queue.Empty:
            pass
        while later and later[0][0] <= time.monotonic():
            heapq.heappop(later)[2]()


def start():
    """Démarre les sons ; renvoie False si pygame manque."""
    global enabled
    try:
        import os

        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        # Sinon pygame garde pour lui Ctrl+C : le serveur ne s'arrête plus.
        os.environ.setdefault("SDL_NO_SIGNAL_HANDLERS", "1")
        from pygame import mixer
    except ImportError:
        print("⚠ pygame n'est pas installé : AUCUN SON.")
        print("  Pour l'installer : py -m pip install pygame  (Mac : python3 -m pip install pygame)")
        return False
    try:
        mixer.init()
        sounds = Sounds(mixer)
    except Exception as error:
        print(f"⚠ Sons impossibles ({error}) : AUCUN SON.")
        return False
    threading.Thread(target=run, args=(sounds,), daemon=True).start()
    enabled = True
    print("Sons : joués par cet ordinateur.")
    return True


def send(message):
    """Transmet un message (texte JSON) reçu par le serveur."""
    if not enabled:
        return
    try:
        data = json.loads(message)
    except ValueError:
        return
    if isinstance(data, dict):
        messages.put(data)
