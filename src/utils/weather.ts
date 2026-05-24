// Open-Meteo free weather API — no key required
// https://open-meteo.com/

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

export interface CurrentWeather {
  temp: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  weatherText: string;
  weatherIcon: string;
}

export interface DayWeather {
  date: string;
  tempMax: number;
  tempMin: number;
  precip: number;
  weatherCode: number;
  weatherText: string;
  weatherIcon: string;
}

export interface WeatherResult {
  current: CurrentWeather | null;
  forecast: DayWeather[];
}

// WMO weather codes → text + icon
function wmoInfo(code: number): { text: string; icon: string } {
  if (code === 0) return { text: '晴', icon: '☀️' };
  if (code === 1) return { text: '少云', icon: '🌤️' };
  if (code === 2) return { text: '多云', icon: '⛅' };
  if (code === 3) return { text: '阴', icon: '☁️' };
  if (code >= 45 && code <= 48) return { text: '雾', icon: '🌫️' };
  if (code >= 51 && code <= 55) return { text: '毛毛雨', icon: '🌦️' };
  if (code >= 61 && code <= 65) return { text: '雨', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { text: '雪', icon: '❄️' };
  if (code >= 80 && code <= 82) return { text: '阵雨', icon: '🌦️' };
  if (code >= 85 && code <= 86) return { text: '阵雪', icon: '🌨️' };
  if (code >= 95 && code <= 99) return { text: '雷暴', icon: '⛈️' };
  return { text: '未知', icon: '❓' };
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

  const resp = await fetch(`${FORECAST_URL}?${params}`);
  const data = await resp.json();

  const currentCode = data.current?.weather_code ?? 0;
  const info = wmoInfo(currentCode);

  const current: CurrentWeather | null = data.current
    ? {
        temp: Math.round(data.current.temperature_2m),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        weatherCode: currentCode,
        weatherText: info.text,
        weatherIcon: info.icon,
      }
    : null;

  const forecast: DayWeather[] = (data.daily?.time || []).map((date: string, i: number) => {
    const code = data.daily.weather_code[i];
    const fInfo = wmoInfo(code);
    return {
      date,
      tempMax: Math.round(data.daily.temperature_2m_max[i]),
      tempMin: Math.round(data.daily.temperature_2m_min[i]),
      precip: data.daily.precipitation_sum[i],
      weatherCode: code,
      weatherText: fInfo.text,
      weatherIcon: fInfo.icon,
    };
  });

  return { current, forecast };
}

export interface HistoryDay {
  date: string;
  tempMax: number;
  tempMin: number;
  precip: number;
  weatherCode: number;
  weatherText: string;
  weatherIcon: string;
}

export async function fetchHistory(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<HistoryDay[]> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
    timezone: 'Asia/Shanghai',
  });

  const resp = await fetch(`${ARCHIVE_URL}?${params}`);
  const data = await resp.json();

  return (data.daily?.time || []).map((date: string, i: number) => {
    const code = data.daily.weather_code[i] ?? 0;
    const info = wmoInfo(code);
    return {
      date,
      tempMax: Math.round(data.daily.temperature_2m_max[i]),
      tempMin: Math.round(data.daily.temperature_2m_min[i]),
      precip: data.daily.precipitation_sum[i] ?? 0,
      weatherCode: code,
      weatherText: info.text,
      weatherIcon: info.icon,
    };
  });
}
