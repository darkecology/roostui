# Roost UI

Radar roost detection visualization and annotation tool. Single-page app using d3 for data-joins/SVG rendering and vanilla JS for DOM manipulation.

## Completed work

1. **Extract data module** -- separated data/state from rendering into `data.js`
2. **Replace casual d3 DOM usage** with vanilla JS
3. **Create RoostViewer class** -- vanilla JS class (`js/RoostViewer.js`) that renders images + SVG bbox overlays. Framework-agnostic; see `ROOST_VIEWER_DESIGN.md` for full interface docs.
4. **Integrate RoostViewer into vis.js** -- vis.js creates/destroys a RoostViewer per day, drives it via `setFrame()`/`update()`, and wires callbacks for hover/click/labeling. All SVG rendering and image display now owned by RoostViewer.

## Next steps

- **Build out test-viewer** -- read-only viewer using RoostViewer with a hard-coded dataset. Parse batches into (station, day) combinations, let the user pick a station-day, and display that day's data. Entry point: `test-viewer.html` + `js/test-viewer.js`.
- **Wrapper options** -- RoostViewer is framework-agnostic. A Web Component or React wrapper can be added later if needed.

## Architecture

- `js/RoostViewer.js` -- display engine: renders images + SVG bbox overlays inside a container. Owns DOM setup, color scale, data-join rendering, selected/filtered CSS state. No opinions about navigation UI, labeling, or filtering. Driven by the wrapper via `setFrame()`, `update()`, and callbacks.
- `js/data.js` -- data loading, track summarization, filtering, export formatting. Uses d3 for CSV/JSON fetching, grouping, rollup, csvFormat. No DOM.
- `js/vis.js` -- annotation app UI as a single IIFE. Creates a RoostViewer per day, owns navigation state, labeling, filtering, tooltip, and export. Remaining d3 usage: `<option>` data-joins, radio button enter-join.
- `js/utils.js` -- parsing helpers, `expand_pattern` (uses sprintf for dynamic patterns)
- `js/BoolList.js` -- navigation helper for lists with boolean flags
- `index.html` -- annotation app, inline CSS
- Build: rollup -> `dist/demo.js` and `dist/demo.min.js`
- No test suite; verification is manual (`npm run build` + `npm run serve` on port 8888)

## Conventions

- Do not sign commits with Co-Authored-By
