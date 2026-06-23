import requests
import json
import time

# Importare da altri file nella stessa cartella
from csv_make import csv_make

durata_sleep = 10
json_file = "json/read_backup.json"
num_sensori = 1  # TODO: Prendere numero sensori da get_status

def main():
    while True:
        # Questo dizionario conterrà l'unione di tutte le celle raggruppate per sensore
        # Struttura finale desiderata: {"Sensore_1": {"cella0": "...", "cella505": "..."}}
        combined_data = {}

        posizione_cella = 0
        errore_ciclo = False

        print("=== Inizio ciclo di scaricamento totale (tutti i blocchi di celle) ===")

        # Ciclo compatto per scorrere i blocchi di celle (0, 505, 1010, 1515, 2020, 2525)
        while posizione_cella <= 2525:
            for i in range(1, num_sensori + 1):
                api_url = f"http://muse-24m-16494/read_bakup_arrays?arraynumbkup={i}&firstcell={posizione_cella}"

                try:
                    response = requests.post(api_url, timeout=10)
                    response.raise_for_status()
                    data = response.json()

                    # Estrazione sicura delle celle dalla struttura innestata ricevuta
                    # data è del tipo: [[{"Array backup 1": [{"cella0": "..."}]}]]
                    try:
                        # Navighiamo la struttura dinamica del tuo JSON
                        celle_ricevute = data[0][0]["Array backup 1"][0]
                        
                        sensor_key = f"Sensore_{i}"
                        if sensor_key not in combined_data:
                            combined_data[sensor_key] = {}
                        
                        # Uniamo le nuove celle (es. da 505 a 1010) a quelle già scaricate
                        combined_data[sensor_key].update(celle_ricevute)
                        print(f"Dati di {api_url} (Celle {posizione_cella} e successive) scaricati.")
                    
                    except (IndexError, KeyError, TypeError) as parse_err:
                        print(f"Errore nella struttura dati ricevuta da {api_url}: {parse_err}")
                        errore_ciclo = True

                except requests.exceptions.RequestException as e:
                    print(f"Errore API, impossibile aprire {api_url}: {e}")
                    errore_ciclo = True

            # Incrementiamo per il blocco successivo di celle
            posizione_cella += 505

        # === Fine scaricamento di tutti i blocchi ===
        if combined_data and not error_ciclo:
            # Sovrascriviamo il file ("w") con la struttura pulita, completa e formattata correttamente
            with open(json_file, "w+", encoding="utf-8") as f:
                json.dump(combined_data, f, indent=4, ensure_ascii=False)
            print(f"\nTutti i dati aggregati sono stati salvati correttamente in {json_file}.")
            
            # Ora csv_make() può leggere un JSON valido e strutturato
            csv_make()
        else:
            print("\nCiclo completato con errori o nessun dato ricevuto. Salto la creazione del CSV.")

        print(f"In attesa per {durata_sleep} secondi prima del prossimo controllo globale...\n")
        time.sleep(durata_sleep)

if __name__ == "__main__":
    main()
