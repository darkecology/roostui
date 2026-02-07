import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { parse_day, parse_time, parse_scan,
		 get_urls, obj2url, url2obj } from './utils.js';
import { BoolList } from './BoolList.js';
import { Box, Track, labels, defaultFilters,
		 loadConfig, loadDataset, loadBatch,
		 updateTracks, formatExport, unique } from './data.js';
import { RoostViewer } from './RoostViewer.js';

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

	var viewer = null;			// RoostViewer instance

	var config;                 // UI config
	var dataset_config;         // Dataset config

	var nav = {					// Navigation state
		"dataset" : "",
		"batch": "",
		"day": 0,
		"frame": 0
	};

	var filters = {};			// Current filters

	var stationCoords = null;	// { callsign: { lat, lon } }
	var geoFeatures = null;		// { states, counties, lakes }
	var mapEnabled = true;


	/* -----------------------------------------
	 * UI globals
	 * ---------------------------------------- */

	function toggleMap() {
		mapEnabled = !mapEnabled;
		var el = document.getElementById("mapToggle");
		if (el) el.checked = mapEnabled;
		if (viewer) viewer.update({ mapConfig: buildMapConfig() });
	}

	var keymap = {
		'9':  next_box, // tab
		'27': unselect_box, // esc
		'38': prev_day, // up
		'40': next_day, // down
		'37': prev_frame,	// left
		'39': next_frame,  // right
		'77': toggleMap    // m
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

	var selectedTrack = null;		// Currently selected Track object
	var unselectTimeout = null;		// Timeout handle for delayed unselect

	function selectTrack(track, rect) {

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

		// Tell viewer to highlight this track
		viewer.update({ selectedTrackId: track.id });

		// Display tooltip
		var tip = document.getElementById("labeltip");

		tip.onmouseenter = () => selectTrack(track, rect);
		tip.onmouseleave = () => scheduleUnselectTrack(track);

		tip.style.visibility = "visible";
		tip.style.left = (rect.x + rect.width + 18) + "px";
		tip.style.top = rect.y + (rect.height/2) - 35 + "px";

		// Create radio buttons and labels (enter-only d3 join)
		var entering = d3.select("#labels").selectAll("span")
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
			.text((d,i) => `(${i+1}) ${d}`);

		entering.append("br");

		// Select the correct radio button
		d3.select("#labels").selectAll("input")
			.property("checked", (d, i) => d===track.label)
			.on("change", (e, d) => setTrackLabel(track, d));


		// Enable keyboard shortcuts
		var zero_code = 48; // keycode for 0
		for(let i=0; i < labels.length; i++) {
			keymap[zero_code + parseInt(i+1)] =
				((label) => () => setTrackLabel(track, label))(labels[i]);
		}

		// Find the box for this track in the current frame
		var box = findBoxForTrack(track);

		// Create mapper link
		var mapperEl = document.getElementById("mapper");
		if (box) {
			mapperEl.innerHTML = '<a href="#"> View on map</a>';
			mapperEl.onclick = () => mapper(box);
		} else {
			mapperEl.innerHTML = '';
		}

		// Create notes box
		var notesEl = document.getElementById("notes");
		notesEl.value = track.notes;
		notesEl.onchange = () => { track.notes = notesEl.value; track.user_labeled = true; };
		notesEl.onkeydown = (e) => {
			if (e.which == 13) notesEl.blur();
		};
	}

	function findBoxForTrack(track) {
		if (!frames) return null;
		var scan = frames.currentItem;
		if (!scan) return null;
		var day = days.currentItem;
		var boxes_for_day = boxes_by_day.has(day) ? boxes_by_day.get(day) : [];
		for (var b of boxes_for_day) {
			if (b.track_id === track.id && b.filename.trim() === scan.filename.trim()) {
				return b;
			}
		}
		return null;
	}

	function scheduleUnselectTrack(track) {
		unselectTimeout = window.setTimeout(() => unselectTrack(track), 250);
	}

	function unselectTrack(track) {

		// The track may have already been unselected. If so, return
		if (selectedTrack !== track) {
			return;
		}

		// Tell viewer to clear selection
		viewer.update({ selectedTrackId: null });

		// Disable tooltip
		document.getElementById("labeltip").style.visibility = "hidden";

		// Disable keyboard shortcuts
		var zero_code = 48; // keycode for 0
		for(let i=0; i < labels.length; i++) {
			delete keymap[zero_code + parseInt(i+1)];
		}

		selectedTrack = null;

	}

	function setTrackLabel(track, label) {
		let i = labels.indexOf(label);
		document.getElementById("label" + i).checked = true;
		track.label = label;
		track.user_labeled = true;

		// Update viewer filtered state
		viewer.update({ filteredTrackIds: buildFilteredTrackIds() });

		// Warn before closing window
		window.onbeforeunload = function() {
			return true;
		};
	}

	/* -----------------------------------------
	 * Helpers
	 * ---------------------------------------- */

	function buildViewerFrames(scanList, datasetName, datasetConfig) {
		return scanList.map(function(scan) {
			var urls = get_urls(scan.filename, datasetName, datasetConfig);
			return { filename: scan.filename, imageUrls: { dz: urls[0], vr: urls[1] } };
		});
	}

	function buildFilteredTrackIds() {
		var filtered = new Set();
		for (var [id, track] of tracks) {
			if (track.label !== 'swallow-roost') filtered.add(id);
		}
		return filtered;
	}

	function titleCase(s) {
		return s.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); })
			.replace(/\bAfb\b/g, 'AFB');
	}

	function batchTitle(batch) {
		var code = batch.substring(0, 4);
		var info = stationCoords && stationCoords[code];
		if (!info || !info.name) return '';
		return titleCase(info.name) + (info.st ? ', ' + info.st : '');
	}

	function buildMapConfig() {
		if (!mapEnabled || !geoFeatures || !stationCoords) return null;
		var code = nav.batch ? nav.batch.substring(0, 4) : null;
		if (!code || !stationCoords[code]) return null;
		var coords = stationCoords[code];
		return {
			lat: coords.lat,
			lon: coords.lon,
			features: geoFeatures,
		};
	}

	function buildStationInfo() {
		var code = nav.batch ? nav.batch.substring(0, 4) : null;
		if (!code || !stationCoords || !stationCoords[code]) return null;
		var info = stationCoords[code];
		return { code: code, name: info.name, st: info.st, county: info.county, country: info.country, elev: info.elev, lat: info.lat, lon: info.lon, tz: info.tz };
	}

	function loadGeoData() {
		return Promise.all([
			d3.json('data/stations.json'),
			d3.json('data/geo/states-10m.json'),
			d3.json('data/geo/counties-10m.json'),
			d3.json('data/geo/lakes.json'),
			d3.json('data/geo/neighbors-10m.json'),
		]).then(function(results) {
			stationCoords = results[0];
			var statesTopo = results[1];
			var countiesTopo = results[2];
			var lakesGeo = results[3];
			var neighborsTopo = results[4];
			geoFeatures = {
				nation: topojson.feature(statesTopo, statesTopo.objects.nation),
				neighbors: topojson.feature(neighborsTopo, neighborsTopo.objects.countries),
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

	/* -----------------------------------------
	 * UI
	 * ---------------------------------------- */

	UI.handle_config = function(data) {
		config = data;
	};

	UI.init = function()
	{
		// Populate data and set event handlers
		document.getElementById("export").addEventListener("click", export_sequences);
		document.body.addEventListener("keydown", handle_keydown);

		// Map toggle
		var mapToggle = document.getElementById("mapToggle");
		if (mapToggle) {
			mapToggle.addEventListener("change", function() {
				mapEnabled = mapToggle.checked;
				if (viewer) viewer.update({ mapConfig: buildMapConfig() });
			});
		}


		// Load geo data (non-blocking)
		loadGeoData();

		// Populate datasets
		var datasets = d3.select('#datasets');
		var options = datasets.selectAll("options")
			.data(config['datasets'])
			.enter()
			.append("option")
			.text(d => d);

		datasets.node().addEventListener("change", change_dataset);
		Object.assign(filters, defaultFilters);
		render_filters();

		let url_nav = url2obj(window.location.hash.substring(1));
		Object.assign(nav, url_nav);
		render_dataset();
	};


	function handle_keydown(e) {
		var tagName = e.target.tagName;
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



	/* -----------------------------------------
	 * Filtering
	 * ---------------------------------------- */

	function enable_filtering() {
		for (let id of ["detections_min", "high_quality_detections_min", "score_min", "avg_score_min"]) {
			document.getElementById(id).addEventListener("change", change_filter);
		}
	}

	function change_filter() {
		let filterSettings = {
			score_min: +document.getElementById("score_min").value,
			detections_min: +document.getElementById("detections_min").value,
			high_quality_detections_min: +document.getElementById("high_quality_detections_min").value,
			avg_score_min: +document.getElementById("avg_score_min").value
		};
		updateTracks(boxes, tracks, filterSettings);
		if (!viewer) return;
		viewer.update({ filteredTrackIds: buildFilteredTrackIds() });
		recomputeActiveTracks();
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

		let datasets = document.getElementById('datasets');
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

			document.getElementById('datasets').value = dataset;

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
				.text(d => d)
				.attr('title', d => batchTitle(d));
			batchesSelect.node().addEventListener("change", change_batch);

			// If the batch nav is not set already, use the selected value
			// from the dropdown list
			if (! nav.batch) {
				nav.batch = document.getElementById('batches').value;
			}

			render_batch();
		}
	}


	/* -----------------------------------------
	 * 2. Batch
	 * ---------------------------------------- */

	function change_batch() {
		let batches = document.getElementById('batches');
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

			document.getElementById('batches').value = nav.batch;

			let result = await loadBatch(dataset_config, nav);
			scans = result.scans;
			boxes = result.boxes;
			boxes_by_day = result.boxesByDay;
			tracks = result.tracks;
			day_notes = result.dayNotes;

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

			dateSelect.node().addEventListener("change", change_day);

			render_day();
		}
	}



	/* -----------------------------------------
	 * 3. Day
	 * ---------------------------------------- */

	function change_day() {
		let n = document.getElementById("dateSelect");
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
		document.getElementById("dateSelect").value = days.currentInd;

		var day_key = days.currentItem; // string representation of date

		// Populate day notes set up handlers
		var notesEl = document.getElementById("dayNotes");
		notesEl.value = day_notes.get(day_key);
		notesEl.onchange = () => save_day_notes();
		notesEl.onkeydown = (e) => {
			if (e.which == 13) notesEl.blur();
		};

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

		timeSelect.node().onchange = () => {
			var n = document.getElementById("timeSelect");
			n.blur();
			frames.currentInd = n.value;
			update_nav_then_render_frame();
		};

		// Destroy previous viewer
		if (viewer) {
			viewer.destroy();
			viewer = null;
		}

		// Build frames and boxes for viewer
		var viewerFrames = buildViewerFrames(allframes, nav.dataset, dataset_config);
		var dayBoxes = boxes_by_day.get(day_key) || [];

		// Mark all tracks for this day as viewed
		for (var b of dayBoxes) {
			b.track.viewed = true;
		}

		var container = document.getElementById("viewer");
		viewer = new RoostViewer(container, {
			frames: viewerFrames,
			boxes: dayBoxes,
			imageKeys: ['dz', 'vr'],
			mapConfig: buildMapConfig(),
			stationInfo: buildStationInfo(),
			filteredTrackIds: buildFilteredTrackIds(),
			onTrackHover: function(trackId, trackBoxes, rect) {
				if (trackId) {
					var track = tracks.get(trackId);
					selectTrack(track, rect);
				} else {
					if (selectedTrack) scheduleUnselectTrack(selectedTrack);
				}
			},
			onTrackClick: function(trackId) {
				var track = tracks.get(trackId);
				setTrackLabel(track, 'non-roost');
			}
		});

		navigateToFrame();
	}

	function save_day_notes() {
		let key = days.currentItem; // string representation of date
		let value = document.getElementById("dayNotes").value;
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
		navigateToFrame();
	}

	function mapper(box) {
		var ll = box.lat + "," + box.lon;
		var url = "http://maps.google.com/?q=" + ll + "&ll=" + ll + "&z=8";
		//var url = "http://www.google.com/maps/search/?api=1&query=" + ll + "&zoom=8&basemap=satellite";
		window.open(url);
	}

	function navigateToFrame() {
		if(!days) return;

		if (selectedTrack) {
			unselectTrack(selectedTrack);
		}

		frames.currentInd = nav.frame;
		document.getElementById("timeSelect").value = frames.currentInd;

		viewer.setFrame(frames.currentInd);

		recomputeActiveTracks();

		var url = window.location.href.replace(window.location.hash,"");
		history.replaceState({}, "", url + "#" + obj2url(nav));
	}

	function recomputeActiveTracks() {
		if (!frames) return;
		var day = days.currentItem;
		var scan = frames.currentItem;
		var boxes_for_day = boxes_by_day.has(day) ? boxes_by_day.get(day) : [];
		var boxes_for_scan = boxes_for_day.filter(function(d) {
			return d.filename.trim() === scan.filename.trim();
		});
		active_tracks = boxes_for_scan.map(function(b) { return tracks.get(b.track_id); });
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
			viewer.update({ selectedTrackId: track.id });
			var rect = viewer.getTrackRect(track.id);
			if (rect) selectTrack(track, rect);
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
			viewer.update({ selectedTrackId: track.id });
			var rect = viewer.getTrackRect(track.id);
			if (rect) selectTrack(track, rect);
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
		let filename = `roost_labels_${document.getElementById("batches").value}.csv`;

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
