# Analisi delle recensioni di un hotel di lusso: relazione tecnica

Alessandra Tafuro

## 1. Che cosa ho costruito

Ho costruito un sistema in n8n che legge l'intero archivio delle recensioni di un hotel e lo trasforma in informazioni per la direzione. Per ogni recensione il sistema indica la lingua, il giudizio complessivo e il giudizio sui singoli aspetti di cui parla. Segnala le recensioni che la direzione dovrebbe guardare, con il motivo. Poi aggrega tutto, sull'intero archivio e nel tempo, e alla fine scrive da solo un digest in italiano per chi non è tecnico.

Il sistema elabora tutte le 1.927 recensioni del file. Le uscite, prodotte dal workflow così come sono, stanno in `data/output/`:

| file | contenuto |
|---|---|
| `recensioni_analizzate.json` (e `.jsonl`) | un oggetto per recensione, nello schema richiesto |
| `aspetti.json` | elenco finale degli aspetti, con versione e descrizione |
| `aggregazione.json` | conteggi, classifiche, periodi, andamento nel tempo, lingue, segnalazioni |
| `digest.md` | testo per la direzione |
| `tabella_recensioni_aspetti.csv`, `tabella_aspetti_per_periodo.csv` | le stesse informazioni in tabelle piatte, pronte per Tableau o Excel |
| `esecuzione.json`, `recensioni_diagnostica.jsonl`, `registro_giro.json` | diagnostica: anomalie del file, guardrail, ritentativi, controlli, tempi e costi |
| `valutazione.json`, `valutazione.md` | risultati della verifica su recensioni non usate durante lo sviluppo |

Le istruzioni per avviarlo sono nel `README.md`. Basta Docker e una chiave OpenAI: un solo comando esegue tutto.

## 2. Lo strumento: perché n8n e non un agente

Lo stesso lavoro si poteva fare con LangChain o con un SDK per agenti. Ho scelto n8n, e la ragione è nel tipo di problema.

Questo problema non è da agente. Il flusso è fisso e sempre uguale: leggere il file, analizzare ogni recensione, aggregare, scrivere il digest. Un agente conviene quando il modello deve decidere da solo quali passi fare e quali strumenti usare. Qui quella libertà non serve, e renderebbe i risultati meno ripetibili, perché due esecuzioni potrebbero seguire strade diverse.

Per questo il modello linguistico lavora come interprete del testo dentro un flusso controllato. Lo uso solo dove serve capire il linguaggio: i temi, i giudizi, le segnalazioni, il testo del digest. Tutto il resto è codice che dà sempre lo stesso risultato: gli identificativi, i conteggi, le classifiche, i periodi, i test statistici e i controlli.

n8n mi ha dato anche due vantaggi pratici. Il primo è la riproducibilità: la versione di n8n è fissata (2.29.10) e tutto parte con `docker compose run --rm esegui`, senza installare un ambiente Python. Il secondo è la leggibilità: chi apre il workflow vede le fasi colorate e può aprire ogni nodo. Il disegno comunque non dipende da n8n. Prompt, schemi JSON e controlli si porterebbero in LangChain senza cambiare la logica.

## 3. Come è fatto il flusso

Il workflow principale ha 33 nodi (più 4 note che spiegano le fasi), divisi in quattro fasi.

1. **Contesto, lettura e guardrail di ingresso.** Il sistema legge un file di contesto (chi viene recensito, chi legge i risultati, quali problemi segnalare). Poi legge il CSV, assegna a ogni recensione un identificativo stabile, controlla i campi e annota le anomalie. Prima di qualunque chiamata al modello, toglie i dati sensibili e cerca i testi scritti per manipolare l'analisi.
2. **Aspetti.** Se esiste l'elenco fisso degli aspetti, il sistema usa quello. Altrimenti gli aspetti emergono dalle recensioni (sezione 4.2).
3. **Analisi di ogni recensione.** Le recensioni vanno al modello a gruppi di cinque. La risposta deve rispettare uno schema JSON stretto. Il codice controlla ogni risposta, richiede quelle mancanti e decide se la recensione va segnalata.
4. **Aggregazione, digest e guardrail di uscita.** Il codice calcola tutti i numeri. Il modello scrive il digest copiando le frasi con i numeri preparate dal codice. Il codice controlla numeri e citazioni, e un ultimo guardrail cerca dati personali e nomi di persone.

Accanto ci sono tre workflow per la verifica: uno calcola le metriche e gira anche da riga di comando; due usano i nodi di valutazione di n8n (Data Table, Evaluation Trigger ed Evaluation), così le metriche si vedono anche nella scheda Evaluations.

## 4. Le scelte progettuali

### 4.1 I dati

**Colonne.** Le leggo tutte, ma nell'analisi entrano titolo, voto, data di pubblicazione e testo. Per il tempo uso la data di pubblicazione e non `travelDate`. La data di pubblicazione c'è sempre. `travelDate` invece manca in 30 recensioni e in 2 è successiva alla pubblicazione, cosa impossibile. La leggo comunque, la controllo e registro le anomalie in `esecuzione.json`, ma non entra in nessun conteggio.

**Identificativo.** Il file non ha un identificativo e non è garantito l'ordine. Ho scelto un identificativo che dipende solo dal contenuto: «R» seguito dai primi 10 caratteri dello SHA-1 di data, titolo e testo. Se il file viene riordinato o ricaricato, ogni recensione mantiene lo stesso identificativo. Se due recensioni fossero identiche, la seconda riceverebbe un suffisso e verrebbe esclusa dai conteggi. In questo file non è mai successo.

