
import * as React from 'react'
import { createRoot } from 'react-dom/client';
import { BoolList } from './BoolList.js';
import {
    parse_time, parse_scan,
    get_urls, obj2url, parse_day
} from './utils.js';
import Track from './Track.js';
import * as d3 from 'd3';


/**
 * Contains React component to view and interact with svgs and tracks. 
 */

export function save_notes(box) {
    box.track.notes = document.getElementById('notes').value;
    box.user_labeled = true;
}

function unique(a) {
    return [...new Set(a)];
}

function isObjEmpty(obj) {
    return Object.keys(obj).length === 0;
}

//Renders the current frame based on user input  (current frame = dataset, batch, day, time set )
export function render_frame() {
    var days = window.days;

    if (isObjEmpty(days)) return;

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
    active_tracks = boxes_for_scan.map(b => window.tracks.get(b.track_id));

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

//Renders the current day based on user input (current day = dataset, batch, day set )
function render_day() {
    var days = window.days;

    if (window.nav["dataset"] === "") return;

    days.currentInd = nav.day;

    d3.select("#dateSelect").property("value", days.currentInd);
    

    var day_key = days.currentItem; // string representation of date


    if (window.discount_toggle) {
        let ud = window.unviewed_days
        let current = window.displayed_discount_dates[nav.day];
        window.unviewed_days = ud.filter(e => e !== current)
    }

    // Populate day notes set up handlers
    var notes = d3.select("#dayNotes");
    if (window.day_notes.get(day_key)) {
        notes.node().value = window.day_notes.get(day_key);
    }

    notes.on("change", () => save_day_notes());
    /* notes.on("keydown", (e) => {
        if (e.which == 13) notes.node().blur();
    });
    */
    // 
    var allframes = window.scans.get(day_key); // list of scans
    var frames_with_roosts = [];
    if (boxes_by_day.has(day_key)) {
        frames_with_roosts = boxes_by_day.get(day_key).map(d => d.filename);
    }

    if (allframes) {
        frames = new BoolList(allframes, frames_with_roosts);
    }

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
    window.day_notes.set(key, value);
}

export function update_nav_then_render_frame() {
    nav.frame = frames.currentInd;
    render_frame();
}

function ViewModule() {
    render_day();
    return (
        <div>
            <img id="img1" />
            <svg id="svg1" />
            <img id="img2" />
            <svg id="svg2" />
        </div>

    );
}

export default ViewModule

const domNode = document.getElementById('viewer');
const root = createRoot(domNode);
root.render(<ViewModule />);

