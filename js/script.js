const CLEAR_FAVORITES_ON_LOAD = true;  // empty favorites every time refresh web page
const API_KEY = "***";//Add API key from OpenWeather to get data!! 

let UNIT = "C"; 
let chart = null;    // Frappe chart instance
let lastSunrise = null, lastSunset = null;

// Status for export
let lastLabels = [];    // 24h
let currentDatasets = []; 
let lastHourly = { temp: [] };


const cityInput  = document.getElementById("cityInput");
const searchBtn   = document.getElementById("searchBtn");
const geoBtn  = document.getElementById("geoBtn");
const unitSelect  = document.getElementById("unitSelect");
const favBtn  = document.getElementById("favBtn");
const favSelect  = document.getElementById("favSelect");

const cityNameEl = document.getElementById("cityName");
const descEl  = document.getElementById("description");
const tempEl  = document.getElementById("temperature");
const iconEl  = document.getElementById("weatherIcon");
const hourlyWrap = document.getElementById("hourlyScroll");
const dailyWrap = document.getElementById("forecastContainer");


const aqiLine  = document.getElementById("aqiLine");


searchBtn.addEventListener("click", () => {
  const q = cityInput.value.trim();
  if (!q) return alert("Please enter a city name!");
  fetchByCity(q);
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return alert("Geolocation not supported.");
  navigator.geolocation.getCurrentPosition(
    pos => fetchByCoords(pos.coords.latitude, pos.coords.longitude),
    () => alert("Unable to access your location.")
  );
});

unitSelect.addEventListener("change", () => {
  UNIT = unitSelect.value;
  if (window.__lastCoords) {
    const {lat, lon, name} = window.__lastCoords;
    fetchByCoords(lat, lon, name);
  }
});

favBtn.addEventListener("click", addCurrentToFavorites);
favSelect.addEventListener("change", e => {
  const v = e.target.value;
  if (!v) return;
  try {
    const item = JSON.parse(v);
    fetchByCoords(item.lat, item.lon, item.name);
  } finally {
    favSelect.selectedIndex = 0; 
  }
});

/**Different Units */
const c2f = c => (c * 9/5 + 32);
const c2k = c => (c + 273.15);
function toUnit(celsius){
  if (UNIT === "F") return c2f(celsius);
  if (UNIT === "K") return c2k(celsius);
  return celsius;
}
function formatTemp(celsius){
  const v = toUnit(celsius);
  const suffix = UNIT === "C" ? "°C" : (UNIT === "F" ? "°F" : " K");
  return `${v.toFixed(1)} ${suffix}`;
}
function mapArrayToUnit(arrCelsius){ return arrCelsius.map(toUnit); }

/**Different background */
function applyBackground(tempC){
  const now = Date.now()/1000;
  const isNight = (lastSunrise && lastSunset) ? (now < lastSunrise || now > lastSunset) : false;
  document.body.classList.toggle("night", isNight);

  let bg;
  if (tempC <= 0)      bg = "linear-gradient(135deg,#93c5fd,#e0f2fe)";
  else if (tempC >=25) bg = "linear-gradient(135deg,#fecaca,#fde68a)";
  else                 bg = "linear-gradient(135deg,#a8dadc,#f1faee)";

  if (isNight) bg = "radial-gradient(1200px 600px at 50% -10%, #1f2937, #0b1020)";
  document.body.style.background = bg;
}

/**Get weather icon from OpenWeather */
function meteoCodeToOWIcon(code, isDay=true){
  if (code === 0) return isDay ? "01d" : "01n";
  if ([1].includes(code)) return isDay ? "02d" : "02n";
  if ([2].includes(code)) return isDay ? "03d" : "03n";
  if ([3].includes(code)) return isDay ? "04d" : "04n";
  if ([45,48].includes(code)) return "50d";
  if ([51,53,55,56,57].includes(code)) return "09d";
  if ([61,63,65,80,81,82,66,67].includes(code)) return "10d";
  if ([71,73,75,77,85,86].includes(code)) return "13d";
  if ([95,96,99].includes(code)) return "11d";
  return isDay ? "02d" : "02n";
}

