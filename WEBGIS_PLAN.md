# WebGIS 本地 MVP 中文实施计划

## 概要

- 在 `e:\codex\webgis` 新建一个独立前端项目，并把本计划保存为 `e:\codex\webgis\WEBGIS_PLAN.md`。
- 第一版做纯本地 WebGIS，不做后端、登录、云同步或多人协作。
- 核心能力：地图浏览、点/线/面/矩形标注、要素属性编辑、测距测面、GeoJSON/CSV 导入导出、本地自动保存。
- 技术栈固定为：Vite + React + TypeScript + Leaflet + Leaflet-Geoman + Turf + lucide-react。

## 关键功能

- 地图工作台：左侧图层/数据面板，中间地图，右侧选中要素属性面板，顶部紧凑工具栏。
- 标注能力：新增点、线、面、矩形；支持选中、编辑、删除、改名、改颜色、填写描述。
- 测量能力：线显示长度，面和矩形显示面积。
- 数据能力：
  - GeoJSON：导入和导出点、线、面、矩形。
  - CSV：仅导入和导出点位，字段为 `name,latitude,longitude,description,color`。
- 本地保存：使用 localStorage，刷新页面后恢复地图视图、底图、标注和属性。
- 底图：默认 OpenStreetMap XYZ，无需 API key；后续可扩展国内底图。

## Claude 执行任务包

Decision: 委托 Claude 作为单一实现代理执行，因为任务边界清晰，适合用文字规格交付；考虑 DeepSeek/Claude 非多模态，不要求它根据截图还原 UI。

Role:
scoped implementation worker

Goal:
在 `e:\codex\webgis` 实现 WebGIS 本地 MVP，并把本计划保存为 `WEBGIS_PLAN.md`。

Context:
用户希望做一个类似 GPS 工具箱网页版和 ArcGIS 标注体验的本地 WebGIS。第一版强调可用、轻量、可验证，不追求完整 GIS 平台。

Allowed actions:
创建和修改 `agent_memory/**`、`webgis/**`；安装 npm 依赖；运行构建和本地开发服务验证。

Ownership:
只允许操作 `e:\codex\agent_memory` 和 `e:\codex\webgis`。

Forbidden actions:
不要修改无关目录；不要添加后端、账号、云同步、付费地图 key；不要实现 KML/KMZ/GPX；不要做坐标系转换；不要使用破坏性命令。

Commands to run:
先补齐 `agent_memory/`，再执行：

```powershell
npm create vite@latest webgis -- --template react-ts
Set-Location webgis
npm install leaflet @geoman-io/leaflet-geoman-free @turf/area @turf/length lucide-react
npm install -D @types/leaflet
npm run build
```

可选启动：

```powershell
npm run dev -- --host 127.0.0.1 --port 5174
```

Expected output:
一个可运行的 WebGIS MVP、`WEBGIS_PLAN.md`、构建验证结果、功能清单、未解决风险记录。

Stop condition:
`npm run build` 通过，并完成标注、测量、导入导出、本地保存的手动验证；如果依赖安装或网络失败，停止并说明原因。

## 验收标准

- 页面打开后直接进入地图工作台，不做营销首页。
- 可以新增、编辑、删除点、线、面、矩形。
- 选中要素后能编辑名称、描述和颜色。
- 线要素显示长度；面和矩形显示面积。
- GeoJSON 导出后重新导入，数量和几何类型保持一致。
- CSV 导入能生成点位；CSV 导出只包含点位。
- 刷新页面后，地图视图和标注数据仍然存在。
- 桌面和移动端布局不重叠，工具栏按钮可点击。
- `npm run build` 无 TypeScript 错误。

## 默认假设

- 第一版只做单用户本地版本。
- 坐标使用 WGS84 经纬度。
- 圆形标注暂不做，因为 GeoJSON 没有原生圆形类型。
- KML/KMZ/GPX 放到后续版本。
- 国内底图和坐标偏移处理放到后续版本。
