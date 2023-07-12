import * as d3 from 'd3';
import sprintf from 'sprintf';
import $ from 'jquery';
import {
	parse_day, parse_time, parse_scan, parse_datetime,
	get_urls, expand_pattern, obj2url, url2obj
} from './utils.js';
import { BoolList } from './BoolList.js';

var UI = (function () {

	var UI = {};

	/* -----------------------------------------
	 * UI state variables
	 * ---------------------------------------- */

	var days;					// BoolList of dates
	var frames;					// BoolList of frames for current day

	var scans;					// List of scans for selected "batch"
	var boxes;					// All boxes
	var boxes_by_day;           // Boxes grouped by local dates
	var tracks;					// All tracks

	var active_tracks;			// boxes active in current frame

	var day_notes;              // map from a local date to notes for that local date

	var svgs;					// Top-level svg elements

	var config;                 // UI config
	var dataset_config;         // Dataset config

	var nav = {					// Navigation state
		"dataset": "",
		"batch": "",
		"day": 0,
		"frame": 0
	};

	var filters = {};			// Current filters


	/* -----------------------------------------
	 * UI globals
	 * ---------------------------------------- */

	var labels = ['non-roost',
		'swallow-roost',
		'weather-roost',
		'unknown-noise-roost',
		'AP-roost',
		'duplicate',
		'bad-track'];

	var default_filters = {
		"detections_min": 2,
		"high_quality_detections_min": 2,
		"score_min": 0.05,
		"avg_score_min": -1.0
	};

	var keymap = {
		'9': next_box, // tab
		'27': unselect_box, // esc
		'38': prev_day, // up
		'40': next_day, // down
		'37': prev_frame,	// left
		'39': next_frame   // right
	};

	var shift_keymap = {
		'9': prev_box, // tab
		'38': prev_day_with_roost, // up
		'40': next_day_with_roost, // down
		'37': prev_frame_with_roost,	// left
		'39': next_frame_with_roost   // right
	};

	/* ---------------------------------------------------
	 * Class definitions
	 * -------------------------------------------------- */

	/* -----------------------------------------
	 * Box
	 * ---------------------------------------- */
	class Box {
		constructor(obj) {
			obj && Object.assign(this, obj);

			this.setTrack(new Track({}));
		}

		setTrack(t) {
			this.track = t;
		}
	}

	/* -----------------------------------------
	 * Track
	 * ---------------------------------------- */
	class Track {
		constructor(obj) {
			obj && Object.assign(this, obj);
			this.nodes = new Map();
		}

		// Each SVG has a DOM element for the track
		setNode(n, svg) {
			this.nodes.set(svg, n);
		}

		setSelected() {
			Track.selectedTrack = this;
		}

		// Called when a user hovers
		//
		//   node = the bounding box that was hovered
		// 
		select(node) {

			// If this track is already selected, do nothing
			if (Track.selectedTrack && this == Track.selectedTrack) {
				window.clearTimeout(Track.unselectTimeout);
				return;
			}

			// If another track is selected, unselect it
			if (Track.selectedTrack) {
				Track.selectedTrack.unselect();
			}

			// Now continue selecting this track
			Track.selectedTrack = this;
			//console.log(Track.selectedTrack);

			// Add selected attribute to bounding box elements
			for (const node of this.nodes.values()) {
				d3.select(node).classed("selected", true);
			}

			// Display tooltip
			var tip = d3.select("#labeltip");

			tip.on("mouseenter", () => this.select(node))
				.on("mouseleave", () => this.scheduleUnselect());

			var bbox = d3.select(node).select("rect").node().getBoundingClientRect();
			//console.log(bbox);

			tip.style("visibility", "visible")
				.style("left", (bbox.x + bbox.width + 18) + "px")
				.style("top", bbox.y + (bbox.height / 2) - 35 + "px");

			// Create radio buttons and labels
			var entering = tip.select("#labels").selectAll("span")
				.data(labels)
				.enter()
				.append("span");

			entering.append("input")
				.attr("id", (d, i) => "label" + i)
				.attr("type", "radio")
				.attr("name", "label")
				.attr("value", (d, i) => i);

			entering.append("label")
				.attr("for", (d, i) => "label" + i)
				.text((d, i) => sprintf("(%d) %s", i + 1, d));

			entering.append("br");

			// Select the correct radio button
			tip.selectAll("input")
				.property("checked", (d, i) => d === this.label)
				.on("change", (e, d) => this.setLabel(d));


			// Enable keyboard shortcuts
			var zero_code = 48; // keycode for 0
			for (let i = 0; i < labels.length; i++) {
				keymap[zero_code + parseInt(i + 1)] =
					((label) => () => this.setLabel(label))(labels[i]);
			}
			//keymap[9] = this.sendToBack; // tab: send to back

			// Create mapper link
			var box = d3.select(node).datum(); // the Box object
			var link = tip.select("#mapper")
				.html('<a href="#"> View on map</a>')
				.on("click", () => mapper(box));

			// Create notes box
			var notes = tip.select("#notes");
			notes.node().value = box.track.notes;
			notes.on("change", () => save_notes(box));
			notes.on("keydown", (e) => {
				if (e.which == 13) notes.node().blur();
			});

			// Create delete track option for the particular box
			// Create delete track button
			var deleteButton = tip.select("#delete_track");
			deleteButton.html('<button>Delete track</button>')
				.on("click", () => delete_track(box.track.id));
		}

		// Called when user unhovers to schedule unselection in 250ms
		scheduleUnselect = e => {
			Track.unselectTimeout = window.setTimeout(this.unselect, 250);
		}

		sendToBack = e => {
			for (const node of this.nodes.values()) {
				d3.select(node).lower();
			}
		}

		unselect = e => {

			// The track may have already been unselected. If so, return
			if (Track.selectedTrack !== this) {
				return;
			}

			// Remove selected class from elements
			for (const node of this.nodes.values()) {
				d3.select(node).classed("selected", false);
			}

			// Disable tooltip
			var tip = d3.select("#labeltip");
			tip.style("visibility", "hidden");

			// Disable keyboard shortcuts
			var zero_code = 48; // keycode for 0
			for (let i = 0; i < labels.length; i++) {
				delete keymap[zero_code + parseInt(i + 1)];
			}

			Track.selectedTrack = null;

		}

		setLabel(label) {
			let i = labels.indexOf(label);
			d3.select("#label" + i).node().checked = true;
			this.label = label;
			this.user_labeled = true;

			for (const node of this.nodes.values()) {
				d3.select(node).classed("filtered", this.label !== 'swallow-roost');
			}

			// Send to back after setting label?
			// this.sendToBack();

			// Warn before closing window
			window.onbeforeunload = function () {
				return true;
			};
		}
	}
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


	function handle_keydown(e) {
		var tagName = d3.select(e.target).node().tagName;
		if (tagName == 'INPUT' || tagName == 'SELECT' || tagName == 'TEXTAREA') {
			return;
		}
		var code = e.keyCode;
		var map = e.shiftKey ? shift_keymap : keymap;
		if (code in map) {
			e.preventDefault();
			e.stopPropagation();
			map[code]();
		}
	}

	function unique(a) {
		return [...new Set(a)];
	}

	function save_notes(box) {
		box.track.notes = document.getElementById('notes').value;
		box.user_labeled = true;
	}

	/* -----------------------------------------
	 * Track Modifications
	 * ---------------------------------------- */

	/* -----------------------------------------
	 * 1) delete_track() => deletes the track 
		information for a track with identifier 
		as 'track_id' for the particular box 
		selection across time
	 * ---------------------------------------- */
	function delete_track(track_id) {

		// find the track
		if (tracks.has(track_id)) {
			tracks.delete(track_id);
		}

		// clear the selected track
		Track.selectedTrack = null;

		// remove the box associated with the track
		boxes = boxes.filter(box => box.track_id !== track_id);

		// Update boxes_by_day too
		for (let [date, boxesArray] of boxes_by_day.entries()) {
			boxes_by_day.set(date, boxesArray.filter(box => box.track_id !== track_id));
		}
		// re-render frame
		render_frame();
	}


	/* -----------------------------------------
	 * Filtering
	 * ---------------------------------------- */

	function enable_filtering() {
		d3.selectAll("#detections_min, #high_quality_detections_min, #score_min, #avg_score_min")
			.on("change", change_filter);
	}

	function change_filter(d, i, nodes) {
		update_tracks();
		render_frame();
	}

	function render_filters() {
		for (const [key, val] of Object.entries(filters)) {
			document.getElementById(key).value = val;
		}
	}


	/* -----------------------------------------
	 * Page navigation and rendering
	 * ---------------------------------------- */

	/* -----------------------------------------
	 * 1. Dataset
	 * ---------------------------------------- */

	function change_dataset() {

		let datasets = d3.select('#datasets').node();
		datasets.blur();

		nav.dataset = datasets.value;
		nav.batch = '';
		nav.day = 0;
		nav.frame = 0;

		render_dataset();
	}

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


	/* -----------------------------------------
	 * 2. Batch
	 * ---------------------------------------- */

	function change_batch() {
		let batches = d3.select('#batches').node();
		batches.blur();

		nav.batch = batches.value;
		nav.day = 0;
		nav.frame = 0;

		render_batch();
	}

	function render_batch() {

		if (window.onbeforeunload &&
			!window.confirm("Change batches? You made changes but did not export data.")) {
			return;
		}
		window.onbeforeunload = null;

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
				scans = d3.group(scans, (d) => d.local_date);
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
				boxes = _boxes;
				boxes_by_day = d3.group(boxes, d => d.local_date);

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

				tracks = d3.rollup(boxes, summarizer, d => d.track_id);

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
				for (let day of days.items) {
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

				render_day();
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


	/* -----------------------------------------
	 * 3. Day
	 * ---------------------------------------- */

	function change_day() {
		let n = d3.select("#dateSelect").node();
		n.blur();
		nav.day = n.value;
		days.currentInd = n.value;
		update_nav_then_render_day();
	}

	function prev_day() {
		if (days.prev()) update_nav_then_render_day();
	}

	function prev_day_with_roost() {
		if (days.prevTrue()) update_nav_then_render_day();
	}

	function next_day() {
		if (days.next()) update_nav_then_render_day();
	}

	function next_day_with_roost() {
		if (days.nextTrue()) update_nav_then_render_day();
	}

	function update_nav_then_render_day() {
		nav.day = days.currentInd;
		nav.frame = 0;
		render_day();
	}

	function render_day() {

		if (!days) return;

		days.currentInd = nav.day;
		d3.select("#dateSelect").property("value", days.currentInd);

		var day_key = days.currentItem; // string representation of date

		// Populate day notes set up handlers
		var notes = d3.select("#dayNotes");
		notes.node().value = day_notes.get(day_key);
		notes.on("change", () => save_day_notes());
		notes.on("keydown", (e) => {
			if (e.which == 13) notes.node().blur();
		});

		// 
		var allframes = scans.get(day_key); // list of scans
		var frames_with_roosts = [];
		if (boxes_by_day.has(day_key)) {
			frames_with_roosts = boxes_by_day.get(day_key).map(d => d.filename);
		}

		frames = new BoolList(allframes, frames_with_roosts);

		var timeSelect = d3.select("#timeSelect");

		var options = timeSelect.selectAll("option")
			.data(frames.items);

		options.enter()
			.append("option")
			.merge(options)
			.attr("value", (d, i) => i)
			.text(d => parse_time(parse_scan(d.filename)['time']));

		options.exit().remove();

		timeSelect.on("change", () => {
			var n = timeSelect.node();
			n.blur();
			frames.currentInd = n.value;
			update_nav_then_render_frame();
		});

		render_frame();
	}

	function save_day_notes() {
		let key = days.currentItem; // string representation of date
		let value = d3.select("#dayNotes").node().value;
		day_notes.set(key, value);
	}


	/* -----------------------------------------
	 * 4. Frame
	 * ---------------------------------------- */

	function prev_frame() {
		if (frames.prev()) update_nav_then_render_frame();
	}

	function next_frame() {
		if (frames.next()) update_nav_then_render_frame();
	}

	function prev_frame_with_roost() {
		if (frames.prevTrue()) update_nav_then_render_frame();
	}

	function next_frame_with_roost() {
		if (frames.nextTrue()) update_nav_then_render_frame();
	}

	function update_nav_then_render_frame() {
		nav.frame = frames.currentInd;
		render_frame();
	}

	function mapper(box) {
		var ll = box.lat + "," + box.lon;
		var url = "http://maps.google.com/?q=" + ll + "&ll=" + ll + "&z=8";
		//var url = "http://www.google.com/maps/search/?api=1&query=" + ll + "&zoom=8&basemap=satellite";
		window.open(url);
	}

	function render_frame() {
		if (!days) return;

		if (Track.selectedTrack) {
			Track.selectedTrack.unselect();
		}

		var day = days.currentItem;

		frames.currentInd = nav.frame;
		d3.select("#timeSelect").property("value", frames.currentInd);

		var scan = frames.currentItem;

		var urls = get_urls(scan.filename, nav["dataset"], dataset_config);
		d3.select("#img1").attr("src", urls[0]);
		d3.select("#img2").attr("src", urls[1]);

		let boxes_for_day = boxes_by_day.has(day) ? boxes_by_day.get(day) : [];
		let boxes_for_scan = boxes_for_day.filter(d => d.filename.trim() == scan.filename.trim());
		active_tracks = boxes_for_scan.map(b => tracks.get(b.track_id));

		let track_ids = boxes_for_day.map((d) => d.track_id);
		track_ids = unique(track_ids);

		// Create color map from track_ids to ordinal color scale
		var myColor = d3.scaleOrdinal().domain(track_ids)
			.range(d3.schemeSet1);

		var scale = 1.2;
		var groups = svgs.selectAll("g")
			.data(boxes_for_scan, (d) => d.track_id);

		groups.exit().remove();

		// For entering groups, create elements
		var entering = groups.enter()
			.append("g")
			.attr("class", "bbox");
		entering.append("rect");
		entering.append("text");

		// Register each new DOM element with the track and mark the track as viewed
		entering.each(function (d) {
			d.track.setNode(this, this.parentNode);
			d.track.viewed = true;
		});

		// Merge existing groups with entering ones
		groups = entering.merge(groups);

		// Set handlers for group
		groups.classed("filtered", (d) => d.track.label !== 'swallow-roost')
			.on("mouseenter", function (e, d) { d.track.select(this); })
			.on("mouseleave", (e, d) => d.track.scheduleUnselect());

		// Set attributes for boxes
		groups.select("rect")
			.attr("x", b => b.x - scale * b.r)
			.attr("y", b => b.y - scale * b.r)
			.attr("width", b => 2 * scale * b.r)
			.attr("height", b => 2 * scale * b.r)
			.attr("stroke", d => myColor(d.track_id))
			.attr("fill", "none");
		//.on("click", mapper)

		// Set attributes for text
		groups.select("text")
			.attr("x", b => b.x - scale * b.r + 5)
			.attr("y", b => b.y - scale * b.r - 5)
			.text(b => b.track_id.split('-').pop() + ": " + b.det_score);

		groups.on("click", (e, d) => d.track.setLabel("non-roost"));

		var url = window.location.href.replace(window.location.hash, "");
		history.replaceState({}, "", url + "#" + obj2url(nav));

		//window.location.hash = obj2url(nav);
	}


	function prev_box() {

		if (active_tracks.length == 0)
			return;

		let track_idx;

		// If a track is currently selected, go to previous index, else go to last track
		if (Track.selectedTrack) {
			track_idx = active_tracks.indexOf(Track.selectedTrack);
			Track.selectedTrack.unselect();
			track_idx--;
		}
		else {
			track_idx = active_tracks.length - 1;
		}

		// Select the track
		if (track_idx >= 0) {
			let track = active_tracks[track_idx];
			let node = track.nodes.values().next().value;
			track.select(node);
		}
	}

	function next_box() {

		if (active_tracks.length == 0)
			return;

		let track_idx;

		// If a track is currently selected, go to next index, else go to first track
		if (Track.selectedTrack) {
			track_idx = active_tracks.indexOf(Track.selectedTrack);
			Track.selectedTrack.unselect();
			track_idx++;
		}
		else {
			track_idx = 0;
		}

		// Select the track
		if (track_idx < active_tracks.length) {
			let track = active_tracks[track_idx];
			let node = track.nodes.values().next().value;
			track.select(node);
		}
	}

	function unselect_box() {
		if (Track.selectedTrack)
			Track.selectedTrack.unselect();
	}


	/* -----------------------------------------
	 * 5. Export
	 * ---------------------------------------- */

	function export_sequences() {

		// Determine column names associated with different entities (box, track, day)
		let track_cols = ["length", "tot_score", "avg_score", "viewed", "user_labeled", "label", "original_label", "notes"];
		let day_cols = ["day_notes"];

		// Columns associated with boxes are all other columns
		let box_cols = Object.keys(boxes[0]);
		let exclude_cols = [...track_cols, ...day_cols, "track"];
		box_cols = box_cols.filter(val => exclude_cols.indexOf(val) === -1);

		// Assign track attributes to each box
		for (let box of boxes) {
			var track = tracks.get(box.track_id);
			for (var col of track_cols) {
				box[col] = track[col];
			}
		}

		// Assign day notes to box
		for (let box of boxes) {
			box['day_notes'] = day_notes.get(box['local_date']);
		}

		// This is the list of output columns
		let cols = box_cols.concat(track_cols).concat(day_cols);

		let dataStr = d3.csvFormat(boxes, cols);
		let dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(dataStr);

		let filename = sprintf("roost_labels_%s.csv", $("#batches").val());

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
