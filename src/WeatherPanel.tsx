import { useCallback, useEffect, useState } from 'react';
import {
  CloudSun,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  History,
  Thermometer,
  Droplets,
  Wind,
  Loader2,
} from 'lucide-react';
import { fetchWeather, fetchHistory } from './utils/weather';
import type { CurrentWeather, DayWeather, HistoryDay } from './utils/weather';

const SHIHEZI = { lat: 44.3061, lng: 86.0806, name: '石河子' };

export default function WeatherPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [current, setCurrent] = useState<CurrentWeather | null>(null);
  const [forecast, setForecast] = useState<DayWeather[]>([]);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear() - 1);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().getMonth() + 1);
  const [tab, setTab] = useState<'current' | 'history'>('current');

  const loadCurrent = useCallback(async () => {
    setLoadingCurrent(true);
    try {
      const result = await fetchWeather(SHIHEZI.lat, SHIHEZI.lng);
      setCurrent(result.current);
      setForecast(result.forecast);
    } catch { /* silent */ }
    finally { setLoadingCurrent(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const start = `${historyYear}-${String(historyMonth).padStart(2, '0')}-01`;
      const lastDay = new Date(historyYear, historyMonth, 0).getDate();
      const end = `${historyYear}-${String(historyMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const data = await fetchHistory(SHIHEZI.lat, SHIHEZI.lng, start, end);
      setHistory(data);
    } catch { /* silent */ }
    finally { setLoadingHistory(false); }
  }, [historyYear, historyMonth]);

  useEffect(() => {
    if (!collapsed && tab === 'current' && !current) loadCurrent();
  }, [collapsed, tab, current, loadCurrent]);

  if (collapsed) {
    return (
      <button className="weather-launcher" type="button" onClick={() => setCollapsed(false)} title="石河子天气">
        <CloudSun size={18} />
        <span>天气</span>
        <ChevronsRight size={14} />
      </button>
    );
  }

  return (
    <aside className="panel weather-panel">
      <div className="weather-header">
        <span className="weather-title">
          <CloudSun size={16} />
          <span>{SHIHEZI.name}天气</span>
        </span>
        <div className="weather-tabs">
          <button className={`weather-tab ${tab === 'current' ? 'active' : ''}`} onClick={() => setTab('current')}>
            <Thermometer size={13} /> 实时
          </button>
          <button className={`weather-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            <History size={13} /> 历史
          </button>
        </div>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="最小化">
          <ChevronsLeft size={14} />
        </button>
      </div>

      <div className="weather-body">
        {tab === 'current' && (
          <>
            {loadingCurrent ? (
              <div className="weather-loading"><Loader2 size={20} className="builtin-spinner" /> 加载中...</div>
            ) : (
              <>
                {current && (
                  <div className="weather-now">
                    <div className="weather-now-main">
                      <span className="weather-now-icon">{current.weatherIcon}</span>
                      <span className="weather-now-temp">{current.temp}°C</span>
                    </div>
                    <div className="weather-now-text">{current.weatherText}</div>
                    <div className="weather-now-detail">
                      <span><Droplets size={13} /> {current.humidity}%</span>
                      <span><Wind size={13} /> {current.windSpeed} km/h</span>
                    </div>
                  </div>
                )}

                <div className="weather-forecast">
                  <div className="weather-section-title">
                    <Calendar size={13} /> 7日预报
                  </div>
                  <div className="weather-days">
                    {forecast.map((d) => (
                      <div key={d.date} className="weather-day">
                        <span className="weather-day-date">{d.date.slice(5)}</span>
                        <span className="weather-day-icon">{d.weatherIcon}</span>
                        <span className="weather-day-temps">
                          <strong>{d.tempMax}°</strong> <span className="weather-day-low">{d.tempMin}°</span>
                        </span>
                        {d.precip > 0 && <span className="weather-day-rain">{d.precip}mm</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            <div className="weather-history-ctl">
              <select value={historyYear} onChange={(e) => setHistoryYear(Number(e.target.value))}>
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
              <select value={historyMonth} onChange={(e) => setHistoryMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
              <button className="weather-query-btn" onClick={loadHistory} disabled={loadingHistory}>
                {loadingHistory ? <Loader2 size={13} className="builtin-spinner" /> : '查询'}
              </button>
            </div>

            {history.length > 0 && (
              <div className="weather-history-list">
                {history.map((d) => (
                  <div key={d.date} className="weather-day">
                    <span className="weather-day-date">{d.date.slice(5)}</span>
                    <span className="weather-day-icon">{d.weatherIcon}</span>
                    <span className="weather-day-temps">
                      <strong>{d.tempMax}°</strong> <span className="weather-day-low">{d.tempMin}°</span>
                    </span>
                    {d.precip > 0 && <span className="weather-day-rain">{d.precip}mm</span>}
                  </div>
                ))}
              </div>
            )}
            {!loadingHistory && history.length === 0 && (
              <div className="weather-empty">选择年月后点查询</div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
