import * as d3 from 'd3';

/* -----------------------------------------
 * Shared style injection (ref-counted)
 * ---------------------------------------- */

let _styleRefCount = 0;
let _styleEl = null;

const VIEWER_CSS = `
.roost-viewer .bbox > rect { stroke-width: 3; pointer-events: all; }
.roost-viewer .bbox > text { stroke: #fff; fill: #fff; }
.roost-viewer .bbox.selected > rect { fill: orange; fill-opacity: 0.7; }
.roost-viewer .bbox.filtered { opacity: 0.45; }
.roost-viewer .bbox.filtered.selected { opacity: 0.7; }
`;

function injectStyle() {
	if (_styleRefCount === 0) {
		_styleEl = document.createElement('style');
		_styleEl.textContent = VIEWER_CSS;
		document.head.appendChild(_styleEl);
	}
	_styleRefCount++;
}

function removeStyle() {
	_styleRefCount--;
	if (_styleRefCount === 0 && _styleEl) {
		_styleEl.remove();
		_styleEl = null;
	}
}

/* -----------------------------------------
 * RoostViewer
 * ---------------------------------------- */

const PANEL_SIZE = 600;
const BOX_SCALE = 1.2;

export class RoostViewer {

	/**
	 * @param {HTMLElement} container
	 * @param {object} options
	 * @param {Array} options.frames - [{ imageUrls: { dz: url, vr: url }, time }]
	 * @param {Array} options.boxes  - [{ filename, x, y, r, det_score, track_id }]
	 * @param {string[]} [options.imageKeys] - ['dz', 'vr']
	 * @param {function} [options.formatBoxLabel]
	 * @param {string|null} [options.selectedTrackId]
	 * @param {Set} [options.filteredTrackIds]
	 * @param {function} [options.onTrackHover]
	 * @param {function} [options.onTrackClick]
	 * @param {function} [options.onFrameChange]
	 */
	constructor(container, options) {
		this._container = container;
		this._options = Object.assign({
			frames: [],
			boxes: [],
			imageKeys: ['dz', 'vr'],
			formatBoxLabel: (box) => box.track_id.split('-').pop() + ': ' + box.det_score,
			selectedTrackId: null,
			filteredTrackIds: new Set(),
			onTrackHover: () => {},
			onTrackClick: () => {},
			onFrameChange: () => {},
		}, options);

		this._frameIndex = 0;
		this._panels = [];      // [{ img, svg }]

		// Index data
		this._indexData();

		// DOM setup
		this._container.classList.add('roost-viewer');
		this._container.style.position = 'relative';
		this._buildPanels();
		injectStyle();

		// Render initial frame (images + boxes, but no callback)
		if (this._options.frames.length > 0) {
			this._applyFrame(0);
		}
	}

	/* -----------------------------------------
	 * Data indexing
	 * ---------------------------------------- */

	_indexData() {
		var boxes = this._options.boxes;
		var frames = this._options.frames;

		// Map filename -> frame index for quick lookup
		this._filenameToFrameIndex = new Map();
		for (var i = 0; i < frames.length; i++) {
			if (frames[i].filename) {
				this._filenameToFrameIndex.set(frames[i].filename.trim(), i);
			}
		}

		// Group boxes by frame filename
		this._boxesByFilename = new Map();
		for (var box of boxes) {
			var fn = box.filename.trim();
			if (!this._boxesByFilename.has(fn)) {
				this._boxesByFilename.set(fn, []);
			}
			this._boxesByFilename.get(fn).push(box);
		}

		// Collect unique track_ids for stable color assignment
		var trackIdSet = new Set();
		for (var box of boxes) {
			trackIdSet.add(box.track_id);
		}
		this._trackIds = Array.from(trackIdSet);

		// Build color scale once so colors are stable across frames
		this._colorScale = d3.scaleOrdinal()
			.domain(this._trackIds)
			.range(d3.schemeSet1);
	}

	/* -----------------------------------------
	 * DOM construction
	 * ---------------------------------------- */

	_buildPanels() {
		// Remove existing panels
		for (var panel of this._panels) {
			panel.wrapper.remove();
		}
		this._panels = [];

		var keys = this._options.imageKeys;
		for (var i = 0; i < keys.length; i++) {
			var wrapper = document.createElement('div');
			wrapper.style.position = 'absolute';
			wrapper.style.left = (i * PANEL_SIZE) + 'px';
			wrapper.style.top = '0px';
			wrapper.style.width = PANEL_SIZE + 'px';
			wrapper.style.height = PANEL_SIZE + 'px';

			var img = document.createElement('img');
			img.style.position = 'absolute';
			img.style.left = '0px';
			img.style.top = '0px';
			img.style.width = PANEL_SIZE + 'px';
			img.style.height = PANEL_SIZE + 'px';

			var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('width', PANEL_SIZE);
			svg.setAttribute('height', PANEL_SIZE);
			svg.style.position = 'absolute';
			svg.style.left = '0px';
			svg.style.top = '0px';

			wrapper.appendChild(img);
			wrapper.appendChild(svg);
			this._container.appendChild(wrapper);

			this._panels.push({ wrapper: wrapper, img: img, svg: svg, key: keys[i] });
		}

		// Set container dimensions to fit all panels
		this._container.style.width = (keys.length * PANEL_SIZE) + 'px';
		this._container.style.height = PANEL_SIZE + 'px';
	}

