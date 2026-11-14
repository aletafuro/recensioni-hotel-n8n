"""Verifica del sistema sulle recensioni NON usate durante lo sviluppo.

Confronta, sui risultati dell'esecuzione completa (data/output), il gruppo di
SVILUPPO (recensioni su cui sono stati scritti e provati i prompt) con il
gruppo di TEST (tenuto da parte fin dall'inizio, vedi crea_split.py).
Se il sistema fosse tarato sulle recensioni viste, sul test dovrebbe
peggiorare: piu' temi fuori dall'elenco degli aspetti, meno coerenza tra
voto e testo, piu' errori di lingua.

Le differenze sono giudicate con un test su due proporzioni: una differenza
conta solo se supera 2 errori standard (|z| >= 2).

Se esiste data/valutazione/gold_set.csv (annotazione manuale di recensioni di
test), calcola anche accuratezza e copertura rispetto all'annotazione.

Uso:   python valutazione/verifica_generalizzazione.py [cartella_output]
Crea:  valutazione/risultati_verifica.json e stampa un riepilogo
"""
import csv
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "data" / "output"


def pulisci(s):
    return s.replace("\r\n", "\n").replace("\r", "\n").strip()


def leggi_input():
    with open(BASE / "data" / "input" / "ritz_carlton_reviews.csv", encoding="utf-8", newline="") as f:
        righe = list(csv.DictReader(f))
    out = {}
    for r in righe:
        h = hashlib.sha1("|".join([pulisci(r["publishedDate"]), pulisci(r["title"]), pulisci(r["text"])]).encode("utf-8")).hexdigest()
        out["R" + h[:10]] = r
    return out


def scrittura(testo):
    """Lingua deducibile dall'alfabeto, per controllare il codice lingua del modello."""
    if re.search(r"[぀-ヿ]", testo):
        return "ja"
    if re.search(r"[가-힯]", testo):
        return "ko"
    if re.search(r"[一-鿿]", testo):
        return "zh"
    if re.search(r"[Ѐ-ӿ]", testo):
        return "ru"
    return None


def z_due_proporzioni(k1, n1, k0, n0):
    if not n1 or not n0:
        return None
    p = (k1 + k0) / (n1 + n0)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0))
    return round((k1 / n1 - k0 / n0) / se, 2) if se > 0 else 0.0


def misure(gruppo, sorgente, diagn):
    n = len(gruppo)
    voto = lambda r: int(sorgente[r["review_id"]]["rating"])
    alti = [r for r in gruppo if voto(r) >= 4]
    bassi = [r for r in gruppo if voto(r) <= 2]
    con_scrittura = [r for r in gruppo if scrittura(sorgente[r["review_id"]]["text"])]
    m = {
        "recensioni": (n, n),
        "positive_tra_voti_4_5": (sum(r["overall_sentiment"] == "positive" for r in alti), len(alti)),
        "negative_o_miste_tra_voti_1_2": (sum(r["overall_sentiment"] in ("negative", "mixed") for r in bassi), len(bassi)),
        "con_almeno_un_aspetto": (sum(bool(r["aspects"]) for r in gruppo), n),
        "con_temi_fuori_elenco": (sum(bool(diagn[r["review_id"]]["temi_fuori_elenco"]) for r in gruppo), n),
        "segnalate": (sum(r["needs_attention"] for r in gruppo), n),
        "segnalate_per_contenuto": (sum(bool(diagn[r["review_id"]]["segnalazioni"]) for r in gruppo), n),
        "lingua_coerente_con_alfabeto": (sum(r["language"] == scrittura(sorgente[r["review_id"]]["text"]) for r in con_scrittura), len(con_scrittura)),
    }
    aspetti_medi = sum(len(r["aspects"]) for r in gruppo) / n if n else None
    return m, aspetti_medi


