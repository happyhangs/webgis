import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronsLeft, CloudSun, Droplets, Loader2, MapPin, Search, Thermometer, Wind } from 'lucide-react';
import { stopFloatingPanelButtonEvent, useFloatingPanels } from './FloatingPanelContext';
import { useDraggablePanel } from './useDraggablePanel';
import {
  DEFAULT_WEATHER_LOCATION,
  fetchWeather,
  resolveWeatherLocation,
  type CurrentWeather,
  type DayWeather,
  type WeatherLocation,
} from './utils/weather';

export default function WeatherPanel() {
  const { isPanelOpen, closePanel } = useFloatingPanels();
  const { panelRef, panelStyle, dragging, dragHandleProps, resizeHandle } = useDraggablePanel();
  const [query, setQuery] = useState(DEFAULT_WEATHER_LOCATION.name);
  const [loc, setLoc] = useState<WeatherLocation>(DEFAULT_WEATHER_LOCATION);
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<DayWeather[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadWeather = useCallback(async (nextQuery = query) => {
    setLoading(true);
    setMessage('');
    try {
      const nextLoc = await resolveWeatherLocation(nextQuery);
      const result = await fetchWeather(nextLoc.lat, nextLoc.lng);
      setLoc(nextLoc);
      setQuery(nextLoc.name);
      setCurrent(result.current);
      setForecast(result.forecast);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '天气查询失败');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (isPanelOpen('weather') && !current && !loading) {
      loadWeather(DEFAULT_WEATHER_LOCATION.name);
    }
  }, [current, isPanelOpen, loadWeather, loading]);

  if (!isPanelOpen('weather')) return null;

  return (
    <aside ref={panelRef} className={`panel floating-panel weather-panel ${dragging ? 'is-dragging' : ''}`} style={panelStyle}>
      <div className="weather-header floating-panel-drag-handle" {...dragHandleProps}>
        <span className="weather-title"><CloudSun size={15} /> 天气查询</span>
        <button
          className="panel-toggle"
          onPointerDown={stopFloatingPanelButtonEvent}
          onClick={(event) => {
            stopFloatingPanelButtonEvent(event);
            closePanel('weather');
          }}
          title="最小化"
          aria-label="最小化天气查询面板"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="weather-body">
        <div className="weather-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') loadWeather(); }}
            placeholder="城市或坐标，如 石河子 / 44.3061,86.0806"
          />
          <button type="button" onClick={() => loadWeather()} disabled={loading} title="查询天气" aria-label="查询天气">
            {loading ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
          </button>
        </div>

        <div className="weather-location">
          <MapPin size={13} />
          <span>{loc.name}</span>
        </div>

        {message && <div className="weather-message">{message}</div>}

        {current && (
          <div className="weather-now">
            <div>
              <span className="weather-now-label"><Thermometer size={14} /> 当前</span>
              <strong>{current.temp}°C</strong>
            </div>
            <span>{current.weatherText}</span>
            <small><Droplets size={13} /> {current.humidity}%</small>
            <small><Wind size={13} /> {current.windSpeed} km/h</small>
          </div>
        )}

        <div className="weather-forecast-title">
          <CalendarDays size={14} />
          <span>7 日预报</span>
        </div>
        <div className="weather-days">
          {forecast.map((day) => (
            <div className="weather-day" key={day.date}>
              <span>{day.date.slice(5)}</span>
              <strong>{day.tempMax}° / {day.tempMin}°</strong>
              <span>{day.weatherText}</span>
              <small>{day.precip > 0 ? `${day.precip} mm` : '少雨'}</small>
            </div>
          ))}
          {!loading && forecast.length === 0 && !message && (
            <div className="weather-empty">打开后自动查询石河子天气。</div>
          )}
        </div>
      </div>

      <div {...resizeHandle('n')} />
      <div {...resizeHandle('s')} />
      <div {...resizeHandle('e')} />
      <div {...resizeHandle('w')} />
      <div {...resizeHandle('ne')} />
      <div {...resizeHandle('nw')} />
      <div {...resizeHandle('se')} />
      <div {...resizeHandle('sw')} />
    </aside>
  );
}
