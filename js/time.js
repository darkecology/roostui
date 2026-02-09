import SunCalc from 'suncalc';

/**
 * Get sunrise time for a given date and location.
 * @param {Date} date - any Date on the day of interest (UTC)
 * @param {number} lat - station latitude
 * @param {number} lon - station longitude
 * @returns {Date} sunrise as a JS Date object
 */
export function getSunrise(date, lat, lon) {
	return SunCalc.getTimes(date, lat, lon).sunrise;
}

/**
 * Get timezone abbreviation for an IANA zone at a given date.
 * e.g. "America/New_York" on a summer date -> "EDT"
 * @param {string} ianaZone - IANA timezone ID
 * @param {Date} date - date to determine DST
 * @returns {string} short timezone abbreviation
 */
export function tzAbbrev(ianaZone, date) {
	var parts = new Intl.DateTimeFormat('en-US', {
		timeZone: ianaZone,
		timeZoneName: 'short',
	}).formatToParts(date);
	var tz = parts.find(function(p) { return p.type === 'timeZoneName'; });
	return tz ? tz.value : '';
}

/**
 * Format a scan's time for display.
 * @param {object} scan - scan object with `filename` and `local_time`
 * @param {string} stationTz - IANA timezone ID (e.g. "America/Chicago")
 * @param {Date} sunriseDate - sunrise Date for this day/station
 * @param {boolean} useUTC - if true, show UTC time; else show local time
 * @returns {{ time: string, sunrise: string }} formatted time and sunrise-relative strings
 */
export function formatTime(scan, stationTz, sunriseDate, useUTC) {
	// Parse UTC time from filename: "KAPX20000601_094243" -> "09:42"
	var fn = scan.filename;
	var utcH = fn.substring(13, 15);
	var utcM = fn.substring(15, 17);
	var utcS = fn.substring(17, 19);

	// Parse local time from local_time: "20000601_054243" -> "05:42"
	var lt = scan.local_time;
	var locH = lt.substring(9, 11);
	var locM = lt.substring(11, 13);

	// Build the time string
	var time;
	if (useUTC) {
		time = utcH + ':' + utcM + ' UTC';
	} else {
		// Get timezone abbreviation from the scan's UTC datetime
		var scanDate = new Date(Date.UTC(
			parseInt(fn.substring(4, 8), 10),
			parseInt(fn.substring(8, 10), 10) - 1,
			parseInt(fn.substring(10, 12), 10),
			parseInt(utcH, 10),
			parseInt(utcM, 10),
			parseInt(utcS, 10)
		));
		var tz = tzAbbrev(stationTz, scanDate);
		time = locH + ':' + locM + ' ' + tz;
	}

	// Compute minutes from sunrise
	var sunrise = '';
	var sunriseFull = '';
	if (sunriseDate) {
		var scanUTC = new Date(Date.UTC(
			parseInt(fn.substring(4, 8), 10),
			parseInt(fn.substring(8, 10), 10) - 1,
			parseInt(fn.substring(10, 12), 10),
			parseInt(utcH, 10),
			parseInt(utcM, 10),
			parseInt(utcS, 10)
		));
		var diffMin = Math.round((scanUTC - sunriseDate) / 60000);
		var absMin = Math.abs(diffMin);
		if (diffMin >= 0) {
			sunrise = '+' + diffMin + 'm \u2600';
			sunriseFull = '+' + diffMin + ' min from sunrise';
		} else {
			sunrise = '\u2212' + absMin + 'm \u2600';
			sunriseFull = '\u2212' + absMin + ' min from sunrise';
		}
	}

	return { time: time, sunrise: sunrise, sunriseFull: sunriseFull };
}
