import { GeoJSONFeature } from '../types';

function escapeCSV(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCSV(features: GeoJSONFeature[]): string {
  const points = features.filter((f) => f.properties.shapeType === 'Marker');
  const header = 'name,latitude,longitude,description,color';
  const rows = points.map((f) => {
    const [lng, lat] = f.geometry.coordinates as number[];
    return `${escapeCSV(f.properties.name)},${lat},${lng},${escapeCSV(f.properties.description)},${f.properties.color}`;
  });
  return [header, ...rows].join('\n');
}

export function importCSV(raw: string): GeoJSONFeature[] {
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].toLowerCase().split(',').map((c) => c.trim());
  const nameIdx = headers.indexOf('name');
  const latIdx = headers.indexOf('latitude');
  const lngIdx = headers.indexOf('longitude');
  const descIdx = headers.indexOf('description');
  const colorIdx = headers.indexOf('color');

  if (latIdx < 0 || lngIdx < 0) return [];

  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line, i) => {
      // Handle quoted CSV fields
      const cols = parseCSVLine(line);
      const lat = parseFloat(cols[latIdx]);
      const lng = parseFloat(cols[lngIdx]);

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          id: crypto.randomUUID(),
          name: nameIdx >= 0 ? cols[nameIdx] || `CSV点 ${i + 1}` : `CSV点 ${i + 1}`,
          description: descIdx >= 0 ? cols[descIdx] || '' : '',
          color: colorIdx >= 0 ? cols[colorIdx] || '#3388ff' : '#3388ff',
          shapeType: 'Marker' as const,
          layerId: '__default__',
        },
      };
    });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}
