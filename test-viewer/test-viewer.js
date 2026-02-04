import * as d3 from 'd3';
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
var imageSel = document.getElementById('imageSel');
var prevBtn = document.getElementById('prevBtn');
var nextBtn = document.getElementById('nextBtn');
var frameInfo = document.getElementById('frameInfo');
var viewerEl = document.getElementById('viewer');

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

function buildTooltipContent(trackId, box, trackBoxes) {
	var div = document.createElement('div');
	div.style.fontSize = '12px';
	div.innerHTML =
		'<div><b>' + trackId.split('-').pop() + '</b> (' + trackBoxes.length + ' boxes)</div>' +
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

			// Build sorted day list from scans
			availableDays = Array.from(currentScans.keys()).sort();

			// Populate day dropdown
			setOptions(daySel, availableDays.map(function(day) {
				return { value: day, label: formatDayLabel(day) };
			}));
			daySel.disabled = false;

			// Auto-select first day
			if (availableDays.length > 0) {
				daySel.value = availableDays[0];
				onDayChange();
			}
		})
		.catch(function(err) {
			console.error('Error loading batch:', err);
			setOptions(daySel, [{ value: '', label: '(error)' }]);
			daySel.disabled = true;
		});
}

// --- Viewer creation ---

function onDayChange() {
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

	var imageKey = imageSel.value;

	viewer = new RoostViewer(viewerEl, {
		frames: currentFrames,
		boxes: boxes,
		imageKeys: [imageKey],
		onFrameChange: function(i) {
			frameInfo.textContent =
				'Frame ' + (i + 1) + ' / ' + viewer.getFrameCount() +
				'  (' + currentFrames[i].time + ')';
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

	viewer.setFrame(0);
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

imageSel.addEventListener('change', function() {
	if (viewer) {
		viewer.update({ imageKeys: [imageSel.value] });
	}
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
});

// --- Startup ---

d3.text(DATA_BASE + 'batches.txt').then(function(text) {
	parseBatches(text);
	setOptions(stationSel, stations.map(function(s) {
		return { value: s, label: s };
	}));
	if (stations.length > 0) {
		stationSel.value = stations[0];
		onStationChange();
	}
}).catch(function(err) {
	console.error('Error loading batches.txt:', err);
});
