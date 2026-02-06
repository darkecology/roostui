import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import tippy from 'tippy.js';
import { RoostViewer } from '../js/RoostViewer.js';

// --- Config ---

var DATASET = 'all_stations_v3';
var DATA_BASE = '../data/' + DATASET + '/';
var IMG_BASE = 'http://doppler.cs.umass.edu/roost/img/' + DATASET;

// --- Parsed batch index ---

var stations = [];                // sorted unique station codes
var yearsByStation = {};          // { KAPX: [2000, 2001, ...] }
var batchLookup = {};             // { KAPX: { 2000: 'KAPX_20000601_20001231' } }

// --- Cached batch data ---

var currentScans = null;          // Map<localDate, [{filename, local_time}]>
var currentBoxes = null;          // all boxes for the loaded batch
var currentBoxesByDay = null;     // Map<localDate, [boxes]>
var availableDays = [];           // sorted day keys from scans

// --- Viewer state ---

var viewer = null;
var currentFrames = null;         // frames array for current day
var currentTip = null;
var hideTimeout = null;

function cancelHide() {
	if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
}

function destroyTip() {
	cancelHide();
	if (currentTip) { currentTip.destroy(); currentTip = null; }
}

function scheduleHide() {
	cancelHide();
	hideTimeout = setTimeout(destroyTip, 100);
}

// --- DOM refs ---

var stationSel = document.getElementById('stationSel');
var yearSel = document.getElementById('yearSel');
var daySel = document.getElementById('daySel');
var showDZ = document.getElementById('showDZ');
var showVR = document.getElementById('showVR');
var currentImageKey = 'dz';
var prevBtn = document.getElementById('prevBtn');
var nextBtn = document.getElementById('nextBtn');
var frameInfo = document.getElementById('frameInfo');
var viewerEl = document.getElementById('viewer');
var viewerWrap = document.getElementById('viewerWrap');
var filterToggle = document.getElementById('filterToggle');
var filterPanel = document.getElementById('filterPanel');
var filterInputs = {
	detections_min: document.getElementById('detections_min'),
	high_quality_detections_min: document.getElementById('high_quality_detections_min'),
	score_min: document.getElementById('score_min'),
	avg_score_min: document.getElementById('avg_score_min'),
};
var filteredOpacity = document.getElementById('filtered_opacity');
var filteredOpacityLabel = document.getElementById('filtered_opacity_label');
var showMap = document.getElementById('showMap');

// --- Geo data state ---

var stationCoords = null;
var geoFeatures = null;
var mapEnabled = true;

// --- Track summaries (computed per batch) ---

var trackSummaries = new Map();  // trackId -> { length, avg_score }

// --- Hash navigation ---

function parseHash() {
	var obj = {};
	var str = window.location.hash.substring(1);
	if (!str) return obj;
	var parts = str.split('&');
	for (var i = 0; i < parts.length; i++) {
		var kv = parts[i].split('=');
		if (kv.length === 2 && kv[0] && kv[1]) obj[kv[0]] = kv[1];
	}
	return obj;
}

function updateHash() {
	var state = {
		station: stationSel.value,
		year: yearSel.value,
		day: daySel.value,
	};
	if (viewer) state.frame = viewer.getFrameIndex();
	var str = Object.keys(state).map(function(k) { return k + '=' + state[k]; }).join('&');
	var url = window.location.href.replace(window.location.hash, '');
	history.replaceState({}, '', url + '#' + str);
}

var pendingNav = null;  // {day, frame} to apply after batch loads

// --- Helpers ---

function imageUrls(filename) {
	var station = filename.substring(0, 4);
	var year = filename.substring(4, 8);
	var month = filename.substring(8, 10);
	var day = filename.substring(10, 12);
	return {
		dz: IMG_BASE + '/dz05/' + year + '/' + month + '/' + day + '/' + station + '/' + filename + '.png',
		vr: IMG_BASE + '/vr05/' + year + '/' + month + '/' + day + '/' + station + '/' + filename + '.png',
	};
}

function formatDayLabel(yyyymmdd) {
	var m = parseInt(yyyymmdd.substring(4, 6), 10) - 1;
	var d = parseInt(yyyymmdd.substring(6, 8), 10);
	var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return months[m] + ' ' + d;
}

function setOptions(sel, items) {
	sel.innerHTML = '';
	for (var i = 0; i < items.length; i++) {
		var opt = document.createElement('option');
		opt.value = items[i].value;
		opt.textContent = items[i].label;
		sel.appendChild(opt);
	}
}

