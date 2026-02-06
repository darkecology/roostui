# Map Overlay Design

## Overview

Add a toggleable geographic map overlay to RoostViewer, displaying state boundaries, county boundaries, and major water bodies over radar images. The overlay renders on an HTML `<canvas>` element positioned between the radar image and the SVG bounding-box layer, using a d3-geo projection that matches the radar image geometry.

## Motivation

Geographic context helps users orient themselves when viewing radar imagery and annotating roost detections. The previous labeling tool (roost-label) provided this via pre-rendered transparent GIF map overlays generated with MapServer. This design achieves the same goal using client-side vector rendering, which is more flexible and requires no offline image generation step.

## Projection

Radar images are rendered by converting polar radar coordinates (slant range, azimuth, elevation) to Cartesian (x, y) via:

1. (slant range, elevation) → (ground range, altitude) using the 4/3 earth model
2. (ground range, azimuth) → (x, y) via polar-to-Cartesian conversion

This is functionally equivalent to an **azimuthal equidistant projection** centered on the radar station: radial distance from center = ground distance, azimuth preserved. d3-geo provides `d3.geoAzimuthalEquidistant()` which matches this exactly.

### Image parameters

| Parameter | Value |
|-----------|-------|
| Range | 150,000 m (150 km) |
| Image size | 600 × 600 px |
| Scale | 500 m/pixel |
| Center | Radar station (lat, lon) |
| Orientation | North up |

Source: `~/darkecology/roost-system/src/roosts/data/renderer.py` (`ARRAY_R_MAX = 150000.0`, `ARRAY_DIM = 600`). The saved images are flipped to north-up (line 193: `rgb[::-1, :, :]`).

### d3-geo projection setup

```js
const PANEL_SIZE = 600;
const RANGE_M = 150000;
const EARTH_RADIUS = 6_371_000;

const scale = (PANEL_SIZE / 2) / (RANGE_M / EARTH_RADIUS);  // ~12,744

const projection = d3.geoAzimuthalEquidistant()
  .rotate([-stationLon, -stationLat])
  .translate([PANEL_SIZE / 2, PANEL_SIZE / 2])
  .scale(scale);
```

## Architecture

### Layer structure

Each RoostViewer panel currently contains an `<img>` and `<svg>`, absolutely positioned. The map overlay adds a `<canvas>` between them:

```
panel wrapper (absolute, 600×600)
  ├── <img>     radar image
  ├── <canvas>  map overlay (pointer-events: none)
  └── <svg>     bounding box overlays (interactive)
```

The canvas has `pointer-events: none` so mouse events pass through to the SVG layer for bbox hover/click interactions.

### Module structure

```
RoostViewer (js/RoostViewer.js)
  └── MapOverlay (js/MapOverlay.js)   ← new
```

**MapOverlay** is a small class that owns a `<canvas>` element and renders geographic features using a d3-geo path generator. RoostViewer creates one MapOverlay per panel when `mapConfig` is provided. The apps (vis.js, viewer.js) load the geographic data and pass it through RoostViewer's existing options/update interface.

This keeps RoostViewer's role unchanged (rendering engine, no data loading) while MapOverlay handles the projection math and canvas drawing.

### Data flow

```
App (vis.js or viewer.js)
  │
  ├── loads stations.json          → station lat/lon lookup
  ├── loads TopoJSON files         → converts to GeoJSON via topojson-client
  │
  └── creates RoostViewer({
        mapConfig: {
          lat, lon,                 ← from stations.json
          features: {               ← from TopoJSON
            states: GeoJSON,
            counties: GeoJSON,
            water: GeoJSON
          }
        }
      })
        │
        └── creates MapOverlay(canvas, mapConfig)
              │
              └── renders features via d3.geoPath(projection, canvasCtx)
```

## MapOverlay class

### Interface

```js
import { MapOverlay } from './MapOverlay.js';

// Create
const overlay = new MapOverlay(canvasElement, {
  lat: 41.413,
  lon: -81.860,
  features: {
    states: statesGeoJSON,       // FeatureCollection
    counties: countiesGeoJSON,   // FeatureCollection
    water: waterGeoJSON,         // FeatureCollection or null
  },
  showStates: true,
  showCounties: true,
  showWater: true,
});

// Update (e.g., toggle layers or change station)
overlay.update({ showCounties: false });
overlay.update({ lat: 44.907, lon: -84.720 });  // re-projects

// Destroy
overlay.destroy();
```

