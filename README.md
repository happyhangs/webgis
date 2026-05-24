# 点位工具

一个纯前端 WebGIS 点位与图形标注工作台，适合在本机进行地图浏览、点线面标注、测距测面、多图层管理，以及 GeoJSON/CSV/KML/SHP 数据导入导出。当前项目固定使用 `http://127.0.0.1:5182/` 作为本地开发入口。

## 本次更新

- 界面改为更偏 GIS 工作台的审美：深色紧凑工具栏、浅色结构化面板、清晰的图层列表和属性编辑区。
- 工具栏新增“点位工具”标识和当前要素数量徽标，绘制、编辑、删除、导入、导出、底图切换保持在首屏可见。
- 面板统一 8px 圆角、细边框、状态色和滚动条样式，移动端会自动改为上下布局。
- README 补充了启动方式、数据边界、导入格式、依赖和验证命令。
- 补充 `shpjs` 到项目依赖，保证重新 clone 后 SHP 导入能力可复现。
- 应用标题改为“点位工具”，并新增本地 SVG 图标 `public/point-tool-icon.svg`。
- 内置图层删除最终 GeoJSON 超过 1MB 的数据文件，只保留轻量数据，避免误加载大文件导致卡顿。
- 调用高德 Web 服务 API 增加地图内纵向悬浮导航面板：起点/终点支持地名或坐标，规划结果会生成一条可编辑、可导出的路线图层，并显示距离、耗时和步骤列表。

## 功能概览

- 地图标注：支持点、线、面、矩形的新增、编辑、删除。
- 属性编辑：可维护名称、描述、颜色、所属图层，并显示长度或面积。
- 多图层管理：创建、重命名、删除图层，切换可见性，将标注移动到不同图层。
- 底图切换：OpenStreetMap、高德标准、高德卫星、谷歌标准、谷歌卫星。
- 搜索定位：支持 `39.9,116.4` 这类坐标输入，也支持通过高德地理编码搜索地名。
- 驾车导航：在地图内纵向悬浮面板中输入起点和终点，调用高德路径规划接口生成路线，并显示距离、预计耗时和分步指引。
- GPS 定位：调用浏览器 Geolocation，将当前位置落点到地图。
- 内置数据：只保留最终 GeoJSON 小于 1MB 的轻量边界/区划数据，避免误加载大文件导致页面卡顿。
- 数据导入：支持 GeoJSON、CSV 点位、KML、SHP ZIP。
- 数据导出：支持导出 GeoJSON，以及点位 CSV。
- 自动保存：通过 localStorage 保存地图视图、图层、底图和标注数据。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | Vite + React 18 + TypeScript |
| 地图 | Leaflet |
| 标注编辑 | @geoman-io/leaflet-geoman-free |
| 空间计算 | Turf.js |
| 图标 | lucide-react |
| KML 解析 | @tmcw/togeojson |
| SHP 解析 | shpjs |

## 快速启动

首次运行：

```bash
npm install
npm start
```

浏览器打开：

```text
http://127.0.0.1:5182/
```

Windows 下也可以双击 `start.bat`。脚本会先检查 5182 端口：如果服务已经在运行，就直接打开页面；如果服务未运行，就启动 Vite dev server 后再打开页面。

## 常用命令

```bash
npm start
npm run build
npm run preview
```

`vite.config.ts` 已固定：

- `host: 127.0.0.1`
- `port: 5182`
- `strictPort: true`

如果提示 `Port 5182 is already in use`，说明本机已有点位工具或其他服务占用该端口，先关闭对应进程后再启动。

## 项目结构

```text
src/
├── main.tsx              # 入口，安装 DOM 安全修补
├── App.tsx               # 主布局
├── AppContext.tsx         # 全局状态管理
├── MapView.tsx            # Leaflet + Geoman 地图核心
├── Toolbar.tsx            # 工具栏、搜索、导入导出、底图切换
├── NavigationPanel.tsx    # 高德驾车悬浮导航面板
├── LayerPanel.tsx         # 图层面板 + 内置数据
├── PropertyPanel.tsx      # 属性编辑面板
├── basemaps.ts            # 底图配置
├── domSafety.ts           # React + Leaflet DOM 冲突防护
├── store.ts               # localStorage 读写
├── types.ts               # TypeScript 类型
├── index.css              # 全局界面样式
└── utils/
    ├── amap.ts            # 高德地理编码搜索和驾车路径规划
    ├── builtin.ts         # 内置图层定义
    ├── measure.ts         # 距离面积计算
    ├── geojson.ts         # GeoJSON 导入导出
    └── csv.ts             # CSV 导入导出
```

## 数据说明

内置面板只保留最终 GeoJSON 小于 1MB 的轻量图层：

| 类别 | 图层 |
| --- | --- |
| 轻量边界 | 南海诸岛、南海九段线、南海边界 |
| 轻量区划 | 九段线 |

超过 1MB 的内置 GeoJSON 已从 `public/data/` 删除，避免点击内置图层时一次性加载大文件。这里按浏览器实际加载的 `public/data/*.json` 体积判断，而不是按原始 SHP 组件体积判断；例如 `hyd1_4p.shp` 原始组件约 1020.5KB，但转换后的 `一级河流(面).json` 约 2.3MB，因此不放入默认内置面板。

以下内容默认作为本地数据处理，不上传到 GitHub：

- `全国shp/`
- 大型转换结果：国界线、省/市/县界、铁路、高速、国道、省道、水系等超过 1MB 的 GeoJSON

如需使用大型 SHP 或 GeoJSON，建议通过工具栏的 SHP/GeoJSON 导入功能按需加载。也可以将原始 SHP 数据放入 `全国shp/` 后运行转换脚本：

```bash
node scripts/convert-shp.mjs
```

## 导入格式

- GeoJSON：支持 `.geojson` 和 `.json`。
- CSV：主要用于点位数据。
- KML：支持 `.kml`，会转换为 GeoJSON 要素后加入新图层。
- SHP：建议使用包含 `.shp/.dbf/.prj` 等文件的 `.zip`。

导入后的要素会被分配到新图层，并自动写入 localStorage。

## 注意事项

- 地名搜索依赖高德地理编码服务，需要网络可访问高德接口。
- 驾车导航依赖高德路径规划 Web 服务 API，起终点请求参数按 `经度,纬度` 传入，返回路线会转换为本工具内部使用的 WGS-84 坐标后绘制。
- 如果把项目公开到 GitHub，请确保高德 Key 已做域名、IP、额度等限制，或改造为自己的环境变量配置。
- 谷歌底图在部分网络环境下可能无法加载，这是网络访问限制，不是前端代码错误。
- 本工具定位为本地标注与轻量数据查看，不替代 ArcGIS/QGIS 的完整空间分析能力。

## 验证

本次更新已执行：

```bash
npm run build
```

构建通过时，Vite 可能提示部分 chunk 超过 500 kB，这是地图与空间处理依赖带来的体积提醒，不影响本地运行。

## License

MIT
