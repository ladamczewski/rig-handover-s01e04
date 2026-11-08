# Podgląd digestu — przygotowanie do issue #7

To instrukcja przyszłej publikacji przez koordynatora, **nie potwierdzenie wdrożenia**.
Issue #7 pozostaje otwarte: wymaga prawdziwego publicznego podglądu oraz wysłania
reviewerowi adresu i zgłoszeń planu. Sam commit tego workflow nie spełnia „Done when”.

## Ustawienia wymagające osobnej zgody człowieka

Przed pierwszym uruchomieniem koordynator:

1. Integruje zmiany z głównej gałęzi, w tym śledzony `pnpm-lock.yaml` i poprawkę
   `hostname: '127.0.0.1'` w `src/server.ts`. Workflow używa Node 22 i pnpm 10;
   `pnpm install --frozen-lockfile` celowo nie tworzy brakującego lockfile.
2. Po uzyskaniu zgody publikuje kod workflow na domyślnej gałęzi. Jest wyłącznie
   `workflow_dispatch`: push i pull request nie uruchamiają publikacji.
3. Po osobnej zgodzie wybiera w Settings → Pages źródło **GitHub Actions**.
   Workflow nie włącza Pages ani nie zmienia ustawień repozytorium.
4. Po osobnej zgodzie dodaje w Settings → Secrets and variables → Actions
   **repository secret `LANE_MARKER`**. Nie zapisuje wartości w kodzie, inputach,
   komendach, `.env`, zgłoszeniach ani dokumentacji.
5. Sprawdza środowisko `github-pages`, dopuszczone gałęzie i ewentualne ręczne zgody.
   Dla kontroli publikacji warto wymagać zatwierdzenia deploymentu w tym środowisku.

Nie potrzeba PAT: workflow deklaruje `contents: read`, `pages: write` i `id-token: write`.
W tej pracy nie wykonano żadnego z powyższych ustawień ani publikacji.

## Ręczny review i późniejsze czyszczenie

Actions → **Digest preview** → Run workflow, z zatwierdzonej gałęzi:

- `mode: review`: marker pobierany wyłącznie z `secrets.LANE_MARKER`. Brak lub
  biała wartość przerywa krok przed capture/upload/deploy.
- `mode: clean` (domyślny): marker jest pusty, następnie usuwany ze środowiska.
  Nowy serwer nie czyta `.env`; zapisany banner ma `no marker set`.

Sekret zastępuje pierwotny pomysł jawnego inputu `lane_marker`: nie ma wartości
markera w payloadzie dispatch. GitHub maskuje sekrety w logach, ale nie należy
polegać na maskowaniu przekształconego HTML. Dlatego nie wypisujemy ani markera,
ani HTML, nie włączamy debug/trace i nie pokazujemy prywatnego logu serwera.
Marker w opublikowanej stronie **jest publiczny**; sekret chroni sposób przekazania,
nie publiczną treść preview.

Po testach i typecheck skrypt uruchamia istniejącą usługę przez
`node --import tsx`, czeka na `/health`, a następnie **curl** zapisuje rzeczywiste
`GET http://127.0.0.1:8787/digest/2026-10-28` bez zmian jako `index.html`.
Wymagane są HTTP 200, HTML i samodzielna statyczna strona bez client JS.
Jedyny plik w artefakcie strony to `index.html`; upload ma retencję jednego dnia.
Nie uploadujemy repozytorium, `.env`, logu serwera ani `runs/`.

Adres docelowy to root strony projektu, identyczny dla review i clean:

```text
https://ladamczewski.github.io/rig-handover-s01e04/
```

Nie używamy URL z numerem runu ani ścieżki `/digest/2026-10-28` na Pages.
`deploy-pages` raportuje adres również przez środowisko `github-pages`.
Kolejne ręczne uruchomienie zastępuje tę samą stronę; wspólna grupa concurrency
nie przerywa aktywnego deploymentu.

Po `review` człowiek sprawdza publiczny HTTPS, tabelę i banner, a reviewerowi
wysyła **link i zgłoszenia planu**, nie kopię HTML. Dopiero wtedy można rozważyć
zamknięcie #7. Po review uruchamia `clean` i sprawdza ten sam adres
(z uwzględnieniem cache) pod kątem `no marker set`. Nie usuwa sekretu przed
capture review, ale może usunąć go po udanym czyszczeniu.

Uwaga: podmiana publicznej strony nie usuwa wcześniejszego artefaktu Actions.
Artefakt review wygasa po jednym dniu; jeśli zgoda wymaga natychmiastowego
usunięcia kopii, koordynator osobno usuwa artefakt review. Nie dodajemy do tego
workflow szerszych uprawnień `actions: write`.

## Lokalna weryfikacja bez publikacji

Skrypt niczego nie instaluje. Przy istniejących zależnościach, dostępnym porcie
8787 i zintegrowanym bindzie localhost:

```sh
directory="$(env -u LANE_MARKER bash scripts/save-preview.sh)"
test -s "$directory/index.html"
# Obejrzyj plik lokalnie; nie wklejaj HTML ani markera do logów/zgłoszenia.
rm -rf -- "$(dirname -- "$directory")"
```

W trybie lokalnym wszystkie outputy, heartbeat i prywatny log trafiają wyłącznie
do nowego katalogu `/private/tmp/rig-preview.*`; na Actions do `RUNNER_TEMP`.
Skrypt zatrzymuje usługę i usuwa runtime także po błędzie. Udany capture zostawia
tylko katalog strony do uploadu; workflow usuwa go i tymczasowe archiwum po próbie
deploymentu. `runs/` jest jedynie odczytywane, a `.env` nigdy nie jest ładowany.
Nie commituj wygenerowanego HTML.

Jeśli lokalny sandbox zwraca `listen EPERM`, nie omijaj ograniczenia:
rzeczywisty capture HTTP musi sprawdzić człowiek poza sandboxem lub zatwierdzony
run na runnerze. Same testy tras w pamięci nie dowodzą działania curl/deploy.

## Oficjalne kontrakty użytych akcji

- `actions/checkout@v6`
- `actions/setup-node@v6`: `node-version`, `package-manager-cache`
- `pnpm/action-setup@v4`: `version`, `run_install`
- `actions/upload-pages-artifact@v4`: `path`, `retention-days`
- `actions/deploy-pages@v4`: domyślny artefakt `github-pages`, output `page_url`

Zweryfikowano w repozytoriach tych akcji na GitHub. To standardowe wdrożenie
statycznej strony Pages, nie eksperymentalny tryb `deploy-pages.preview`.
