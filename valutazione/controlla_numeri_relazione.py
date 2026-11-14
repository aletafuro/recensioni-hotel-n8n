"""Controlla i numeri della relazione contro i file del giro definitivo."""
import collections
import csv
import json
import sys
from pathlib import Path

base = Path(sys.argv[1])
o = base / "data" / "output"
A = json.load(open(o / "aggregazione.json", encoding="utf-8"))
E = json.load(open(o / "esecuzione.json", encoding="utf-8"))
V = json.load(open(o / "valutazione.json", encoding="utf-8"))
rel = (base / "RELAZIONE.md").read_text(encoding="utf-8")
righe = list(csv.DictReader(open(base / "data" / "input" / "ritz_carlton_reviews.csv", encoding="utf-8")))
anni = collections.Counter(r["publishedDate"][:4] for r in righe)
cl = A["classifiche"]
ap = {x["nome"]: x for x in cl["piu_apprezzati"]}
cr = {x["nome"]: x for x in cl["piu_criticati"]}
ta = {x["nome"]: x for x in cl["piu_criticati_per_tasso"]}
sig = {(x["nome"], "critic" in x["misura"]): x for x in A["andamento"] if x["significativo"] and x["confronto_con"] == "tutti_i_periodi_precedenti"}
g = E["registro_giro"]
b = V["B_gold_set"]
ris = json.load(open(o / "recensioni_analizzate.json", encoding="utf-8"))
sp = lambda n, m: (sig[(n, m)]["valore_periodo_di_confronto"], sig[(n, m)]["valore_ultimo_periodo"])
ea = A["meta"]["elenco_aspetti"]

