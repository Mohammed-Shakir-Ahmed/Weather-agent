const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Heavy drizzle",
  56: "Light freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Moderate rain showers",
  82: "Heavy rain showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with light hail",
  99: "Thunderstorm with heavy hail"
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  response.end(JSON.stringify(data));
}

async function findLocation(city) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("The location service is unavailable.");
  }

  const data = await response.json();
  const location = data.results?.[0];

  if (!location) {
    throw new Error(`No location was found for "${city}".`);
  }

  return location;
}

async function getWeather(latitude, longitude, timezone) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");

  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m"
    ].join(",")
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max"
    ].join(",")
  );
  url.searchParams.set("forecast_days", "3");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", timezone || "auto");

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("The weather service is unavailable.");
  }

  return response.json();
}

function buildAgentResponse(location, weather) {
  const current = weather.current;
  const daily = weather.daily;

  const place = [
    location.name,
    location.admin1,
    location.country
  ].filter(Boolean).join(", ");

  const forecast = daily.time.map((date, index) => ({
    date,
    condition: WEATHER_CODES[daily.weather_code[index]] || "Unknown",
    minimumTemperature: daily.temperature_2m_min[index],
    maximumTemperature: daily.temperature_2m_max[index],
    precipitationChance: daily.precipitation_probability_max[index]
  }));

  return {
    message:
      `It is ${current.temperature_2m}°C in ${place} and feels like ` +
      `${current.apparent_temperature}°C. Conditions are ` +
      `${(WEATHER_CODES[current.weather_code] || "unknown").toLowerCase()}.`,
    location: {
      name: place,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: weather.timezone
    },
    current: {
      condition: WEATHER_CODES[current.weather_code] || "Unknown",
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m
    },
    forecast
  };
}

async function handleWeatherRequest(request, response, url) {
  const city = url.searchParams.get("city")?.trim();

  if (!city) {
    sendJson(response, 400, {
      error: "Enter a city using the city query parameter."
    });
    return;
  }

  if (city.length > 100) {
    sendJson(response, 400, {
      error: "The city name is too long."
    });
    return;
  }

  try {
    const location = await findLocation(city);
    const weather = await getWeather(
      location.latitude,
      location.longitude,
      location.timezone
    );

    sendJson(response, 200, buildAgentResponse(location, weather));
  } catch (error) {
    sendJson(response, 502, {
      error: error.message || "Unable to retrieve weather information."
    });
  }
}

async function serveHomePage(response) {
  try {
    const html = await fs.readFile(
      path.join(PUBLIC_DIR, "index.html"),
      "utf8"
    );

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(html);
  } catch {
    sendJson(response, 500, {
      error: "The application page could not be loaded."
    });
  }
}

const server = http.createServer(async (request, response) => {
  const rawUrl = request.url || "/";
  const baseHost = request.headers.host || `localhost:${PORT}`;
  const base = `http://${baseHost}`;

  let url;
  try {
    url = new URL(rawUrl, base);
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    await serveHomePage(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/weather") {
    await handleWeatherRequest(request, response, url);
    return;
  }

  sendJson(response, 404, { error: "Route not found." });
});

server.listen(PORT, () => {
  console.log(`Weather agent running at http://localhost:${PORT}`);
});
