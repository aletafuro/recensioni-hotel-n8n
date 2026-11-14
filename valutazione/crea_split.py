"""Separa le recensioni in SVILUPPO e TEST (tenute da parte).

Il test serve a verificare che il sistema sia generico: durante lo sviluppo
non si leggono, non si usano per scrivere i prompt e non si usano per
scegliere gli aspetti. Si guardano solo alla fine, a sistema ormai fissato.

La divisione non dipende dall'ordine del file: si basa sull'identificativo
della recensione, che e' calcolato dal contenuto con la STESSA regola usata
nel workflow n8n (nodo "Assegna ID e pulisci"):

    review_id = "R" + primi 10 caratteri di sha1(publishedDate | title | text)

con title e text ripuliti da spazi all'inizio e alla fine e con gli a capo
uniformati a "\n". Una recensione e' di TEST se il numero formato dai
caratteri 11-18 dello sha1 diviso 5 da' resto 0 (circa il 20%).

Uso:  python valutazione/crea_split.py
Crea: data/dev/dev.csv            recensioni di sviluppo (input per le prove)
      data/test/test.csv          recensioni di test (solo per la verifica finale)
      data/valutazione/test_ids.txt  identificativi delle recensioni di test
"""
import csv
import hashlib
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
SORGENTE = BASE / "data" / "input" / "ritz_carlton_reviews.csv"


def pulisci(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n").strip()


def sha(row: dict) -> str:
    chiave = "|".join([pulisci(row["publishedDate"]), pulisci(row["title"]), pulisci(row["text"])])
    return hashlib.sha1(chiave.encode("utf-8")).hexdigest()


def main():
    with open(SORGENTE, encoding="utf-8", newline="") as f:
        righe = list(csv.DictReader(f))

    dev, test, test_ids, visti = [], [], [], set()
    for r in righe:
        h = sha(r)
        rid = "R" + h[:10]
        assert rid not in visti, f"identificativo ripetuto: {rid}"
        visti.add(rid)
        if int(h[10:18], 16) % 5 == 0:
            test_ids.append(rid)
            test.append(r)
        else:
            dev.append(r)

    for nome, gruppo in (("dev", dev), ("test", test)):
        (BASE / "data" / nome).mkdir(parents=True, exist_ok=True)
        with open(BASE / "data" / nome / f"{nome}.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(righe[0].keys()))
            w.writeheader()
            w.writerows(gruppo)
    (BASE / "data" / "valutazione").mkdir(parents=True, exist_ok=True)
    (BASE / "data" / "valutazione" / "test_ids.txt").write_text("\n".join(sorted(test_ids)) + "\n", encoding="utf-8")

    print(f"totale {len(righe)}  sviluppo {len(dev)}  test {len(test_ids)}")


if __name__ == "__main__":
    main()
