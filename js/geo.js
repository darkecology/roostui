import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export function titleCase(s) {
	return s.toLowerCase().replace(/\b\w/g, function(c) { return c.toUpperCase(); })
		.replace(/\bAfb\b/g, 'AFB');
}

export function loadGeoData(basePath) {
	return Promise.all([
		d3.json(basePath + 'stations.json'),
		d3.json(basePath + 'geo/states-10m.json'),
		d3.json(basePath + 'geo/counties-10m.json'),
		d3.json(basePath + 'geo/lakes.json'),
		d3.json(basePath + 'geo/neighbors-10m.json'),
	]).then(function(results) {
		var stationCoords = results[0];
		var statesTopo = results[1];
		var countiesTopo = results[2];
		var lakesGeo = results[3];
		var neighborsTopo = results[4];
		var geoFeatures = {
			nation: topojson.feature(statesTopo, statesTopo.objects.nation),
			neighbors: topojson.feature(neighborsTopo, neighborsTopo.objects.countries),
			states: topojson.mesh(statesTopo, statesTopo.objects.states, function(a, b) { return a !== b; }),
			counties: topojson.mesh(countiesTopo, countiesTopo.objects.counties, function(a, b) { return a !== b; }),
			lakes: lakesGeo,
		};
		return { stationCoords: stationCoords, geoFeatures: geoFeatures };
	});
}

export function buildMapConfig(stationCode, stationCoords, geoFeatures) {
	if (!geoFeatures || !stationCoords) return null;
	if (!stationCode || !stationCoords[stationCode]) return null;
	var coords = stationCoords[stationCode];
	return {
		lat: coords.lat,
		lon: coords.lon,
		features: geoFeatures,
	};
}

export function buildStationInfo(stationCode, stationCoords) {
	if (!stationCode || !stationCoords || !stationCoords[stationCode]) return null;
	var info = stationCoords[stationCode];
	return { code: stationCode, name: info.name, st: info.st, county: info.county, country: info.country, elev: info.elev, lat: info.lat, lon: info.lon, tz: info.tz };
}