La prova su un altro dominio (sezione 4.8) ha mostrato il limite di questa regola. Nelle recensioni di un'app molti scrivono solo «Top». Due persone diverse che lo scrivono lo stesso giorno hanno data, titolo e testo uguali, e la regola le scambiava per la stessa recensione: una delle due spariva dai conteggi. Per l'hotel non cambia nulla, perché le recensioni sono lunghe e nessuna coincide con un'altra. Ma la regola giusta è un'altra: quando la fonte dà un proprio identificativo, come fanno gli store delle app, si usa quello; quando non lo dà, si aggiunge almeno il voto. E i testi uguali vanno distinti: un testo breve e comune ripetuto è normale, un testo lungo e specifico ripetuto da autori diversi in pochi giorni è il segnale di una possibile campagna coordinata.

**Lingue.** Le recensioni sono in 15 lingue, quasi il 90% in inglese. Non le traduco. Il modello legge ogni recensione nella sua lingua, e gli aspetti sono gli stessi per tutte le lingue. Le prove testuali delle segnalazioni si controllano nella lingua originale. Il campo `language` lo indica il modello. L'ho verificato confrontandolo con l'alfabeto per giapponese, cinese, coreano e russo (sezione 5).

**Rumore.** Il sistema gestisce testi vuoti, duplicati, voti fuori scala e date non valide. Ognuno di questi casi viene annotato, e nessuno ferma l'esecuzione.

### 4.2 Come emergono gli aspetti

Gli aspetti non sono dati in partenza. Li ho fatti emergere in due passi.

1. **Temi liberi.** Su un campione di 240 recensioni il modello elenca, con parole sue, i temi su cui l'ospite esprime un giudizio. Il campione è stratificato per voto: le recensioni da 1-2 stelle sono il 6% dell'archivio, ma pesano il 30% del campione, perché contengono le critiche che la direzione deve conoscere.
2. **Raggruppamento.** I temi liberi, con la loro frequenza, vanno al modello, che li raggruppa in un elenco chiuso di aspetti con nome e descrizione. Il codice controlla l'elenco: ogni tema frequente (almeno il 2% del campione) deve finire in un aspetto, e nessun tema può stare in due aspetti. Se il controllo non passa, il modello riceve i problemi e corregge.

Lo schema di risposta dell'analisi elenca gli aspetti ammessi. Il modello non può inventarne altri, quindi i nomi restano coerenti tra una recensione e l'altra.

**Il giro di scoperta.** Il giro definitivo (`data/output/`) usa l'elenco fisso descritto qui sotto, quindi i suoi file non contengono la scoperta. Per mostrarla c'è anche un giro completo con la scoperta attiva, fatto con lo stesso workflow (`data/output_scoperta/`). Lì si vede tutto: il campione di 240 recensioni, con 72 recensioni da 1-2 stelle (il 30%), 60 da 3 stelle e 108 da 4-5; i 408 temi liberi distinti con le loro frequenze; i giri di raggruppamento; l'elenco che ne esce, con 16 aspetti. I temi raggruppati coprono il 90,5% delle citazioni dei temi del campione. L'elenco di questo giro non è identico alla v1: per esempio tiene separati «Personale» e «Qualità del servizio», proprio la confusione che ho corretto nella v2. È la prova pratica del perché l'elenco va fissato.

**Elenco fisso degli aspetti.** Facendo girare la scoperta più volte ho visto che l'elenco cambia da un giro all'altro: una prova aveva 14 aspetti con vista e club lounge, il giro completo ne aveva 13 senza. Con un elenco che cambia, i numeri di giri diversi non si confrontano. È come cambiare le modalità di una domanda chiusa a metà rilevazione. Per questo ho reso fisso l'elenco, con un numero di versione.

- **v1:** l'elenco emerso dal giro completo, salvato com'era.
- **v2:** la v1 rivista, con modifiche motivate dai dati.
  - Ho aggiunto «Vista dalla camera». «Room view» stava nella camera, ma la descrizione della camera escludeva la vista: una contraddizione interna, che mandava la vista fuori elenco.
  - Ho aggiunto «Club lounge». I suoi temi c'erano già, ma nascosti dentro «Cibo e bevande», e il modello li considerava fuori elenco: «club access» era in 21 recensioni.
  - Ho unito «Qualità del servizio e risposta della direzione» e «Servizio del personale» in «Personale e servizio». Il primo aveva solo 3 temi, e nel gold set i due si confondevano.
  - Ho spostato pulizia e odori della camera in «Pulizia», e il servizio in camera in «Cibo e bevande».

Il workflow usa l'elenco fisso se c'è, e salta la scoperta. Con `RISCOPRI_ASPETTI=true` la scoperta si rifà. Con un archivio di un'altra attività, senza elenco fisso, gli aspetti emergono da soli.

**Quando si aggiunge un aspetto.** «Fisso» non vuol dire chiuso per sempre: vuol dire che l'elenco non cambia da solo da un giro all'altro. I temi fuori elenco funzionano come la categoria «altro» di un questionario. Ho salvato nell'elenco fisso la loro linea di base: il 65,3% delle recensioni ha almeno un tema fuori elenco, ma quasi tutti marginali, come compleanni e shopping. A ogni giro il sistema controlla due cose.
- La quota di recensioni con temi fuori elenco supera la linea di base di almeno 2 errori standard?
- C'è un tema fuori elenco che compare in almeno il 2% delle recensioni?

Se una delle due condizioni scatta, l'aggregazione scrive che l'elenco va rivisto, con i temi candidati. Nel giro definitivo il controllo non è scattato: le recensioni con temi fuori elenco sono il 65,5%, contro il 65,3% della linea di base (z = 0,14), e nessun tema fuori elenco arriva al 2%. Questo confronto va letto per quello che è: la linea di base è stata misurata sulle stesse 1.927 recensioni, quindi dice che il modello è stabile da un giro all'altro, non che l'elenco regga su recensioni nuove. Il controllo serve davvero nei giri successivi, quando arrivano recensioni che il sistema non ha mai visto.

