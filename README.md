# WebGIS 本地地图标注工具

纯前端 WebGIS 应用，支持地图浏览、点线面标注、测距测面、多图层管理、GeoJSON/CSV/SHP 数据导入导出。

## 功能

- **地图标注** — 点、线、面、矩形的新增/编辑/删除，支持属性编辑（名称、描述、颜色）
- **多图层管理** — 创建/重命名/删除图层，可见性切换，标注跨图层移动
- **5 种底图** — OpenStreetMap / 高德标准 / 高德卫星 / 谷歌标准 / 谷歌卫星
- **测距测面** — 线要素显示长度，面与矩形显示面积
- **内置数据** — 一键加载国界线、省界、九段线
- **数据导入导出** — GeoJSON、CSV（点位）、SHP（ZIP）
- **自动保存** — localStorage 持久化，刷新页面后恢复地图视图和标注

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Vite + React 18 + TypeScript |
| 地图 | Leaflet + OpenStreetMap |
| 标注编辑 | @geoman-io/leaflet-geoman-free |
| 空间计算 | Turf.js |
| 图标 | lucide-react |
| SHP 解析 | shpjs（浏览器端） |
| SHP 转 GeoJSON | shapefile（Node.js 脚本） |

## 快速启动

```bash
npm install
npm start
```

浏览器打开 `http://127.0.0.1:5182`。

> 端口在 `vite.config.ts` 中配置，默认 5182。

## 项目结构

```
src/
├── main.tsx              # 入口，DOM 安全修补
├── App.tsx               # 主布局
├── AppContext.tsx         # 全局状态（useReducer）
├── MapView.tsx            # Leaflet + Geoman 地图核心
├── Toolbar.tsx            # 工具栏（绘制/编辑/导入/导出/底图）
├── LayerPanel.tsx         # 图层面板 + 内置数据
├── PropertyPanel.tsx      # 属性编辑面板
├── basemaps.ts            # 底图配置
├── domSafety.ts           # React + Leaflet DOM 冲突修补
├── types.ts               # TypeScript 类型
├── store.ts               # localStorage 读写
├── index.css              # 全局样式
└── utils/
    ├── builtin.ts         # 内置图层定义
    ├── measure.ts         # 距离面积计算
    ├── geojson.ts         # GeoJSON 导入导出
    └── csv.ts             # CSV 导入导出
```

## 内置数据转换

`public/data/` 中的 GeoJSON 由 `scripts/convert-shp.mjs` 从 SHP 文件转换而来：

```bash
node scripts/convert-shp.mjs
```

> 原始 SHP 数据需放在 `全国shp/` 目录下。

## License

MIT
