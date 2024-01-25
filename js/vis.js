import * as d3 from 'd3';
import sprintf from 'sprintf';
import $ from 'jquery';
import {
	parse_day, parse_scan, parse_datetime,
	expand_pattern, url2obj
} from './utils.js';
import { BoolList } from './BoolList.js';
import ViewModule, { save_notes } from './Viewer.js';
import Track from './Track.js';
import Box from './Box.js'
import handle_keydown from './KeymapUtils.js';


/**
 * Global variables for all functions 
 */

window.days = new BoolList([], []);					// BoolList of dates
window.frames = new BoolList([], []);						// BoolList of frames for current day

window.unviewed_days = [];

window.scans = {};					// List of scans for selected "batch"
window.boxes = {};					// All boxes
window.boxes_by_day = [];           // Boxes grouped by local dates
window.tracks = {};					// All tracks

window.active_tracks = {};			// boxes active in current frame

window.day_notes = {};              // map from a local date to notes for that local date

window.svgs = {};				// Top-level svg elements

window.config = {};                // UI config
window.dataset_config = {};         // Dataset config

window.discountEnabled = false;
window.discountFile = "";
window.discountDates = new BoolList([], []);
window.discount_start = ""
window.discount_end = ""
window.discount_toggle = false;
window.displayed_discount_dates = [];

window.nav = {					// Navigation state
	"dataset": "",
	"batch": "",
	"day": 0,
	"frame": 0
};

window.labels = ['non-roost',
	'swallow-roost',
	'weather-roost',
	'unknown-noise-roost',
	'AP-roost',
	'duplicate',
	'bad-track'];


export function update_nav_then_render_day() {
	nav.day = days.currentInd;
	nav.frame = 0;
	ViewModule();
}

