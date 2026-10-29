# PM-26B — Politica di assistenza, annullamento, rimborso e conservazione
BOZZA — NON PUBBLICATA — NON IN VIGORE
Data: 28 ottobre 2026. Fonte: decisioni PM-26A del responsabile del prodotto nella [matrice decisionale](../../GO_LIVE_MATRIX.md). Questo è un testo proposto per una futura politica, non una dichiarazione che procedure o processi di cancellazione siano già attivi. I diritti inderogabili restano invariati.

## 1. Ambito e informazioni da definire
Il servizio è destinato a persone di almeno 18 anni residenti in Svizzera o Liechtenstein. La prima versione in produzione prevede pagamenti con carta e offerte manuali; offerte automatiche e TWINT restano disattivati. Identità e indirizzo del gestore, dominio, contatti di assistenza e privacy, fornitori e paesi di trattamento restano DA DEFINIRE. Questa bozza non seleziona alcun fornitore.

## 2. Assistenza scritta
È prevista assistenza scritta con l’obiettivo di una prima risposta entro 2 giorni lavorativi durante la settimana. Si tratta di un obiettivo di prima risposta, non di una garanzia di risoluzione. Non sono promessi assistenza telefonica o servizio 24 ore su 24, 7 giorni su 7. Durante l’esame di un pagamento o di una controversia devono essere fornite informazioni sullo stato. Responsabile, canale effettivo, calendario lavorativo, tempi di risoluzione ed escalation restano DA DEFINIRE.

## 3. Annullamento della vendita e commissione di servizio
Il prezzo del veicolo è separato dalla commissione di servizio della piattaforma di CHF 30. Annullare una vendita e rimborsare tale commissione sono decisioni distinte. Svincolare una prenotazione non ancora addebitata è diverso dal rimborsare denaro già addebitato. L’acquirente vincitore paga CHF 30 quando la vendita si conclude con successo.
- Se un acquirente viene superato da un’altra offerta, la sua prenotazione viene svincolata.
- In caso di annullamento imputabile al venditore, rimozione di un annuncio non conforme o errore della piattaforma, la commissione non viene addebitata all’acquirente; se già addebitata, viene esaminata e rimborsata.
- Gli addebiti duplicati o errati vengono corretti.
- L’inadempimento dell’acquirente non attiva un addebito automatico. Un amministratore esamina motivazioni e risposta dell’acquirente. Se l’inadempimento è confermato, CHF 30 restano al gestore come commissione di servizio e non vengono versati al venditore.
- Finché una controversia è aperta, un addebito non ancora effettuato viene sospeso.

Queste procedure sono previste per l’implementazione; non viene promesso un tempo bancario di svincolo o rimborso.

## 4. Esame motivato dei rimborsi
Dopo una vendita conclusa con successo, un semplice ripensamento non comporta automaticamente il rimborso della commissione secondo questa bozza. Errori, servizi mancanti e controversie vengono esaminati in base alle motivazioni. Non è stato scelto un periodo aggiuntivo di rimborso commerciale incondizionato. Termini di richiesta e decisione, prove, riesame dopo un rifiuto, rimborsi parziali e gestione delle contestazioni bancarie restano DA DEFINIRE. La regola del prototipo locale di un’unica richiesta e decisione definitiva non viene adottata come politica di produzione. I diritti inderogabili non vengono limitati.

## 5. Obiettivi di conservazione approvati
| Categoria | Obiettivo |
| --- | --- |
| Corrispondenza di assistenza chiusa, salvo protezione come prova | 6 mesi dalla chiusura |
| Messaggi non collegati a una transazione, salvo protezione come prova | 6 mesi dall’ultima attività |
| Log tecnici e di sicurezza, salvo protezione come prova | 30 giorni |
| Backup | Conservazione a rotazione di 30 giorni |

Sono obiettivi di politica prodotto approvati, non termini legali né una dichiarazione di cancellazione automatica già attiva. La regola approvata sull’attività dei messaggi è riportata sotto; i riferimenti temporali dei log e il ciclo dei backup restano da documentare.

Regola messaggi approvata PM-26D: l’ultima attività è la data più recente di creazione della conversazione, del messaggio o di creazione/modifica dell’appuntamento. La lettura/visualizzazione non prolunga il termine. La soglia è di 6 mesi di calendario UTC, limitata all’ultimo giorno del mese di destinazione. Qualsiasi offerta, prenotazione, vendita o segnalazione del veicolo, segnalazione di messaggio aperta o chiusa nella conversazione, oppure appuntamento in attesa/accettato protegge tutti i messaggi della conversazione. La chiusura di segnalazioni o controversie non rimuove automaticamente la protezione. Solo i messaggi senza tali collegamenti oltre la soglia sono candidati in un’anteprima di sola lettura; nulla viene cancellato. I periodi di protezione restano DA DEFINIRE. I riferimenti temporali dei log e il ciclo dei backup restano da specificare.

## 6. Eccezioni di protezione e durate da definire
I periodi di conservazione di pagamenti/transazioni, contratti e accettazioni, nonché dei fascicoli di controversie aperte o chiuse, restano DA DEFINIRE. Corrispondenza, messaggi e log che costituiscono prove di transazioni o controversie sono esclusi dalla cancellazione automatica generale. L’ambito approvato per i messaggi è riportato sopra; gli altri ambiti e i periodi da definire richiedono una decisione separata. Una durata non definita non equivale all’approvazione di una conservazione illimitata.
La chiusura di un account non comporta la cancellazione immediata di tutti i dati delle transazioni. Qui non viene assegnata alcuna durata ad account, media o altre categorie non elencate. La scelta fra cancellazione e anonimizzazione, la revisione della protezione e il rispetto delle richieste di cancellazione dopo il ripristino di un backup devono essere definiti prima dell’implementazione.

## 7. Pubblicazione e implementazione
Informazioni su gestore, contatti e fornitori, decisioni ancora aperte ed esame del testo finale devono essere completati prima della pubblicazione. Queste bozze non sono una versione legale attiva e non richiedono accettazione agli utenti. Il documento non attiva cancellazioni pianificate, pagamenti o rimborsi. Il [piano di implementazione](../../RETENTION_PROTECTION_PLAN.md) separato descrive i limiti tecnici.
