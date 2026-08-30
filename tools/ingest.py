"""Импорт сканов из scans/ в data/cards.json.

Логика автопарсинга собрана из наблюдений за этой конкретной коллекцией:

* Сканы идут «прогонами»: внутри прогона пауза между файлами 20-27 c,
  между прогонами -- больше минуты. Один прогон = одна сторона стопки карт.
* За прогоном лицевых сторон идёт прогон оборотов той же стопки в том же
  порядке, поэтому N-й файл прогона оборотов -- это оборот N-й карты
  предыдущего прогона.
* Сторона определяется детектором магнитной полосы (однородная тёмная
  полоса во всю ширину на фоне общей текстуры) с голосованием по прогону:
  отдельный скан детектор путает примерно в 8% случаев, целый прогон -- нет.
* Если за прогоном лиц идёт снова прогон лиц, у первого нет отсканированных
  оборотов -- его карты заводятся односторонними.

Запуск повторно безопасен: уже заведённые файлы не трогаются, добавляются
только новые.
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import store

if hasattr(sys.stdout, "reconfigure"):  # консоль Windows по умолчанию не UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Прогоны, где голосование ошибается (проверено глазами).
SIDE_OVERRIDES = {
    "2026-08-30-0217.png": "back",  # вторая сторона холдера 0215
}

RUN_GAP = 40  # секунд; внутри прогона 20-27, между прогонами >60


def back_score(path):
    """Больше нуля -- похоже на оборот (нашлась магнитная полоса)."""
    from PIL import Image
    import numpy as np

    a = np.asarray(Image.open(path).convert("L").resize((300, 190)), dtype="float32")
    h = a.shape[0]
    glob = a.std() + 1e-6
    bh = int(h * 0.22)
    best = -9e9
    tops = list(range(int(h * 0.02), int(h * 0.28))) + list(range(int(h * 0.50), int(h * 0.76)))
    for top in tops:
        band = a[top:top + bh]
        out = np.concatenate([a[max(0, top - 12):top], a[top + bh:top + bh + 12]])
        if out.size == 0:
            continue
        s = (out.mean() - band.mean()) / glob - band.std(1).mean() / glob - band.mean(1).std() / glob
        best = max(best, s)
    return float(best)


def split_runs(files):
    runs, cur = [], [files[0]]
    for prev, cur_f in zip(files, files[1:]):
        a = os.path.getmtime(os.path.join(store.SCANS, prev))
        b = os.path.getmtime(os.path.join(store.SCANS, cur_f))
        if b - a > RUN_GAP:
            runs.append(cur)
            cur = []
        cur.append(cur_f)
    runs.append(cur)
    return runs


def label_runs(runs):
    """Метка стороны для каждого прогона: большинством голосов по файлам."""
    labels = []
    for run in runs:
        forced = {SIDE_OVERRIDES[f] for f in run if f in SIDE_OVERRIDES}
        if len(forced) == 1:
            labels.append(forced.pop())
            continue
        votes = sum(1 for f in run if back_score(os.path.join(store.SCANS, f)) > 0)
        labels.append("back" if votes * 2 > len(run) else "front")
    return labels


def pair(runs, labels):
    """(front_file, back_file|None) в порядке сканирования."""
    out = []
    i = 0
    while i < len(runs):
        if labels[i] == "front":
            has_back = (
                i + 1 < len(runs)
                and labels[i + 1] == "back"
                and len(runs[i + 1]) == len(runs[i])
            )
            if has_back:
                out += list(zip(runs[i], runs[i + 1]))
                i += 2
            else:
                out += [(f, None) for f in runs[i]]
                i += 1
        else:
            # прогон оборотов без предшествующих лиц -- заводим как есть
            out += [(None, f) for f in runs[i]]
            i += 1
    return out


def main():
    store.require("PIL", "numpy")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="только показать, что будет добавлено")
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(store.SCANS) if f.lower().endswith(".png"))
    if not files:
        sys.exit("scans/ пуст")

    db = store.load()
    known = store.used_files(db)
    fresh = [f for f in files if f not in known]
    if not fresh:
        print("Новых сканов нет; в базе %d карт." % len(db["cards"]))
        return

    runs = split_runs(fresh)
    labels = label_runs(runs)
    pairs = pair(runs, labels)

    print("Прогонов: %d" % len(runs))
    for run, lab in zip(runs, labels):
        print("  %s-%s  n=%-2d  %s" % (run[0][-8:-4], run[-1][-8:-4], len(run), lab))
    both = sum(1 for f, b in pairs if f and b)
    print("\nПар: %d, односторонних: %d, всего карт: %d" % (both, len(pairs) - both, len(pairs)))

    if args.dry_run:
        return

    n = len(db["cards"])
    for idx, (front, back) in enumerate(pairs, start=n + 1):
        card = store.new_card("c%03d" % idx)
        if front:
            card["front"]["file"] = front
        if back:
            card["back"]["file"] = back
        db["cards"].append(card)
    store.save(db)
    print("Записано в %s" % store.DB)


if __name__ == "__main__":
    main()
