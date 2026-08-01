require("dotenv").config();

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "meta-llama/llama-3.1-8b-instruct:free";
const AI_BASE_URL = process.env.AI_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";

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

async function getAiContent(location, weather) {
  if (!AI_API_KEY) {
    throw new Error("AI API key is not configured.");
  }

  const current = weather.current;
  const place = [
    location.name,
    location.admin1,
    location.country
  ].filter(Boolean).join(", ");
  const weatherCondition = WEATHER_CODES[current.weather_code] || "Unknown";

  const prompt = [
    "You are a concise weather assistant.",
    `Create a helpful weather response for ${place}.`,
    `Current details: ${weatherCondition.toLowerCase()}, ${current.temperature_2m}°C, feels like ${current.apparent_temperature}°C, humidity ${current.relative_humidity_2m}%, wind ${current.wind_speed_10m} km/h, precipitation ${current.precipitation} mm.`,
    "Return valid JSON only with two keys: summary and advice.",
    "summary must be one short natural sentence.",
    "advice must be an array of exactly three objects with title and advice fields."
  ].join(" ");

  const response = await fetch(AI_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: "You write short, friendly weather summaries and practical advice in JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    let errorMessage = "The AI service could not generate content.";

    try {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorMessage;
    } catch {
      // Ignore JSON parsing errors and keep the default message.
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("The AI service returned no content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("The AI response format was invalid.");
    }
    parsed = JSON.parse(match[0]);
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const advice = Array.isArray(parsed.advice)
    ? parsed.advice
        .filter((item) => item && typeof item.title === "string" && typeof item.advice === "string")
        .slice(0, 3)
    : [];

  if (!summary || advice.length < 3) {
    throw new Error("The AI response was incomplete.");
  }

  return {
    summary,
    advice
  };
}

async function buildAgentResponse(location, weather) {
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

  const weatherCondition = WEATHER_CODES[current.weather_code] || "Unknown";
  const aiContent = await getAiContent(location, weather);

  return {
    message: aiContent.summary,
    summary: aiContent.summary,
    location: {
      name: place,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: weather.timezone
    },
    current: {
      condition: weatherCondition,
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m
    },
    advice: aiContent.advice,
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

    const agentResponse = await buildAgentResponse(location, weather);
    sendJson(response, 200, agentResponse);
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
