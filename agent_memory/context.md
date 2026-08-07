# Project Context

## 2026-07-15 手动地块标注吸附
- “农田人工标定”多边形绘制显式使用 `snappable: false` 和 `snapMiddle: false`，新顶点不再吸附到已有点或边中点；主页普通绘图工具保持原有行为。
- 连续标注统一依赖 Geoman 的 `continueDrawing: true`，移除了创建地块后以默认选项重复启用绘制的旧逻辑。

## 2026-07-14 高德卫星请求代理兼容
- 后端 Python 可能继承失效的本地代理（本机实测为 `127.0.0.1:9`），导致 `/amap-static` 拼接卫星瓦片时报 `WinError 10061`。
- `backend/farmland_segmenter/server.py` 现在保留可用系统代理；仅当代理连接被拒绝时，使用未被代理处理的新请求对象自动直连重试。

## 2026-07-14 三种识别范围入口
- 农田识别卡片现以“本地影像 / 地图框选 / 行政区域”三个并列入口选择识别范围。
- 行政区域使用 `public/data/counties/` 本地索引，按省、市、县三级选择；选中后写入“行政区识别范围”边界图层并定位地图。
- 行政区识别复用单张 640px 静态卫星图链路；大范围批量切片暂未加入，界面明确建议先定位行政区再框选具体农田。

## 2026-07-14 本地影像闭环
- 农田识别面板支持本地 GeoTIFF、PNG、JPG；WGS84（EPSG:4326）和 CGCS2000（EPSG:4490）GeoTIFF 在浏览器内读取边界，普通图片通过主地图框选覆盖范围。
- 本地影像载入后先切换到 `offline` 数据 URI 空白底图，再按边界显示影像，避免目标经纬度触发在线瓦片请求。
- 本地影像可直接调用 `127.0.0.1:8765/segment` 推理，也可带入训练中心标注并生成 YOLO 数据；本地草稿不构造或请求高德瓦片。
- 在线地图识别仍保留在折叠区，并明确标注会访问高德卫星服务。

## 2026-07-14 新疆多区域数据准备
- 现有两份真实人工标注共 114 个地块：`backend/datasets/93454ac236a985f7/annotations.geojson` 39 个、`backend/datasets/efa196f0a9d4125b/annotations.geojson` 75 个；另有 `webgis/` 下 KML 去重后 25 个地块，覆盖石河子、奇台、北屯和新源。
- 新增 `scripts/build-xinjiang-training-dataset.ts`，按单地块近景生成 640x640 卫星训练图，并按地理区域隔离训练/验证样本；干运行统计为训练 119、验证 20。
- 真正生成影像需要把地块中心坐标发送给高德卫星瓦片服务。当前尚未获得对此数据外发的明确授权，因此只完成了清单和生成器，没有下载瓦片或写入新数据集。

## 2026-07-14 目标链路当前态
- 网页主页已具备农田识别浮窗、地图视图/框选推理、结果图层写回；训练中心可展示 100 Epoch 历史、指标卡、Loss/mAP50 曲线、日志和模型路径。
- 最近模型为 `farmland_seg_20260713_143634.pt`；训练状态和 100 条历史可由后端恢复。
- 当前验证集 mAP50、mAP50-95、Recall 均为 0.0%，默认置信度 0.25 的网页实测没有识别出地块；现阶段只证明技术闭环可运行，不能证明分割效果可用。
- 折叠属性栏现在仍显示农田、地块、天气三个浮窗入口，非技术用户无需先展开空属性面板。

## 2026-07-13 主页连续绘制
- 主页工具栏的点、线、面、矩形绘制统一通过 `src/hooks/useToolBridge.ts` 调用 Leaflet-Geoman。
- 绘制模式现使用 Geoman 原生 `continueDrawing: true`；完成一个要素后保持同一绘制工具激活，点击同一工具或切换工具时仍沿用 `Toolbar.tsx` 现有退出逻辑。

