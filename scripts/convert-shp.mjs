import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { open } from 'shapefile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, '..');
const SHP_DIR = resolve(BASE, '全国shp');
const OUT_DIR = resolve(BASE, 'public/data');

const tasks = [
  { src: '国界线/国界线.shp', out: '国界线.json', name: '国界线' },
  { src: '最新2021年全国行政区划/省.shp', out: '省.json', name: '省界' },
  { src: '最新2021年全国行政区划/九段线.shp', out: '九段线.json', name: '九段线' },
];

for (const { src, out, name } of tasks) {
  try {
    const shpPath = resolve(SHP_DIR, src);
    console.log(`Converting ${name} (${src})...`);
    const source = await open(shpPath);
    const features = [];
    for (;;) {
      const { done, value } = await source.read();
      if (done) break;
      features.push(value);
    }
    const geojson = { type: 'FeatureCollection', features };
    const outPath = resolve(OUT_DIR, out);
    await writeFile(outPath, JSON.stringify(geojson));
    const kb = (JSON.stringify(geojson).length / 1024).toFixed(0);
    console.log(`  -> ${out} (${features.length} features, ${kb} KB)`);
  } catch (e) {
    console.error(`  FAILED ${name}:`, e.message);
  }
}
console.log('Done.');
