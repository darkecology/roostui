import * as d3 from 'd3';
import sprintf from 'sprintf';
import $ from 'jquery';
import { parse_day, parse_time, parse_scan,
		 get_urls, obj2url, url2obj } from './utils.js';
import { BoolList } from './BoolList.js';
import { Box, Track, labels, defaultFilters,
		 loadConfig, loadDataset, loadBatch,
		 updateTracks, formatExport, unique } from './data.js';

var UI = (function() {

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
		"dataset" : "",
		"batch": "",
		"day": 0,
		"frame": 0
	};

	var filters = {};			// Current filters

	
	/* -----------------------------------------
	 * UI globals
	 * ---------------------------------------- */
	
	var keymap = {
		'9':  next_box, // tab
		'27': unselect_box, // esc
		'38': prev_day, // up
		'40': next_day, // down
		'37': prev_frame,	// left
		'39': next_frame   // right
	};

	var shift_keymap = {
		'9':  prev_box, // tab
		'38': prev_day_with_roost, // up
		'40': next_day_with_roost, // down
		'37': prev_frame_with_roost,	// left
		'39': next_frame_with_roost   // right
	};

	/* ---------------------------------------------------
	 * Track UI management
	 * -------------------------------------------------- */

	var trackNodes = new Map();		// Map<trackId, Map<svgParent, gElement>>
	var selectedTrack = null;		// Currently selected Track object
	var unselectTimeout = null;		// Timeout handle for delayed unselect

	function getTrackNodes(track) {
		if (!trackNodes.has(track.id)) {
			trackNodes.set(track.id, new Map());
		}
		return trackNodes.get(track.id);
	}

	function setTrackNode(track, node, svg) {
		getTrackNodes(track).set(svg, node);
	}

	function selectTrack(track, node) {

		// If this track is already selected, do nothing
		if (selectedTrack && track == selectedTrack) {
			window.clearTimeout(unselectTimeout);
			return;
		}

		// If another track is selected, unselect it
		if (selectedTrack) {
			unselectTrack(selectedTrack);
		}

		// Now continue selecting this track
		selectedTrack = track;

		// Add selected attribute to bounding box elements
		var nodes = getTrackNodes(track);
		for (const n of nodes.values()) {
			d3.select(n).classed("selected", true);
		}

		// Display tooltip
		var tip = d3.select("#labeltip");

		tip.on("mouseenter", () => selectTrack(track, node) )
			.on("mouseleave", () => scheduleUnselectTrack(track) );

		var bbox = d3.select(node).select("rect").node().getBoundingClientRect();

		tip.style("visibility", "visible")
			.style("left", (bbox.x + bbox.width + 18) + "px")
			.style("top", bbox.y + (bbox.height/2) - 35+ "px");

		// Create radio buttons and labels
		var entering = tip.select("#labels").selectAll("span")
			.data(labels)
			.enter()
			.append("span");

		entering.append("input")
			.attr("id", (d,i) => "label" + i)
			.attr("type", "radio")
			.attr("name", "label")
			.attr("value", (d,i) => i);

		entering.append("label")
			.attr("for", (d,i) => "label" + i)
			.text((d,i) => sprintf("(%d) %s", i+1, d));

		entering.append("br");

		// Select the correct radio button
		tip.selectAll("input")
			.property("checked", (d, i) => d===track.label)
			.on("change", (e, d) => setTrackLabel(track, d));


		// Enable keyboard shortcuts
		var zero_code = 48; // keycode for 0
		for(let i=0; i < labels.length; i++) {
			keymap[zero_code + parseInt(i+1)] =
				((label) => () => setTrackLabel(track, label))(labels[i]);
		}

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
	}

	function scheduleUnselectTrack(track) {
		unselectTimeout = window.setTimeout(() => unselectTrack(track), 250);
	}

	function sendTrackToBack(track) {
		var nodes = getTrackNodes(track);
		for (const n of nodes.values()) {
			d3.select(n).lower();
		}
	}

	function unselectTrack(track) {

		// The track may have already been unselected. If so, return
		if (selectedTrack !== track) {
			return;
		}

		// Remove selected class from elements
		var nodes = getTrackNodes(track);
		for (const n of nodes.values()) {
			d3.select(n).classed("selected", false);
		}

		// Disable tooltip
		var tip = d3.select("#labeltip");
		tip.style("visibility", "hidden");

		// Disable keyboard shortcuts
		var zero_code = 48; // keycode for 0
		for(let i=0; i < labels.length; i++) {
			delete keymap[zero_code + parseInt(i+1)];
		}

		selectedTrack = null;

	}

	function setTrackLabel(track, label) {
		let i = labels.indexOf(label);
		d3.select("#label" + i).node().checked = true;
		track.label = label;
		track.user_labeled = true;

		var nodes = getTrackNodes(track);
		for (const n of nodes.values()) {
			d3.select(n).classed("filtered", track.label !== 'swallow-roost');
		}

		// Warn before closing window
		window.onbeforeunload = function() {
			return true;
		};
	}

	/* -----------------------------------------
	 * UI
	 * ---------------------------------------- */

	UI.handle_config = function(data) {
		config = data;
	};
	
	UI.init = function()
	{
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
		Object.assign(filters, defaultFilters);
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

	function save_notes(box)
	{
		box.track.notes = document.getElementById('notes').value;
		box.user_labeled = true;
	}
	

	/* -----------------------------------------
	 * Filtering
	 * ---------------------------------------- */

	function enable_filtering() {
		d3.selectAll("#detections_min, #high_quality_detections_min, #score_min, #avg_score_min")
			.on("change", change_filter);
	}

	function change_filter(d, i, nodes) {
		let filterSettings = {
			score_min: +d3.select("#score_min").node().value,
			detections_min: +d3.select("#detections_min").node().value,
			high_quality_detections_min: +d3.select("#high_quality_detections_min").node().value,
			avg_score_min: +d3.select("#avg_score_min").node().value
		};
		updateTracks(boxes, tracks, filterSettings);
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
	
	async function render_dataset() {
		// If work needs saving, check if user wants to proceed
		if (window.onbeforeunload &&
			! window.confirm("Change dataset? You made changes but did not export data."))
		{
				return;
		}
		window.onbeforeunload = null;

		let dataset = nav.dataset;
		if (dataset) {

			d3.select('#datasets').node().value = dataset;

			let result = await loadDataset(dataset);

			dataset_config = result.datasetConfig;
			if ("filtering" in dataset_config) {
				Object.assign(filters, dataset_config["filtering"]);
			}
			else {
				Object.assign(filters, defaultFilters);
			}
			render_filters();

			var batchesSelect = d3.select('#batches');
			var options = batchesSelect.selectAll("option")
				.data(result.batches)
				.join("option")
				.text(d => d);
			batchesSelect.on("change", change_batch);

			// If the batch nav is not set already, use the selected value
			// from the dropdown list
			if (! nav.batch) {
				nav.batch = batchesSelect.node().value;
			}

			render_batch();
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

	async function render_batch() {

		if (window.onbeforeunload &&
			! window.confirm("Change batches? You made changes but did not export data."))
		{
			return;
		}
		window.onbeforeunload = null;

		if (nav.batch) {

			d3.select('#batches').node().value = nav.batch;

			let result = await loadBatch(dataset_config, nav);
			scans = result.scans;
			boxes = result.boxes;
			boxes_by_day = result.boxesByDay;
			tracks = result.tracks;
			day_notes = result.dayNotes;

			// Clear track DOM nodes for new batch
			trackNodes = new Map();

			// Update tracks based on current filter settings
			change_filter();

			enable_filtering();

			days = new BoolList(scans.keys(), boxes_by_day.keys());

			// Add day note entries for days without boxes
			for (let day of days.items) {
				if (!day_notes.has(day)) {
					day_notes.set(day, '');
				}
			}

			var dateSelect = d3.select("#dateSelect");
			var options = dateSelect.selectAll("option")
				.data(days.items);

			options.enter()
				.append("option")
				.merge(options)
				.attr("value", (d,i) => i)
				.text(function(d, i) {
					var str = parse_day(d);
					return days.isTrue(i) ? str : "(" + str + ")";
				});

			options.exit().remove();

			dateSelect.on("change", change_day);

			render_day();
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

		if(!days) return;

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
			frames_with_roosts =  boxes_by_day.get(day_key).map(d => d.filename);
		}

		frames = new BoolList(allframes, frames_with_roosts);

		var timeSelect = d3.select("#timeSelect");
		
		var options = timeSelect.selectAll("option")
			.data(frames.items);

		options.enter()
			.append("option")
			.merge(options)
			.attr("value", (d,i) => i)
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

	function render_frame()
	{
		if(!days) return;

		if (selectedTrack) {
			unselectTrack(selectedTrack);
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
		entering.each( function(d) {
			setTrackNode(d.track, this, this.parentNode);
			d.track.viewed = true;
		});

		// Merge existing groups with entering ones
		groups = entering.merge(groups);

		// Set handlers for group
		groups.classed("filtered", (d) => d.track.label !== 'swallow-roost')
			.on("mouseenter", function (e,d) { selectTrack(d.track, this); } )
			.on("mouseleave", (e,d) => scheduleUnselectTrack(d.track) );

		// Set attributes for boxes
		groups.select("rect")
		 	.attr("x", b => b.x - scale*b.r)
			.attr("y", b => b.y - scale*b.r)
		 	.attr("width", b => 2*scale*b.r)
		 	.attr("height", b => 2*scale*b.r)
			.attr("stroke", d => myColor(d.track_id))
			.attr("fill", "none");
		//.on("click", mapper)

		// Set attributes for text
		groups.select("text")
		 	.attr("x", b => b.x - scale*b.r + 5)
			.attr("y", b => b.y - scale*b.r - 5)
		 	.text(b => b.track_id.split('-').pop() + ": " + b.det_score);

		groups.on("click", (e,d) => setTrackLabel(d.track, "non-roost"));

		var url = window.location.href.replace(window.location.hash,"");
		history.replaceState({}, "", url + "#" + obj2url(nav));

		//window.location.hash = obj2url(nav);
	}	


	function prev_box() {

		if (active_tracks.length == 0)
			return;

		let track_idx;

		// If a track is currently selected, go to previous index, else go to last track
		if (selectedTrack) {
			track_idx = active_tracks.indexOf(selectedTrack);
			unselectTrack(selectedTrack);
			track_idx--;
		}
		else {
			track_idx = active_tracks.length - 1;
		}

		// Select the track
		if (track_idx >= 0) {
			let track = active_tracks[track_idx];
			let nodes = getTrackNodes(track);
			let node = nodes.values().next().value;
			selectTrack(track, node);
		}
	}

	function next_box() {

		if (active_tracks.length == 0)
			return;

		let track_idx;

		// If a track is currently selected, go to next index, else go to first track
		if (selectedTrack) {
			track_idx = active_tracks.indexOf(selectedTrack);
			unselectTrack(selectedTrack);
			track_idx++;
		}
		else {
			track_idx = 0;
		}

		// Select the track
		if (track_idx < active_tracks.length) {
			let track = active_tracks[track_idx];
			let nodes = getTrackNodes(track);
			let node = nodes.values().next().value;
			selectTrack(track, node);
		}
	}

	function unselect_box() {
		if (selectedTrack)
			unselectTrack(selectedTrack);
	}

	
	/* -----------------------------------------
	 * 5. Export
	 * ---------------------------------------- */
	
	function export_sequences() {

		let result = formatExport(boxes, tracks, day_notes);

		let dataUri = 'data:text/csv;charset=utf-8,'+ encodeURIComponent(result.csv);
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


loadConfig().then(UI.handle_config).then(UI.init);