	/* -----------------------------------------
	 * Frame navigation
	 * ---------------------------------------- */

	setFrame(index) {
		this._applyFrame(index);
		this._options.onFrameChange(this._frameIndex);
	}

	_applyFrame(index) {
		var frames = this._options.frames;
		if (frames.length === 0) return;

		// Clamp
		index = Math.max(0, Math.min(index, frames.length - 1));
		this._frameIndex = index;

		var frame = frames[index];

		// Update image sources
		for (var panel of this._panels) {
			if (frame.imageUrls && frame.imageUrls[panel.key]) {
				panel.img.src = frame.imageUrls[panel.key];
			} else {
				panel.img.src = '';
			}
		}

		this._renderBoxes();
	}

	nextFrame() {
		if (this._frameIndex < this._options.frames.length - 1) {
			this.setFrame(this._frameIndex + 1);
		}
	}

	prevFrame() {
		if (this._frameIndex > 0) {
			this.setFrame(this._frameIndex - 1);
		}
	}

	getFrameIndex() {
		return this._frameIndex;
	}

	getFrameCount() {
		return this._options.frames.length;
	}

	/* -----------------------------------------
	 * SVG rendering (private)
	 * ---------------------------------------- */

	_renderBoxes() {
		var frames = this._options.frames;
		if (frames.length === 0) return;

		var frame = frames[this._frameIndex];
		var filename = (frame.filename || '').trim();
		var boxes = this._boxesByFilename.get(filename) || [];
		var colorScale = this._colorScale;
		var formatLabel = this._options.formatBoxLabel;
		var selectedId = this._options.selectedTrackId;
		var filteredIds = this._options.filteredTrackIds;
		var self = this;

		for (var panel of this._panels) {
			var svg = d3.select(panel.svg);

			var groups = svg.selectAll('g')
				.data(boxes, function(d) { return d.track_id; });

			groups.exit().remove();

			// Enter
			var entering = groups.enter()
				.append('g')
				.attr('class', 'bbox');
			entering.append('rect');
			entering.append('text');

			// Event listeners on entering groups
			entering
				.on('mouseenter', function(e, d) {
					var trackBoxes = self._getBoxesForTrack(d.track_id);
					self._options.onTrackHover(d.track_id, trackBoxes, this.getBoundingClientRect());
				})
				.on('mouseleave', function() {
					self._options.onTrackHover(null, null, null);
				})
				.on('click', function(e, d) {
					self._options.onTrackClick(d.track_id);
				});

			// Merge
			groups = entering.merge(groups);

			// Update rect attributes
			groups.select('rect')
				.attr('x', function(b) { return b.x - BOX_SCALE * b.r; })
				.attr('y', function(b) { return b.y - BOX_SCALE * b.r; })
				.attr('width', function(b) { return 2 * BOX_SCALE * b.r; })
				.attr('height', function(b) { return 2 * BOX_SCALE * b.r; })
				.attr('stroke', function(d) { return colorScale(d.track_id); })
				.attr('fill', 'none');

			// Update text
			groups.select('text')
				.attr('x', function(b) { return b.x - BOX_SCALE * b.r + 5; })
				.attr('y', function(b) { return b.y - BOX_SCALE * b.r - 5; })
				.text(function(b) {
					var label = formatLabel(b);
					return label != null ? label : '';
				});

			// Apply visual state classes
			groups.classed('filtered', function(d) {
				return filteredIds && filteredIds.has(d.track_id);
			});
			groups.classed('selected', function(d) {
				return d.track_id === selectedId;
			});
		}
	}

	_getBoxesForTrack(trackId) {
		var boxes = this._options.boxes;
		var result = [];
		for (var b of boxes) {
			if (b.track_id === trackId) result.push(b);
		}
		return result;
	}

	/* -----------------------------------------
	 * Query
	 * ---------------------------------------- */

	getTrackRect(trackId) {
		for (var panel of this._panels) {
			var groups = panel.svg.querySelectorAll('g.bbox');
			for (var g of groups) {
				if (g.__data__ && g.__data__.track_id === trackId) {
					return g.getBoundingClientRect();
				}
			}
		}
		return null;
	}

	/* -----------------------------------------
	 * Visual state update
	 * ---------------------------------------- */

	update(options) {
		var rebuildPanels = false;

		if (options.imageKeys !== undefined &&
			JSON.stringify(options.imageKeys) !== JSON.stringify(this._options.imageKeys)) {
			rebuildPanels = true;
		}

		// Merge options
		Object.assign(this._options, options);

		if (rebuildPanels) {
			this._buildPanels();
			this.setFrame(this._frameIndex);
		} else {
			this._renderBoxes();
		}
	}

	/* -----------------------------------------
	 * Cleanup
	 * ---------------------------------------- */

	destroy() {
		// Remove panels
		for (var panel of this._panels) {
			panel.wrapper.remove();
		}
		this._panels = [];

		// Remove viewer class
		this._container.classList.remove('roost-viewer');
		this._container.style.position = '';
		this._container.style.width = '';
		this._container.style.height = '';

		// Ref-counted style removal
		removeStyle();
	}
}