**Chi decide di aggiungere un aspetto.** Aggiungere un aspetto ha tre rischi: lo storico va rianalizzato, altrimenti il nuovo aspetto sembrerebbe nato il giorno in cui è stato aggiunto; il modello può proporre un aspetto fatto male, che si sovrappone a uno esistente; chi legge i numeri ogni settimana se li vede cambiare. In questo progetto il sistema si ferma alla segnalazione. Nella versione pensata per la produzione l'aggiornamento è automatico, ma solo se supera controlli fissati in anticipo:
1. il sistema propone una nuova versione dell'elenco, con i temi candidati come aspetti nuovi o dentro aspetti esistenti;
2. il codice controlla la proposta: nessun tema in due aspetti, tutti i temi candidati coperti, gli aspetti esistenti con lo stesso identificativo, nessun tema inventato. Un aspetto nuovo viene rifiutato anche quando si sovrappone a uno esistente, cioè quando almeno metà delle sue recensioni ha già uno stesso aspetto: in quel caso il tema fa parte dell'aspetto esistente;
3. test di stabilità: un campione di recensioni viene rianalizzato con il vecchio e con il nuovo elenco, e sugli aspetti che esistevano già i giudizi devono restare uguali entro la variabilità normale del modello. Il campione è stratificato: metà a caso e metà recensioni che citano i temi candidati, perché è lì che un aspetto nuovo può «rubare» recensioni a quelli vecchi;
4. se i controlli passano, il sistema adotta la nuova versione, conserva la precedente, rianalizza lo storico e avvisa di che cosa è cambiato; se non passano, tiene la versione vecchia e chiede l'intervento di una persona.

La persona viene informata e può tornare indietro, ma non è un passaggio obbligato. La regola di adozione è decisa prima ed è uguale ogni volta, invece di dipendere dal giudizio del momento.

Due di questi controlli sono nati da un errore. Ho costruito la procedura nel progetto per la produzione, e la prima versione aveva solo il test di stabilità su 60 recensioni prese a caso. Alla prima prova ha adottato un aspetto nuovo, «truffa», che si sovrapponeva ai profili falsi: 6 delle 10 recensioni che parlavano di truffa erano già classificate lì. Il test non se n'era accorto, perché nel campione a caso le recensioni su quel tema erano pochissime. Ho annullato la nuova versione e ho aggiunto il controllo sulla sovrapposizione e il campione stratificato. La stessa prova ha mostrato anche quanto varia il modello da un giro all'altro (sezione 9).

### 4.3 L'analisi di ogni recensione

**Sentiment complessivo.** Il modello giudica il testo, non le stelle, che riceve solo come contesto. Ho definito «misto» in modo stretto: lodi sostanziali E critiche sostanziali. Una recensione molto positiva con una piccola critica resta positiva.

**Sentiment per aspetto.** Un aspetto compare solo se l'ospite esprime un giudizio, non se lo nomina soltanto. Ogni aspetto compare al massimo una volta per recensione. Se ci sono lodi e critiche sullo stesso aspetto, vale quella prevalente, e se si bilanciano davvero il giudizio è neutro.

**Schema stretto.** La risposta del modello deve rispettare uno schema JSON con i soli valori ammessi. Il codice ricontrolla tutto prima di scrivere: le chiavi, i valori, che il motivo ci sia quando la recensione è segnalata e solo allora. Il file finale è JSON valido per costruzione.

**Gruppi di cinque.** Mandare più recensioni per chiamata costa meno, ma il modello può mescolarle. È successo davvero: con gruppi da otto, una recensione ha ricevuto come prova una frase di un'altra recensione dello stesso gruppo («zip tie in my chicken noodle soup»). Ho ridotto i gruppi a cinque e scritto nelle istruzioni che ogni recensione è indipendente. Il controllo delle prove registra i casi rimasti.

**Ritentativi.** Le recensioni che mancano nella risposta, o che hanno una risposta non valida, vengono richieste di nuovo una alla volta, fino a tre volte. Se anche così non va, la recensione esce comunque, senza giudizi inventati e segnalata come «da leggere a mano». Nel giro definitivo una sola recensione è stata richiesta di nuovo, e nessuna è rimasta senza analisi.

### 4.4 Le recensioni da segnalare

Nella presentazione del progetto le segnalazioni sono state descritte come la «campanellina» del sistema dal vivo: arriva una recensione e il sistema avvisa che va gestita in fretta. Ho costruito il criterio pensando a questo uso. Una recensione è segnalata se vale almeno una di queste condizioni.

1. **Descrive un problema preciso**, che dipende dall'hotel, in una di queste categorie. Priorità alta: sicurezza, igiene e salute, discriminazione o molestie, oggetti persi o danneggiati. Priorità media: comportamento del personale (un episodio preciso, non un generico «poco gentile»), addebiti contestati, prenotazione non rispettata, disservizio grave, reclamo non risolto.
2. **Ha un voto molto basso** (1 o 2 stelle). Una recensione da 1 stella su un hotel di lusso è un danno di immagine pubblico, e merita una risposta anche senza un episodio preciso. Priorità bassa.
3. **Voto e testo non sono coerenti** (4-5 stelle con testo negativo, o il contrario). Può essere un errore dell'ospite, e va verificato.
4. **È sospetta di manipolazione** (sezione 4.7).

Le critiche ordinarie (camera piccola, colazione cara, ascensore lento) non sono segnalazioni. Ogni segnalazione per contenuto deve avere una **prova**: una frase copiata dalla recensione. Il codice controlla che la frase esista davvero nel testo. Se non c'è, la segnalazione viene scartata e registrata, con la distinzione tra prova inventata e prova presa da un'altra recensione. Il motivo scritto in `attention_reason` unisce la categoria, una sintesi di quello che è successo e la regola sul voto.