function destroyViewer() {
	destroyTip();
	if (viewer) {
		viewer.destroy();
		viewer = null;
		currentFrames = null;
	}
	frameInfo.textContent = 'Frame -- / --';
}

function buildTrackSummaries(boxes) {
	trackSummaries = new Map();
	var grouped = d3.group(boxes, function(d) { return d.track_id; });
	for (var entry of grouped) {
		var id = entry[0];
		var trackBoxes = entry[1];
		var sum = 0;
		for (var i = 0; i < trackBoxes.length; i++) sum += trackBoxes[i].det_score;
		trackSummaries.set(id, {
			length: trackBoxes.length,
			avg_score: sum / trackBoxes.length,
		});
	}
}

function getFilterSettings() {
	return {
		detections_min: +filterInputs.detections_min.value,
		high_quality_detections_min: +filterInputs.high_quality_detections_min.value,
		score_min: +filterInputs.score_min.value,
		avg_score_min: +filterInputs.avg_score_min.value,
	};
}

function buildFilteredTrackIds() {
	var settings = getFilterSettings();
	var filtered = new Set();

	// Count high-quality detections per track
	var hqCounts = d3.rollup(currentBoxes, function(v) {
		return v.filter(function(d) { return d.det_score >= settings.score_min; }).length;
	}, function(d) { return d.track_id; });

	for (var entry of trackSummaries) {
		var id = entry[0];
		var t = entry[1];
		if (t.length < settings.detections_min ||
			(hqCounts.get(id) || 0) < settings.high_quality_detections_min ||
			t.avg_score < settings.avg_score_min) {
			filtered.add(id);
		}
	}
	return filtered;
}

function onFilterChange() {
	if (viewer) {
		viewer.update({ filteredTrackIds: buildFilteredTrackIds() });
	}
}

function buildTooltipContent(trackId, box, trackBoxes) {
	var div = document.createElement('div');
	div.style.fontSize = '12px';
	div.innerHTML =
		'<div><b>Roost ' + trackId.split('-').pop() + '</b> (' + trackBoxes.length + ' detections)</div>' +
		'<div>score: ' + (box ? box.det_score.toFixed(3) : '--') + '</div>' +
		(box && box.lat ? '<div>lat/lon: ' + box.lat.toFixed(2) + ', ' + box.lon.toFixed(2) + '</div>' : '');
	if (box && box.lat) {
		var a = document.createElement('a');
		a.textContent = 'View on map';
		a.href = '#';
		a.style.color = '#6cf';
		a.onclick = function(e) {
			e.preventDefault();
			var ll = box.lat + ',' + box.lon;
			window.open('https://maps.google.com/?q=' + ll + '&ll=' + ll + '&z=8');
		};
		div.appendChild(a);
	}
	return div;
}

// --- Map overlay ---

function buildMapConfig() {
	if (!mapEnabled || !geoFeatures || !stationCoords) return null;
	var code = stationSel.value;
	if (!code || !stationCoords[code]) return null;
	var coords = stationCoords[code];
	return {
		lat: coords.lat,
		lon: coords.lon,
		features: geoFeatures,
	};
}

function loadGeoData() {
	return Promise.all([
		d3.json('../data/stations.json'),
		d3.json('../data/geo/states-10m.json'),
		d3.json('../data/geo/counties-10m.json'),
		d3.json('../data/geo/lakes.json'),
		d3.json('../data/geo/land-110m.json'),
	]).then(function(results) {
		stationCoords = results[0];
		var statesTopo = results[1];
		var countiesTopo = results[2];
		var lakesGeo = results[3];
		var landTopo = results[4];
		geoFeatures = {
			land: topojson.feature(landTopo, landTopo.objects.land),
			nation: topojson.feature(statesTopo, statesTopo.objects.nation),
			states: topojson.mesh(statesTopo, statesTopo.objects.states, function(a, b) { return a !== b; }),
			counties: topojson.mesh(countiesTopo, countiesTopo.objects.counties, function(a, b) { return a !== b; }),
			lakes: lakesGeo,
		};
		// If the viewer was created before geo data loaded, push the map config now
		if (viewer) viewer.update({ mapConfig: buildMapConfig() });
	}).catch(function(err) {
		console.warn('Failed to load geo data (map overlay disabled):', err);
	});
}

// --- Day navigation ---

function prevDay() {
	var idx = availableDays.indexOf(daySel.value);
	if (idx > 0) {
		daySel.value = availableDays[idx - 1];
		onDayChange();
	}
}

function nextDay() {
	var idx = availableDays.indexOf(daySel.value);
	if (idx < availableDays.length - 1) {
		daySel.value = availableDays[idx + 1];
		onDayChange();
	}
}

