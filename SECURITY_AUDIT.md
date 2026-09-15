# Audit dipendenze

Riepilogo delle vulnerabilità note al commit corrente e decisioni adottate.

## Strumenti e baseline

- `pnpm audit` (contro advisory GitHub), in `package.json`.
- Versione pnpm allineata su `9.15.4` via `packageManager`, usata in CI e Docker (`corepack` la rispetta automaticamente).
- Test suite baseline: 76 test, typecheck pulito, build verificata.

## Vulnerabilità risolte in questa fase

Nessuna in modo automatico. I problemi reali sono major-version-upgrade e li tratto come migrazioni separate (vedi sotto).

## Vulnerabilità residue

Tutte richiedono major upgrade. Lasciate aperte per migrazione dedicata con test specifici.

### `next` 14.2.35 — 23 advisory

Tutte le fix disponibili richiedono `next >= 15.x`. Patch di 14.x non più emessi dalla fondazione.

- 2 low (cache poisoning redirect, RSC cache busting)
- 16 moderate
- 5 high

Blocco principale: Next 15 + React 19 cambiano il rendering server, l'Image API, il middleware. Non è una patch, è una migrazione. Aprire PR separata con:
- bump `next ^14.2.5` → `^15.x`
- bump `react`/`react-dom` → 19.x
- adattare `middleware.ts`, `app/page.tsx`, `app/alternatives/...`, `app/compare/...`
- rieseguire smoke test su desktop e mobile

### `vitest` 2.1.9 — 1 critical, 1 moderate

- CVE critica in `@vitest/mocker` (path traversal in mock redirect). Fix: `vitest >= 3.2.6` oppure `>= 4.1.11`.
- `vitest 4.x` porta anche cambiamenti di API (i config plugin).

Solo dev dependency. Non esposto in produzione. Migrazione a 3.x o 4.x è isolata, può essere PR separata senza toccare il runtime.

### `postcss` 8.4.31 (via `next`) — 4 advisory

Patch `>= 8.5.23`. Il `postcss` dichiarato in `package.json` è già `^8.5.28`, ma `next 14.2.35` ne porta uno annidato a 8.4.31. Si risolve automaticamente con la migrazione Next 15.

### `vite`, `esbuild`, `glob` — dev transitive

Patch disponibili senza major bump ma le versioni bloccate sono in devDependencies e non vengono portate dentro al runtime. Non bloccanti per la release. Da aggiornare in un PR di hygiene quando vitest viene migrato.

## Vincoli operativi decisi

- `packageManager: pnpm@9.15.4` — blocca la versione anche sui developer che arrivano con corepack.
- CI passa da `pnpm@9` a `pnpm@9.15.4` per non prendere l'ultima 9.x a sorpresa.
- Localmente era attivo `pnpm@11.25.0`. Il lockfile (`lockfileVersion: '9.0'`) è compatibile con entrambe, ma `packageManager` forza la 9 come baseline comune.
- Nessun `pnpm override` introdotto: gli override mascherano incompatibilità e il piano li vieta.

## Dipendenze: stato di manutenzione

| Pacchetto | Versione corrente | Prossima azione |
|---|---|---|
| next | 14.2.35 | Migrazione a 15.x (PR separata) |
| @prisma/client, prisma | 5.22.0 | Tenere in lockstep, ignorato major |
| react / react-dom | 18.3.1 | Migrazione a 19 insieme a next 15 |
| typescript | 5.5.x | Tenere |
| vitest | 2.1.9 | Migrazione a 3.x o 4.x (PR separata) |
| tailwindcss | 3.4.x | Tenere |