/**Favorite cities, using local storage*/
const FAV_KEY = "weather_favorites_v1";
function loadFavorites(){ try{ return JSON.parse(localStorage.getItem(FAV_KEY))||[]; }catch{ return []; } }
function saveFavorites(list){ localStorage.setItem(FAV_KEY, JSON.stringify(list)); }
function renderFavorites(){
  const list = loadFavorites();
  favSelect.innerHTML = '<option value="">Favorites…</option>' +
    list.map(x=>`<option value='${JSON.stringify(x)}'>${x.name}</option>`).join("");
  favSelect.selectedIndex = 0;
}
function initFavorites(){
  if (CLEAR_FAVORITES_ON_LOAD) { try{ localStorage.removeItem(FAV_KEY); }catch{} }
  renderFavorites();
}
function addCurrentToFavorites(){
  const data = window.__lastCoords;
  if (!data) return alert("Search a city first.");
  let list = loadFavorites();
  if (!list.some(x => x.name===data.name && x.lat===data.lat && x.lon===data.lon)){
    list.push(data); saveFavorites(list); renderFavorites();
    alert("Saved to favorites.");
  } else alert("Already in favorites.");
}

/**Fetch weather*/
function fetchByCity(city){
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`;
  fetch(url).then(r=>r.json()).then(d=>{
    if (d.cod !== 200) throw new Error("City not found or invalid key");
    lastSunrise = d.sys?.sunrise; lastSunset = d.sys?.sunset;
    window.__lastCoords = { lat:d.coord.lat, lon:d.coord.lon, name:d.name };
    renderCurrent(d);
    fetchForecasts(d.coord.lat, d.coord.lon);
  }).catch(e=>alert(e.message));
}

function fetchByCoords(lat, lon, nameHint){
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
  fetch(url).then(r=>r.json()).then(d=>{
    lastSunrise = d.sys?.sunrise; lastSunset = d.sys?.sunset;
    window.__lastCoords = { lat, lon, name:d.name||nameHint||"Current location" };
    renderCurrent(d);
    fetchForecasts(lat, lon);
  }).catch(e=>console.error(e));
}

/**Different sources*/
function fetchForecasts(lat, lon){
  const owURL    = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
  const meteoURL =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`; // [修复: 时区对齐] Open-Meteo 返回地点时区的本地时间
  const metNoURL = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;

  Promise.all([
    fetch(owURL).then(r=>r.json()),
    fetch(meteoURL).then(r=>r.json()),
    // MET Norway request sometimes fail, so added error handelling
    fetch(metNoURL).then(r=>r.json()).catch(()=>null)
  ])
  .then(([ow, meteo, metno]) => {
    // 24h double line（OpenWeather 3h→1h vs Open-Meteo 1h）
    draw24hChartHourly(ow, meteo.hourly); // Fix: city.timezone for time axis alignment

    // Try to add the 3rd line
    try {
      if (metno?.properties?.timeseries && chart) {
        const metNoVals = extractMetNo24hToUnit(metno); // transform unit
        if (metNoVals.some(v => v != null)) {
          currentDatasets.push({ name:"MET Norway", values: metNoVals });
          requestAnimationFrame(() => {
          chart.update({ labels: lastLabels, datasets: currentDatasets });
        });
      }
    }
} catch {}


    renderHourlyScroll(meteo.hourly);
    renderDaily7(meteo.daily);

    // Get PM2.5 data
    fetchPM25_OpenWeather(lat, lon);
  })
  .catch(err => console.error("Forecast fetch error:", err));
}

/**Current weather*/
function renderCurrent(d){
  const t = d.main?.temp ?? 0;
  cityNameEl.textContent = `${d.name}, ${d.sys?.country ?? ""}`;
  descEl.textContent     = d.weather?.[0]?.description ?? "--";
  tempEl.textContent     = formatTemp(t);
  iconEl.src = `https://openweathermap.org/img/wn/${(d.weather?.[0]?.icon||"01d")}@4x.png`;
  applyBackground(t);
}

