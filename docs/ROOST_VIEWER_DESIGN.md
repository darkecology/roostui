# RoostViewer Design

## Overview

`RoostViewer` is a vanilla JS class that renders radar scan images with SVG bounding-box overlays. It handles a single day's worth of data: a sequence of frames (radar scans) and the associated detection boxes grouped into tracks.

The viewer is a rendering core with no opinions about navigation UI, labeling, or filtering logic. Wrappers provide those concerns for each use case.

## Use Cases

### 1. Labeling app

Internal tool for annotating roost detections. Two images side by side (reflectivity and velocity). Navigation via time dropdown. Track selection, labeling (7 categories), filtering by score thresholds, CSV export. The annotation app wraps the viewer and owns all label/filter state.

### 2. Public viewer

Read-only viewer for a single station-day. Single image (reflectivity), with optional toggle to velocity. Navigation via scrubber or play button. No labeling or filtering.

## Architecture

```
RoostViewer              (vanilla JS class -- core)
+-- RoostViewerElement   (Web Component wrapper -- future)
+-- useRoostViewer       (React hook wrapper -- future)
+-- annotation app       (wraps viewer with labeling/filtering/export)
```

The viewer is framework-agnostic. A Web Component wrapper is trivial to add later (just lifecycle glue forwarding to the class). Same for a React hook via `useEffect` + ref.

## Class Interface

### Constructor

```js
const viewer = new RoostViewer(container, {
  // Data
  frames: [
    { filename: 'KCLE20200820_100000', imageUrls: { dz: '...', vr: '...' } },
    ...
  ],
  boxes: [
    { filename: '...', x, y, r, det_score, track_id },
    ...
  ],

  // Display
  imageKeys: ['dz'],              // or ['dz', 'vr'] for side-by-side
  formatBoxLabel: (box) => ...,   // returns string or null (no label)

  // Visual state (optional)
  selectedTrackId: null,
  filteredTrackIds: new Set(),

  // Callbacks (optional)
  onTrackHover: (trackId, boxes, rect) => {},
  onTrackClick: (trackId) => {},
  onFrameChange: (frameIndex) => {},
});
```

### Data inputs

- **`frames`** -- ordered array of objects, each with:
  - `filename`: scan filename (e.g. `'KCLE20200820_100000'`) -- used to map boxes to frames
  - `imageUrls`: object keyed by image type (e.g. `{ dz: url, vr: url }`)
- **`boxes`** -- flat array of plain objects, as they appear in the source CSV:
  - `filename` -- ties the box to a frame
  - `x`, `y`, `r` -- position and radius (image coordinates)
  - `det_score` -- detection confidence
  - `track_id` -- groups boxes into tracks

### Display config

- **`imageKeys`** -- which image layers to show. `['dz']` for single image, `['dz', 'vr']` for side-by-side. Can be changed via `update()` (e.g. toggle button).
- **`formatBoxLabel`** -- function `(box) => string | null` controlling the text rendered inside each box's SVG group. Return `null` to suppress labels entirely. Default: `(box) => box.track_id.split('-').pop() + ': ' + box.det_score` (matches current behavior). Examples:
  ```js
  // Labeling app: show track suffix and score
  formatBoxLabel: (box) => `${box.track_id.split('-').pop()}: ${box.det_score}`
  // Public viewer: no text
  formatBoxLabel: () => null
  ```

### Visual state (via `update()`)

- **`selectedTrackId`** -- highlight all boxes belonging to this track
- **`filteredTrackIds`** -- `Set` of track IDs to dim (reduced opacity)

### Navigation

```js
viewer.nextFrame()       // advance one frame
viewer.prevFrame()       // go back one frame
viewer.setFrame(index)   // jump to specific frame
viewer.getFrameIndex()   // current position (0-based)
viewer.getFrameCount()   // total frames for the day
```

### Query

```js
viewer.getTrackRect(trackId)  // DOMRect of the first matching bbox <g>, or null
```

Used by the wrapper for tooltip positioning during keyboard navigation (Tab/Shift-Tab), where there is no mouse event to provide coordinates.

