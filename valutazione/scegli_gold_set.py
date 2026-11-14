"""Sceglie le recensioni di TEST da etichettare per il gold set.

La scelta e' fatta PRIMA di guardare i risultati del sistema e non dipende da
essi: solo voto, lingua (dedotta dall'alfabeto e da poche parole) e ordine
dato dall'hash dell'identificativo (ripetibile).

Composizione (50 recensioni):
- 15 con voto 1-2   (sono il 6% dell'archivio, ma contano molto per la direzione)
- 10 con voto 3
- 25 con voto 4-5
- di cui almeno 8 non in inglese, presi dai rispettivi gruppi di voto

Uso:   python valutazione/scegli_gold_set.py
Crea:  data/valutazione/gold_da_etichettare.csv  (review_id, rating, title, text)
"""
import csv
import hashlib
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def pulisci(s):
    return s.replace("\r\n", "\n").replace("\r", "\n").strip()


def non_inglese(testo):
    t = testo.lower()
    if re.search(r"[^\x00-\x7f‘’“”–—… éè]", t) and not re.search(r"\b(the|and|was|were)\b", t):
        return True
    parole = set(re.findall(r"[a-z]+", t))
    inglesi = len(parole & {"the", "and", "was", "we", "very", "room", "is", "with", "for", "our"})
    altre = len(parole & {"el", "la", "muy", "que", "y", "il", "molto", "che", "le", "tres", "est", "das", "und", "sehr", "ist", "muito", "não", "nao", "com"})
    return altre > inglesi


def main():
    test_ids = set((BASE / "data" / "valutazione" / "test_ids.txt").read_text(encoding="utf-8").split())
    righe = []
    with open(BASE / "data" / "input" / "ritz_carlton_reviews.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            h = hashlib.sha1("|".join([pulisci(r["publishedDate"]), pulisci(r["title"]), pulisci(r["text"])]).encode("utf-8")).hexdigest()
            rid = "R" + h[:10]
            if rid in test_ids:
                righe.append({"review_id": rid, "ordine": h[18:26], "rating": int(r["rating"]), "title": pulisci(r["title"]),
                              "text": pulisci(r["text"]), "estera": non_inglese(r["text"])})
    righe.sort(key=lambda x: x["ordine"])

    gruppi = {"basso": (lambda v: v <= 2, 15), "medio": (lambda v: v == 3, 10), "alto": (lambda v: v >= 4, 25)}
    scelte = []
    for nome, (filtro, quanti) in gruppi.items():
        candidati = [r for r in righe if filtro(r["rating"])]
        esteri = [r for r in candidati if r["estera"]]
        # prima una quota di recensioni non inglesi (in proporzione al gruppo), poi le altre in ordine di hash
        quota_estere = max(1, round(quanti * 8 / 50))
        presi = esteri[:quota_estere]
        presi += [r for r in candidati if r not in presi][: quanti - len(presi)]
        scelte += presi

    (BASE / "data" / "valutazione").mkdir(parents=True, exist_ok=True)
    with open(BASE / "data" / "valutazione" / "gold_da_etichettare.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["review_id", "rating", "title", "text"])
        w.writeheader()
        for r in scelte:
            w.writerow({k: r[k] for k in ["review_id", "rating", "title", "text"]})
    print(f"scelte {len(scelte)} recensioni di test: "
          f"voto 1-2 {sum(r['rating'] <= 2 for r in scelte)}, voto 3 {sum(r['rating'] == 3 for r in scelte)}, "
          f"voto 4-5 {sum(r['rating'] >= 4 for r in scelte)}, non inglesi {sum(r['estera'] for r in scelte)}")


if __name__ == "__main__":
    main()
