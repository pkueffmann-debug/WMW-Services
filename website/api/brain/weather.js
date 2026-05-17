// /api/brain/weather?location=Berlin — current weather + short forecast
// via wttr.in (free, no API key needed). Returns JSON shaped for the
// dashboard cards.

const { gate } = require('../_lib/auth');

module.exports = async (req, res) => {
  const user = await gate(req, res);
  if (!user) return;

  // Accept ?location=Berlin or ?lat=52.5&lon=13.4
  const url = new URL(req.url || '/', 'http://x');
  let loc = url.searchParams.get('location') || '';
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  if (!loc && lat && lon) loc = `${lat},${lon}`;
  if (!loc) loc = 'Berlin';

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://wttr.in/${encodeURIComponent(loc)}?format=j1`, {
      signal: ctrl.signal,
      headers: { 'Accept-Language': 'de', 'User-Agent': 'JARVIS/0.2' },
    });
    clearTimeout(tid);
    if (!r.ok) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: `wttr.in ${r.status}` }));
    }
    const j = await r.json();
    const cur  = (j.current_condition || [])[0] || {};
    const area = (j.nearest_area || [])[0] || {};
    const today = (j.weather || [])[0] || {};
    const tomorrow = (j.weather || [])[1] || {};

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.end(JSON.stringify({
      fetched_at: new Date().toISOString(),
      location: area.areaName?.[0]?.value || loc,
      country:  area.country?.[0]?.value || '',
      temp_c:        Number(cur.temp_C),
      feels_like_c:  Number(cur.FeelsLikeC),
      condition:     cur.weatherDesc?.[0]?.value || cur.lang_de?.[0]?.value || '',
      humidity:      Number(cur.humidity),
      wind_kmh:      Number(cur.windspeedKmph),
      wind_dir:      cur.winddir16Point || '',
      today: {
        min_c: Number(today.mintempC),
        max_c: Number(today.maxtempC),
        sun_hours: Number(today.sunHour),
      },
      tomorrow: {
        min_c: Number(tomorrow.mintempC),
        max_c: Number(tomorrow.maxtempC),
        condition: tomorrow.hourly?.[4]?.lang_de?.[0]?.value
                || tomorrow.hourly?.[4]?.weatherDesc?.[0]?.value
                || '',
      },
    }));
  } catch (e) {
    console.error('[weather]', e?.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e?.message || 'weather fetch failed' }));
  }
};
