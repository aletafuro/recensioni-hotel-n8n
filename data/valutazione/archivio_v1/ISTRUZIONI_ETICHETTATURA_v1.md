# Istruzioni per l'etichettatura alla cieca del gold set

Etichetta a mano, una per una, le recensioni del file `gold_da_etichettare.csv` (in questa cartella). Lavora SOLO con questo file di istruzioni e con quel CSV: NON aprire nessun altro file del progetto (in particolare non `data/output/`, non `workflow/`, non i log, non gli appunti), perche' la verifica deve essere indipendente dal sistema che si sta valutando.

## Che cosa produrre

Un file `gold_set.csv` in questa stessa cartella, codifica UTF-8, con esattamente queste colonne:

- `review_id`: copiato dal file di partenza;
- `language`: codice ISO 639-1 della lingua del testo (en, es, it, ja...);
- `overall_sentiment`: positive | negative | mixed | neutral;
- `aspects`: elenco `aspetto:sentiment` separato da `;` (es. `location:positive; breakfast:negative`), usando SOLO gli identificativi della tabella sotto; sentiment positive | negative | neutral; vuoto se nessun aspetto ha un giudizio;
- `attention_categories`: codici delle categorie di segnalazione separati da `;`, vuoto se nessuna;
- `note`: facoltativa, una riga in italiano per i casi dubbi.

## Definizioni

**Sentiment complessivo** (giudica il testo, il voto in stelle e' solo contesto): positive = chiaramente soddisfatto, critiche minori o assenti; negative = chiaramente insoddisfatto, lodi minori o assenti; mixed = lodi sostanziali E critiche sostanziali; neutral = nessun giudizio chiaro (testo descrittivo).

**Aspetto**: un tema specifico su cui chi scrive esprime un giudizio. Si indica un aspetto solo se c'e' un giudizio (non se e' solo nominato). Un aspetto al massimo una volta per recensione: se ci sono lodi e critiche sullo stesso aspetto, scegli il giudizio prevalente; se si bilanciano davvero, neutral. neutral anche per giudizi tiepidi («la colazione era ok»).

**Segnalazione**: un problema che la direzione dovrebbe guardare, SOLO se la recensione lo descrive esplicitamente e solo se dipende dall'hotel (personale, servizi, struttura). Le critiche ordinarie (camera piccola, colazione cara, ascensore lento, arredamento datato) NON sono segnalazioni. Problemi dei dintorni o di terzi non sono segnalazioni.

## Aspetti ammessi

| identificativo | nome | descrizione |
|---|---|---|
| `location` | Posizione | Include tutte le valutazioni relative alla posizione dell'hotel e alla vicinanza a punti di interesse, trasporti e attrazioni, escludendo aspetti interni all'hotel. |
| `staff_service` | Servizio del personale | Comprende tutte le valutazioni sul personale dell'hotel, inclusi comportamento, cortesia, professionalità e specifici ruoli come concierge, reception e doorman. |
| `room_quality_and_comfort` | Qualità e comfort della camera | Include tutte le valutazioni riguardanti la qualità, dimensione, arredamento, comfort del letto, pulizia, manutenzione e servizi interni alla camera, esclusi bagno e vista. |
| `bathroom` | Bagno | Include tutte le valutazioni relative al bagno della camera, comprese qualità, dimensioni, servizi e comfort, esclusi aspetti generali della camera. |
| `food_and_beverage` | Cibo e bevande | Comprende tutte le valutazioni relative a ristoranti, bar, qualità del cibo e bevande, servizio di ristorazione e colazione, esclusi aspetti non alimentari dell'hotel. |
| `price_and_value` | Prezzo e valore | Include tutte le valutazioni relative al prezzo, rapporto qualità-prezzo, costi aggiuntivi e politiche di pagamento, esclusi aspetti qualitativi non economici. |
| `hotel_facilities_and_ambience` | Strutture e atmosfera dell'hotel | Comprende valutazioni su decorazioni, condizioni, stile, atmosfera e aree comuni dell'hotel, esclusi servizi specifici come camere, ristoranti o spa. |
| `spa_and_wellness` | Spa e benessere | Include tutte le valutazioni relative ai servizi spa, trattamenti benessere e strutture correlate, esclusi altri servizi dell'hotel. |
| `check_in_and_check_out` | Check-in e check-out | Include tutte le valutazioni relative ai processi, servizi e esperienze di check-in e check-out, esclusi altri servizi di accoglienza. |
| `noise_and_soundproofing` | Rumore e insonorizzazione | Include tutte le valutazioni relative al livello di rumore, disturbi acustici e insonorizzazione delle camere e delle aree comuni. |
| `wifi_and_technology` | Wi-Fi e tecnologia | Include tutte le valutazioni relative alla connessione internet, servizi tecnologici e supporto IT, esclusi altri servizi tecnologici specifici della camera. |
| `service_quality_and_management_response` | Qualità del servizio e risposta della direzione | Include valutazioni generali sulla qualità del servizio offerto dall'hotel e sulla risposta della direzione a eventuali problemi o richieste degli ospiti. |
| `cleanliness` | Pulizia | Include tutte le valutazioni relative alla pulizia generale dell'hotel, delle camere, dei bagni e delle aree comuni, esclusi aspetti specifici di manutenzione o qualità. |

## Categorie di segnalazione

| codice | nome | definizione |
|---|---|---|
| `safety_security` | sicurezza | minacce, aggressioni, furti, intrusi, situazioni o condizioni pericolose |
| `health_hygiene` | igiene e salute | insetti o cimici, muffa, camera, bagno o biancheria sporchi, intossicazione alimentare, malattia causata dal soggiorno |
| `discrimination_harassment` | discriminazione o molestie | discriminazione (origine, nazionalita', genere, religione, disabilita'...) o molestie |
| `property_damage_or_loss` | oggetti persi o danneggiati | oggetti dell'ospite persi, rubati o danneggiati |
| `staff_misconduct` | comportamento del personale | un episodio preciso di comportamento ostile, scorretto, umiliante o poco professionale del personale (non un generico 'personale poco gentile') |
| `billing_dispute` | addebiti contestati | addebiti inattesi, sbagliati o doppi, problemi con depositi o rimborsi |
| `booking_failure` | prenotazione non rispettata | prenotazione non onorata, tipo di camera sbagliato, overbooking, camera non pronta per ore, vantaggi promessi negati |
| `severe_service_failure` | disservizio grave | un guasto o disservizio serio che ha rovinato il soggiorno (per esempio niente acqua calda, niente riscaldamento o aria condizionata, camera guasta, impossibile dormire) |
| `unresolved_complaint` | reclamo non risolto | l'ospite ha reclamato e il problema non e' stato risolto, oppure dichiara di voler andare oltre (vie legali, contestazione del pagamento, reclamo alla sede, non tornera' per come e' stato gestito) |

## Regole
- Leggi ogni recensione per intero, anche quelle lunghe e quelle non in inglese.
- Non inventare: etichetta solo cio' che il testo dice.
- Lavora in modo indipendente: non cercare di indovinare che cosa risponderebbe un sistema automatico.
- Alla fine controlla che il file abbia 50 righe, tutte le colonne, e solo valori ammessi.
