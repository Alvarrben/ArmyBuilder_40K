# FORGE â€” Army Builder 40K

First browser prototype for planning Warhammer 40,000 11th-edition army lists. It is a static app with no build step or third-party JavaScript dependencies.

## Run locally

Serve this folder with a static web server and open its `index.html` page. For example, from this directory run `python -m http.server 8000`, then visit `http://localhost:8000`. Lists are saved in that browser's local storage.

## Deploy with GitHub Pages

The workflow at `.github/workflows/pages.yml` deploys the static site whenever `main` is updated. In the repository settings, set **Pages â†’ Build and deployment â†’ Source** to **GitHub Actions**. The deployed URL is shown in the workflow run and the `github-pages` environment.

## Points data

The scraper fetches each faction page directly from the official [Munitorum Field Manual](https://mfm.warhammer-community.com/en) and writes:

- `data/mfm-snapshot.json`: structured faction pages, units, size/tier costs, wargear, detachments, DP and enhancements.
- `data/mfm-points.csv`: flat export of all extracted point rows.

Run `node scripts/scrape-mfm.mjs` to fetch every faction. Use `node scripts/scrape-mfm.mjs --inspect space-marines` to inspect one faction without replacing the complete snapshot. Use `--output path/to/file.json` to choose another JSON destination; the CSV is written alongside it.

The web app uses the generated snapshot if present and falls back to the small `data/points.csv` demonstration catalogue. The scraper records its retrieval date and the MFM version shown by the official page. Check the source page before relying on data in a game; the upstream page's contents and point values can change.

The points, names and rules are Games Workshop content. FORGE is an unofficial, independent prototype and is not affiliated with or endorsed by Games Workshop. The generated data includes a source URL, attribution and disclaimer; do not assume the code license grants rights to the game data.