### 4.5 L'aggregazione

**Unità di conto.** Conto le recensioni, non le frasi: un aspetto vale al massimo 1 per recensione.

**Due classifiche.** La classifica principale è per **volume**: quante recensioni apprezzano o criticano l'aspetto, cioè quanti ospiti tocca. Quella secondaria è per **tasso**: tra le recensioni che parlano dell'aspetto, la quota di giudizi positivi o negativi, solo per gli aspetti con almeno 30 menzioni. Servono tutte e due. «Personale e servizio» è secondo tra i più criticati per volume (188 recensioni, dopo le 198 di «Prezzo e valore»), perché se ne parla moltissimo, ma solo l'11% di chi ne parla lo critica. «Prezzo e valore» invece è criticato dal 65% di chi ne parla.

**Granularità temporale.** Le recensioni sono distribuite molto male negli anni: da 1 a 34 l'anno fino al 2009, 363 nel 2017, quasi nessuna nel 2020-2021. Un mese o un trimestre fisso darebbero periodi vuoti e percentuali senza senso. Ho scelto l'anno come unità di base, con una regola: gli anni consecutivi si uniscono finché il periodo ha almeno 100 recensioni. Con 100 recensioni, un aspetto citato da un terzo degli ospiti ha circa 33 menzioni, abbastanza per una percentuale leggibile. Il risultato sono 11 periodi, dal 2002-2008 al 2020-2024. Il sistema accetta anche il trimestre o il mese, e la serie annuale grezza è nel file per chi vuole ricalcolare.

**Andamento nel tempo.** Confronto l'ultimo periodo con tutti i precedenti insieme e con il periodo subito prima, per ogni aspetto, sulla quota di recensioni che lo apprezzano e che lo criticano. Uso un test su due proporzioni. Con tanti confronti alcuni risulterebbero «significativi» per puro caso, quindi applico la correzione di Benjamini-Hochberg (falsi positivi attesi al massimo 10%). Nel digest compaiono come cambiamenti solo quelli che superano questa soglia.

**Per lingua.** Ogni lingua con almeno 15 recensioni è confrontata con tutte le altre sulla quota di recensioni negative o miste, con lo stesso test e la stessa correzione. È l'esempio fatto nella presentazione: se le recensioni negative venissero quasi tutte da una lingua, sarebbe un'informazione. In questo archivio non c'è nessuna differenza oltre il caso.

**File per la visualizzazione.** `aggregazione.json` contiene tutto in forma strutturata. Le due tabelle CSV permettono di collegarlo a Tableau o Excel senza scrivere codice.

### 4.6 Il digest

Il requisito più delicato è che ogni numero e ogni affermazione del digest siano coerenti con l'aggregazione. Un modello linguistico, lasciato libero, calcola, arrotonda e a volte cambia il significato dei numeri. Ho costruito il digest in modo che non possa farlo: **i numeri li scrive il codice, il modello scrive solo le parole intorno.**

1. **Il codice calcola i fatti e scrive le frasi con i numeri**, con articoli e preposizioni corretti, per esempio: «1.446 recensioni su 1.927 ne danno un giudizio positivo (il 75% del totale); tra le 1.692 recensioni che ne parlano, i giudizi positivi sono l'86%».
2. **Il modello restituisce solo commenti e citazioni.** Riceve i fatti e restituisce un JSON con un commento a parole per ogni sezione (sintesi, apprezzati, criticati, andamento nel tempo, recensioni da guardare) e da tre a sei citazioni scelte dalle recensioni.
3. **Il codice controlla la parte del modello:** nei commenti non ci deve essere nessuna cifra (né numeri, né percentuali, né anni) e nessuna virgoletta; ogni citazione deve essere copiata parola per parola dalla recensione indicata, e ogni identificativo deve esistere. Il controllo vale per la citazione nella lingua originale: la traduzione italiana che il modello mette accanto non è controllata.
4. **Il codice monta il digest:** titoli, frasi con i numeri, elenchi, recensioni da guardare con il loro motivo, commenti del modello e citazioni, con la traduzione quando la recensione non è in italiano.
5. **Se un controllo non passa**, il modello riceve l'elenco dei problemi e corregge, fino a tre tentativi. Se non basta, il digest esce senza i commenti del modello, con le stesse frasi e citazioni scelte dal sistema. La risposta scartata resta in `esecuzione.json`.

Ci sono arrivata per gradi (sezione 7). Prima il modello scriveva tutto il testo e un controllo verificava che ogni numero esistesse nei fatti. Poi, dopo aver trovato un numero giusto con il significato sbagliato, ho fatto scrivere le frasi con i numeri al codice e ho chiesto al modello di copiarle identiche. Ma il modello, per scrivere meglio, le riformulava o le univa. Il controllo lo fermava, giustamente, e il digest finiva sulla versione di riserva. La soluzione è stata smettere di chiedergli di copiare.

### 4.7 I guardrail

Ho seguito un principio: **guardrail su ciò che entra da fuori, verifica su ciò che il modello produce.**

- **Dati sensibili, in ingresso:** email, telefoni, carte, IBAN, IP, link e chiavi vengono sostituiti da segnaposto prima di ogni chiamata a OpenAI.
- **Manipolazione, in ingresso:** espressioni regolari in più lingue («ignore previous instructions» e simili), più un controllo con il modello. Una recensione sospetta viene analizzata comunque, perché lo schema stretto limita i danni, ma è segnalata ed esclusa dai conteggi.
- **Uscita, sul digest:** dati personali, link, chiavi, «Mr/Ms» seguito da un nome, e un controllo con il modello sui nomi di persone. Se non passa, si usa il digest di riserva.

Due lezioni sono venute dalle prove.

