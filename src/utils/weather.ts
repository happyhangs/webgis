const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export interface WeatherLocation {
  lat: number;
  lng: number;
  name: string;
}

export interface CurrentWeather {
  temp: number;
  humidity: number;
  windSpeed: number;
  weatherText: string;
}

export interface DayWeather {
  date: string;
  tempMax: number;
  tempMin: number;
  precip: number;
  weatherText: string;
}

export interface WeatherResult {
  current: CurrentWeather | null;
  forecast: DayWeather[];
}

export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  lat: 44.3061,
  lng: 86.0806,
  name: '石河子',
};

function wmoText(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '少云';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if (code >= 45 && code <= 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95 && code <= 99) return '雷暴';
  return '未知';
}

export async function resolveWeatherLocation(query: string): Promise<WeatherLocation> {
  const text = query.trim();
  if (!text || text === DEFAULT_WEATHER_LOCATION.name) return DEFAULT_WEATHER_LOCATION;

  const coord = text.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (coord) {
    const lat = Number(coord[1]);
    const lng = Number(coord[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, name: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    }
  }

  const params = new URLSearchParams({
    name: text,
    count: '1',
    language: 'zh',
    format: 'json',
  });
  const response = await fetch(`${GEOCODE_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`地名查询失败 HTTP ${response.status}`);
  const data = await response.json();
  const first = data?.results?.[0];
  if (!first) throw new Error(`未找到地点：${text}`);
  return {
    lat: Number(first.latitude),
    lng: Number(first.longitude),
    name: [first.name, first.admin1, first.country].filter(Boolean).join(' '),
  };
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
    timezone: 'Asia/Shanghai',
    forecast_days: '7',
  });
  const response = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`天气查询失败 HTTP ${response.status}`);
  const data = await response.json();
  const currentCode = Number(data.current?.weather_code ?? 0);
  const current = data.current ? {
    temp: Math.round(Number(data.current.temperature_2m)),
    humidity: Math.round(Number(data.current.relative_humidity_2m)),
    windSpeed: Math.round(Number(data.current.wind_speed_10m)),
    weatherText: wmoText(currentCode),
  } : null;

  const forecast: DayWeather[] = (data.daily?.time || []).map((date: string, index: number) => {
    const code = Number(data.daily.weather_code?.[index] ?? 0);
    return {
      date,
      tempMax: Math.round(Number(data.daily.temperature_2m_max?.[index] ?? 0)),
      tempMin: Math.round(Number(data.daily.temperature_2m_min?.[index] ?? 0)),
      precip: Number(data.daily.precipitation_sum?.[index] ?? 0),
      weatherText: wmoText(code),
    };
  });

  return { current, forecast };
}