controlli = {
    "recensioni 1.927": len(righe) == 1927,
    "15 lingue": len({x["language"] for x in ris}) == 15,
    "quasi 90% inglese": 0.89 < A["lingue"]["en"] / 1927 < 0.90,
    "30 senza travelDate": sum(1 for r in righe if not r["travelDate"].strip()) == 30,
    "max 34 fino al 2009, 363 nel 2017": max(anni[str(y)] for y in range(2002, 2010)) == 34 and anni["2017"] == 363,
    "1-2 stelle circa 6%": round(100 * sum(1 for r in righe if r["rating"] in ("1", "2")) / 1927) == 6,
    "voto medio 4,51": A["voto_medio"] == 4.51,
    "73/18/8 %": tuple(round(A["sentiment_complessivo"][k]["pct"]) for k in ("positive", "mixed", "negative")) == (73, 18, 8),
    "Personale 1.446 e 75%": ap["Personale e servizio"]["recensioni_positive"] == 1446 and round(ap["Personale e servizio"]["pct_recensioni_che_lo_apprezzano"]) == 75,
    "Personale 1.692 ne parlano, 86%": ap["Personale e servizio"]["menzioni"] == 1692 and round(ap["Personale e servizio"]["pct_positive_su_menzioni"]) == 86,
    "Posizione 1.099 e 98%": ap["Posizione"]["recensioni_positive"] == 1099 and round(ap["Posizione"]["pct_positive_su_menzioni"]) == 98,
    "critiche 198/188/168/150": [cr[n]["recensioni_negative"] for n in ("Prezzo e valore", "Personale e servizio", "Qualità e comfort della camera", "Cibo e bevande")] == [198, 188, 168, 150],
    "Personale criticato dall'11% di chi ne parla": round(cr["Personale e servizio"]["pct_negative_su_menzioni"]) == 11,
    "tasso prezzo 65%, wifi 60%": round(ta["Prezzo e valore"]["pct_negative_su_menzioni"]) == 65 and round(ta["Wi-Fi e tecnologia"]["pct_negative_su_menzioni"]) == 60,
    "11 periodi": len(A["periodi"]) == 11,
    "ultimo periodo 126, 3,61, 31,7%": (A["periodi"][-1]["recensioni"], A["periodi"][-1]["voto_medio"], A["periodi"][-1]["sentiment_complessivo"]["negative"]["pct"]) == (126, 3.61, 31.7),
    "voti prima tra 4,39 e 4,70": (min(p["voto_medio"] for p in A["periodi"][:-1]), max(p["voto_medio"] for p in A["periodi"][:-1])) == (4.39, 4.7),
    "45 confronti, 23 significativi": len(A["andamento"]) == 45 and sum(x["significativo"] for x in A["andamento"]) == 23,
    "personale 8,7 -> 25,4": sp("Personale e servizio", True) == (8.7, 25.4),
    "camera 7,7 -> 23,8": sp("Qualità e comfort della camera", True) == (7.7, 23.8),
    "prezzo 9,3 -> 24,6": sp("Prezzo e valore", True) == (9.3, 24.6),
    "cibo 7,1 -> 18,3": sp("Cibo e bevande", True) == (7.1, 18.3),
    "segnalate 266, 13,8%, 43 alta": (A["segnalazioni"]["totale"], A["segnalazioni"]["pct_sul_totale"], A["segnalazioni"]["per_priorita"]["alta"]) == (266, 13.8, 43),
    "linea di base 65,3, oggi 65,5, z 0,14": (ea["confronto_con_la_linea_di_base"]["pct_linea_di_base"], ea["recensioni_con_temi_fuori_elenco_pct"], ea["confronto_con_la_linea_di_base"]["z"]) == (65.3, 65.5, 0.14),
    "una ritentata, nessuna fallita": len(E["analisi"]["recensioni_ritentate"]) == 1 and not E["analisi"]["recensioni_fallite"],
    "durata 23,3 e costi 0,80 / 0,49 / 1,29 / 0,67": (g["durata_minuti"], round(g["misurato_totale"]["costo_usd"], 2), round(g["guardrail_stimato"]["costo_usd"], 2), round(g["costo_totale_usd_misurato_piu_stimato"], 2), round(g["costo_per_1000_recensioni_usd"], 2)) == (23.3, 0.8, 0.49, 1.29, 0.67),
    "token 1.294.617 / 176.814, 1.928 chiamate": (g["misurato_totale"]["token_input"], g["misurato_totale"]["token_output"], g["guardrail_stimato"]["chiamate"]) == (1294617, 176814, 1928),
    "gold 90%, 78,6-95,7, kappa 0,83": (b["sentiment_complessivo"]["accuratezza_pct"], b["sentiment_complessivo"]["ic95"], b["sentiment_complessivo"]["kappa_cohen"]) == (90, [78.6, 95.7], 0.83),
    "gold aspetti 92,3/82,5/87,2 e 156/169/189": (b["aspetti"]["precisione_pct"], b["aspetti"]["richiamo_pct"], b["aspetti"]["f1_pct"], b["aspetti"]["in_comune"], b["aspetti"]["in_comune"] + b["aspetti"]["solo_sistema"], b["aspetti"]["in_comune"] + b["aspetti"]["solo_gold"]) == (92.3, 82.5, 87.2, 156, 169, 189),
    "gold giudizio aspetti 95,5 (91,0-97,8)": (b["aspetti"]["sentiment_corretto_sugli_aspetti_in_comune_pct"], b["aspetti"]["ic95_sentiment"]) == (95.5, [91, 97.8]),
    "gold segnalazioni 12 giuste, 8 in piu', 0 perse": (b["segnalazioni_per_contenuto"]["vere_positive"], b["segnalazioni_per_contenuto"]["false_positive"], b["segnalazioni_per_contenuto"]["false_negative"]) == (12, 8, 0),
    "gold lingua 100% (92,9-100)": (b["lingua"]["accuratezza_pct"], b["lingua"]["ic95"]) == (100, [92.9, 100]),
}
tab = {c["misura"]: c for c in V["A_sviluppo_contro_test"]["confronto"]}
attesi = {
    "positive_tra_voti_4_5": ("1.130 su 1.354 (83,5%)", "274 su 331 (82,8%)", "-0,30"),
    "negative_o_miste_tra_voti_1_2": ("86 su 86 (100%)", "26 su 26 (100%)", "| 0 |"),
    "con_almeno_un_aspetto": ("1.543 (99,8%)", "381 (100%)", "0,86"),
    "con_temi_fuori_elenco": ("1.017 (65,8%)", "245 (64,3%)", "-0,54"),
    "segnalate": ("215 (13,9%)", "51 (13,4%)", "-0,26"),
    "segnalate_per_contenuto": ("190 (12,3%)", "45 (11,8%)", "-0,26"),
    "lingua_coerente_con_alfabeto": ("38 su 39 (97,4%)", "15 su 15 (100%)", "0,63"),
}
fmt = lambda x: f"{x:,}".replace(",", ".")
for m, (sv, te, z) in attesi.items():
    c = tab[m]
    corrisponde = sv.startswith(fmt(c["sviluppo"]["casi"])) and te.startswith(fmt(c["test"]["casi"])) and abs(float(z.strip("| ").replace(",", ".")) - c["z_test_meno_sviluppo"]) < 0.005
    controlli["tabella A: " + m] = corrisponde and sv in rel and te in rel
controlli["aspetti medi 3,78 e 3,79"] = V["A_sviluppo_contro_test"]["aspetti_medi_per_recensione"] == {"sviluppo": 3.78, "test": 3.79}
for k, v in controlli.items():
    print("OK " if v else "NO ", k)
print("TUTTI I NUMERI CONTROLLATI CORRISPONDONO" if all(controlli.values()) else "CI SONO DIFFERENZE")