- **Un guardrail pronto può rovinare i dati.** Due controlli del nodo Guardrails di n8n, usati così com'erano, cancellavano testo buono. Il controllo dei link scambiava per indirizzi le parole unite da un punto senza spazio («nights.We»), e su 40 recensioni ha cancellato 8 pezzi di frase. Il controllo delle chiavi segrete, basato sulla casualità apparente del testo, ha cancellato un'intera riga in giapponese, perché senza spazi «sembra casuale». Li ho sostituiti con espressioni regolari che riconoscono solo link e chiavi veri.
- **Un guardrail dipende dal dominio.** Nella prova su un'app (sezione 4.8), il controllo anti-manipolazione ha escluso tre recensioni vere da 1 stella che *parlavano* di intelligenza artificiale («non sono persone vere, sono chatbot»): le ha scambiate per testi che *parlano a* un'intelligenza artificiale. Erano proprio le critiche più importanti per quell'app. Ho corretto le istruzioni: parlare di bot o di AI è una lamentela normale; manipolazione è dare istruzioni al sistema che analizza.

### 4.8 Un sistema generico: il file di contesto

All'inizio l'hotel era scritto dentro i prompt in tre punti. Gli aspetti emergevano già dai dati, ma le categorie di segnalazione erano pensate per un hotel, e un'altra attività ha problemi diversi. Ho spostato tutto ciò che riguarda il dominio in un file, `data/contesto/contesto.json`: che cosa viene recensito, chi scrive, chi legge, la lingua del digest, la scala del voto, le critiche ordinarie da non segnalare, le categorie di segnalazione con nome, priorità e definizione. Tutti i prompt leggono il dominio da lì. Il file non elenca servizi né aspetti, perché il modello tenderebbe a vederli anche dove non ci sono.

Per verificarlo ho fatto girare lo stesso workflow, cambiando solo quel file, su 500 recensioni pubbliche di un'app. Ha funzionato senza toccare il workflow, e gli aspetti sono emersi da soli (pagamenti, autenticità dei profili, qualità dell'app...). Questa prova ha fatto scoprire il problema del guardrail descritto sopra e un problema di virgolette nel digest, corretti anche nel progetto dell'hotel, e il limite dell'identificativo con i testi brevi (sezione 4.1).

## 5. Verifica su recensioni non usate durante lo sviluppo

### 5.1 Il metodo

**Divisione fatta all'inizio.** Prima di leggere le recensioni ho diviso l'archivio in base all'identificativo: 1.546 recensioni di sviluppo e 381 di test (il 20%). Tutte le prove su campioni, quelle in cui ho scritto e corretto i prompt, sono state fatte solo sulle recensioni di sviluppo. Le recensioni di test non le ho mai lette.

Per onestà, tre precisazioni.
- Prima della divisione, esplorando il file, avevo visto le prime righe e le 8 recensioni più corte.
- I giri completi analizzano tutte le recensioni, comprese quelle di test. Anche la scoperta degli aspetti ha pescato il suo campione da tutto l'archivio.
- La revisione dell'elenco degli aspetti (v2) ha usato anche un'informazione presa dal gold set, che è fatto di recensioni di test: la confusione tra personale e servizio. Per questo il miglioramento dalla v1 alla v2 misurato su quel gold set non è indipendente (sezione 9). Le altre misure non dipendono da questa scelta.

**Due verifiche.**

- **A. Sviluppo contro test, senza etichette.** Se il sistema fosse tarato sulle recensioni viste, sul test dovrebbe andare peggio. Confronto sette misure che non richiedono etichette:
  - quante recensioni da 4-5 stelle il sistema giudica positive, e quante da 1-2 stelle negative o miste;
  - quante hanno almeno un aspetto, e quante hanno temi fuori elenco;
  - quante sono segnalate;
  - se la lingua indicata coincide con l'alfabeto (giapponese, cinese, coreano, russo).
  
  Una differenza conta solo se supera 2 errori standard.
- **B. Gold set.** 50 recensioni di test etichettate e confrontate con il sistema. Le ho scelte prima di vedere i risultati: 15 con 1-2 stelle, 10 con 3, 25 con 4-5, di cui 8 non in inglese. Le negative sono sovra-rappresentate di proposito, perché sono quelle che contano per la direzione. Le ha etichettate **alla cieca** un modello diverso da quello del sistema. Non ha visto né i risultati né i prompt: ha ricevuto solo le recensioni, l'elenco degli aspetti e i criteri. Con l'elenco v2 l'etichettatura è stata rifatta da capo, e quella con la v1 è conservata a parte.

**Controllo incrociato.** Le metriche le calcolano due programmi scritti in modo indipendente: il workflow di verifica in n8n e uno script Python. Danno numeri identici.

### 5.2 I risultati

**A. Sviluppo contro test, senza etichette** (giro definitivo; una differenza conta solo se |z| ≥ 2)

| misura | sviluppo (1.546 recensioni) | test (381 recensioni) | z |
|---|---|---|---|
| recensioni da 4-5 stelle giudicate positive | 1.130 su 1.354 (83,5%) | 274 su 331 (82,8%) | -0,30 |
| recensioni da 1-2 stelle giudicate negative o miste | 86 su 86 (100%) | 26 su 26 (100%) | 0 |
| recensioni con almeno un aspetto | 1.543 (99,8%) | 381 (100%) | 0,86 |
| recensioni con temi fuori elenco | 1.017 (65,8%) | 245 (64,3%) | -0,54 |
| recensioni segnalate | 215 (13,9%) | 51 (13,4%) | -0,26 |
| recensioni segnalate per un problema preciso | 190 (12,3%) | 45 (11,8%) | -0,26 |
| lingua coerente con l'alfabeto (giapponese, cinese, coreano, russo) | 38 su 39 (97,4%) | 15 su 15 (100%) | 0,63 |