## 2026-07-11 农田识别与训练中心职责拆分
- 农田识别浮窗只保留地图当前视图/矩形框选推理、模型与阈值设置，以及训练中心入口；上传影像、人工标注、直接训练、指标和日志不再混放在该浮窗。
- 既有“农田人工标定”图层的 15 个 Polygon 可一键与匹配的高德卫星静态图打包、持久化并转入训练中心；新标注通过“框选地图并去标注”进入训练中心。
- 训练中心显示数据预览、数据与参数、时间线、mAP50/mAP50-95/Recall/Seg Loss、Loss/mAP50 曲线、日志和模型结果。
- 后端会从最近一次已完成数据集的 `manifest.json` 与 `history.json` 恢复训练状态，服务重启后仍能显示历史曲线和模型路径。
- 当前真实训练结果为 100 Epoch，分割 mAP50 13.9%、mAP50-95 9.6%、Recall 48.7%、val Seg Loss 3.150；只能证明流程可用，精度尚不适合生产分割。

## 2026-07-11 Real Annotation Dataset Audit
- 当前后端状态文件只持久化图层与 GeoJSON 几何，不持久化原始影像、影像范围或标注批次关系。
- 当前状态中有 15 个 `training-map-draft` Polygon，均位于“图层 2”；人工训练入口只自动选择名为“农田人工标定”的图层，因此这批面没有被自动纳入训练。
- Git HEAD 中仍保存旧 `合并导出.kml`（47 个 Polygon、26 个 Point）及 23 张点位关联现场照片；当前工作区对应文件被删除/占位替换，但 Git 历史中的数据尚可恢复。
- 现场照片是点位观察资料，不是与卫星像素一一配准的分割影像；KML Polygon 可作为地理真值，需按固定地图影像范围重新切片后才能生成 YOLO segmentation 数据。

## 2026-07-11 Training Validation And Curves
- 地图当前视图/矩形框选 -> 高德静态卫星图 -> YOLO segmentation -> WGS84 Polygon -> `农田模型识别`图层链路已完成构建、单测和本机推理验证。
- 训练前会生成独立 `images/train` 与 `images/val`：多图按图片留出验证集，单图按互不重叠的空间区域裁切；无法形成有效验证样本时明确拒绝训练。
- 后端训练状态保留逐 Epoch 指标历史，训练中心在至少两轮数据后用原生 SVG 显示 Loss 与 mAP50 曲线。
- “模型精度达标”仍需权威真值测试集与明确的 IoU/F1/边界误差阈值，不能仅凭流程可运行判定。

## 2026-07-06 Training Draft Color
- 训练中心地图草稿设置区新增原生颜色选择器；`draftColor` 同时驱动画布上点/线/面显示和“添加至图层”后的要素样式颜色。
- 草稿颜色通过 `.training-map-draft-layout` 上的 `--draft-color` CSS 变量传给 SVG 标注；训练数据 ZIP 生成仍主要使用几何，颜色不影响 YOLO 标签。

## 2026-07-06 Training Draft Delete Tool
- 训练中心地图草稿工具栏新增“删除”工具；进入删除模式后点击已完成的点、线、面标注会删除整个标注。
- 删除工具只作用于 `draftShapes` 中已完成的标注；未完成的当前线/面仍沿用“撤销点”或“清空”处理，不新增顶点级编辑。

## 2026-07-06 Training Draft Wheel Zoom
- 用户明确要的是训练中心标注时在既有地图草稿上用滚轮放大/缩小，不是改变框选取景范围；已去掉面板里的“框选取景”滑杆和 `selectMapSnapshot({ scale })` 参数。
- 训练中心“标注画布大小”只改变画布容器尺寸，范围仍为 360-980px；底图瓦片定位按固定 640x640 静态图尺寸计算，不再随画布尺寸改变可见地理范围。
- 地图草稿新增滚轮视图缩放：最小为 100%，即完整显示当前草图范围；放大时只移动/缩放视图层，标注坐标和 WGS84 bounds 不变。

