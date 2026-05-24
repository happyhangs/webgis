import { readFile, writeFile, stat } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import { fileURLToPath } from 'url';
import { open } from 'shapefile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(__dirname, '..');
const SHP_DIR = resolve(BASE, '全国shp');
const OUT_DIR = resolve(BASE, 'public/data');

// name, shp_relative_path, category, color, max_size_mb (0=unlimited)
const TASKS = [
  // ── 国界 ──
  { name: '国界线', path: '国界线/国界线.shp', cat: '国界', color: '#e63946', maxMb: 0 },
  { name: '南海诸岛', path: '国界线/SouthSea/南海诸岛及其它岛屿.shp', cat: '国界', color: '#e76f51', maxMb: 0 },
  { name: '南海九段线', path: '国界线/SouthSea/九段线.shp', cat: '国界', color: '#e76f51', maxMb: 0 },
  { name: '南海边界', path: '国界线/SouthSea/bou2_4l.shp', cat: '国界', color: '#e63946', maxMb: 0 },

  // ── 行政区划 (2021版优先) ──
  { name: '省界', path: '最新2021年全国行政区划/省.shp', cat: '行政区划', color: '#e9c46a', maxMb: 0 },
  { name: '市界', path: '最新2021年全国行政区划/市.shp', cat: '行政区划', color: '#f4a261', maxMb: 0 },
  { name: '县界', path: '最新2021年全国行政区划/县.shp', cat: '行政区划', color: '#90be6d', maxMb: 0 },
  { name: '九段线', path: '最新2021年全国行政区划/九段线.shp', cat: '行政区划', color: '#e76f51', maxMb: 0 },
  { name: '区县(2021-05)', path: '2021年5月区县/区县数据-21-05.shp', cat: '行政区划', color: '#577590', maxMb: 0 },

  // ── 交通 ──
  { name: '铁路', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国道路网shp数据/全国道路网/铁路.shp', cat: '交通', color: '#333333', maxMb: 0 },
  { name: '高速', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国道路网shp数据/全国道路网/高速.shp', cat: '交通', color: '#e63946', maxMb: 100 },
  { name: '国道', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国道路网shp数据/全国道路网/国道.shp', cat: '交通', color: '#f4a261', maxMb: 100 },
  { name: '省道', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国道路网shp数据/全国道路网/省道.shp', cat: '交通', color: '#e9c46a', maxMb: 200 },

  // ── 水系 ──
  { name: '一级河流(线)', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/一级河流/hyd1_4l.shp', cat: '水系', color: '#457b9d', maxMb: 0 },
  { name: '一级河流(面)', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/一级河流/hyd1_4p.shp', cat: '水系', color: '#a8dadc', maxMb: 0 },
  { name: '二级河流(线)', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/二级河流/hyd2_4l.shp', cat: '水系', color: '#457b9d', maxMb: 0 },
  { name: '二级河流(面)', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/二级河流/hyd2_4p.shp', cat: '水系', color: '#a8dadc', maxMb: 0 },
  { name: '四级河流', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/四级河流/River4_polyline.shp', cat: '水系', color: '#1d3557', maxMb: 0 },
  { name: '五级河流', path: '2020全国电子地图省市县行政区划道路水系shp数据/全国水系矢量shp数据/五级河流/River5_polyline.shp', cat: '水系', color: '#1d3557', maxMb: 0 },
];

// Skip massive files
const SKIP_PATTERNS = [
  '城市一级道路', '城市二级道路', '城市三级道路', '城市四级道路',
  '县道', '乡道',
];

function shouldSkip(name) {
  return SKIP_PATTERNS.some(p => name.includes(p));
}

async function main() {
  let converted = 0, skipped = 0, failed = 0;

  for (const { name, path, cat, color, maxMb } of TASKS) {
    if (shouldSkip(name)) {
      console.log(`SKIP  ${name} — 文件过大，需简化处理`);
      skipped++;
      continue;
    }

    const shpPath = resolve(SHP_DIR, path);
    const outPath = resolve(OUT_DIR, `${name}.json`);

    try {
      // Check file size
      const info = await stat(shpPath);
      const mb = (info.size / 1024 / 1024).toFixed(0);
      if (maxMb > 0 && info.size > maxMb * 1024 * 1024) {
        console.log(`SKIP  ${name} (${mb} MB > ${maxMb}MB 限制)`);
        skipped++;
        continue;
      }

      process.stdout.write(`${cat}/${name} (${mb} MB)... `);
      const source = await open(shpPath);
      const features = [];
      for (;;) {
        const { done, value } = await source.read();
        if (done) break;
        features.push(value);
      }

      const geojson = { type: 'FeatureCollection', features };
      await writeFile(outPath, JSON.stringify(geojson));
      const outKb = ((JSON.stringify(geojson).length) / 1024).toFixed(0);
      console.log(`OK → ${outKb} KB, ${features.length} features`);
      converted++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Converted: ${converted}, Skipped: ${skipped}, Failed: ${failed}`);
}

main();