Aspetti medi per recensione: 3,78 nello sviluppo e 3,79 nel test.

**B. Gold set** (50 recensioni di test, etichettate alla cieca)

| misura | valore | intervallo di confidenza al 95% |
|---|---|---|
| sentiment complessivo, accuratezza | 90% (45 su 50) | 78,6-95,7% |
| sentiment complessivo, kappa di Cohen | 0,83 | |
| lingua | 100% (50 su 50) | 92,9-100% |
| aspetti, precisione | 92,3% (156 su 169) | |
| aspetti, richiamo | 82,5% (156 su 189) | |
| aspetti, F1 | 87,2% | |
| giudizio giusto sugli aspetti trovati da entrambi | 95,5% | 91,0-97,8% |
| segnalazioni per un problema preciso, richiamo | 100% (12 su 12) | |
| segnalazioni per un problema preciso, precisione | 60% (12 su 20) | |

Sul sentiment complessivo, i cinque disaccordi sono quattro recensioni positive per il gold set che il sistema giudica miste, e una mista che il sistema giudica negativa. Non c'è nessuna confusione tra positivo e negativo: le 18 recensioni negative del gold set sono negative anche per il sistema.

**Elenco degli aspetti v1 contro v2.** Con l'elenco emerso da solo (v1) e il suo gold set, la F1 sugli aspetti era del 79,2%; con l'elenco rivisto (v2) è dell'87,2%. Precisione e richiamo migliorano entrambi, ma con 50 recensioni il salto è al limite dei 2 errori standard (z circa 2,0). In più la revisione ha usato un'informazione dello stesso gold set, quindi questo confronto è ottimista. È un miglioramento probabile, non dimostrato.

### 5.3 Che cosa ne deriva

**Nessun segno che il sistema sia tarato sulle recensioni che ho visto.** Su tutte le sette misure, sviluppo e test sono uguali entro il rumore: lo |z| più grande è 0,86. È un controllo senza etichette: mostra che sviluppo e test si comportano allo stesso modo, non dimostra da solo che le risposte siano giuste. Per questo c'è anche il gold set, fatto solo con recensioni di test. Se avessi adattato i prompt alle recensioni di sviluppo, sul test avrei visto più temi fuori elenco, meno coerenza tra voto e testo o più errori di lingua. Non succede.

**Il giudizio complessivo è affidabile, nei limiti di un gold set piccolo etichettato da un modello.** L'accuratezza è del 90%, con un kappa di 0,83, cioè un accordo molto alto anche tenendo conto di quello che ci si aspetterebbe per caso. Gli errori stanno tutti al confine tra «positivo» e «misto», dove anche due persone potrebbero non essere d'accordo. Positivo e negativo non vengono mai scambiati.

**Gli aspetti sono riconosciuti bene, e il punto debole era l'elenco, non la lettura.** Quando il sistema e il gold set trovano lo stesso aspetto, il giudizio coincide nel 95,5% dei casi. Il richiamo più basso della precisione dice che il sistema tende a non indicare un aspetto citato di sfuggita. Il miglioramento dalla v1 alla v2 viene quasi tutto dal confine tra personale e servizio: con la v2, «Personale e servizio» coincide quasi del tutto con il gold set.

**Le segnalazioni sbagliano dalla parte della prudenza.** Nessuna recensione da segnalare è stata persa, ma su 20 segnalazioni per un problema preciso 8 non lo sono per il gold set. Per la direzione è l'errore meno grave: costa una lettura in più. Va comunque tenuto sotto controllo, e in produzione lo misurerebbero i pulsanti «giusta / sbagliata» (sezione 10).

Il limite principale di questa verifica: il gold set è di 50 recensioni, quindi gli intervalli sono larghi, ed è stato etichettato da un modello, non da una persona. È un confronto tra modelli, scelto per essere indipendente, ma non sostituisce un'annotazione umana (sezione 10).

## 6. Che cosa dicono le recensioni

Questi sono i risultati principali del giro definitivo. Il digest per la direzione è in `data/output/digest.md`.

- **Nel complesso:** 1.927 recensioni dal 2002 al 2024, voto medio 4,51 su 5. Il 73% delle recensioni è positivo, il 18% misto e l'8% negativo.
- **Che cosa piace di più:** il personale e il servizio (1.446 recensioni ne danno un giudizio positivo, il 75% del totale) e la posizione (1.099 recensioni, e il 98% di chi ne parla la apprezza). Poi la camera, la vista e le strutture e l'atmosfera dell'hotel.
- **Che cosa si critica di più:** per volume, il prezzo e il valore (198 recensioni), poi il personale e il servizio (188), la camera (168) e il cibo e le bevande (150). Per tasso, il prezzo e il valore è criticato dal 65% di chi ne parla, il Wi-Fi e la tecnologia dal 60%.
- **Come cambiano le cose:** dei 45 confronti nel tempo, 23 risultano significativi dopo la correzione per confronti multipli. L'ultimo periodo (2020-2024, 126 recensioni) è chiaramente diverso dai precedenti: il voto medio scende a 3,61, contro valori tra 4,39 e 4,70 prima, e le recensioni negative salgono al 31,7%. Rispetto al 2002-2019 aumentano le critiche al personale e al servizio (dall'8,7% al 25,4% delle recensioni), alla camera (dal 7,7% al 23,8%), al prezzo (dal 9,3% al 24,6%) e al cibo (dal 7,1% al 18,3%).
- **Recensioni da guardare:** 266 (il 13,8%), di cui 43 con priorità alta. I motivi più frequenti sono episodi precisi di comportamento del personale, disservizi gravi, prenotazioni non rispettate e problemi di igiene.
- **Lingue:** nessuna lingua si distingue dalle altre oltre il caso.

