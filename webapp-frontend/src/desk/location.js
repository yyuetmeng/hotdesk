// Device location sent with a check-in (owner 2026-10-16), for later "are you near the seat" checks.
// Never blocks the check-in: when the browser has no location, or the user says no, the reason is sent instead.
// Browsers only give a location on HTTPS (or localhost).
const FAILURE = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

/** Resolves to the check-in body part: { location: { lat, lng, accuracy } } or { location_status }. */
export function checkInLocation(geo = globalThis.navigator?.geolocation, timeoutMs = 6000) {
  if (!geo?.getCurrentPosition) return Promise.resolve({ location_status: 'unsupported' });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ location_status: 'timeout' }), timeoutMs);   // some browsers never answer
    const done = (value) => { clearTimeout(timer); resolve(value); };
    try {
      geo.getCurrentPosition(
        ({ coords }) => done({ location: { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy } }),
        (err) => done({ location_status: FAILURE[err?.code] ?? 'unavailable' }),
        { enableHighAccuracy: true, timeout: timeoutMs - 500, maximumAge: 60000 });
    } catch { done({ location_status: 'unavailable' }); }
  });
}
