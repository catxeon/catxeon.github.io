"""Общие пути и чтение/запись базы карт."""
import json, os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCANS = os.path.join(ROOT, "scans")
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(ROOT, "img")
CACHE = os.path.join(ROOT, ".cache")
DB = os.path.join(DATA, "cards.json")

SIDES = ("front", "back")

PIP_NAMES = {"PIL": "pillow", "numpy": "numpy"}


def require(*modules):
    """Понятная ошибка вместо трейсбека, если зависимости не установлены.

    Частая ловушка на Windows: пакет поставлен в другой интерпретатор, и
    `python` из PATH его не видит. Поэтому в подсказке -- полный путь именно
    к тому интерпретатору, которым запущен скрипт.
    """
    missing = [m for m in modules if not _importable(m)]
    if not missing:
        return
    packages = " ".join(PIP_NAMES.get(m, m) for m in missing)
    lines = [
        "",
        "Не хватает библиотек: " + ", ".join(missing),
        "Установи их в тот же интерпретатор, которым запускаешь скрипт:",
        "",
        '    "' + sys.executable + '" -m pip install ' + packages,
        "",
    ]
    sys.stderr.write("\n".join(lines))
    sys.exit(1)


def _importable(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def empty_side():
    return {"file": None, "rotate": 0, "masks": [], "nomask": False}


def new_card(cid):
    return {
        "id": cid,
        "front": empty_side(),
        "back": empty_side(),
        "bank": "",
        "country": "RU",
        "network": "",
        "type": "",
        "title": "",
        "notes": "",
        "tags": [],
        "status": "todo",
    }


def load():
    if not os.path.exists(DB):
        return {"version": 1, "cards": []}
    with open(DB, encoding="utf-8") as fh:
        return json.load(fh)


def save(db):
    """Атомарная запись: сначала во временный файл, потом замена."""
    os.makedirs(DATA, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(db, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, DB)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def used_files(db):
    out = set()
    for c in db["cards"]:
        for s in SIDES:
            if c[s].get("file"):
                out.add(c[s]["file"])
    return out
