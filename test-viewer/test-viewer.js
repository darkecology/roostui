import { RoostViewer } from '../js/RoostViewer.js';

// --- Real data: KCLE 8/20/2020, dataset all_stations_v3 ---

var DATASET = 'all_stations_v3';
var IMG_BASE = 'http://doppler.cs.umass.edu/roost/img/' + DATASET;

function imageUrls(filename) {
	// parse station/date from filename like KCLE20200820_102320_V06
	var station = filename.substring(0, 4);
	var year = filename.substring(4, 8);
	var month = filename.substring(8, 10);
	var day = filename.substring(10, 12);
	return {
		dz: IMG_BASE + '/dz05/' + year + '/' + month + '/' + day + '/' + station + '/' + filename + '.png',
		vr: IMG_BASE + '/vr05/' + year + '/' + month + '/' + day + '/' + station + '/' + filename + '.png',
	};
}

var scans = [
	'KCLE20200820_101619_V06',
	'KCLE20200820_102320_V06',
	'KCLE20200820_103020_V06',
	'KCLE20200820_103720_V06',
	'KCLE20200820_104420_V06',
	'KCLE20200820_105120_V06',
	'KCLE20200820_110519_V06',
	'KCLE20200820_111219_V06',
	'KCLE20200820_111920_V06',
	'KCLE20200820_112620_V06',
];

var localTimes = [
	'06:16:19', '06:23:20', '06:30:20', '06:37:20', '06:44:20',
	'06:51:20', '07:05:19', '07:12:19', '07:19:20', '07:26:20',
];

var frames = scans.map(function(fn, i) {
	return { filename: fn, time: localTimes[i], imageUrls: imageUrls(fn) };
});

var boxes = [
	// Track KCLE20200820-1 (5 detections)
	{ filename: 'KCLE20200820_101619_V06', x: 354.30, y: 405.11, r: 15.29, det_score: 0.882, track_id: 'KCLE20200820-1' },
	{ filename: 'KCLE20200820_102320_V06', x: 356.62, y: 405.90, r: 22.04, det_score: 0.753, track_id: 'KCLE20200820-1' },
	{ filename: 'KCLE20200820_103020_V06', x: 354.77, y: 403.67, r: 21.68, det_score: 0.791, track_id: 'KCLE20200820-1' },
	{ filename: 'KCLE20200820_103720_V06', x: 356.87, y: 405.67, r: 25.27, det_score: 0.585, track_id: 'KCLE20200820-1' },
	{ filename: 'KCLE20200820_104420_V06', x: 357.19, y: 404.47, r: 32.07, det_score: 0.214, track_id: 'KCLE20200820-1' },

	// Track KCLE20200820-2 (7 detections)
	{ filename: 'KCLE20200820_102320_V06', x: 205.06, y: 58.25,  r: 16.20, det_score: 0.977, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_103020_V06', x: 206.89, y: 60.08,  r: 26.81, det_score: 0.979, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_103720_V06', x: 207.73, y: 61.68,  r: 38.55, det_score: 0.918, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_104420_V06', x: 208.99, y: 66.70,  r: 49.07, det_score: 0.866, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_105120_V06', x: 211.57, y: 71.43,  r: 60.31, det_score: 0.852, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_110519_V06', x: 215.60, y: 75.77,  r: 70.58, det_score: 0.668, track_id: 'KCLE20200820-2' },
	{ filename: 'KCLE20200820_111219_V06', x: 212.84, y: 79.94,  r: 79.88, det_score: 0.142, track_id: 'KCLE20200820-2' },

	// Track KCLE20200820-7 (7 detections)
	{ filename: 'KCLE20200820_103020_V06', x: 87.25,  y: 170.03, r: 20.22, det_score: 0.754, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_103720_V06', x: 86.66,  y: 170.00, r: 30.13, det_score: 0.825, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_104420_V06', x: 87.66,  y: 174.95, r: 34.59, det_score: 0.645, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_105120_V06', x: 88.56,  y: 175.51, r: 44.46, det_score: 0.564, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_110519_V06', x: 69.40,  y: 198.85, r: 71.05, det_score: 0.577, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_111219_V06', x: 73.56,  y: 199.95, r: 78.09, det_score: 0.315, track_id: 'KCLE20200820-7' },
	{ filename: 'KCLE20200820_111920_V06', x: 74.76,  y: 210.01, r: 84.07, det_score: 0.115, track_id: 'KCLE20200820-7' },

	// Track KCLE20200820-14 (1 detection)
	{ filename: 'KCLE20200820_105120_V06', x: 429.80, y: 573.09, r: 33.71, det_score: 0.799, track_id: 'KCLE20200820-14' },
];

// --- Create viewer ---

var log = document.getElementById('log');
function appendLog(msg) {
	var line = document.createElement('div');
	line.textContent = msg;
	log.appendChild(line);
	log.scrollTop = log.scrollHeight;
}

var viewer = new RoostViewer(document.getElementById('viewer'), {
	frames: frames,
	boxes: boxes,
	imageKeys: ['dz'],
	onFrameChange: function(i) {
		document.getElementById('frameInfo').textContent =
			'Frame ' + (i + 1) + ' / ' + viewer.getFrameCount() +
			'  (' + frames[i].time + ')';
		appendLog('frameChange: ' + i);
	},
	onTrackHover: function(trackId, trackBoxes, rect) {
		if (trackId) {
			document.getElementById('hoverInfo').textContent =
				'Hover: ' + trackId + ' (' + trackBoxes.length + ' boxes)';
			appendLog('hover: ' + trackId);
		} else {
			document.getElementById('hoverInfo').textContent = 'Hover: --';
		}
	},
	onTrackClick: function(trackId) {
		appendLog('click: ' + trackId);
		// Toggle selection
		var current = viewer._options.selectedTrackId;
		viewer.update({ selectedTrackId: current === trackId ? null : trackId });
		document.getElementById('selInfo').textContent =
			'Selected: ' + (viewer._options.selectedTrackId || '--');
	},
});

// --- Wire up controls ---

document.getElementById('prevBtn').addEventListener('click', function() { viewer.prevFrame(); });
document.getElementById('nextBtn').addEventListener('click', function() { viewer.nextFrame(); });

document.addEventListener('keydown', function(e) {
	if (e.key === 'ArrowLeft') viewer.prevFrame();
	if (e.key === 'ArrowRight') viewer.nextFrame();
});

var dzBtn = document.getElementById('showDZ');
var vrBtn = document.getElementById('showVR');

dzBtn.addEventListener('click', function() {
	viewer.update({ imageKeys: ['dz'] });
	dzBtn.disabled = true;
	vrBtn.disabled = false;
});

vrBtn.addEventListener('click', function() {
	viewer.update({ imageKeys: ['vr'] });
	vrBtn.disabled = true;
	dzBtn.disabled = false;
});

// Trigger initial frame display
viewer.setFrame(0);