## 2026-07-06 Selection-Constrained Inference
- 自标注训练闭环已存在：地图草稿/上传影像标注面 -> 生成 YOLO segmentation ZIP -> `/train` 训练 -> `.pt` 模型用于 `/segment` 推理。
- 框选识别现在保留两套范围：`snapshot.bounds` 对应 640x640 静态图整幅范围，`snapshot.selectionBounds` 对应用户真实拖拽矩形；写回图层前会把 YOLO 多边形裁剪到真实框选范围。
- 导入 `.pt` 模型后不再自动对当前视图推理，避免用户未明确范围时把结果写到错误视野；需显式点击“捕获当前视图并识别”或“框选区域并识别”。

## 2026-07-06 Toolbar Cleanup
- 顶部工具栏已移除“点位工具”右侧的要素数量徽标。
- 训练中心按钮图标由 `BrainCircuit` 替换为更简洁的 `Network`，不新增资源或依赖。

## 2026-07-05 Layer Collapse Hook Fix
- 图层侧边栏折叠时报错 `Rendered fewer hooks than expected`，根因是 `src/LayerPanel.tsx` 在 `collapsed` 为 true 时提前 `return`，跳过了后续 `useEffect`。
- 当前修复为把折叠态返回移动到所有 hooks 调用之后，保持展开/折叠两种渲染路径的 hooks 顺序一致。

## 2026-07-05 Drag Responsiveness Summary
- 本轮针对“拖动图层不是很跟手”做最小性能修复。
- 浮动面板拖动由 `src/useDraggablePanel.ts` 在拖动过程中直接写 DOM 位置，并在松手后同步 React 状态，避免 pointermove 每帧触发组件重渲染。
- 地图要素编辑入口 `src/hooks/useToolBridge.ts` 给 Geoman `pm.enable` 传入轻量编辑选项：关闭吸附、同步拖动、pinning 和中点辅助点，仅显示视野内编辑点，减少多边形/顶点拖动时的计算量。
- 取舍：编辑时不再自动吸附到其他边界；如果后续需要高精度贴边，可再做一个“吸附开关”。

## 2026-07-05 Current Effective Summary
- 本轮针对农田识别对齐、跨工具缓存和天气查询做最小改动。
- 当前视图/框选识别和训练草图使用 `/amap-static?...&style=satellite` 获取高德卫星拼图；后端 `server.py` 支持按中心、zoom、size 拼接高德卫星瓦片，减少“模型看标准地图、用户看卫星图”导致的识别偏差。
- 识别默认参数收紧为 `yolo_conf=0.25`、`min_area_m2=200`，仍可在 UI 中手动调整。
- 应用状态现在双写：浏览器 `localStorage` + 后端 `/state` 文件 `backend/data/webgis_state.json`；换不同预览工具时，只要同一个本地后端可用，就能恢复图层和识别结果。
- 天气查询作为现有浮窗系统的一项，默认地点为石河子，使用 Open-Meteo 当前天气与 7 日预报，无新增依赖或密钥。

## 2026-07-02 Cleanup Summary
- 本项目是本地 WebGIS 标注与农田地块识别工作台：前端为 Vite + React + TypeScript + Leaflet/Geoman，后端位于 `backend/farmland_segmenter/`，提供 YOLO segmentation 训练/推理和 `/amap-static` 高德静态图代理。
- 前端入口固定为 `http://127.0.0.1:5182/`，训练中心为 `/train`，后端默认地址为 `http://127.0.0.1:8765/`。
- 已修复 Rollup 原生包半安装/平台依赖错误：删除手写的 Linux Rollup 二进制依赖，并通过 `npm install` 恢复 Windows optional dependency。
- 已删除 AI 生成的根目录报告、运行日志、无内容占位脚本和未引用示例工具文件。
- `jszip`、`geotiff` 仍被浏览器端 YOLO 数据集导出使用；`shapefile` 未被代码引用，已移除。