def gold(risultati, diagn):
    """Stesse definizioni del nodo 'Calcola metriche' del workflow di verifica (controllo incrociato)."""
    p = BASE / "data" / "valutazione" / "gold_set.csv"
    if not p.exists():
        return None
    per_id = {r["review_id"]: r for r in risultati}
    with open(p, encoding="utf-8", newline="") as f:
        righe = [r for r in csv.DictReader(f) if r.get("review_id") and r.get("overall_sentiment")]
    ok_overall = ok_lingua = tp = fp = fn = sent_ok = sent_n = 0
    seg_tp = seg_fp = seg_fn = 0
    for g in righe:
        r = per_id[g["review_id"]]
        ok_overall += r["overall_sentiment"] == g["overall_sentiment"].strip()
        ok_lingua += r["language"] == (g.get("language") or "").strip()
        atteso = {}
        for pezzo in filter(None, (s.strip() for s in (g.get("aspects") or "").split(";"))):
            a, s = (x.strip() for x in pezzo.split(":"))
            atteso[a] = s
        sistema = {a["aspect"]: a["sentiment"] for a in r["aspects"]}
        comuni = set(atteso) & set(sistema)
        tp += len(comuni)
        fp += len(set(sistema) - set(atteso))
        fn += len(set(atteso) - set(sistema))
        sent_n += len(comuni)
        sent_ok += sum(atteso[a] == sistema[a] for a in comuni)
        seg_g = bool([c for c in (g.get("attention_categories") or "").split(";") if c.strip()])
        seg_s = bool(diagn[g["review_id"]]["segnalazioni"])
        seg_tp += seg_g and seg_s
        seg_fp += (not seg_g) and seg_s
        seg_fn += seg_g and not seg_s
    q = lambda a, b: round(100 * a / b, 1) if b else None
    prec, rich = q(tp, tp + fp), q(tp, tp + fn)
    # F1 dai valori esatti, non da quelli gia' arrotondati (come nel workflow n8n)
    p_esatta = tp / (tp + fp) if tp + fp else 0
    r_esatta = tp / (tp + fn) if tp + fn else 0
    return {
        "recensioni_etichettate": len(righe),
        "sentiment_complessivo_accuratezza_pct": q(ok_overall, len(righe)),
        "lingua_accuratezza_pct": q(ok_lingua, len(righe)),
        "aspetti_precisione_pct": prec,
        "aspetti_richiamo_pct": rich,
        "aspetti_f1_pct": round(100 * 2 * p_esatta * r_esatta / (p_esatta + r_esatta), 1) if p_esatta and r_esatta else None,
        "sentiment_sugli_aspetti_in_comune_pct": q(sent_ok, sent_n),
        "segnalazioni_precisione_pct": q(seg_tp, seg_tp + seg_fp),
        "segnalazioni_richiamo_pct": q(seg_tp, seg_tp + seg_fn),
    }


def main():
    risultati = json.loads((OUT / "recensioni_analizzate.json").read_text(encoding="utf-8"))
    diagn = {json.loads(l)["review_id"]: json.loads(l) for l in (OUT / "recensioni_diagnostica.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    sorgente = leggi_input()
    test_ids = set((BASE / "data" / "valutazione" / "test_ids.txt").read_text(encoding="utf-8").split())
    sviluppo = [r for r in risultati if r["review_id"] not in test_ids]
    test = [r for r in risultati if r["review_id"] in test_ids]

    ms, am_s = misure(sviluppo, sorgente, diagn)
    mt, am_t = misure(test, sorgente, diagn)
    tabella = []
    for k in ms:
        (ks, ns), (kt, nt) = ms[k], mt[k]
        z = None if k == "recensioni" else z_due_proporzioni(kt, nt, ks, ns)
        tabella.append({
            "misura": k,
            "sviluppo": f"{ks}/{ns}" + (f" ({100 * ks / ns:.1f}%)" if ns and k != "recensioni" else ""),
            "test": f"{kt}/{nt}" + (f" ({100 * kt / nt:.1f}%)" if nt and k != "recensioni" else ""),
            "z_test_meno_sviluppo": z,
            "differenza_oltre_il_rumore": None if z is None else abs(z) >= 2,
        })
    esito = {
        "cartella_risultati": str(OUT),
        "confronto": tabella,
        "aspetti_medi_per_recensione": {"sviluppo": round(am_s, 2) if am_s is not None else None, "test": round(am_t, 2) if am_t is not None else None},
        "lingue_test": Counter(r["language"] for r in test).most_common(),
        "gold_set": gold(risultati, diagn),
    }
    (BASE / "valutazione" / "risultati_verifica.json").write_text(json.dumps(esito, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'misura':34s} {'sviluppo':>22s} {'test':>20s} {'z':>6s}")
    for t in tabella:
        print(f"{t['misura']:34s} {t['sviluppo']:>22s} {t['test']:>20s} {str(t['z_test_meno_sviluppo']):>6s}{'  <-- oltre il rumore' if t['differenza_oltre_il_rumore'] else ''}")
    print("aspetti medi per recensione:", esito["aspetti_medi_per_recensione"])
    if esito["gold_set"]:
        print("gold set:", json.dumps({k: v for k, v in esito["gold_set"].items() if k != "errori_sentiment_complessivo"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
