# Verifica del sistema

Generata il 2026-11-13 dai risultati in `/files/output`.

## A. Sviluppo contro test (senza etichette)

Recensioni di sviluppo: 1546. Recensioni di test: 381. Una differenza conta solo se |z| >= 2.

| misura | sviluppo | test | z | oltre il rumore |
|---|---|---|---|---|
| positive tra voti 4 5 | 1130/1354 (83,5%) | 274/331 (82,8%) | -0,3 | no |
| negative o miste tra voti 1 2 | 86/86 (100%) | 26/26 (100%) | 0 | no |
| con almeno un aspetto | 1543/1546 (99,8%) | 381/381 (100%) | 0,86 | no |
| con temi fuori elenco | 1017/1546 (65,8%) | 245/381 (64,3%) | -0,54 | no |
| segnalate | 215/1546 (13,9%) | 51/381 (13,4%) | -0,26 | no |
| segnalate per contenuto | 190/1546 (12,3%) | 45/381 (11,8%) | -0,26 | no |
| lingua coerente con alfabeto | 38/39 (97,4%) | 15/15 (100%) | 0,63 | no |

Aspetti medi per recensione: sviluppo 3,78, test 3,79.

## B. Gold set

Gold set etichettato alla cieca da un modello diverso da quello del sistema, senza accesso ai risultati ne' ai prompt: e' un confronto tra modelli, non un'annotazione umana.

Recensioni etichettate: 50.

| misura | valore | intervallo 95% |
|---|---|---|
| sentiment complessivo, accuratezza | 90% | 78,6-95,7% |
| sentiment complessivo, kappa di Cohen | 0,83 | |
| lingua, accuratezza | 100% | 92,9-100% |
| aspetti, precisione | 92,3% | |
| aspetti, richiamo | 82,5% | |
| aspetti, F1 | 87,2% | |
| sentiment sugli aspetti in comune | 95,5% | 91-97,8% |
| segnalazioni per contenuto, precisione | 60% | |
| segnalazioni per contenuto, richiamo | 100% | |

Disaccordi da leggere: 12 (elenco in valutazione.json).