var UI = (function () {

	var UI = {};

	var filters = {};			// Current filters


	/* -----------------------------------------
	 * UI globals
	 * ---------------------------------------- */

	var default_filters = {
		"detections_min": 2,
		"high_quality_detections_min": 2,
		"score_min": 0.05,
		"avg_score_min": -1.0
	};
	Track.selectedTrack = null;
	Track.unselectTimeout = null;

	/* -----------------------------------------
	 * UI
	 * ---------------------------------------- */

	UI.handle_config = function (data) {
		config = data;
	};

	UI.init = function () {
		svgs = d3.selectAll("#svg1, #svg2");

		// Populate data and set event handlers	
		d3.select("#export").on("click", export_sequences);
		d3.select("#notes-save").on("click", save_notes);
		d3.select('body').on('keydown', handle_keydown);
		d3.select('#discount_button').on('click', handle_discount_button);
		d3.select('#continue_button').on('click', export_sequences);
		d3.select('#close_button').on('click', () => d3.select("#export-modal").style("display", "none"));

		// Populate datasets
		var datasets = d3.select('#datasets');
		var options = datasets.selectAll("options")
			.data(config['datasets'])
			.enter()
			.append("option")
			.text(d => d);

		datasets.on("change", change_dataset);
		Object.assign(filters, default_filters);
		render_filters();

		let url_nav = url2obj(window.location.hash.substring(1));
		Object.assign(nav, url_nav);
		render_dataset();
	};


	/* -----------------------------------------
	 * Filtering
	 * ---------------------------------------- */

	function enable_filtering() {
		d3.selectAll("#detections_min, #high_quality_detections_min, #score_min, #avg_score_min")
			.on("change", change_filter);
	}

	function change_filter(d, i, nodes) {
		update_tracks();
		ViewModule();
	}


	function render_filters() {
		for (const [key, val] of Object.entries(filters)) {
			document.getElementById(key).value = val;
		}
	}



	function change_dataset() {

		let datasets = d3.select('#datasets').node();
		datasets.blur();

		nav.dataset = datasets.value;
		nav.batch = '';
		nav.day = 0;
		nav.frame = 0;
		document.getElementById('discount_button').setAttribute("disabled", 'disabled');
		window.discountEnabled = false;
		window.discount_start = "";
		window.discount_end = "";

		if (window.onbeforeunload &&
			!window.confirm("Change dataset? You made changes but did not export data.")) {
			return;
		}
		window.onbeforeunload = null;

		render_dataset();
	}

	//Renders the current dataset based on user input (current dataset = dataset )
	function render_dataset() {

		// If work needs saving, check if user wants to proceed
		if (window.onbeforeunload &&
			!window.confirm("Change dataset? You made changes but did not export data.")) {
			return;
		}
		window.onbeforeunload = null;

		let dataset = nav.dataset;
		if (dataset) {

			d3.select('#datasets').node().value = dataset;

			function handle_config(_config) {
				dataset_config = _config;
				if ("filtering" in dataset_config) {
					Object.assign(filters, dataset_config["filtering"]);
				}
				else {
					Object.assign(filters, default_filters);
				}
				render_filters();
			}

			function handle_batches(batch_list) {
				batch_list = batch_list.trim().split("\n");
				var batches = d3.select('#batches');
				var options = batches.selectAll("option")
					.data(batch_list)
					.join("option")
					.text(d => d);
				batches.on("change", change_batch);

				// If the batch nav is not set already, used the selected value
				// from the dropdown list
				if (!nav.batch) {
					nav.batch = batches.node().value;
				}
			}

			var batchFile = sprintf("data/%s/batches.txt", dataset);
			var dataset_config_file = sprintf("data/%s/config.json", dataset);

			Promise.all([
				d3.text(batchFile).then(handle_batches),
				d3.json(dataset_config_file).then(handle_config)
			]).then(render_batch);
		}
	}

	//change the current batch and update nav based on input
	function change_batch() {
		let batches = d3.select('#batches').node();
		batches.blur();

		nav.batch = batches.value;
		nav.day = 0;
		nav.frame = 0;
		document.getElementById('discount_button').setAttribute("disabled", 'disabled');
		window.discountEnabled = false;
		window.discount_start = "";
		window.discount_end = "";

		if (window.onbeforeunload &&
			!window.confirm("Change batches? You made changes but did not export data.")) {
			return;
		}
		window.onbeforeunload = null;
		render_batch();
	}

	function handle_discount_button() {
		window.discount_toggle = !window.discount_toggle;
		if (window.discount_toggle) {
			if (window.discountEnabled == true) {
				document.getElementById('discount_button').value = "End DISCount"
				Promise.all([d3.text(window.discountFile)])
					.then(data => {
						return handle_discount(data);
					})
			}

		}
		else {
			document.getElementById('discount_button').value = "DISCount"
			render_batch_no_changes();
		}

	}

	function render_batch_no_changes() {
		window.days = new BoolList(window.scans.keys(), window.boxes_by_day.keys());

		var dateSelect = d3.select("#dateSelect");
		var options = dateSelect.selectAll("option")
			.data(window.days.items);

		options.enter()
			.append("option")
			.merge(options)
			.attr("value", (d, i) => i)
			.text(function (d, i) {
				var str = parse_day(d);
				return days.isTrue(i) ? str : "(" + str + ")";
			});

		options.exit().remove();

		if (!nav.batch) {
			nav.batch = batches.node().value;
		}
		nav.day = 0;
		nav.frame = 0
		dateSelect.on("change", change_day);

		ViewModule();


	}

	function handle_discount(discount_list) {
		discount_list = discount_list[0].trim().split("\n");
		
		let st = window.discount_start
		let end = parseInt(window.discount_end) + 1
		
		let filtered_list = discount_list.slice(st, end)
		if (filtered_list === undefined || filtered_list.length == 0) {
			alert("This is not a valid date range or there are no dates within this range.")
		}
		else {
			//we need to sort boxes by day 
			let to_sort = [...window.boxes_by_day.keys()];
			to_sort.sort((a, b) => filtered_list.indexOf(a) - filtered_list.indexOf(b));
			window.days = new BoolList(filtered_list, to_sort);

			let discount_text_list = discount_list.map((item, index) => { return days.isTrue(index) ? (index + 1).toString() + ": " + parse_day(item) : (index + 1).toString() + ": (" + parse_day(item) + ")" })

			let filtered_text_list = discount_text_list.slice(st, end)

			let dl = filtered_text_list

			window.displayed_discount_dates = dl; 
			window.unviewed_days = dl;

			var dates = d3.select('#dateSelect');
			dates.selectAll("option")
				.data(filtered_list)
				.join("option")
				.text(function (d, i) {
					return filtered_text_list[i]
				});
			dates.on("change", change_day);

			// If the batch nav is not set already, used the selected value
			// from the dropdown list
			if (!nav.batch) {
				nav.batch = batches.node().value;
			}
			nav.day = 0;
			nav.frame = 0

			ViewModule();

		}

	}

	function fileExists(url) {
		if (url == "") {
			return false
		}
		var http = new XMLHttpRequest();
		http.open('HEAD', url, false);
		http.send();
		return http.status != 404;
	}

	//Renders the current batch based on user input (current batch = batch )
	function render_batch() {
		//check to see if batch has a discount file 
		var discount_file_name = null;
		var discount_file = null;
		discount_file_name = expand_pattern(dataset_config["discount"], nav);
		discount_file = sprintf(discount_file_name);

		if (fileExists(discount_file)) {
			document.getElementById('discount_button').removeAttribute('disabled');
			d3.select("#export").on("click", discount_export_sequences);
			window.discountEnabled = true;
			window.discountFile = discount_file
			Promise.all([d3.text(discount_file)])
				.then(data => {
					window.discountDates = data[0].trim().split("\n");
				})

		}

		if (nav.batch) {

			d3.select('#batches').node().value = nav.batch;

			var csv_file = expand_pattern(dataset_config["boxes"], nav);
			var scans_file = expand_pattern(dataset_config["scans"], nav);

			function preprocess_scan(d) {
				d.local_date = parse_datetime(d.local_time)['date'];
				return d;
			}

			function handle_scans(_scans) {
				scans = _scans;
				// filter scan list to current batch if specified in dataset_config
				if ("filter" in dataset_config["scans"]) {
					scans = scans.filter(
						d => expand_pattern(dataset_config["scans"]["filter"], parse_scan(d.filename)) == nav.batch
					);
				}

				// group scans by local_date
				window.scans = d3.group(scans, (d) => d.local_date);
			}

			// convert a row of the csv file into Box object
			function row2box(d) {
				let info = parse_scan(d.filename);
				d.station = info['station'];
				d.date = info['date'];
				d.time = info['time'];
				if ("swap" in dataset_config && dataset_config["swap"]) {
					let tmp = d.y;
					d.y = d.x;
					d.x = tmp;
				}
				d.local_date = parse_datetime(d.local_time)['date'];
				if (d.track_id.length < 13) {
					d.track_id = d.station + d.local_date + '-' + d.track_id;
				}
				return new Box(d);
			}

			function sum_non_neg_values(boxes) {
				let sum = 0;
				let n_values = 0;
				for (let box of boxes) {
					if (box.det_score >= 0) {
						sum += parseFloat(box.det_score);
						n_values += 1;
					}
				}
				let avg = sum / n_values
				return { 'sum': sum, 'avg': avg };
			}

			// Load boxes and create tracks when new batch is selected
			function handle_boxes(_boxes) {
				window.boxes = _boxes;
				boxes_by_day = d3.group(window.boxes, d => d.local_date);

				let summarizer = function (v) { // v is the list of boxes for one track
					let scores = sum_non_neg_values(v);
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

				window.tracks = d3.rollup(window.boxes, summarizer, d => d.track_id);

				// Link boxes to their tracks
				for (var box of boxes) {
					box.track = tracks.get(box.track_id);
				}
				update_tracks(); // add attributes that depend on user input
			}

			// Load scans and boxes
			Promise.all([
				d3.csv(scans_file, preprocess_scan).then(handle_scans),
				d3.csv(csv_file, row2box).then(handle_boxes)
			]).then(() => {

				enable_filtering();

				days = new BoolList(scans.keys(), boxes_by_day.keys());

				// scans were grouped by local_dates, scans.keys() are local_dates

				// Initialize notes
				day_notes = new Map();
				for (let day of window.days.items) {
					day_notes.set(day, ''); // local_date
				}
				for (let box of boxes) {
					if (box['day_notes'] != null) {
						day_notes.set(box['local_date'], box['day_notes'])
					}
				}

				var dateSelect = d3.select("#dateSelect");
				var options = dateSelect.selectAll("option")
					.data(days.items);

				options.enter()
					.append("option")
					.merge(options)
					.attr("value", (d, i) => i)
					.text(function (d, i) {
						var str = parse_day(d);
						return days.isTrue(i) ? str : "(" + str + ")";
					});

				options.exit().remove();

				dateSelect.on("change", change_day);

				if (window.discountEnabled) {
					var start_discountdates = d3.select('#discountStartDateSelect');
					start_discountdates.selectAll("option")
						.data(window.discountDates)
						.join("option")
						.attr("value", (d, i) => i)
						.text(function (d, i) {
							return i + 1
						});

					var end_discountdates = d3.select('#discountEndDateSelect');
					let N = window.discountDates.length
					end_discountdates.selectAll("option")
						.data(window.discountDates)
						.join("option")
						.attr("value", (d, i) => i)
						.text(function (d, i) {
							return i + 1
						}).property("selected", function (d, i) { return i == N - 1; })

					start_discountdates.on("change", change_discount_range)
					end_discountdates.on("change", change_discount_range)

					window.discount_start = d3.select("#discountStartDateSelect").node().value;
					window.discount_end = d3.select("#discountEndDateSelect").node().value;

				}


				ViewModule();
			});
		}
	}

	// Compute track attributes that depend on user input
	function update_tracks() {

		let score_min = +d3.select("#score_min").node().value;

		let summarizer = function (v) { // v is the list of boxes for one track
			let n_high_quality = v.filter(d => d.det_score >= score_min).length;
			return n_high_quality;
		};

		let n_high_quality = d3.rollup(boxes, summarizer, d => d.track_id);

		// Default labeling based on user filtering
		let detections_min = +d3.select("#detections_min").node().value;
		let high_quality_detections_min = +d3.select("#high_quality_detections_min").node().value;
		let avg_score_min = +d3.select("#avg_score_min").node().value;

		for (let [id, t] of tracks) {

			if (t.user_labeled) {
				continue;		// don't override a user-entered label
			}

			// Automatic labeling based on filtered rools 
			if (t.length < detections_min ||
				n_high_quality.get(id) < high_quality_detections_min ||
				t.avg_score < avg_score_min) {
				t.label = 'non-roost';
			}
			else {
				t.label = 'swallow-roost';
			}

			t.original_label = t.label;
		}
	}


	//Change the day 
	function change_day() {
		let n = d3.select("#dateSelect").node();
		n.blur();
		nav.day = n.value;
		days.currentInd = n.value;
		update_nav_then_render_day();
	}

	function change_discount_range() {
		discount_start = d3.select("#discountStartDateSelect").node().value;
		discount_end = d3.select("#discountEndDateSelect").node().value;
	}


	//export data 
	function discount_export_sequences() {
		if (discountEnabled) {
			var modal = d3.select("#export-modal");
			modal.style("display", "block")
			if (window.unviewed_days.length == 0) {
				d3.select("#modal_unviewed").style("visibility", "hidden");
			}
			d3.select("#unviewed_days").text(window.unviewed_days)
		}

	}

	function export_sequences() {

		// Determine column names associated with different entities (box, track, day)
		let track_cols = ["length", "tot_score", "avg_score", "viewed", "user_labeled", "label", "original_label", "notes"];
		let day_cols = ["day_notes"];

		// Columns associated with boxes are all other columns
		let box_cols = Object.keys(window.boxes[0]);
		let exclude_cols = [...track_cols, ...day_cols, "track"];
		box_cols = box_cols.filter(val => exclude_cols.indexOf(val) === -1);

		// Assign track attributes to each box
		for (let box of window.boxes) {
			var track = window.tracks.get(box.track_id);
			for (var col of track_cols) {
				box[col] = track[col];
			}
		}

		// Assign day notes to box
		for (let box of window.boxes) {
			box['day_notes'] = window.day_notes.get(box['local_date']);
		}

		// This is the list of output columns
		let cols = box_cols.concat(track_cols).concat(day_cols);

		let dataStr = d3.csvFormat(window.boxes, cols);
		let dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(dataStr);
		let filename = sprintf("roost_labels_%s.csv", $("#batches").val());
		if (window.discountEnabled) {
			filename = sprintf("roost_labels_%s_%d_%d.csv", $("#batches").val(), (+discount_start) + 1, (+discount_end) + 1);
		}
		let linkElement = document.createElement('a');
		linkElement.setAttribute('href', dataUri);
		linkElement.setAttribute('download', filename);
		linkElement.click();

		// Remove warning about export
		window.onbeforeunload = null;
	}

	return UI;
}());


d3.json('data/config.json').then(UI.handle_config).then(UI.init);