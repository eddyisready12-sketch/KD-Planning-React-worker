# GitHub Pages Testversie

Deze map is voorbereid om de React-versie via GitHub Pages te testen.

## Wat is aangepast

- `vite.config.ts` gebruikt nu `VITE_BASE_PATH`
- `.env.example` bevat een voorbeeld voor GitHub Pages
- `package.json` heeft een extra script `build:github`

## Voor GitHub Pages

1. Maak van deze map een GitHub repository.
2. Maak een `.env.local` bestand op basis van `.env.example`.
3. Zet in `.env.local`:

```env
VITE_BASE_PATH=/jouw-repo-naam/
```

Voorbeeld:

```env
VITE_BASE_PATH=/mixplanner-react/
```

4. Installeer dependencies:

```powershell
npm install
```

5. Bouw de site:

```powershell
npm run build:github
```

6. Publiceer de inhoud van `dist` op GitHub Pages.

## Lokaal testen

```powershell
npm install
npm run dev
```

Open daarna:

`http://localhost:3000`

## Belangrijk

- Deze React/Vite versie opent niet via dubbelklik op `index.html`
- Voor GitHub Pages moet de `VITE_BASE_PATH` overeenkomen met je repo-naam
- Als je GitHub Actions wilt gebruiken voor deploy, kan ik daar ook meteen een workflow voor toevoegen
