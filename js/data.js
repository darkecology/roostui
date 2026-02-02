import * as d3 from 'd3';
import sprintf from 'sprintf';
import { parse_datetime, parse_scan, expand_pattern } from './utils.js';

/* -----------------------------------------
 * Constants
 * ---------------------------------------- */

export var labels = ['non-roost',
			  'swallow-roost',
			  'weather-roost',
			  'unknown-noise-roost',
			  'AP-roost',
			  'duplicate',
			  'bad-track'];

export var defaultFilters = {
	"detections_min" : 2,
	"high_quality_detections_min" : 2,
	"score_min" : 0.05,
	"avg_score_min" : -1.0
};

/* -----------------------------------------
 * Classes
 * ---------------------------------------- */

export class Box {
	constructor(obj) {
		if (obj) Object.assign(this, obj);
		this.track = null;
	}
}

export class Track {
	constructor(obj) {
		if (obj) Object.assign(this, obj);
	}
}

/* -----------------------------------------
 * Utility
 * ---------------------------------------- */

export function unique(a) {
	return [...new Set(a)];
}

/* -----------------------------------------
 * Internal helpers
 * ---------------------------------------- */

function preprocessScan(d) {
	d.local_date = parse_datetime(d.local_time)['date'];
	return d;
}

function row2box(d, datasetConfig) {
	let info = parse_scan(d.filename);
	d.station = info['station'];
	d.date = info['date'];
	d.time = info['time'];
	if("swap" in datasetConfig && datasetConfig["swap"]){
		let tmp = d.y;
		d.y = d.x;
		d.x = tmp;
	}
	d.local_date = parse_datetime(d.local_time)['date'];
	if(d.track_id.length < 13){
		d.track_id = d.station + d.local_date + '-' + d.track_id;
	}
	return new Box(d);
}

function sumNonNegValues(boxes) {
	let sum = 0;
	let n_values = 0;
	for (let box of boxes) {
		if (box.det_score >= 0) {
			sum += parseFloat(box.det_score);
			n_values += 1;
		}
	}
	let avg = sum / n_values;
	return {'sum': sum, 'avg': avg};
}

/* -----------------------------------------
 * Data loading functions
 * ---------------------------------------- */

export async function loadConfig() {
	return d3.json('data/config.json');
}

export async function loadDataset(datasetName) {
	var batchFile = sprintf("data/%s/batches.txt", datasetName);
	var configFile = sprintf("data/%s/config.json", datasetName);

	let [batchText, datasetConfig] = await Promise.all([
		d3.text(batchFile),
		d3.json(configFile)
	]);

	let batches = batchText.trim().split("\n");
	return { batches, datasetConfig };
}

export async function loadBatch(datasetConfig, nav) {
	var csv_file = expand_pattern(datasetConfig["boxes"], nav);
	var scans_file = expand_pattern(datasetConfig["scans"], nav);

	let [rawScans, rawBoxes] = await Promise.all([
		d3.csv(scans_file, preprocessScan),
		d3.csv(csv_file, d => row2box(d, datasetConfig))
	]);

	// Filter scan list to current batch if specified in datasetConfig
	if ("filter" in datasetConfig["scans"]) {
		rawScans = rawScans.filter(
			d => expand_pattern(datasetConfig["scans"]["filter"], parse_scan(d.filename)) == nav.batch
		);
	}

	// Group scans by local_date
	let scans = d3.group(rawScans, (d) => d.local_date);

	// Process boxes
	let boxes = rawBoxes;
	let boxesByDay = d3.group(boxes, d => d.local_date);

	// Create tracks
	let summarizer = function(v) {
		let scores = sumNonNegValues(v);
		let viewed = false;
		let user_labeled = false;
		let label = null;
		let original_label = null;
		let notes = "";
		if (v[0].viewed != null) {
			viewed = v[0].viewed;
			user_labeled = v[0].user_labeled;
			label = v[0].label;
			original_label = v[0].original_label;
			notes = v[0].notes;
		}
		return new Track({
			id: v[0].track_id,
			date: v[0].date,
			length: v.length,
			tot_score: scores['sum'],
			avg_score: scores['avg'],
			viewed: viewed,
			user_labeled: user_labeled,
			label: label,
			original_label: original_label,
			notes: notes,
			boxes: v
		});
	};

	let tracks = d3.rollup(boxes, summarizer, d => d.track_id);

	// Link boxes to their tracks
	for (var box of boxes) {
		box.track = tracks.get(box.track_id);
	}

	// Initialize day notes
	let dayNotes = new Map();
	for (let day of scans.keys()) {
		dayNotes.set(day, '');
	}
	for (let box of boxes) {
		if (box['day_notes'] != null) {
			dayNotes.set(box['local_date'], box['day_notes']);
		}
	}

	return { scans, boxes, boxesByDay, tracks, dayNotes };
}

/* -----------------------------------------
 * Processing functions
 * ---------------------------------------- */

export function updateTracks(boxes, tracks, filterSettings) {
	let score_min = +filterSettings.score_min;

	let summarizer = function(v) {
		let n_high_quality = v.filter(d => d.det_score >= score_min).length;
		return n_high_quality;
	};

	let n_high_quality = d3.rollup(boxes, summarizer, d => d.track_id);

	let detections_min = +filterSettings.detections_min;
	let high_quality_detections_min = +filterSettings.high_quality_detections_min;
	let avg_score_min = +filterSettings.avg_score_min;

	for (let [id, t] of tracks) {
		if (t.user_labeled) {
			continue;
		}

		if (t.length < detections_min ||
			n_high_quality.get(id) < high_quality_detections_min ||
			t.avg_score < avg_score_min )
		{
			t.label = 'non-roost';
		}
		else
		{
			t.label = 'swallow-roost';
		}

		t.original_label = t.label;
	}
}

export function formatExport(boxes, tracks, dayNotes) {
	let track_cols = ["length", "tot_score", "avg_score", "viewed", "user_labeled", "label", "original_label", "notes"];
	let day_cols = ["day_notes"];

	let box_cols = Object.keys(boxes[0]);
	let exclude_cols = [...track_cols, ...day_cols, "track"];
	box_cols = box_cols.filter( val => exclude_cols.indexOf(val) === -1);

	for (let box of boxes) {
		var track = tracks.get(box.track_id);
		for (var col of track_cols) {
			box[col] = track[col];
		}
	}

	for (let box of boxes) {
		box['day_notes'] = dayNotes.get(box['local_date']);
	}

	let cols = box_cols.concat(track_cols).concat(day_cols);
	let csv = d3.csvFormat(boxes, cols);

	return { csv, cols };
}
