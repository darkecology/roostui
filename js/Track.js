import * as d3 from 'd3';
import { update_nav_then_render_frame } from './Viewer.js';
import sprintf from 'sprintf';

/**
 * Creates and handles tracks. 
 */

export default class Track {

    constructor(obj) {
        obj && Object.assign(this, obj);
        this.nodes = new Map();
    }

    // Each SVG has a DOM element for the track
    setNode(n, svg) {
        this.nodes.set(svg, n);
    }

    //sets current track as the selected track 
    setSelected() {
        Track.selectedTrack = this;
    }

    //opens the current track in google maps using the longitude and latitude given by the box
    mapper(box) {
        var ll = box.lat + "," + box.lon;
        var url = "http://maps.google.com/?q=" + ll + "&ll=" + ll + "&z=8";
        //var url = "http://www.google.com/maps/search/?api=1&query=" + ll + "&zoom=8&basemap=satellite";
        window.open(url);
    }

    //saves the notes input by the user 
    save_notes(box) {
        box.track.notes = document.getElementById('notes').value;
        box.user_labeled = true;
    }

    //selects the track and opens the tooltip 
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

        // Create mapper link
        var box = d3.select(node).datum(); // the Box object
        var link = tip.select("#mapper")
            .html('<a href="#"> View on map</a>')
            .on("click", () => this.mapper(box));

        var zero_code = 48;
        for (let i = 0; i < labels.length; i++) {
            window.keymap[zero_code + parseInt(i + 1)] =
                ((label) => () => this.setLabel(label))(labels[i]);
        }
        // Create notes box
        var notes = tip.select("#notes");
        notes.node().value = box.track.notes;
        notes.on("change", () => this.save_notes(box));
        notes.on("keydown", (e) => {
            if (e.which == 13) notes.node().blur();
        });

        // Create delete track option for the particular box
        // Create delete track button
        var deleteButton = tip.select("#delete_track");
        deleteButton.html('<button>Delete track</button>')
            .on("click", () => this.delete_track(box.track.id));
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

    //unselect the track 
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

        Track.selectedTrack = null;

    }

    //sets track label based on user input 
    setLabel(label) {
        let i = window.labels.indexOf(label);
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

    //deletes the track 
    delete_track(track_id) {

        // find the track
        if (window.tracks.has(track_id)) {
            window.tracks.delete(track_id);
        }

        // clear the selected track
        Track.selectedTrack = null;

        // remove the box associated with the track
        window.boxes = boxes.filter(box => box.track_id !== track_id);

        // Update boxes_by_day too
        for (let [date, boxesArray] of boxes_by_day.entries()) {
            window.boxes_by_day.set(date, boxesArray.filter(box => box.track_id !== track_id));
        }
        // re-render frame
        update_nav_then_render_frame();
    }

}