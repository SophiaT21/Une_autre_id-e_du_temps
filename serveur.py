"""Serveur local de l'installation.

- Sert les pages du projet (flaque.html, flaque2.html, ciel.html…) sans cache :
  le navigateur recharge toujours la dernière version des fichiers.
- Relie les écrans : chaque onde créée sur une flaque est envoyée ici
  (POST /onde) puis retransmise à toutes les flaques ouvertes (GET
  /evenements), quelles que soient la fenêtre, le navigateur ou l'ordinateur.
- Donne l'heure de référence (GET /temps) pour que tous les écrans, même sur
  des ordinateurs différents, partagent exactement le même temps.

Lancement (depuis le dossier du projet) :
    python3 serveur.py
puis ouvrir http://localhost:8000/flaque.html et http://localhost:8000/flaque2.html
(depuis un autre ordinateur du même réseau : l'adresse affichée au lancement).

Uniquement la bibliothèque standard de Python : rien à installer.
"""

import http.server
import json
import queue
import socket
import threading
import time
from pathlib import Path

PORT = 8000
ROOT = Path(__file__).resolve().parent

# Une file de messages par écran connecté.
clients = set()
clients_lock = threading.Lock()


def broadcast(message):
    with clients_lock:
        for q in list(clients):
            q.put(message)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        # Pas de ligne dans le terminal pour chaque fichier servi.
        pass

    def do_GET(self):
        if self.path == "/temps":
            body = json.dumps({"t": time.time()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/evenements":
            self.stream_events()
        else:
            super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length).decode()

        try:
            message = json.loads(data)
        except ValueError:
            self.send_error(400)
            return

        # Goutte / onde existante
        if self.path == "/onde":
            broadcast(data)
            self.send_response(204)
            self.end_headers()
            return

        # État du parapluie
        if self.path == "/umbrella":
            state = int(message.get("state", 0))

            umbrella_message = json.dumps({
                "type": "umbrella",
                "state": state
            })

            broadcast(umbrella_message)

            self.send_response(204)
            self.end_headers()
            return

        self.send_error(404)

    def stream_events(self):
        """Flux « server-sent events » : les ondes arrivent au fil de l'eau."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = queue.Queue()
        with clients_lock:
            clients.add(q)
        print(f"Écran connecté ({len(clients)} en tout)", flush=True)
        try:
            while True:
                try:
                    message = q.get(timeout=15)
                    self.wfile.write(f"data: {message}\n\n".encode())
                except queue.Empty:
                    # Signe de vie régulier : détecte les écrans fermés.
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with clients_lock:
                clients.discard(q)
            print(f"Écran déconnecté ({len(clients)} en tout)", flush=True)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Une page fermée ou rechargée coupe sa connexion : c'est normal, on
        # n'affiche pas d'erreur pour ça.
        import sys

        if isinstance(sys.exc_info()[1], (ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "?"


if __name__ == "__main__":
    server = Server(("", PORT), Handler)
    print("Serveur de l'installation lancé.")
    print(f"  Sur cet ordinateur    : http://localhost:{PORT}/flaque.html  et  /flaque2.html")
    print(f"  Depuis un autre poste : http://{local_ip()}:{PORT}/flaque.html  et  /flaque2.html")
    print("Ctrl+C pour arrêter.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
