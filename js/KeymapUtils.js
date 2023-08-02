import { update_nav_then_render_frame } from './Viewer.js';
import { update_nav_then_render_day } from './vis.js';
import * as d3 from 'd3';
import Track from './Track.js'

/**
 * This file keeps track of two keymaps and their respective functions. 
 *  up/down for days
 *  left/right for frames
 *  hover on box or use tab/shift-tab to select for labeling 
 */


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
function enable_shortcuts() {
    for (let i = 0; i < labels.length; i++) {
        keymap['48' + parseInt(i + 1)] =
            ((label) => () => this.setLabel(label))(labels[i]);
    }
}

const keymap = {
    '9': next_box, // tab
    '27': unselect_box, // esc
    '38': prev_day, // up
    '40': next_day, // down 
    '37': prev_frame,	// left
    '39': next_frame,   // right
    '48': enable_shortcuts
};

const shift_keymap = {
    '9': prev_box, // tab
    '38': prev_day_with_roost, // up
    '40': next_day_with_roost, // down */
    '37': prev_frame_with_roost,	// left
    '39': next_frame_with_roost   // right
};

export default function handle_keydown(e) {
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