### Rendering

Layers are drawn in back-to-front order on the canvas:

1. **Water bodies** — blue fill (`rgba(64, 128, 200, 0.3)`), no stroke
2. **County boundaries** — gray stroke (`#808080`), 0.5px line width, no fill
3. **State boundaries** — white stroke (`#ffffff`), 1.5px line width, no fill

Canvas rendering is used instead of SVG because there are ~3,000 US county polygons. Canvas draws all paths in a single composited pass, while SVG would create thousands of DOM elements.

The map only re-renders when station coordinates or layer visibility change — not on every frame change. This means rendering cost is negligible during normal navigation.

### Clipping

The canvas naturally clips to its 600×600 bounds, so only features within the 150km range are visible. No explicit clipping circle is needed, though one could be added for aesthetic reasons (the radar image is square, but the actual radar coverage is circular).

## RoostViewer changes

### New option: `mapConfig`

```js
new RoostViewer(container, {
  // ...existing options...
  mapConfig: {                    // optional, default null
    lat: 41.413,                  // station latitude
    lon: -81.860,                 // station longitude
    features: {                   // GeoJSON FeatureCollections
      states: ...,
      counties: ...,
      water: ...,
    },
    showStates: true,             // toggle individual layers
    showCounties: true,
    showWater: true,
  }
});
```

When `mapConfig` is `null` (the default), no canvas is created and behavior is unchanged.

### update()

```js
// Toggle map on/off
viewer.update({ mapConfig: { ... } });   // enable
viewer.update({ mapConfig: null });       // disable (rebuilds panels)

// Toggle layers or change station
viewer.update({ mapConfig: { showCounties: false } });
viewer.update({ mapConfig: { lat: newLat, lon: newLon } });
```

When mapConfig transitions between null and non-null, panels are rebuilt (canvas added/removed). When mapConfig properties change within an existing config, the MapOverlay is updated in place.

## Data sources

### Station coordinates

Extracted from `~/darkecology/darkeco-dataset/data/meta/nexrad-stations.csv` into `data/stations.json`:

```json
{
  "KABR": { "lat": 45.455833, "lon": -98.413333 },
  "KABX": { "lat": 35.149722, "lon": -106.82388 },
  ...
}
```

~160 stations, <10KB.

### Geographic boundaries

Downloaded from public sources and stored in `data/geo/`:

| File | Source | Size (approx) | Content |
|------|--------|------|---------|
| `states-10m.json` | [us-atlas](https://github.com/topojson/us-atlas) | ~200KB | US state boundaries |
| `counties-10m.json` | us-atlas | ~600KB | US county boundaries |
| `lakes-10m.json` | [world-atlas](https://github.com/topojson/world-atlas) / Natural Earth | TBD | Major water bodies |

These are TopoJSON format (compact). Converted to GeoJSON at load time using `topojson-client`.

### New dependency

**`topojson-client`** (~2KB minified) — converts TopoJSON to GeoJSON. Imported statically so rollup can bundle it.

## App integration

### Annotation app (vis.js + index.html)

- Loads `data/stations.json` and `data/geo/*.json` at startup (non-blocking)
- Converts TopoJSON → GeoJSON via `topojson.feature()`
- Adds a map toggle checkbox to the controls area
- Extracts station code from scan filenames (first 4 characters)
- Passes `mapConfig` to RoostViewer; updates on toggle or station change

### Viewer app (viewer/viewer.js + viewer/index.html)

- Same data loading pattern
- Adds a "Map" toggle button alongside the existing DZ/VR buttons
- Station code available directly from the station dropdown
- Passes `mapConfig` to RoostViewer; updates on toggle or station change

## Prior art

The previous labeling tool (roost-label) used a similar approach:

- Pre-rendered transparent GIFs generated via MapServer (`shp2img`) from Census Bureau shapefiles
- Overlaid between radar image (z-index 0) and SVG annotations (z-index 3)
- Toggle via checkbox + 'M' keyboard shortcut
- Synchronized zoom/pan with radar image

The new approach replaces offline GIF generation with client-side d3-geo rendering, eliminating the MapServer dependency and enabling dynamic layer control.

## Future considerations

- **Opacity control**: A slider to adjust map overlay transparency
- **Additional layers**: Highways, city labels, radar range rings
- **Station marker**: Crosshair or dot at the radar center
- **Keyboard shortcut**: 'M' key to toggle map (matching roost-label convention)
