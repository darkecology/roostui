import * as d3 from 'd3';

var PANEL_SIZE = 600;
var RANGE_M = 150000;
var EARTH_R = 6371000;

export class MapOverlay {

	constructor(canvas, config) {
		this._canvas = canvas;
		this._ctx = canvas.getContext('2d');
		this._config = config;   // { lat, lon, features }
		this._projection = null;
		this._path = null;
		this._setupProjection();
		this.render();
	}

	_setupProjection() {
		var scale = (PANEL_SIZE / 2) / (RANGE_M / EARTH_R);
		this._projection = d3.geoAzimuthalEquidistant()
			.rotate([-this._config.lon, -this._config.lat])
			.translate([PANEL_SIZE / 2, PANEL_SIZE / 2])
			.scale(scale);
		this._path = d3.geoPath(this._projection, this._ctx);
	}

	render() {
		var ctx = this._ctx;
		var path = this._path;
		var features = this._config.features;

		ctx.clearRect(0, 0, PANEL_SIZE, PANEL_SIZE);

		// Ocean: fill everything outside land masses with blue tint.
		// Uses evenodd fill rule: outer rect + land path = fills the gap.
		var landFeature = features.land || features.nation;
		if (landFeature) {
			ctx.beginPath();
			ctx.rect(0, 0, PANEL_SIZE, PANEL_SIZE);
			path(landFeature);
			ctx.fillStyle = 'rgba(70, 130, 180, 0.25)';
			ctx.fill('evenodd');
		}

		// Inland water bodies (same blue fill)
		if (features.lakes) {
			ctx.beginPath();
			path(features.lakes);
			ctx.fillStyle = 'rgba(70, 130, 180, 0.25)';
			ctx.fill();
		}

		// Coastline (nation boundary)
		if (features.nation) {
			ctx.beginPath();
			path(features.nation);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// County boundaries (thin gray stroke)
		if (features.counties) {
			ctx.beginPath();
			path(features.counties);
			ctx.strokeStyle = 'rgba(180, 180, 180, 0.4)';
			ctx.lineWidth = 0.5;
			ctx.stroke();
		}

		// State boundaries (white, thicker)
		if (features.states) {
			ctx.beginPath();
			path(features.states);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
	}

	update(config) {
		var needsReproject = (config.lat !== this._config.lat || config.lon !== this._config.lon);
		this._config = config;
		if (needsReproject) {
			this._setupProjection();
		}
		this.render();
	}

	invert(x, y) {
		return this._projection.invert([x, y]);
	}

	destroy() {
		this._ctx.clearRect(0, 0, PANEL_SIZE, PANEL_SIZE);
	}
}