## Current Effective Summary
- 本地 WebGIS 标注与农田地块识别工作台；前端负责地图、图层、标注、训练中心和结果呈现，后端负责 YOLO segmentation 训练/推理与高德静态图代理。
- 地图要素以 WGS-84 存储；高德底图显示和静态图请求使用 GCJ-02 中心点，`getMapSnapshot`/`selectMapSnapshot` 同时提供 WGS84 bounds 用于写回和推理结果入库。
- 训练中心现在有两类输入：YOLO ZIP 用于模型训练；地图草稿用于把当前地图静态底图带入训练中心快速标注、写回当前图层，也可把整幅底图和面标注打包成可训练 YOLO ZIP。
- 当前地图草稿通过 `/amap-static` 获取 640x640 底图作为训练图片；“当前地图去标注”会先在主地图上框选区域，再按选区中心和整数缩放生成训练中心底图；训练中心用高德卫星瓦片作可视化参考，点/线/面标注按 WGS84 bounds 反算为 GeoJSON 要素，其中 YOLO 分割训练只使用面标注。
- 关键文件：`src/FieldDetectPanel.tsx`、`src/components/ManualLabelCard.tsx`、`src/TrainingPage.tsx`、`src/hooks/useToolBridge.ts`、`src/hooks/useYoloInference.ts`、`backend/farmland_segmenter/server.py`。

## Purpose
- 本地 WebGIS 标注与农田/地块识别工作台，前端负责地图、图层、标注、训练数据导出与结果呈现，后端负责 YOLO segmentation 训练和推理。

## Scope
- 当前任务聚焦地块识别训练、推理输出和地图呈现链路。
- 默认不回退或清理仓库中已有的大量未提交改动。

## Architecture And Conventions
- 前端为 Vite + React + TypeScript + Leaflet/Geoman。
- 地图要素以 WGS-84 存储；高德底图显示时通过 WGS/GCJ 转换临时偏移显示。
- YOLO 训练数据必须包含 `images/train` 真实影像和 `labels/train` 同名 segmentation 标签。
- 地图草图训练数据生成会把 `/amap-static` 返回的整幅底图写入 `images/train`，并把草图面标注写入同名 segmentation 标签。
- 后端 `backend/farmland_segmenter` 提供 `/segment`、`/train`、`/train/status` 和 `/amap-static`。
- 当前视图/框选识别使用 AMap 静态图时，前端必须用同一个整数 zoom 同时请求 `/amap-static` 并反算 WGS84 bounds；否则识别结果会出现经纬度/尺度错位。
- 每次 YOLO 训练保存为新的命名 `.pt` 文件，前端可把刚训练完成的模型路径直接传给推理接口。

## Key Files
- `src/FieldDetectPanel.tsx`：农田识别侧栏主容器，连接标注、训练和推理状态。
- `src/components/ManualLabelCard.tsx`：人工标注、训练提交和模型输出名输入。
- `src/components/YoloInferenceCard.tsx`：模型选择、阈值参数和识别触发 UI。
- `src/TrainingPage.tsx`：训练中心，展示后台训练状态、指标、模型命名和结果文件。
- `src/hooks/useYoloTraining.ts`：提交训练任务并消费训练 SSE 状态。
- `src/hooks/useToolBridge.ts`：地图桥接 API，包含当前视图截图信息。
- `src/hooks/useYoloInference.ts`：调用 `/segment` 并把识别结果写入前端图层。
- `src/utils/yoloDataset.ts`：人工标注导出 YOLO segmentation 数据集。
- `backend/farmland_segmenter/train.py`：YOLO segmentation 训练入口、数据集校验、模型命名保存、训练指标轮询。
- `backend/farmland_segmenter/server.py`：训练/推理 HTTP API 与训练状态管理。
- `backend/farmland_segmenter/inference.py`：YOLO mask 到 GeoJSON 地块的转换。

## External Constraints
- 高德静态图代理依赖后端 `AMAP_KEY`。
- 本地 YOLO 训练/推理依赖 `ultralytics` 和 `torch`。
- Windows 启动后端应优先使用 `D:\ProgramData\anaconda31\python.exe`；旧的 `D:\Python\python.exe` 3.7 缺少 YOLO 依赖。
- 当前仓库工作树已有大量用户/既有未提交改动，修改时必须最小化范围。

## Current Assumptions
- “地块识别”应以训练后的 YOLO segmentation 模型为主，不再依赖旧的 ExG/NDVI 占位识别。
- 推理结果入库坐标保持 WGS-84，由地图显示层按底图临时转换。
- 如果当前阈值下无地块，用户应能在识别卡片直接调低置信度、IoU 或最小面积后重新识别。
