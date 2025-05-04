import Track from './Track.js'

/**
 * Box object for track. 
 */
export default class Box {
    constructor(obj) {
        obj && Object.assign(this, obj);

        this.setTrack(new Track({}));
    }

    setTrack(t) {
        this.track = t;
    }
}