// --- Batch index loading ---

function parseBatches(text) {
	var lines = text.trim().split('\n');
	var stationSet = {};
	for (var i = 0; i < lines.length; i++) {
		var batch = lines[i].trim();
		if (!batch) continue;
		var station = batch.substring(0, 4);
		var year = parseInt(batch.substring(5, 9), 10);
		stationSet[station] = true;
		if (!yearsByStation[station]) yearsByStation[station] = [];
		yearsByStation[station].push(year);
		if (!batchLookup[station]) batchLookup[station] = {};
		batchLookup[station][year] = batch;
	}
	stations = Object.keys(stationSet).sort();
}

// --- Data loading ---

function loadBatch(station, year) {
	var batch = batchLookup[station][year];
	var scansUrl = DATA_BASE + 'scans_' + batch + '.txt';
	var tracksUrl = DATA_BASE + 'tracks_' + batch + '.txt';

	// Show loading state
	daySel.disabled = true;
	setOptions(daySel, [{ value: '', label: 'Loading...' }]);
	destroyViewer();

	return Promise.all([d3.csv(scansUrl), d3.csv(tracksUrl)])
		.then(function(results) {
			var scansRaw = results[0];
			var tracksRaw = results[1];

			// Parse scans: group by local_date
			currentScans = d3.group(scansRaw, function(d) {
				return d.local_time.substring(0, 8);
			});

			// Parse tracks/boxes
			currentBoxes = tracksRaw.map(function(d) {
				var localDate = d.local_time.substring(0, 8);
				var trackId = d.track_id;
				if (trackId.length < 13) {
					trackId = station + localDate + '-' + trackId;
				}
				return {
					filename: d.filename,
					x: parseFloat(d.x),
					y: parseFloat(d.y),
					r: parseFloat(d.r),
					det_score: parseFloat(d.det_score),
					lat: parseFloat(d.lat),
					lon: parseFloat(d.lon),
					track_id: trackId,
					local_date: localDate,
				};
			});

			currentBoxesByDay = d3.group(currentBoxes, function(d) { return d.local_date; });
			buildTrackSummaries(currentBoxes);

			// Build sorted day list from scans
			availableDays = Array.from(currentScans.keys()).sort();

			// Populate day dropdown
			setOptions(daySel, availableDays.map(function(day) {
				return { value: day, label: formatDayLabel(day) };
			}));
			daySel.disabled = false;

			// Select day from pending nav or default to first
			var targetDay = null;
			var targetFrame = undefined;
			if (pendingNav) {
				targetDay = pendingNav.day;
				targetFrame = pendingNav.frame;
				pendingNav = null;
			}
			if (availableDays.length > 0) {
				if (targetDay && availableDays.indexOf(targetDay) >= 0) {
					daySel.value = targetDay;
				} else {
					daySel.value = availableDays[0];
				}
				onDayChange(targetFrame);
			}
		})
		.catch(function(err) {
			console.error('Error loading batch:', err);
			setOptions(daySel, [{ value: '', label: '(error)' }]);
			daySel.disabled = true;
		});
}

// --- Viewer creation ---

function onDayChange(targetFrame) {
	var day = daySel.value;
	if (!day || !currentScans) return;

	destroyViewer();

	var scans = currentScans.get(day) || [];
	var boxes = currentBoxesByDay.get(day) || [];

	currentFrames = scans.map(function(scan) {
		// Format time from local_time: "20200820_063020" -> "06:30:20"
		var t = scan.local_time.substring(9);
		var time = t.substring(0, 2) + ':' + t.substring(2, 4) + ':' + t.substring(4, 6);
		return {
			filename: scan.filename,
			time: time,
			imageUrls: imageUrls(scan.filename),
		};
	});

	var imageKey = currentImageKey;

	viewer = new RoostViewer(viewerEl, {
		frames: currentFrames,
		boxes: boxes,
		imageKeys: [imageKey],
		mapConfig: buildMapConfig(),
		filteredTrackIds: buildFilteredTrackIds(),
		onFrameChange: function(i) {
			frameInfo.textContent =
				'Frame ' + (i + 1) + ' / ' + viewer.getFrameCount() +
				'  (' + currentFrames[i].time + ')';
			updateHash();
		},
		onTrackHover: function(trackId, trackBoxes, rect) {
			if (trackId) {
				destroyTip();
				var box = trackBoxes.find(function(b) {
					return b.filename === currentFrames[viewer.getFrameIndex()].filename;
				});
				currentTip = tippy(document.body, {
					getReferenceClientRect: function() { return rect; },
					content: buildTooltipContent(trackId, box, trackBoxes),
					allowHTML: true,
					interactive: true,
					showOnCreate: true,
					placement: 'right',
					appendTo: document.body,
					onHidden: function(inst) { inst.destroy(); currentTip = null; },
				});
				currentTip.popper.addEventListener('mouseenter', cancelHide);
				currentTip.popper.addEventListener('mouseleave', scheduleHide);
			} else {
				scheduleHide();
			}
		},
		onTrackClick: function(trackId) {
			var current = viewer._options.selectedTrackId;
			viewer.update({ selectedTrackId: current === trackId ? null : trackId });
		},
	});

	var frame = (typeof targetFrame === 'number') ? Math.min(targetFrame, currentFrames.length - 1) : 0;
	viewer.setFrame(frame);
}

