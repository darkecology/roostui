import * as d3 from 'd3';
import { MapOverlay } from './MapOverlay.js';

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
.roost-viewer .rv-location-tooltip {
	position: absolute; z-index: 100; pointer-events: none;
	background: rgba(0,0,0,0.85); color: #fff; font: 12px/1.4 monospace;
	padding: 6px 10px; border-radius: 4px; white-space: nowrap;
}
.roost-viewer .rv-location-tooltip a { color: #6cf; pointer-events: auto; }
.roost-viewer .rv-location-marker {
	position: absolute; z-index: 99; pointer-events: none;
	width: 12px; height: 12px; margin-left: -6px; margin-top: -6px;
}
.roost-viewer .rv-station-label {
	position: absolute; z-index: 10; bottom: 4px; left: 4px; pointer-events: auto;
	background: rgba(0,0,0,0.55); color: rgba(255,255,255,0.85); font: 11px/1.3 sans-serif;
	padding: 2px 6px; border-radius: 3px; cursor: default;
}
.roost-viewer .rv-sunrise-label {
	position: absolute; z-index: 10; bottom: 4px; right: 4px;
	background: rgba(0,0,0,0.55); color: rgba(255,255,255,0.85); font: 11px/1.3 sans-serif;
	padding: 2px 6px; border-radius: 3px;
}
.roost-viewer .rv-location-marker::before,
.roost-viewer .rv-location-marker::after {
	content: ''; position: absolute; background: #f44;
}
.roost-viewer .rv-location-marker::before {
	width: 2px; height: 100%; left: 5px; top: 0;
}
.roost-viewer .rv-location-marker::after {
	width: 100%; height: 2px; top: 5px; left: 0;
}
.roost-viewer > div + div { border-left: 1px solid #555; }
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
			mapConfig: null,
			stationInfo: null,
			formatBoxLabel: (box) => box.track_id.split('-').pop() + ': ' + box.det_score,
			selectedTrackId: null,
			filteredTrackIds: new Set(),
			onTrackHover: () => {},
			onTrackClick: () => {},
			onFrameChange: () => {},
		}, options);

		this._frameIndex = 0;
		this._mapVisible = options.mapVisible !== undefined ? options.mapVisible : true;
		this._panels = [];      // [{ img, svg, content }]
		this._locationTooltip = null;
		this._locationMarker = null;
		this._dismissTooltip = this._dismissLocationTooltip.bind(this);
		this._zoomTransform = d3.zoomIdentity;
		this._zoomBehavior = null;

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
			if (panel.mapOverlay) panel.mapOverlay.destroy();
			panel.wrapper.remove();
		}
		this._panels = [];
		this._zoomTransform = d3.zoomIdentity;

		var keys = this._options.imageKeys;
		var mapConfig = this._options.mapConfig;
		var self = this;

		// Create zoom behavior (shared across panels)
		this._zoomBehavior = d3.zoom()
			.scaleExtent([1, 8])
			.translateExtent([[0, 0], [PANEL_SIZE, PANEL_SIZE]])
			.filter(function(event) {
				// Allow wheel zoom everywhere
				if (event.type === 'wheel') return true;
				// Only allow left-button drag, and not on bbox elements
				if (event.button) return false;
				return !event.target.closest('.bbox');
			})
			.on('zoom', function(event) {
				self._zoomTransform = event.transform;
				var css = 'translate(' + event.transform.x + 'px,' + event.transform.y + 'px) scale(' + event.transform.k + ')';
				for (var p of self._panels) {
					p.content.style.transform = css;
				}
			});

		for (var i = 0; i < keys.length; i++) {
			var wrapper = document.createElement('div');
			wrapper.style.position = 'absolute';
			wrapper.style.left = (i * PANEL_SIZE) + 'px';
			wrapper.style.top = '0px';
			wrapper.style.width = PANEL_SIZE + 'px';
			wrapper.style.height = PANEL_SIZE + 'px';
			wrapper.style.overflow = 'hidden';

			// Content div for pan/zoom transforms
			var content = document.createElement('div');
			content.style.transformOrigin = '0 0';
			content.style.width = PANEL_SIZE + 'px';
			content.style.height = PANEL_SIZE + 'px';

			var img = document.createElement('img');
			img.style.position = 'absolute';
			img.style.left = '0px';
			img.style.top = '0px';
			img.style.width = PANEL_SIZE + 'px';
			img.style.height = PANEL_SIZE + 'px';

			content.appendChild(img);

			// Map overlay canvas (between img and svg)
			var canvas = null;
			var mapOverlay = null;
			if (mapConfig) {
				canvas = document.createElement('canvas');
				canvas.width = PANEL_SIZE;
				canvas.height = PANEL_SIZE;
				canvas.style.position = 'absolute';
				canvas.style.left = '0px';
				canvas.style.top = '0px';
				canvas.style.pointerEvents = 'none';
				if (!this._mapVisible) canvas.style.display = 'none';
				content.appendChild(canvas);
				mapOverlay = new MapOverlay(canvas, mapConfig);
			}

			var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('width', PANEL_SIZE);
			svg.setAttribute('height', PANEL_SIZE);
			svg.style.position = 'absolute';
			svg.style.left = '0px';
			svg.style.top = '0px';

			content.appendChild(svg);
			wrapper.appendChild(content);
			this._container.appendChild(wrapper);

			// Attach zoom behavior to wrapper
			d3.select(wrapper).call(this._zoomBehavior)
				.on('dblclick.zoom', function() {
					// Double-click resets zoom
					self.resetZoom();
				});

			var panelObj = { wrapper: wrapper, content: content, img: img, canvas: canvas, mapOverlay: mapOverlay, svg: svg, key: keys[i] };
			this._panels.push(panelObj);

			(function(p) {
				wrapper.addEventListener('contextmenu', function(e) {
					self._showLocationTooltip(e, p);
				});
			})(panelObj);
		}

		// Station label overlay (on first panel)
		this._stationLabel = null;
		this._updateStationLabel();

		// Sunrise label overlay (on last panel, bottom-right)
		this._sunriseLabel = null;

		// Set container dimensions to fit all panels
		this._container.style.width = (keys.length * PANEL_SIZE) + 'px';
		this._container.style.height = PANEL_SIZE + 'px';
	}

	_titleCase(s) {
		return s.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); })
			.replace(/\bAfb\b/g, 'AFB');
	}

	_updateStationLabel() {
		if (this._stationLabel) {
			this._stationLabel.remove();
			this._stationLabel = null;
		}
		var info = this._options.stationInfo;
		if (!info || !this._panels.length) return;

		var code = info.code || '';
		var name = info.name ? this._titleCase(info.name) : '';
		var label = code + (name ? ' \u2014 ' + name : '') + (info.st ? ', ' + info.st : '');

		var el = document.createElement('div');
		el.className = 'rv-station-label';
		el.textContent = label;

		var lines = [];
		if (info.county) lines.push('County: ' + this._titleCase(info.county));
		if (info.country) lines.push('Country: ' + this._titleCase(info.country));
		if (info.elev != null) lines.push('Elevation: ' + info.elev + ' ft');
		if (info.lat != null && info.lon != null) {
			lines.push('Location: ' + info.lat.toFixed(4) + '\u00B0, ' + info.lon.toFixed(4) + '\u00B0');
		}
		if (info.tz) lines.push('Timezone: ' + info.tz);
		if (lines.length) el.title = lines.join('\n');

		this._panels[0].wrapper.appendChild(el);
		this._stationLabel = el;
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
		this._updateSunriseLabel(frame.sunriseLabel || '');
	}

	_updateSunriseLabel(text) {
		if (!text) {
			if (this._sunriseLabel) {
				this._sunriseLabel.remove();
				this._sunriseLabel = null;
			}
			return;
		}
		if (!this._panels.length) return;
		var lastPanel = this._panels[this._panels.length - 1];
		if (!this._sunriseLabel) {
			this._sunriseLabel = document.createElement('div');
			this._sunriseLabel.className = 'rv-sunrise-label';
			lastPanel.wrapper.appendChild(this._sunriseLabel);
		}
		this._sunriseLabel.textContent = text;
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

	resetZoom() {
		this._zoomTransform = d3.zoomIdentity;
		for (var panel of this._panels) {
			d3.select(panel.wrapper).call(this._zoomBehavior.transform, d3.zoomIdentity);
		}
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

		// Detect mapConfig added or removed (need to rebuild panels for canvas element)
		var mapConfigChanged = options.mapConfig !== undefined;
		var hadMap = !!this._options.mapConfig;
		var willHaveMap = mapConfigChanged ? !!options.mapConfig : hadMap;
		if (mapConfigChanged && hadMap !== willHaveMap) {
			rebuildPanels = true;
		}

		// Track mapVisible separately from options
		if (options.mapVisible !== undefined) {
			this._mapVisible = options.mapVisible;
			delete options.mapVisible;
		}

		// Merge options
		Object.assign(this._options, options);

		if (rebuildPanels) {
			this._buildPanels();
			this.setFrame(this._frameIndex);
		} else {
			// Update existing map overlays if mapConfig changed but panels didn't rebuild
			if (mapConfigChanged && this._options.mapConfig) {
				for (var panel of this._panels) {
					if (panel.mapOverlay) {
						panel.mapOverlay.update(this._options.mapConfig);
					}
				}
			}
			// Update canvas visibility
			for (var panel of this._panels) {
				if (panel.canvas) {
					panel.canvas.style.display = this._mapVisible ? '' : 'none';
				}
			}
			// Update station label if stationInfo changed
			if (options.stationInfo !== undefined) {
				this._updateStationLabel();
			}
			this._renderBoxes();
		}
	}

	/* -----------------------------------------
	 * Location tooltip (right-click)
	 * ---------------------------------------- */

	_showLocationTooltip(e, panel) {
		e.preventDefault();
		this._dismissLocationTooltip();

		var rect = panel.wrapper.getBoundingClientRect();
		var screenX = e.clientX - rect.left;
		var screenY = e.clientY - rect.top;

		// Invert zoom transform to get image-space coordinates
		var imgCoords = this._zoomTransform.invert([screenX, screenY]);
		var px = imgCoords[0];
		var py = imgCoords[1];

		// Pixel-to-km: 600px = 300km diameter, so 1px = 0.5km
		var xKm = (px - 300) * 0.5;
		var yKm = (300 - py) * 0.5;
		var dist = Math.sqrt(xKm * xKm + yKm * yKm);

		var lines = [];
		lines.push(dist.toFixed(1) + ' km from radar');
		lines.push('x, y: ' + xKm.toFixed(1) + ', ' + yKm.toFixed(1));
		if (panel.mapOverlay) {
			var lonlat = panel.mapOverlay.invert(px, py);
			var lat = lonlat[1];
			var lon = lonlat[0];
			var latStr = Math.abs(lat).toFixed(4) + '\u00B0' + (lat >= 0 ? 'N' : 'S');
			var lonStr = Math.abs(lon).toFixed(4) + '\u00B0' + (lon >= 0 ? 'E' : 'W');
			lines.push(latStr + ', ' + lonStr);
			var mapsUrl = 'https://www.google.com/maps?q=' + lat.toFixed(6) + ',' + lon.toFixed(6);
			lines.push('<a href="' + mapsUrl + '" target="_blank" rel="noopener">Google Maps</a>');
		}

		// Crosshair marker at click point (screen coords)
		var panelLeft = parseInt(panel.wrapper.style.left, 10) || 0;
		var marker = document.createElement('div');
		marker.className = 'rv-location-marker';
		marker.style.left = (panelLeft + screenX) + 'px';
		marker.style.top = screenY + 'px';
		this._container.appendChild(marker);
		this._locationMarker = marker;

		// Tooltip (screen coords)
		var tooltip = document.createElement('div');
		tooltip.className = 'rv-location-tooltip';
		tooltip.innerHTML = lines.join('<br>');
		tooltip.style.left = (panelLeft + screenX + 12) + 'px';
		tooltip.style.top = (screenY + 12) + 'px';

		this._container.appendChild(tooltip);
		this._locationTooltip = tooltip;

		document.addEventListener('click', this._dismissTooltip, true);
		document.addEventListener('contextmenu', this._dismissTooltip, true);
	}

	_dismissLocationTooltip() {
		if (this._locationTooltip) {
			this._locationTooltip.remove();
			this._locationTooltip = null;
		}
		if (this._locationMarker) {
			this._locationMarker.remove();
			this._locationMarker = null;
		}
		document.removeEventListener('click', this._dismissTooltip, true);
		document.removeEventListener('contextmenu', this._dismissTooltip, true);
	}

	/* -----------------------------------------
	 * Cleanup
	 * ---------------------------------------- */

	destroy() {
		this._dismissLocationTooltip();
		// Remove panels
		for (var panel of this._panels) {
			if (panel.mapOverlay) panel.mapOverlay.destroy();
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