/**24h chart*/
function draw24hChartHourly(owAll, meteoHourly){
  // Fix: Open-Meteo return local time
  const tz = owAll?.city?.timezone || 0;        // seconds
  const list = owAll?.list || [];
  const allTimes = meteoHourly.time || [];
  const allTemps = meteoHourly.temperature_2m || [];

  // OpenWeather 3h interporate to horly
  function keyFromLocalSec(localSec){
    const d = new Date(localSec * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const day = String(d.getUTCDate()).padStart(2,'0');
    const h = String(d.getUTCHours()).padStart(2,'0');
    return `${y}-${m}-${day}T${h}`;
  }
  function shiftKey(key, delta){
    const d = new Date(key + ':00:00Z');
    d.setUTCHours(d.getUTCHours() + delta);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const day = String(d.getUTCDate()).padStart(2,'0');
    const h = String(d.getUTCHours()).padStart(2,'0');
    return `${y}-${m}-${day}T${h}`;
  }

  //interporate 3 hour data to hourly data in 24 hours
  const owMap = new Map();
  for (let i=0; i<list.length-1; i++){
    const a = list[i], b = list[i+1];
    const baseLocal = (a.dt||0) + tz;
    const nextLocal = (b.dt||0) + tz;
    const v0 = a?.main?.temp, v1 = b?.main?.temp;
    if (typeof v0 !== "number" || typeof v1 !== "number") continue;
    for (let h=0; h<3; h++){
      const key = keyFromLocalSec(baseLocal + h*3600);
      const val = v0 + (v1 - v0) * (h/3);
      owMap.set(key, val);
    }
    owMap.set(keyFromLocalSec(nextLocal), v1);
  }


  //Find the match in the 48h data provided by Open-Meteo
  const H = Math.min(48, allTimes.length);
  let bestStart = 0, bestCount = -1;
  for (let s=0; s<=H-24; s++){
    let cnt = 0;
    for (let i=0; i<24; i++){
      const k = allTimes[s+i].slice(0,13);
      if (owMap.has(k) || owMap.has(shiftKey(k,1)) || owMap.has(shiftKey(k,-1)) ||
          owMap.has(shiftKey(k,2)) || owMap.has(shiftKey(k,-2))) cnt++;
    }
    if (cnt > bestCount){ bestCount = cnt; bestStart = s; }
  }

  //Take out the final data used for drawing
  const omTimes = allTimes.slice(bestStart, bestStart+24);
  const omC     = allTemps.slice(bestStart, bestStart+24);


  //Generate time labels used in the x-axis
  const labels = omTimes.map(s => s.slice(11,13) + ":00");

  //For each hour, first use "YYYY-MM-DDTHH" as key to find temperature in owMAP
  //If cannot find, shft 1/2/3 hours for other values
  //If still cannot find, target it as null
  const owValsRaw = omTimes.map(k0 => {
    const k = k0.slice(0,13);
    if (owMap.has(k)) return owMap.get(k);
    for (let step of [1,-1,2,-2,3,-3]) {
      const k2 = shiftKey(k, step);
      if (owMap.has(k2)) return owMap.get(k2);
    }
    return null;
  });


  //Filling null with reasonable balue
  //Left to right, Find the first value that is not null, as "prev"
  let prev = null;
  for (let i=0;i<owValsRaw.length;i++){
    if (owValsRaw[i]==null) continue;
    prev = owValsRaw[i]; break;
  }
  //Fill the first "null" with "prev"'s value
  for (let i=0;i<owValsRaw.length;i++){
    if (owValsRaw[i]==null) owValsRaw[i] = prev;
    else prev = owValsRaw[i];
  }

  //Right to left, find the first value that is not null, as "next"
  let next = null;
  for (let i=owValsRaw.length-1;i>=0;i--){
    if (owValsRaw[i]==null) continue;
    next = owValsRaw[i]; break;
  }
  //Fill the first "null" with "next"'s value
  for (let i=owValsRaw.length-1;i>=0;i--){
    if (owValsRaw[i]==null) owValsRaw[i] = next;
    else next = owValsRaw[i];
  }

  //If there's still null, set it as 0
  for (let i=0;i<owValsRaw.length;i++){
    if (owValsRaw[i]==null) owValsRaw[i] = 0;
  }

  lastLabels = labels;
  const owVals    = mapArrayToUnit(owValsRaw).map(v => Number(v.toFixed(1)));
  const meteoVals = mapArrayToUnit(omC).map(v => Number(v.toFixed(1)));

  currentDatasets = [
    { name:"OpenWeather", values: owVals },
    { name:"Open-Meteo",  values: meteoVals }
  ];

  //Destroy old chart before deawing new one
  if (chart && typeof chart.destroy === "function"){ chart.destroy(); chart = null; }

  //Drawing the final graph
  chart = new frappe.Chart("#chart", {
    title:"24h Temperature Comparison",
    data:{ labels: lastLabels, datasets: currentDatasets },
    type:"line", height:280,
    colors:["#2563eb","#ef4444","#22c55e","#f59e0b"],
    lineOptions:{ regionFill:1 },
    axisOptions:{ xAxisMode:"tick", yAxisMode:"span", xIsSeries:true }
  });
}


// interpolate 8 3h point to 24 1h point（interpolate）
function interpolateToHourly(vals3h){
  const out=[];
  for(let i=0;i<7;i++){
    const a=vals3h[i], b=vals3h[i+1];
    out.push(a, a+(b-a)/3, a+(b-a)*2/3);
  }
  out.push(vals3h[7]);
  return out;
}

/**24h scroll（Open-Meteo） */
function renderHourlyScroll(hourly){
  hourlyWrap.innerHTML="";
  const times = hourly.time.slice(0,24);
  const temps = hourly.temperature_2m.slice(0,24);
  const codes = hourly.weathercode.slice(0,24);
  const isDay = (Date.now()/1000 >= (lastSunrise||0)) && (Date.now()/1000 <= (lastSunset||0));

  times.forEach((iso,i)=>{
    // Take hour from OpenMeteo local time
    const label = iso.slice(11,13) + ":00";
    const icon=meteoCodeToOWIcon(codes[i], isDay);
    const el=document.createElement("div");
    el.className="hour-card";
    el.innerHTML=`<p>${label}</p>
      <img src="https://openweathermap.org/img/wn/${icon}.png" alt="icon">
      <p>${formatTemp(temps[i])}</p>`;
    hourlyWrap.appendChild(el);
  });
}

/**7 days（Open-Meteo）*/
function renderDaily7(daily){
  dailyWrap.innerHTML="";
  const days=daily.time.slice(0,7);
  const tmax=daily.temperature_2m_max.slice(0,7);
  const tmin=daily.temperature_2m_min.slice(0,7);
  const codes=daily.weathercode.slice(0,7);

  days.forEach((iso,i)=>{
    const d=new Date(iso); const wd=d.toLocaleDateString("en",{weekday:"short"});
    const icon=meteoCodeToOWIcon(codes[i], true);
    const el=document.createElement("div");
    el.className="day-card";
    el.innerHTML=`<p>${wd}</p>
      <img src="https://openweathermap.org/img/wn/${icon}.png" alt="icon">
      <p>${formatTemp(tmax[i])} / ${formatTemp(tmin[i])}</p>`;
    dailyWrap.appendChild(el);
  });
}

/**3rd source：MET Norway（hourly）*/
function extractMetNo24hToUnit(metno){
  // metno.properties.timeseries: [{ time: "2025-10-12T13:00:00Z", data:{ instant:{ details:{ air_temperature }}}}, ...]
  const ts = metno?.properties?.timeseries || [];
  const out = [];
  const now = new Date();
  for (let i=0;i<24;i++){
    const target = new Date(now.getTime()+i*3600*1000);
    // Get time with UTC hour
    const prefix = target.toISOString().slice(0,13); // "YYYY-MM-DDTHH"
    const slot = ts.find(s => s.time.startsWith(prefix));
    const c = slot?.data?.instant?.details?.air_temperature;
    out.push(typeof c === "number" ? Number(toUnit(c).toFixed(1)) : null);
  }
  return out;
}

/**PM2.5：OpenWeather Air Pollution*/
function fetchPM25_OpenWeather(lat, lon){
  if (!aqiLine) return; // skip if no such element
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`;
  fetch(url)
    .then(r => r.json())
    .then(d => {
      const val = d?.list?.[0]?.components?.pm2_5;
      aqiLine.textContent = (typeof val === "number")
        ? `PM2.5: ${val} μg/m³`
        : "PM2.5: n/a";
    })
    .catch(() => { aqiLine.textContent = "PM2.5: n/a"; });
}



/**CSV：Export*/
function downloadChartCSV() {
  if (!Array.isArray(lastLabels) || !lastLabels.length ||
      !Array.isArray(currentDatasets) || !currentDatasets.length) {
    alert("Chart data not ready yet.");
    return;
  }
  let csv = "Hour," + currentDatasets.map(d => d.name).join(",") + "\n";
  for (let i = 0; i < lastLabels.length; i++) {
    const row = [lastLabels[i]];
    for (const ds of currentDatasets) {
      row.push((ds.values?.[i] ?? "").toString());
    }
    csv += row.join(",") + "\n";
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "24h_data.csv"; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("btnCsv")?.addEventListener("click", downloadChartCSV);


initFavorites();
