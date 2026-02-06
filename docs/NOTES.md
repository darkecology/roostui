# Roost UI Refactoring Notes

## Migration plan

1. **Extract data module** -- separate data/state from rendering into `data.js` (DONE, commit a444acba..47e310d6)
2. **Replace casual d3 DOM usage** with vanilla JS (DONE, commit ffcb9363)
3. **Create `<RoostViewer>`** -- React component taking processed data as props, renders images + SVG overlays
4. **Build annotation app** -- React wrapper around `<RoostViewer>` adding navigation, filtering, labeling, export
5. **Publish `<RoostViewer>`** -- standalone component the public site can import

## Current state (2026-02-02)

- Branch: `refactor/extract-data-module` (pushed to origin)
- Steps 1-2 complete
- Next: step 3

## Architecture after steps 1-2

- `js/data.js` -- data loading, track summarization, filtering, export formatting. Uses d3 for CSV/JSON fetching, grouping, rollup, csvFormat. No DOM.
- `js/vis.js` -- UI as a single IIFE (`var UI`). Uses d3 for: SVG data-joins (render_frame), `<option>` data-joins (dataset/batch/date/time selects), radio button enter-join (selectTrack), scaleOrdinal/schemeSet1, and `d3.selectAll("#svg1, #svg2")`. All other DOM ops are vanilla JS.
- `js/utils.js` -- parsing helpers, `expand_pattern` (uses sprintf)
- `js/BoolList.js` -- navigation helper for lists with boolean flags
- Build: rollup, output to `dist/demo.js` and `dist/demo.min.js`
- No test suite exists

## Key files

- `index.html` -- single-page app, all inline CSS, element IDs used by vis.js
- `data/config.json` -- top-level config listing datasets
- `data/<dataset>/config.json` -- per-dataset config (image URL patterns, box/scan file patterns)
- `data/<dataset>/batches.txt` -- list of batch names

## Decisions / notes

- d3 data-join patterns deliberately kept in step 2 (they'll be replaced by React in step 3)
- `sprintf` remains in `utils.js` (`expand_pattern`) -- not replaceable with template literals since patterns are dynamic
- jQuery fully removed
- `#notes-save` element referenced in old code doesn't exist in HTML; dead code removed
- No automated tests; verification is manual (npm run build + npm run serve on port 8888)
