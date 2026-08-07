# 点位工具

点位工具是一个本地 WebGIS 标注与农田地块识别工作台。前端使用 Vite、React、TypeScript、Leaflet 和 Geoman，适合在本机完成地图浏览、点线面标注、图层管理、轻量区划查看、农田分割结果查看和 YOLO 分割数据集导出。

默认本地入口：

```text
http://127.0.0.1:5182/
```

## 当前能力

- 地图标注：新增、编辑、删除点、线、面和矩形，自动计算长度或面积。
- 图层管理：创建、重命名、删除、隐藏、复制要素到其他图层，并按图层或要素名搜索。
- 内置数据：提供北京市、上海市、广州市、成都市、武汉市、西安市轻量边界，以及 `public/data/counties/` 下的区县行政区划索引。
- 数据导入导出：支持 GeoJSON、CSV 点位、KML 和 SHP ZIP 导入，支持 GeoJSON 和点位 CSV 导出。
- 底图与定位：支持 OpenStreetMap、高德、谷歌、ESRI 卫星等底图，浏览器 GPS 可落点到地图。
- 农田识别：前端面板可调用本地后端分割影像，生成 GeoJSON 地块图层；也可手工标定农田边界，直接上传后端训练，或备份 Ultralytics YOLO segmentation 数据集 ZIP。
- 面积计算：支持地块面积自动计算与显示（m²/亩）。
- 训练中心：`/train` 是二级训练页面，可手动上传已备份的 YOLO ZIP 并查看训练进度。
- 自定义底图：支持 XYZ 瓦片模板自定义底图（WMS/WMTS 兼容）。
- 视图截图分割：一键捕获当前地图视图并发送后端进行分割识别。
- 浮窗系统：农田检测（FieldDetectPanel）、地块统计（FieldPanel）、属性编辑（PropertyPanel）从右侧属性栏停靠入口打开，支持拖动和最小化。

## 快速启动

前后端一起启动：

```bash
npm install
npm run dev:all
```

或通过启动脚本：

```bash
node scripts/start-all.mjs
```

Windows 下也可以双击 `start.bat`，它会启动前端、后端并打开主界面。

只启动前端：

```bash
npm install
npm start
```

后端农田分割服务可选启动：

```bash
cd backend
pip install -r requirements.txt
python -m farmland_segmenter --serve
```

后端默认地址：

```text
http://127.0.0.1:8765/
```

训练中心：

```text
http://127.0.0.1:5182/train
```

前端开发服务固定在 `vite.config.ts` 中：

- `host: 127.0.0.1`
- `port: 5182`
- `strictPort: true`

如果提示 `Port 5182 is already in use`，先关闭占用该端口的本地进程后再启动。

## 常用命令

```bash
npm start
npm run dev:all
npm run build
npm run preview
```

行政区划数据以 `public/data/counties/` 中的文件为准。

## 项目结构

```text
src/
├── main.tsx                 # React 入口和错误边界挂载
├── App.tsx                  # 主布局：工具栏、图层栏、地图、属性栏
├── TrainingPage.tsx         # /train 二级训练中心
├── AppContext.tsx           # 全局状态 reducer 和 localStorage 持久化
├── AppErrorBoundary.tsx     # 前端运行时错误兜底
├── MapView.tsx              # Leaflet 地图、绘制编辑、坐标转换、地图 API 桥接
├── Toolbar.tsx              # 绘制、搜索、导入导出、底图、GPS、自定义底图
├── LayerPanel.tsx           # 图层管理、要素列表、行政区划加载
├── PropertyPanel.tsx        # 要素属性编辑和浮窗停靠入口
├── FieldDetectPanel.tsx     # 后端农田分割、人工标定、YOLO 导出与训练入口、视图截图分割
├── FieldPanel.tsx           # 地块统计和定位浮窗
├── FloatingPanelContext.tsx # 浮窗开关状态
├── FloatingPanelDock.tsx    # 属性栏浮窗按钮条
├── useDraggablePanel.ts     # 浮窗拖动 hook
├── store.ts                 # localStorage 读写和旧数据归一化
├── types.ts                 # 图层、要素、底图类型
├── index.css                # 全局样式
└── utils/
    ├── builtin.ts           # 轻量内置图层定义
    ├── coord.ts             # WGS84/GCJ02/BD09 坐标转换
    ├── csv.ts               # CSV 导入导出
    ├── featureStyle.ts      # 要素样式归一化
    ├── geojson.ts           # GeoJSON 导入导出
    ├── mapAPI.ts            # 地图 API 类型定义
    ├── measure.ts           # 距离面积计算
    └── yoloDataset.ts       # 浏览器端 YOLO 数据集导出

backend/
└── farmland_segmenter/      # Python YOLOv11-seg HTTP API、训练入口

public/
├── data/                    # 轻量城市边界和区县数据
└── manifest.json            # PWA manifest
```

## 数据说明

- `public/data/*.json` 保留轻量示例边界。
- `public/data/counties/_index_county.json` 是行政区划索引，当前覆盖 34 个省级条目，区县数据拆分为多个 JSON 文件按需加载。
- `public/data/counties/` 为本地生成的行政区划拆分数据（体量较大），已被 `.gitignore` 忽略，不入库；新环境需本地生成或另行分发。
- 大型 SHP 和转换结果默认作为本地数据处理，放在 `全国shp/` 或被 `.gitignore` 列出的 `public/data/*.json` 大文件路径下，不建议提交。
- 如需加载大型 SHP 或 GeoJSON，优先使用工具栏导入功能按需加载。
- 农田识别面板里的“直接训练”会在浏览器内临时生成 ZIP 并上传后端，不需要先下载文件。
- “备份 ZIP”下载出的文件通常由浏览器保存到系统“下载/Downloads”目录；从 `/train` 页面训练时，从任意位置选择该 ZIP 都可以。

## 部署

本地开发：

```bash
npm run dev:all
```

生产构建与运行：

```bash
npm run build
python -m farmland_segmenter --serve   # 在 backend/ 目录下执行
```

将 `dist/` 用任意静态服务器（如 nginx）托管，前端请求固定指向 `http://127.0.0.1:8765/` 的后端；如后端地址变化，需同步修改前端中的后端地址配置。

注意：

- 后端是本地工具型 HTTP 服务，无认证，仅建议在本机或内网使用；对外暴露前应加反向代理与访问控制。
- 高德 Key 通过环境变量 `AMAP_KEY` 注入（本地可写 `.env`），不要写入代码或提交仓库。
- `public/data/counties/`、模型文件与训练数据集均不入库，部署环境需自行准备。

## 外部服务

- 高德静态图代理（`/amap-static`）依赖高德 Web 服务，需配置 `AMAP_KEY`：本地开发可复制 `.env.example` 为 `.env` 并填写（`start.bat` 与 `npm run dev:all` 均会读取），生产环境通过环境变量注入。获取方式：https://console.amap.com/
- 谷歌底图在部分网络环境下可能无法加载，这是网络访问限制，不是前端代码错误。
- 如果公开发布项目，应先给高德 Key 配置域名、IP、额度等限制。

## 验证

最小验证：

```bash
npm run build
```

后端语法验证：

```bash
python -m compileall backend\farmland_segmenter
```

构建通过时，Vite 可能提示主 chunk 超过 500 kB，这是地图、空间处理、GeoTIFF 和 YOLO 数据集导出依赖带来的体积提醒，不影响本地运行。

## License

MIT
