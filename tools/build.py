"""Сборка публичной части сайта из data/cards.json.

Для каждой карты со статусом done берёт оригинал из scans/, применяет поворот,
заливает чёрным прямоугольники масок и кладёт результат в img/. Оригиналы
никуда не копируются -- в git уезжают только замаскированные версии.

Карта не публикуется, пока у каждой её стороны нет либо масок, либо явной
отметки «маскировать нечего» (nomask). Это защита от случайной публикации
номера, срока и CVV.
"""
import argparse, datetime, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

store.require("PIL")
from PIL import Image, ImageDraw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MANIFEST = os.path.join(store.CACHE, "build.json")
THUMB_W = 520
PUBLIC_FIELDS = ("bank", "country", "network", "type", "title", "notes", "tags")


def render(src, rotate, masks, max_width):
    im = Image.open(src).convert("RGB")
    if rotate:
        im = im.rotate(-rotate, expand=True)
    if masks:
        d = ImageDraw.Draw(im)
        w, h = im.size
        for mx, my, mw, mh in masks:
            d.rectangle([mx * w, my * h, (mx + mw) * w, (my + mh) * h], fill=(0, 0, 0))
    if max_width and im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    return im


def side_key(side, fmt, max_width, quality):
    payload = json.dumps(
        [side.get("file"), side.get("rotate", 0), side.get("masks", []), fmt, max_width, quality],
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode()).hexdigest()


def side_ready(side):
    if not side.get("file"):
        return True  # стороны нет -- нечего публиковать
    return bool(side.get("masks")) or side.get("nomask")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--format", choices=("webp", "png"), default="webp",
                    help="формат публикуемых картинок (по умолчанию webp)")
    ap.add_argument("--max-width", type=int, default=1600,
                    help="ширина публикуемой картинки в пикселях, 0 -- исходное разрешение")
    ap.add_argument("--quality", type=int, default=88, help="качество webp (для png игнорируется)")
    ap.add_argument("--all", action="store_true", help="публиковать и карты со статусом todo")
    ap.add_argument("--force", action="store_true", help="перерисовать всё, игнорируя кеш")
    args = ap.parse_args()

    db = store.load()
    os.makedirs(store.IMG, exist_ok=True)
    os.makedirs(os.path.join(store.IMG, "thumb"), exist_ok=True)
    os.makedirs(store.CACHE, exist_ok=True)

    manifest = {}
    if os.path.exists(MANIFEST) and not args.force:
        manifest = json.load(open(MANIFEST, encoding="utf-8"))

    ext = args.format
    public, skipped, blocked, drawn = [], [], [], 0
    keep = set()

    for card in db["cards"]:
        if card.get("status") != "done" and not args.all:
            skipped.append(card["id"])
            continue
        unsafe = [s for s in store.SIDES if not side_ready(card[s])]
        if unsafe:
            blocked.append((card["id"], unsafe))
            continue

        entry = {k: card.get(k) for k in PUBLIC_FIELDS}
        entry["id"] = card["id"]

        for s in store.SIDES:
            side = card[s]
            if not side.get("file"):
                continue
            name = "%s-%s.%s" % (card["id"], s, ext)
            out = os.path.join(store.IMG, name)
            thumb_name = "%s-%s.webp" % (card["id"], s)
            thumb = os.path.join(store.IMG, "thumb", thumb_name)
            keep.add(name)
            keep.add("thumb/" + thumb_name)

            key = side_key(side, ext, args.max_width, args.quality)
            if manifest.get(name) != key or not os.path.exists(out) or not os.path.exists(thumb):
                im = render(os.path.join(store.SCANS, side["file"]), side.get("rotate", 0),
                            side.get("masks", []), args.max_width)
                if ext == "png":
                    im.save(out, optimize=True)
                else:
                    im.save(out, quality=args.quality, method=5)
                t = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
                t.save(thumb, quality=80, method=5)
                manifest[name] = key
                drawn += 1
                print("  %s" % name)
            w, h = Image.open(out).size
            entry[s] = {"img": "img/" + name, "thumb": "img/thumb/" + thumb_name, "w": w, "h": h}

        public.append(entry)

    # удаляем картинки карт, которые больше не публикуются
    for root, _, files in os.walk(store.IMG):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), store.IMG).replace("\\", "/")
            if rel not in keep and (f.endswith(".webp") or f.endswith(".png")):
                os.unlink(os.path.join(root, f))
                manifest.pop(rel, None)
                print("  удалено: %s" % rel)

    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"))
    site = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "cards": public,
    }
    with open(os.path.join(store.DATA, "site.json"), "w", encoding="utf-8") as fh:
        json.dump(site, fh, ensure_ascii=False, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(store.IMG) for f in fs)
    print("\nОпубликовано карт: %d (перерисовано картинок: %d)" % (len(public), drawn))
    print("Размер img/: %.1f МБ" % (total / 1024 / 1024))
    if skipped:
        print("Пропущено (статус todo): %d" % len(skipped))
    if blocked:
        print("НЕ опубликованы -- сторона без масок и без отметки «маскировать нечего»:")
        for cid, sides in blocked:
            print("  %s: %s" % (cid, ", ".join(sides)))


if __name__ == "__main__":
    main()