## 7. Problemi incontrati e come li ho risolti

Durante il lavoro ho tenuto un diario di tutte le prove. Qui riporto i problemi più istruttivi.

| problema | come me ne sono accorta | correzione |
|---|---|---|
| Il controllo dei link di n8n cancellava pezzi di frase («nights.We») | segnaposto `<URL>` in testi senza link | espressione regolare solo per link veri |
| Il controllo delle chiavi segrete cancellava una riga in giapponese | segnaposto `<SECRET>` in una recensione giapponese | espressioni regolari per i formati veri di chiave |
| Il modello attribuiva a una recensione la frase di un'altra | il controllo delle prove non trovava la frase nel testo | gruppi da 5, istruzione di indipendenza, registrazione dei casi |
| Elenco degli aspetti tagliato a metà per lunghezza | il nodo non riusciva a leggere la risposta | limite di risposta più alto e nuova richiesta automatica |
| Temi già coperti contati come «fuori elenco» | «concierge» fuori elenco pur essendo nel personale | il modello vede tutti i temi di ogni aspetto; il codice toglie i temi già coperti |
| Elenco degli aspetti diverso a ogni giro | confronto tra giri | elenco fisso degli aspetti, con versione |
| Numero giusto con significato sbagliato nel digest: «75% delle recensioni che ne parlano», mentre era il 75% di tutte | rileggendo il digest finale prima della relazione | frasi con i numeri scritte dal codice |
| Il modello non riusciva a copiare identiche le frasi con i numeri: le univa o le riformulava | il controllo rifiutava il testo tre volte e usciva la versione di riserva | il codice monta il digest; il modello scrive solo commenti senza cifre e sceglie le citazioni |
| La «prova» passata al digest non era sempre una frase esatta | il controllo delle citazioni rifiutava citazioni di prove | al digest si passa la frase esatta del testo |
| Il guardrail escludeva recensioni che parlano di bot e AI | nella prova sull'app | istruzioni che distinguono parlare di AI da parlare a un'AI |
| Il gold set mancante fermava in silenzio il workflow di verifica | il workflow si chiudeva senza scrivere | il nodo di lettura restituisce sempre un elemento |

## 8. I compromessi

- **Gruppi di cinque recensioni per chiamata.** Costa meno e va più veloce di una recensione alla volta, ma il modello può mescolare le recensioni. Il controllo delle prove intercetta i casi visibili. Una contaminazione su un giudizio di aspetto invece non lascia tracce (sezione 9).
- **Controllo anti-manipolazione con il modello, una recensione alla volta.** Lavora una recensione alla volta, quindi pesa sul tempo di un giro, che in tutto dura circa 23 minuti. Ho deciso di tenerlo, perché le recensioni sono testo scritto da sconosciuti.
- **Segnalare in più piuttosto che perdere casi.** Il criterio include il voto basso e le incoerenze tra voto e testo. Per la direzione una segnalazione in più costa una lettura, una persa può costare un problema non gestito.
- **Elenco fisso degli aspetti.** Rende i numeri confrontabili nel tempo, ma un tema nuovo non entra da solo. La linea di base dei temi fuori elenco (65,3% delle recensioni, quasi tutti temi marginali come compleanni e shopping) serve a capire quando riaprire l'elenco.
- **Anno come unità di tempo.** Con questa distribuzione è la scelta più solida. Il prezzo è che i cambiamenti dentro un anno non si vedono.

## 9. I limiti

- **Il gold set è piccolo ed etichettato da un modello.** Le misure hanno intervalli larghi, e il confronto è tra modelli.
- **Il miglioramento dell'elenco v2 è probabile, non dimostrato.** Sulla precisione e sul richiamo degli aspetti è al limite dei 2 errori standard. Soprattutto, la revisione ha usato un'informazione presa dal gold set su cui poi l'ho misurata: per una misura indipendente servirebbe un secondo gold set, mai usato per nessuna decisione.
- **Il gruppo influenza i giudizi.** Il modello legge le recensioni a gruppi di 5. Quando prende una frase da un'altra recensione del gruppo, il controllo delle prove se ne accorge. Ma il gruppo influenza anche gli aspetti assegnati, e questo dal codice non si vede. L'ho misurato nel progetto sulle recensioni di un'app, sulle 500 recensioni dell'app. Fra due giri identici a gruppi di 5 le coppie recensione-aspetto coincidono nel 93% dei casi. Fra un giro a gruppi di 5 e uno con una recensione alla volta coincidono solo nel 79%, una differenza ben oltre il rumore (z = -5,6). L'accuratezza sui gold set resta simile, ma il giudizio su una recensione non dovrebbe dipendere da quelle che le stanno accanto. Per questo, nella versione per le app, le recensioni si analizzano una alla volta: costa circa tre volte tanto, ma su 500 recensioni il costo misurato del modello passa solo da 15 a 49 centesimi di dollaro.
- **Il digest:** i numeri li scrive il codice e le citazioni sono verificate, ma i commenti a parole del modello possono ancora interpretare male. Nel digest definitivo ci sono alcune frasi così. Il commento chiama «divisivi» il personale e la camera, mentre per i numeri gli aspetti più divisivi sono il prezzo, il Wi-Fi, il rumore e il check-in. Dice che per il club lounge «aumentano le critiche», mentre i numeri mostrano solo un calo dei giudizi positivi. Dice che le critiche alla camera riguardano «soprattutto la manutenzione e le dotazioni», ma il sistema non misura niente del genere. E le traduzioni italiane delle citazioni non sono controllate. Il codice controlla che i commenti non contengano numeri, non che il ragionamento sia giusto. Il passo successivo sarebbe un controllo dei commenti contro i fatti, fatto da un secondo modello o da regole sulle parole chiave («aumento», «divisivo»).
- **Le segnalazioni sono un po' larghe:** nel gold set il sistema non perde nessuna recensione da segnalare, ma ne segnala qualcuna in più. Un esempio visto nelle prove: una recensione segnalata come «oggetti persi o danneggiati» per pareti rovinate dell'hotel, mentre la categoria riguarda gli oggetti dell'ospite. Un altro è nel giro definitivo, e il digest lo mostra tra gli esempi: una recensione da 4 stelle segnalata con priorità alta per «igiene e salute» per asciugamani consumati e pochi prodotti da bagno, che per quella categoria è un motivo debole.
- **Il guardrail con il modello legge lo stesso testo non fidato,** quindi in teoria può essere ingannato anche lui. Per questo c'è il doppio controllo con le espressioni regolari, e soprattutto lo schema stretto, che limita ciò che il modello può restituire.
- **Costi del guardrail stimati.** n8n non espone i token dei nodi Guardrails: nel registro sono una stima dichiarata, non una misura.
- **Il modello non dà sempre la stessa risposta.** Anche a temperatura zero, la stessa recensione analizzata due volte può ricevere aspetti diversi. Nel progetto sulle recensioni di un'app ho fatto due giri identici sulle stesse 500 recensioni dell'app: il giudizio complessivo coincide nel 98% dei casi, la presenza di una segnalazione nel 98% e le coppie recensione-aspetto nel 93%. Le differenze stanno quasi tutte in recensioni brevi e vaghe, dove l'aspetto è davvero incerto. Sull'hotel questa affidabilità test-retest non l'ho misurata: è il primo miglioramento della sezione 10. Pesa poco sui totali, perché le oscillazioni si compensano su centinaia di recensioni, ma pesa sulla singola recensione. (Una prima stima del 70%, presa dal test di stabilità dell'aggiornamento automatico, era più bassa perché quel test rianalizza con un testo delle istruzioni leggermente diverso: non è un vero test-retest.)
- **L'ultimo periodo (2020-2024) è il più piccolo,** con 126 recensioni. I cambiamenti sono significativi dopo la correzione, ma includono gli anni della pandemia: il sistema dice che le cose sono cambiate, non perché.