// --- Cascading dropdown handlers ---

function onStationChange() {
	var station = stationSel.value;
	if (!station) return;
	var years = yearsByStation[station] || [];
	setOptions(yearSel, years.map(function(y) {
		return { value: y, label: '' + y };
	}));
	if (years.length > 0) {
		yearSel.value = years[0];
		onYearChange();
	}
}

function onYearChange() {
	var station = stationSel.value;
	var year = yearSel.value;
	if (!station || !year) return;
	loadBatch(station, parseInt(year, 10));
}

// --- Wire up events ---

stationSel.addEventListener('change', onStationChange);
yearSel.addEventListener('change', onYearChange);
daySel.addEventListener('change', onDayChange);

function setImageKey(key) {
	currentImageKey = key;
	showDZ.classList.toggle('active', key === 'dz');
	showVR.classList.toggle('active', key === 'vr');
	if (viewer) viewer.update({ imageKeys: [key] });
}

showDZ.addEventListener('click', function() { setImageKey('dz'); });
showVR.addEventListener('click', function() { setImageKey('vr'); });

showMap.addEventListener('click', function() {
	mapEnabled = !mapEnabled;
	showMap.classList.toggle('active', mapEnabled);
	if (viewer) viewer.update({ mapConfig: buildMapConfig() });
});

filterToggle.addEventListener('click', function() {
	filterPanel.classList.toggle('open');
	filterToggle.innerHTML = filterPanel.classList.contains('open') ? '&#9652; Filters' : '&#9662; Filters';
});

for (var key in filterInputs) {
	filterInputs[key].addEventListener('change', onFilterChange);
}

filteredOpacity.addEventListener('input', function() {
	var val = +filteredOpacity.value;
	viewerWrap.style.setProperty('--filtered-opacity', val);
	filteredOpacityLabel.textContent = val === 0 ? 'hidden' : (val * 100).toFixed(0) + '%';
});

prevBtn.addEventListener('click', function() { if (viewer) viewer.prevFrame(); });
nextBtn.addEventListener('click', function() { if (viewer) viewer.nextFrame(); });

document.addEventListener('keydown', function(e) {
	// Skip if focused on a text input
	var tag = document.activeElement.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA') return;

	// Blur selects so they don't capture arrow keys
	if (tag === 'SELECT') document.activeElement.blur();

	if (e.key === 'ArrowLeft' && viewer) viewer.prevFrame();
	if (e.key === 'ArrowRight' && viewer) viewer.nextFrame();
	if (e.key === 'ArrowUp') { e.preventDefault(); prevDay(); }
	if (e.key === 'ArrowDown') { e.preventDefault(); nextDay(); }
	if (e.key === 'm') { showMap.click(); }
});

// --- Startup ---

loadGeoData();

d3.text(DATA_BASE + 'batches.txt').then(function(text) {
	parseBatches(text);
	setOptions(stationSel, stations.map(function(s) {
		return { value: s, label: s };
	}));
	if (stations.length === 0) return;

	var hash = parseHash();
	var station = (hash.station && stations.indexOf(hash.station) >= 0) ? hash.station : stations[0];
	stationSel.value = station;

	var years = yearsByStation[station] || [];
	setOptions(yearSel, years.map(function(y) {
		return { value: y, label: '' + y };
	}));
	var year = (hash.year && years.indexOf(parseInt(hash.year, 10)) >= 0) ? hash.year : '' + years[0];
	yearSel.value = year;

	if (hash.day || hash.frame) {
		pendingNav = {
			day: hash.day || null,
			frame: hash.frame ? parseInt(hash.frame, 10) : undefined,
		};
	}

	loadBatch(station, parseInt(year, 10));
}).catch(function(err) {
	console.error('Error loading batches.txt:', err);
});