The wrapper decides what UI drives these (arrow keys, dropdown, scrubber, play button). The viewer fires `onFrameChange(frameIndex)` after any navigation so the wrapper can update its UI.

### Callbacks

- **`onTrackHover(trackId, boxes, rect)`** -- mouse enters a box; receives the track ID, all boxes in that track, and the bounding `DOMRect` of the hovered SVG group (for tooltip positioning). `trackId` is `null` on mouse leave. The viewer does not render tooltips -- the wrapper uses this callback to show whatever tooltip is appropriate (labeling UI, simple info card, etc.).
- **`onTrackClick(trackId)`** -- a box is clicked.
- **`onFrameChange(frameIndex)`** -- the viewer moved to a new frame (via `nextFrame`, `prevFrame`, or `setFrame`).

### Updating and cleanup

```js
viewer.update({
  selectedTrackId: 'track-42',
  filteredTrackIds: new Set(['track-1', 'track-2']),
  imageKeys: ['vr'],       // switch to velocity
});

viewer.destroy();           // remove DOM, clean up listeners
```

`update()` accepts any subset of the options. To load a new day, construct a new viewer (or add a `setData()` method later if needed).

## Internal Responsibilities

**The viewer owns:**
- DOM setup: `<img>` elements + SVG overlays inside the container
- Grouping boxes by frame (by `filename`) for navigation
- Grouping boxes by `track_id` for color assignment
- Color scale (d3 ordinal scale with `schemeSet1`, or similar)
- SVG rendering: `<g>` per box containing `<rect>` + `<text>`, using D3 data-join or manual keyed update
- CSS classes for selected/filtered states
- Frame navigation state (current index)

**The viewer does NOT own:**
- Track summarization (avg_score, length, etc.)
- Filtering logic (which tracks to dim)
- Labeling (assigning categories to tracks)
- Tooltips (wrapper renders its own tooltip using `onTrackHover` + the provided `DOMRect`)
- Navigation UI (dropdowns, scrubbers, buttons, keyboard bindings)
- Data loading or URL construction
- Export

## Rendering Details

Each displayed image gets an `<img>` with an absolutely-positioned `<svg>` overlay of the same dimensions. For boxes in the current frame:

- Each box is a `<g class="bbox">` containing a `<rect>` (colored stroke, no fill) and a `<text>` label (abbreviated track ID + score)
- Box rect: centered at `(x, y)`, side length `2 * r * scale` (scale = 1.2)
- Color: assigned per track_id via `d3.scaleOrdinal` with `d3.schemeSet1`
- `.selected` class: orange fill, `fill-opacity: 0.7`
- `.filtered` class: reduced opacity

## Implementation Plan

### Step 1: Scaffold the class

Create `js/RoostViewer.js` with constructor, `update()`, `destroy()`, and navigation methods. Set up the DOM structure (container > image panels > img + svg pairs). No rendering yet.

### Step 2: Frame navigation

Index boxes by filename. Implement `setFrame()` to update image `src` attributes and store current frame index. Wire up `nextFrame()`, `prevFrame()`, `getFrameIndex()`, `getFrameCount()`.

### Step 3: SVG rendering

Group boxes by track_id, set up color scale. On each frame change, data-join (or keyed update) the current frame's boxes into the SVG overlays. Render `<rect>` + `<text>` per box.

### Step 4: Visual state

Implement `selectedTrackId` and `filteredTrackIds`. Apply `.selected` and `.filtered` CSS classes. Handle updates via `update()`.

### Step 5: Interaction and callbacks

Add mouseenter/mouseleave/click handlers on box groups. Fire `onTrackHover`, `onTrackClick`, `onFrameChange`.

### Step 6: Integrate with existing app

Refactor `vis.js` to use `RoostViewer` instead of inline rendering. The existing app becomes the first wrapper, driving navigation and labeling externally.

### Step 7: Web Component wrapper (optional)

Thin `RoostViewerElement` extending `HTMLElement`, forwarding properties to the underlying `RoostViewer` instance.