## 10. Miglioramenti possibili

**Per la valutazione:**
- misurare l'affidabilità test-retest: rianalizzare due volte le stesse recensioni e misurare l'accordo, come si fa con un questionario somministrato due volte;
- un gold set più grande, etichettato da almeno due persone, con la misura del loro accordo, e tenuto da parte solo per la verifica finale;
- analizzare le recensioni una alla volta, come nella versione per le app, dopo la misura descritta nella sezione 9.

**Per gli aspetti:**
- far emergere gli aspetti anche raggruppando i temi per vicinanza negli embedding (lo «spazio latente» citato nella presentazione), e confrontare il risultato con il metodo attuale;
- aggiornamento automatico dell'elenco degli aspetti, con i controlli della sezione 4.2 (proposta, copertura, sovrapposizione, test di stabilità stratificato, rianalisi dello storico, persona solo nei casi dubbi).

**Verso la produzione:**
- giri incrementali: ogni settimana si analizzano solo le recensioni nuove (l'identificativo stabile c'è già; con le fonti che danno un proprio identificativo si usa quello, sezione 4.1);
- un controllo sulle campagne coordinate: testi lunghi quasi identici scritti da autori diversi in pochi giorni, e picchi di recensioni da 1 stella rispetto al ritmo normale, con un test sul conteggio giornaliero;
- avvio programmato, digest settimanale e avviso immediato per le segnalazioni ad alta priorità su Telegram, con i pulsanti «giusta / sbagliata»: la precisione delle segnalazioni si misurerebbe da sola nel tempo;
- test automatici sul codice dei nodi, e un test di regressione sul gold set prima di ogni modifica ai prompt;
- database invece dei file, e un cruscotto;
- accordo sul trattamento dei dati con il fornitore del modello.

**Con un RAG, quando la conoscenza dell'azienda cresce.** Oggi un RAG non servirebbe: il contesto sta in una pagina. Servirebbe per collegare ogni segnalazione alle regole dell'hotel («l'ospite chiede un rimborso: la policy lo prevede?»), per trovare reclami simili già gestiti, o per spiegare i cambiamenti nel tempo con gli eventi della struttura (una ristrutturazione, un cambio di gestione). Le fonti recuperate andrebbero citate e verificate come le citazioni del digest, e il recupero andrebbe valutato a parte.

## 11. Riproducibilità, tempi e costi

Il progetto gira su qualsiasi macchina con Docker. La versione di n8n è fissata, la chiave OpenAI si mette nel file `.env`, e un solo comando esegue tutto: `docker compose run --rm esegui`. Il workflow e la credenziale vengono importati in automatico a ogni avvio. La verifica si lancia con `docker compose run --rm verifica`.

Il giro definitivo ha richiesto 23,3 minuti. Le chiamate al modello fatte dal workflow sono misurate: 1.294.617 token in ingresso e 176.814 in uscita, per 0,80 dollari. Il guardrail con il modello (1.928 chiamate) è stimato in 0,49 dollari. In tutto circa 1,29 dollari per l'intero archivio, cioè 0,67 dollari ogni 1.000 recensioni (`registro_giro.json`, modello gpt-4.1-mini, prezzi di listino indicati nel file e da verificare quando cambiano).

## 12. Riflessione

Un modello linguistico permette di leggere migliaia di recensioni in mezz'ora, ma la fiducia nei risultati non viene dal modello: viene dai controlli che gli ho costruito intorno. Gli errori più pericolosi che ho trovato non erano risposte sbagliate, ma risposte plausibili: un numero giusto con il significato sbagliato, una frase vera attribuita alla recensione sbagliata.
