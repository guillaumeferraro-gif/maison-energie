"""Serveur local facultatif pour eviter les blocages CORS du navigateur.
Python 3.10+, bibliotheque standard uniquement. Aucun enregistrement en arriere-plan.
Lancer : python demarrer.py, puis ouvrir http://127.0.0.1:8765
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import ipaddress
import json
import mimetypes
import secrets
import re
import threading
import time

ROOT = Path(__file__).resolve().parent / "dist"
TOKEN = secrets.token_urlsafe(32)
PORT = 8765
COMMAND_LOCK = threading.Lock()
LAST_COMMAND = {}
NETWORKS = [ipaddress.ip_network(n) for n in ("192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12")]


def allowed_target(url, method, payload=None):
    u = urlsplit(url)
    if u.username or u.password or u.fragment:
        raise ValueError("Adresse invalide")
    if u.scheme == "https" and u.hostname == "script.google.com" and u.port in (None, 443):
        if method != "POST" or not u.path.startswith("/macros/s/") or not u.path.endswith("/exec") or u.query:
            raise ValueError("Adresse Apps Script invalide")
        return False
    if u.scheme != "http" or u.port not in (None, 80):
        raise ValueError("Seuls les Shelly locaux et votre Apps Script sont accessibles")
    try:
        ip = ipaddress.ip_address(u.hostname)
    except ValueError:
        raise ValueError("Une IP locale est requise") from None
    if not any(ip in n for n in NETWORKS):
        raise ValueError("IP hors du reseau prive")
    if method == "POST" and re.fullmatch(r"/script/\d+/gate", u.path) and not u.query:
        if not isinstance(payload, str) or len(payload) > 1000:
            raise ValueError("Requete portail invalide")
        b = json.loads(payload)
        if not isinstance(b, dict) or not isinstance(b.get("token"), str) or len(b["token"]) < 24:
            raise ValueError("Cle du portail absente")
        action = b.get("action")
        if action == "status" and set(b) <= {"action", "token"}:
            return False
        if action not in ("start", "cancel") or not isinstance(b.get("id"), str) or not 8 <= len(b["id"]) <= 80:
            raise ValueError("Commande portail invalide")
        if action == "cancel" and set(b) <= {"action", "token", "id"}:
            return False
        if action == "start" and b.get("mode") in ("car", "pedestrian") and set(b) <= {"action", "token", "id", "mode", "closed"}:
            if b["mode"] == "pedestrian" and b.get("closed") is not True:
                raise ValueError("Confirmer le portail ferme avant le mode pieton")
            return True
        raise ValueError("Commande portail invalide")
    if method != "GET":
        raise ValueError("Methode non autorisee")
    q = parse_qs(u.query, keep_blank_values=True)
    if u.path in ("/shelly", "/status", "/rpc/Shelly.GetStatus") and not q:
        return False
    if re.fullmatch(r"/rpc/(Text|Number|Boolean|Enum)\.GetStatus", u.path) and set(q) == {"id"} and len(q["id"]) == 1 and re.fullmatch(r"2\d{2}", q["id"][0]):
        return False
    if u.path == "/rpc/Switch.GetStatus" and set(q) == {"id"} and q["id"] in (["0"], ["1"]):
        return False
    if u.path in ("/relay/0", "/relay/1") and q.get("turn") == ["on"] and q.get("timer") in (["0.5"], ["1"], ["2"]) and set(q) == {"turn", "timer"}:
        return True
    if u.path == "/rpc/Switch.Set" and q.get("id") in (["0"], ["1"]) and q.get("on") == ["true"] and q.get("toggle_after") in (["0.5"], ["1"], ["2"]) and set(q) == {"id", "on", "toggle_after"}:
        return True
    raise ValueError("Operation Shelly non autorisee")


class GoogleRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlsplit(newurl)
        if urlsplit(req.full_url).scheme != "https" or u.scheme != "https" or u.hostname not in ("script.google.com", "script.googleusercontent.com") or u.username or u.password:
            raise ValueError("Redirection inattendue")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Do not log device addresses, tokens or request payloads.

    def guard(self):
        hosts = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
        if self.headers.get("Host") not in hosts:
            raise ValueError("Hote refuse")
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + h for h in hosts}:
            raise ValueError("Origine refusee")

    def respond(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            self.guard()
            route = urlsplit(self.path).path
            if route == "/api/session":
                return self.respond({"token": TOKEN})
            file = (ROOT / unquote(route).lstrip("/")).resolve() if route != "/" else ROOT / "index.html"
            if not file.is_relative_to(ROOT) or not file.is_file():
                return self.respond({"error": "Fichier introuvable"}, 404)
            data = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except ValueError as err:
            self.respond({"error": str(err)}, 403)

    def do_POST(self):
        try:
            self.guard()
            if self.path != "/api/request" or not secrets.compare_digest(self.headers.get("X-Maison-Token", ""), TOKEN):
                raise ValueError("Session locale invalide")
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 32000:
                raise ValueError("Requete trop grande")
            b = json.loads(self.rfile.read(size))
            method, url = b.get("method", "GET"), b.get("url", "")
            payload = b.get("body")
            if payload is not None and not isinstance(payload, str):
                raise ValueError("Corps invalide")
            command = allowed_target(url, method, payload)
            if command:
                # Shared by all tabs, with no automatic command retry.
                key = urlsplit(url).hostname
                with COMMAND_LOCK:
                    if time.monotonic() - LAST_COMMAND.get(key, -100) < 10:
                        raise ValueError("Patienter 10 secondes entre deux impulsions")
                    LAST_COMMAND[key] = time.monotonic()
            req = Request(url, data=payload.encode("utf-8") if payload is not None else None, method=method,
                          headers={"Content-Type": "text/plain;charset=utf-8"} if payload else {})
            with build_opener(GoogleRedirects()).open(req, timeout=20 if method == "POST" else 3) as response:
                data = response.read(1_000_001)
                if len(data) > 1_000_000:
                    raise ValueError("Reponse trop grande")
                result = json.loads(data)
            self.respond(result)
        except HTTPError as err:
            self.respond({"error": f"L'appareil a repondu HTTP {err.code}. Authentification ou adresse a verifier."}, 502)
        except Exception as err:
            # Avoid reflecting tokens, full URLs or upstream payloads.
            message = str(err) if isinstance(err, ValueError) else "Appareil ou Google injoignable. Verifiez le reseau."
            self.respond({"error": message[:200]}, 400)


if __name__ == "__main__":
    if not (ROOT / "index.html").is_file():
        raise SystemExit("Conservez le dossier dist a cote de demarrer.py.")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Tableau de bord : http://127.0.0.1:{PORT}")
    print("Ce serveur reste sur cet ordinateur. Ctrl+C pour fermer.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
