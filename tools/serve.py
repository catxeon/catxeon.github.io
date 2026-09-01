"""Локальный редактор коллекции.

    python tools/serve.py

Поднимает http://127.0.0.1:8777 : по / отдаёт сайт ровно так, как он будет
выглядеть на Pages, по /editor -- редактор коллекции. Плюс уменьшенные превью
оригиналов из scans/ и API для чтения/записи data/cards.json. Оригиналы
наружу не публикуются -- сервер слушает только localhost.
"""
import argparse, http.server, io, json, os, socketserver, subprocess, sys, threading, urllib.parse, webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PREV = os.path.join(store.CACHE, "prev")
LOCK = threading.Lock()


def preview(name, width, rotate=0):
    """Уменьшенная (и, если надо, повёрнутая) копия скана, с кешем на диске.

    Поворот делается здесь, а не в браузере: тогда координаты масок в
    редакторе всегда заданы относительно уже повёрнутой картинки -- ровно так,
    как их потом применяет build.py.
    """
    from PIL import Image

    os.makedirs(PREV, exist_ok=True)
    out = os.path.join(PREV, "%s.%d.%d.webp" % (name, width, rotate))
    src = os.path.join(store.SCANS, name)
    if not os.path.exists(src):
        return None
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
        im = Image.open(src).convert("RGB")
        if rotate:
            im = im.rotate(-rotate, expand=True)
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(out, quality=82, method=4)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=store.ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)

        # "/" отдаёт лендинг, как на боевом сайте, чтобы локальный просмотр
        # совпадал с продакшеном; редактор живёт на /editor
        if path in ("/editor", "/editor/"):
            self.path = "/editor.html"
            return super().do_GET()

        if path == "/api/cards":
            return self._send(200, json.dumps(store.load(), ensure_ascii=False))

        if path == "/api/scans":
            names = sorted(f for f in os.listdir(store.SCANS) if f.lower().endswith(".png"))
            return self._send(200, json.dumps(names))

        if path == "/api/pool":
            db = store.load()
            used = store.used_files(db)
            free = sorted(f for f in os.listdir(store.SCANS)
                          if f.lower().endswith(".png") and f not in used)
            return self._send(200, json.dumps(free))

        if path.startswith("/preview/"):
            name = os.path.basename(path[len("/preview/"):])
            q = urllib.parse.parse_qs(url.query)
            width = max(200, min(4000, int(q.get("w", ["1400"])[0])))
            rotate = int(q.get("r", ["0"])[0]) % 360
            try:
                out = preview(name, width, rotate)
            except Exception as exc:
                return self._send(500, json.dumps({"error": str(exc)}))
            if not out:
                return self._send(404, json.dumps({"error": "нет такого скана"}))
            with open(out, "rb") as fh:
                data = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/webp")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            return self.wfile.write(data)

        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"

        if path == "/api/cards":
            try:
                db = json.loads(raw.decode("utf-8"))
                if not isinstance(db, dict) or not isinstance(db.get("cards"), list):
                    raise ValueError("ожидался объект с полем cards")
                with LOCK:
                    store.save(db)
            except Exception as exc:
                return self._send(400, json.dumps({"error": str(exc)}))
            return self._send(200, json.dumps({"ok": True, "cards": len(db["cards"])}))

        if path == "/api/build":
            opts = json.loads(raw.decode("utf-8") or "{}")
            cmd = [sys.executable, os.path.join(store.ROOT, "tools", "build.py")]
            for flag in ("--all",):
                if opts.get(flag.strip("-")):
                    cmd.append(flag)
            if opts.get("format"):
                cmd += ["--format", str(opts["format"])]
            if opts.get("max_width") is not None:
                cmd += ["--max-width", str(int(opts["max_width"]))]
            p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            return self._send(200, json.dumps({"code": p.returncode, "out": (p.stdout or "") + (p.stderr or "")}))

        return self._send(404, json.dumps({"error": "нет такого метода"}))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    store.require("PIL")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    base = "http://127.0.0.1:%d" % args.port
    editor = base + "/editor"
    with Server(("127.0.0.1", args.port), Handler) as srv:
        print("Редактор: %s" % editor)
        print("Сайт:     %s/   (Ctrl+C чтобы остановить)" % base)
        if not args.no_browser:
            threading.Timer(0.6, lambda: webbrowser.open(editor)).start()
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\nОстановлен.")


if __name__ == "__main__":
    main()
