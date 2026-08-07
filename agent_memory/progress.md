# Task Progress

## 2026-08-07 审视风险修复（密钥与本地数据）
- Goal: 修复审视发现的提交前风险：start.bat 硬编码 AMAP_KEY、counties 大目录未忽略。
- Completed: 创建 `.env`（含本地 AMAP_KEY）并加入 `.gitignore`；`start.bat` 改为从 `.env` 读取并给出缺失提示；`scripts/start-all.mjs` 增加最小 `.env` 加载（不引入依赖）；`public/data/counties/` 加入 `.gitignore`；README 同步更新数据与密钥说明。
- Validation: `git check-ignore -v` 确认 `.env` 与 `public/data/counties/` 均被忽略；`node --check scripts/start-all.mjs` 通过；cmd 实测 `for /f` 能从 `.env` 解析出 AMAP_KEY（parsed=yes）；未改动前端代码，无需重跑 build。
- Status: 完成；剩余"大量未提交改动分组提交"仍需用户决策，未擅自处理。

## 2026-08-07 项目全面审视
- Goal: 审视项目当前状态（仅审查，不改运行时代码）。
- Completed: 读取 agent_memory、README、启动脚本、前后端结构与关键实现；执行构建、单测与后端语法验证。
- Validation: `npm run build` 通过（3.2s）；vitest 10 文件 32 项通过；后端 unittest 8 项通过；`python -m compileall` 通过；`git diff --check` 仅 LF/CRLF 提示；5182/8765 当前未监听。
- Finding: 前后端代码健康，主要风险集中在提交前：start.bat 硬编码 AMAP_KEY、counties 数据约 228MB 未忽略、大量未提交改动与照片删除。
- Status: 审视完成，未修改运行时代码；风险已记录至 bugs.md。

## 2026-07-15 手动地块标注关闭吸附
- Goal: 手动绘制农田地块时，新顶点不自动粘附到之前的点。
- Completed: 手动标注入口关闭 Geoman 顶点和中点吸附；删除会覆盖该配置的冗余重复启用逻辑，连续绘制仍由 `continueDrawing` 保持。
- Validation: `npm run build` 通过；Vitest 10 个文件、32 个测试通过；`git diff --check` 通过。
- Status: 本轮需求完成；普通主页绘图工具的吸附行为未修改。

## 2026-07-14 高德卫星拼图连接修复
- Goal: 修复行政区域识别获取卫星静态图时的 `WinError 10061`。
- Completed: 定位为 Python 继承失效环回代理；后端仅在代理拒绝连接时改用全新请求对象直连，避免复用已被 `urllib` 代理处理器改写的请求。
- Validation: 8 个后端单元测试通过；失效代理环境下直接瓦片请求返回 HTTP 200；重启后端后实测 `/amap-static` 返回 HTTP 200、`image/jpeg`、193779 字节。
- Status: 本轮连接错误已解决；行政区域识别仍要求本机能够访问在线高德卫星服务。

## 2026-07-14 农田识别范围选择
- Goal: 在农田识别页同时提供本地影像、地图框选和行政区域三种范围选择。
- Completed: 新增三段式范围切换；地图模式直接提供框选识别/当前视图识别；行政区模式支持省、市、县三级本地选择、地图定位、边界图层和所选行政区识别。
- Validation: `npm run build` 通过；Vitest 10 个文件、32 个测试通过；Chrome 实测新疆维吾尔自治区/石河子市选择、边界图层写入及 `/amap-static -> /segment` 完整链路。
- Status: 本轮需求完成；整省/整县高分辨率批量切片识别仍属于后续批处理能力。

## 2026-07-14 本地影像识别与训练入口
- Goal: 不向外部地图服务发送地块经纬度，改用本地影像、本地标注和本地 YOLO 后端完成识别/训练。
- Completed: 农田面板新增 GeoTIFF/PNG/JPG 入口；GeoTIFF 自动读取 4326/4490 边界，PNG/JPG 显式框选覆盖范围；载入后切换离线底图并显示本地影像。
- Completed: 本地影像可调用本地 `/segment`，也可进入训练中心标注；训练中心本地草稿不请求高德瓦片，在线识别入口收进带风险说明的折叠区。
- Validation: `npm run build` 通过；Vitest 9 个文件、31 个测试全部通过；真实 Chrome 验证 GeoTIFF 自动定位、离线底图、本地推理和训练草稿，上传、推理、进入训练中心三段均无外部网络请求；本地 `/segment` 返回正常无地块结果。
- Status: 本地链路已完成。GeoTIFF 投影坐标系暂不做浏览器端重投影，需要手动框选；模型精度仍取决于真实标注数据。

## 2026-07-14 新疆多区域训练数据集
- Goal: 修复旧数据集“多地块挤在单张远景图”导致的小目标问题，生成可用于农田分割训练的多区域近景数据，并重新训练评估。
- Completed: 盘点并去重两份人工标注与 KML；新增 `npm run dataset:xinjiang` 数据集生成命令，复用项目 WGS84/GCJ02 转换，支持近景裁切、邻近标注纳入、YOLO 标签裁剪、空间隔离 train/val 和 ZIP 输出。
- Validation: `npm run dataset:xinjiang -- --dry-run` 通过；除统计人工标注 114、KML 25、训练 119/验证 20 外，还逐地块校验了静态图覆盖范围、缩放级别和 YOLO 标签可生成性。
- Blocked: 实际瓦片下载会把本地地块中心坐标发送给高德服务，权限审查要求用户先明确授权；未生成新影像、未开始新训练。
- Status: 连续三次执行均未获得该数据外发授权，当前任务已暂停；用户明确回复同意后可从单张影像对齐检查继续。
- Next: 用户明确同意坐标发送后，先生成 1 张烟雾样本核对影像/标签对齐，再生成全量数据、训练并比较 mAP50/Recall。

## 2026-07-14 农田识别目标链路验收与入口修复
- Goal: 依据真实网页、后端和模型产物验收农田分割与训练可视化，并补齐最影响小白使用的入口问题。
- Completed: `src/index.css` 让折叠属性栏保留三个 30px 浮窗按钮；农田识别入口在 1440x960 和 1024x768 均可直接打开。
- Runtime: `/health`、`/train/status`、`/amap-static`、`/state` 均实测成功；训练中心显示 100/100 Epoch、100 条历史、指标曲线和模型结果；`/segment` 使用最近模型返回 GeoJSON Polygon。
- Runtime limitation: 网页按默认置信度 0.25 实测返回“没有发现地块”；低至 0.01 虽可返回结果，但包含大量低置信度误检，不作为可用效果。
- Validation: `npm run build` 通过；Vitest 8 文件 30 项通过；Python 后端 7 项通过；`compileall` 通过；Chrome 实测主页、训练中心、折叠入口与网页识别请求。
- Next: 需要用户确认目标地区和期望精度，优先增加跨区域、跨时相、不同地块形态的真实影像与面标注，再重新训练和验收。

## 2026-07-13 主页连续图层绘制
- Goal: 在主页选择点、线、面或矩形工具后，可以连续绘制多个要素，并保留现有工具退出方式。
- Completed: `src/hooks/useToolBridge.ts` 启用 Geoman 的 `continueDrawing` 选项；同一工具再次点击、切换工具时仍会调用现有 `disableDraw`。
- Validation: `npm run build` 通过；`npx vitest run` 的 8 个测试文件、30 项测试全部通过。
- Unverified: 本轮未向持久化图层写入测试要素，因此未执行真实地图连续点击的浏览器交互验证；连续行为依据本地 Geoman 2.18 类型定义和构建结果确认。

## 2026-07-13 UI 复审建议实施（第一阶段）
- Goal: 落地已确认的训练中心独立渲染、地图空间回收、训练信息语义和交互安全改进。
- Completed: `App.tsx` 在 `/train` 与地图工作台之间二选一渲染，训练中心不再覆盖并继续挂载 Leaflet、工具栏和浮窗。
- Completed: 属性面板无选中要素时默认折叠；选中新的要素会自动展开，用户仍可手动折叠当前要素。
- Completed: 训练中心把持久化完成状态明确标为“最近一次训练”，并将新任务数据集/参数与最近模型分开命名；历史时间线同步标为“最近训练过程”。
- Completed: 图层、工具栏、浮窗的纯图标按钮补充可访问名称；属性面板删除要素复用项目现有原生确认流程。
- Validation: `npm run build` 通过；Vitest 8 文件 30 项通过；`git diff --check` 无空白错误，仅有仓库既有 LF/CRLF 提示。
- Blocked: `src/index.css` 的窄屏工具栏、模型名输入宽度、文字对比度和大面积模糊收敛补丁被审批层因连接中断拦截；未绕过限制，等待用户再次明确允许后继续。
- Unverified: 无头 Chrome 回归首次审批超时、重试因 PowerShell 引号转义失败；未继续绕过或重复执行，当前行为改动以构建和静态结构验证为准。

## 2026-07-13 项目 UI 复审与升级建议
- Goal: 只读复审主地图工作台与训练中心，识别可升级、美化且收益明确的改进点。
- Boundary: 本轮未修改运行时代码与样式，仅更新项目记忆；未扩大到模型精度、依赖升级或数据清理。
- Finding: `/train` 仍以全屏覆盖层叠在完整地图工作台之上，后台 37 个工作台控件继续可聚焦，地图也会继续初始化。
- Finding: 1024px 宽度下工具栏由 52px 换行为 89px，左右面板占 546px，地图仅余 438px；空属性栏默认展开是主要空间浪费。
- Finding: 训练中心首次进入时会同时显示“当前训练状态：已完成”和“数据集：未选择”，历史结果与新任务语义混在一起；模型名输入固定为 96px，长名称不可完整查看。
- Finding: 图层折叠按钮缺少可访问名称，多个纯图标按钮只有 `title`；属性栏“删除此要素”没有二次确认。
- Finding: 视觉主题整体已统一且可用，但 11px 浅灰辅助文字偏弱，`index.css` 已达 4175 行并存在多轮覆盖式美化规则，继续追加样式的维护成本较高。
- Validation: Chrome 1440x960 实际检查主页面与训练中心，无控制台错误；DOM/布局检查覆盖 1024px、1366px、1440px；`npm run build` 通过；Vitest 8 文件 30 项通过。
- Next: 建议优先做“训练中心真正分路由渲染 + 属性栏按选择自动展开 + 1024px 工具栏收纳”，再处理训练页信息层级、文本对比度和 CSS 收敛。

## 2026-07-11 农田识别界面精简与训练过程可视化
- Goal: 将农田识别浮窗收敛为地图范围推理，把标注、数据、训练和可视化集中到训练中心。
- Completed: 移除农田浮窗的上传影像识别、上传配准、绘制标注、直接训练和训练指标；保留当前视图/框选推理及阈值设置。
- Completed: 新增 15 个历史面标注的一键保存/转入训练中心入口，以及框选地图进入训练中心标注入口。
- Completed: 训练指标改为 mAP50、mAP50-95、Recall、Seg Loss；修正 Epoch 多加 1，并为低 mAP50 增加明确质量提示。
- Completed: 后端重启时从最近完成的数据集恢复 100 条 Epoch 历史、指标、模型与数据集路径。
- Validation: `npm run build` 通过；Vitest 8 文件 30 项通过；Python 7 项通过。
- Validation: 应用内浏览器确认农田面板无溢出且仅保留两类职责；训练中心显示 4 个指标、2 条曲线、Epoch 100/100 和模型路径，后端重启后仍可恢复；控制台无错误。

## 2026-07-11 真实标注集与运行逻辑审计
- Goal: 解释既有标注为何未参与训练，并核查数据保存、训练及可视化逻辑。
- Finding: 当前状态保留 15 个地图草稿面，但缺少对应影像/范围批次元数据，且所在“图层 2”不会被硬编码的“农田人工标定”入口选中。
- Finding: 上传影像流程把 `imageBounds` 直接设为标注包络框，上传影像也未叠加到地图供用户对图标注，存在严重像素/标签错位风险。
- Finding: 训练临时目录在完成后删除，仅保留 `.pt`；`results.csv`、曲线产物和数据集版本没有长期关联。
- Boundary: 本轮只诊断和提出正确数据方案，未恢复 Git 历史文件、未修改运行时代码。

## 2026-07-11 训练验证与可视化改进
- Goal: 消除训练/验证复用、补齐逐 Epoch 可视化，并验证范围推理和图层输出所需的 Polygon 数据。
- Completed: `train.py` 自动建立独立训练/验证集；单图空间裁切、多图按图片留出，无法产生正样本验证区时阻止训练。
- Completed: `server.py` 累积并通过 SSE/`/train/status` 返回 `history`；训练中心新增 Loss 与 mAP50 原生 SVG 曲线，无新增依赖。
- Completed: 新增 3 项 Python 单测，覆盖单图拆分、标签裁切归一化和重复 Epoch 历史更新。
- Validation: `npm run build` 通过；Vitest 8 文件 29 项通过；Python 3 项通过；compileall 通过；本机范围推理返回 126 个 Polygon 且全部坐标位于给定边界。
- Validation: 应用内浏览器检查训练中心无水平溢出、无控制台错误，后端连接正常；未执行完整 GPU 训练和权威真值精度评估。

## 2026-07-06 Training Draft Color
- Goal: 地图标注草稿颜色可更改。
- Scope: 只改训练中心地图草稿颜色，不新增调色板依赖，不改变标注几何和框选范围。
- Completed: `src/TrainingPage.tsx` 新增 `draftColor` 状态和原生 `input type="color"`；写回图层和生成训练数据时传入当前颜色。
- Completed: `src/index.css` 使用 `--draft-color` 控制草稿点/线/面、预览线和提示颜色。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-06 Training Draft Delete Tool
- Goal: 地图草稿标错时可以删除单个已完成标注。
- Scope: 只改训练中心地图草稿交互，不做顶点编辑、不改训练数据/写回图层格式。
- Completed: `src/TrainingPage.tsx` 新增 `delete` 工具状态；删除模式下点击已完成点、线、面会从 `draftShapes` 移除，空白处不新增标注。
- Completed: `src/index.css` 给删除模式和可删除标注增加点击命中与 hover 危险色。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-06 Training Draft Wheel Zoom
- Goal: 纠正“框选地图去标注”缩放需求理解；去掉面板里的“框选取景”滑杆，在训练中心标注时对既有草图做滚轮缩放，最小不超过草图范围。
- Scope: 最小回退上一轮错放的面板取景缩放；不改变框选识别 `selectionBounds` 裁剪逻辑，不改后端 `/amap-static`。
- Completed: `src/FieldDetectPanel.tsx` 和 `src/components/ManualLabelCard.tsx` 已移除 `mapDraftScale` 状态、props 和“框选取景”滑杆。
- Completed: `src/hooks/useToolBridge.ts` 与 `src/utils/mapAPI.ts` 的 `selectMapSnapshot` 恢复为无参数调用；`src/utils/amapStatic.ts` 删除未需要的 `scaleStaticBounds`。
- Completed: `src/TrainingPage.tsx` 新增地图草稿滚轮缩放状态；指针坐标会按当前缩放视图反算到原始 0-1 草图坐标，标注写回范围不变。
- Completed: `src/TrainingPage.tsx` 的卫星瓦片定位改按固定 `AMAP_STATIC_SIZE` 计算百分比；`标注画布大小` 只改变容器尺寸，不再改变可见地图范围。
- Completed: `src/index.css` 新增统一缩放层 `.training-map-zoom-layer`，底图、瓦片和 SVG 标注一起缩放，并阻止画布内滚轮带动页面滚动。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。
- Validation: `node -e` 缩放数学检查通过，确认最小缩放回到完整范围且滚轮缩放保持鼠标指向的草图坐标不漂移。

## 2026-07-06 Selection-Constrained Inference
- Goal: 回答并落地“能否自标注训练提升准确度”，同时修复框选/导入模型识别结果与区域不对应的问题。
- Scope: 只改前端推理范围和写回逻辑；不新增依赖，不改后端训练/推理接口。
- Completed: `src/hooks/useToolBridge.ts` 的框选截图返回真实 `selectionBounds`，保留静态图整幅 `bounds` 用于影像地理参考。
- Completed: `src/hooks/useYoloInference.ts` 在写入图层前把 YOLO Polygon 裁剪到 `selectionBounds`，并按裁剪后面积重算亩数、过滤小于最小面积的残片。
- Completed: `src/FieldDetectPanel.tsx` 取消导入 `.pt` 后自动跑当前视图推理；用户需显式捕获当前视图或框选区域。
- Completed: `src/utils/geoBounds.ts` 新增矩形裁剪与面积计算工具，并用 `src/utils/__tests__/geoBounds.test.ts` 覆盖。
- Validation: `npx vitest run src\utils\__tests__\geoBounds.test.ts` 通过。
- Validation: `npm run build` 通过。
- Validation: `git diff --check -- <本轮相关文件>` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-06 Toolbar Cleanup
- Goal: 去除“点位工具”旁边的数字，并重新绘制/替换训练中心图标。
- Completed: `src/Toolbar.tsx` 删除 `toolbar-brand-count` 数字徽标。
- Completed: 训练中心图标由 `BrainCircuit` 替换为 `Network`，不新增资源或依赖。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-05 Layer Collapse Hook Fix
- Goal: 修复图层侧边栏折叠时页面报错 `Rendered fewer hooks than expected`。
- Completed: `src/LayerPanel.tsx` 的折叠态返回已移动到所有 hooks 之后，避免折叠路径少调用 `useEffect`。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-05 Drag Responsiveness
- Goal: 改善用户反馈的“拖动图层不是很跟手”。
- Scope: 只优化现有拖动链路，不新增依赖，不做拖拽排序或新的编辑模式。
- Completed: `src/useDraggablePanel.ts` 改为拖动中用 `requestAnimationFrame` 直接更新面板 DOM 位置，松手后再同步 React 状态。
- Completed: `src/hooks/useToolBridge.ts` 的 Geoman 编辑模式关闭吸附、同步拖动、pinning 和中点辅助点，并限制编辑点为视野内，降低复杂图形编辑时的拖动计算量。
- Validation: `npm run build` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。

## 2026-07-05 Recognition Cache Weather
- Goal: 修复农田识别导入结果与地图不对应、识别误差偏大、跨工具打开缓存丢失，并新增默认石河子天气查询模块。
- Scope: 最小改动前后端现有链路；不新增依赖；不重写 YOLO 模型或训练流程。
- Completed: `backend/farmland_segmenter/server.py` 新增 `/amap-static?style=satellite` 高德卫星瓦片拼图分支，用于识别和训练草图底图。
- Completed: `src/hooks/useYoloInference.ts` 和 `src/FieldDetectPanel.tsx` 的当前视图/框选识别改用卫星静态图；地图草图训练入口也改用卫星图；默认识别参数收紧为 `0.25` 置信度、`200 m2` 最小面积。
- Completed: `backend/farmland_segmenter/server.py` 新增 `/state` GET/POST；`src/store.ts` 与 `src/AppContext.tsx` 增加本地与后端状态双写/恢复。
- Completed: `src/utils/weather.ts`、`src/WeatherPanel.tsx`、`src/FloatingPanelContext.tsx`、`src/FloatingPanelDock.tsx`、`src/App.tsx` 和 `src/index.css` 新增天气浮窗，默认石河子，支持城市/坐标查询和 7 日预报。
- Validation: `npm run build` 通过。
- Validation: `python -c "import ast, pathlib; ast.parse(...server.py...)"` 通过。
- Validation: `git diff --check` 通过，仅输出仓库既有 LF/CRLF 提示。
- Note: 未跑真实 YOLO 推理和真实浏览器交互截图；天气接口依赖浏览器可访问 Open-Meteo。

## 2026-07-03 AMap Inference Alignment
- Goal: 修复导入模型后识别结果与高德地图经纬度/大小不对应的问题。
- Completed: 将 AMap 静态图 zoom 统一为 3-17 的整数；前端请求 `/amap-static` 和反算 WGS84 bounds 使用同一个 zoom。
- Completed: 抽出 `src/utils/amapStatic.ts` 统一计算 AMap 静态图范围，避免小数 zoom 被后端按默认/整数处理时造成比例错位。
- Validation: `npm run build` 通过；`npx vitest run src/utils/__tests__/amapStatic.test.ts` 通过。

## 2026-07-03 YOLO Runtime Fix
- Goal: 修复“本地 YOLO 推理环境缺少 ultralytics”导致农田识别无法运行的问题。
- Completed: 确认旧后端进程由 `D:\Python\python.exe` 3.7 启动，缺少 `ultralytics/torch`；当前可用 YOLO 环境为 `D:\ProgramData\anaconda31\python.exe`。
- Completed: `start.bat` 在检测到 Anaconda Python 时设置 `WEBGIS_PYTHON`，避免后端再次用 Python 3.7 启动。
- Completed: 后端推理缺包错误现在会显示当前 Python 路径，便于定位装包装错解释器的问题。
- Validation: 已停止旧 8765 后端并用 Anaconda Python 重启；`/health` 正常；直接推理入口返回 15 个测试结果；HTTP `/segment` 返回 `FeatureCollection` 和模型路径。

## 2026-07-02 Model Result Entry Move
- Goal: 将农田面板里的“查看模型结果”入口上移到训练入口之前，并说明如何用地图检验已训练模型。
- Completed: `src/FieldDetectPanel.tsx` 中把 `YoloInferenceCard` 调整到 `ManualLabelCard` 前面。
- Completed: `src/components/YoloInferenceCard.tsx` 去掉卡片自身的额外上边距，改用父容器 gap 控制间距。
- Validation: `npm run build` passed.

## 2026-07-02 Current Active Task
- Goal: 修复项目无法打开，并做一轮保守瘦身，去掉确认无用的 AI 膨胀产物。
- Completed: 删除错误的 `@rollup/rollup-linux-x64-gnu` 根依赖，执行 `npm install` 修复 lockfile 和 Windows Rollup optional dependency。
- Completed: 删除未使用的 `shapefile` 开发依赖，执行 `npm install` 同步移除 8 个传递包。
- Completed: 删除 `CODE_REVIEW.md`、`PROJECT_FRAMEWORK.md`、`UI_ARCHITECTURE.md`、`.vite-dev*.log`、`.backend-dev*.log`。
- Completed: 删除只剩占位注释且无引用的 `scripts/convert-shp.mjs`、`scripts/split-counties.mjs`、`src/utils/farmland.ts`，并删除本地训练产物 `train/1.png`。
- Completed: 更新 `.gitignore` 和 `README.md`，避免日志、本地模型、训练产物和已删脚本继续干扰。
- Validation: `npm run build` passed；`python -m compileall backend\farmland_segmenter` passed；`git diff --check` passed with only LF/CRLF warnings；`npm ls` confirmed Windows Rollup package resolves and removed packages are absent.

## Current Effective Summary
- Goal: 重新梳理模型输入与地图标注输入方式，支持从当前地图视图生成带 WGS84 边界的可标注底图，在训练中心标注后写回图层。
- Scope: 只改前端数据流和训练中心 UI；复用现有 `/amap-static`、`getMapSnapshot`、AppContext 图层写入能力，不新增后端接口。
- Status: 已完成当前地图草稿进入训练中心、卫星底图展示、点/线/面点击标注、WGS84 要素写回当前图层，并支持框选地图区域后把底图和面标注直接生成训练数据。
- Completed: `TrainingMapDraft` 携带 `amapCenter`；训练中心用高德卫星瓦片拼底图；点/线/面工具写回 Marker/LineString/Polygon；草图画布可调大小和左/右/上位置；“当前地图去标注”先框选地图区域；面标注可一键生成 YOLO ZIP 并填入训练中心，当前 3 点以上未闭合面会自动作为训练面处理，生成后退出草图编辑状态。
- Validation: `npm run build` 通过；`git diff --check` 通过，仅有仓库既有 LF/CRLF 提示。
- Next: 用户实际验证“当前地图去标注 -> 选择点/线/面 -> 完成当前 -> 添加至图层”；如需要精修边界，再升级为顶点编辑。

## Current Active Task
- Goal: 修复项目无法打开（多个源文件被异常写入损坏）。
- Scope: 删除 `useYoloTraining.ts`、`TrainingPage.tsx` 末尾 NUL 字节；按损坏前内容补全 `yoloDataset.ts`、`useManualLabelLayer.ts`、`Toolbar.tsx` 截断段；修复 `farmlandId`、geotiff `getBitsPerSample` 类型错误。
- Success Criteria: `tsc -b` 通过；前端 dev/build 在用户 Windows 环境可正常启动。
- Status: 代码修复完成，`tsc -b` 通过；vite 运行时因 Linux VM esbuild 跨平台限制未验证。
- Validation: `tsc -b` 通过（无类型错误）；vite build/dev 在 Linux VM 因 esbuild 二进制段错误无法运行，待用户在 Windows 执行 `start.bat` 或 `npm run dev` 确认。
- Previous Goal: 优化农田识别和训练中心的交互流畅度与布局。
- Scope: 去除浮窗玻璃模糊效果；压缩农田识别面板冗余提示；“当前地图去标注”改为主地图框选区域；训练中心改为更稳定的三栏布局。
- Success Criteria: 浮窗拖动更轻；识别面板信息更少；用户可选择地图区域作为草图底图；训练中心参数、过程、日志/结果位置更明确。
- Status: 已完成；追加修复训练中心入口状态清理和草图转训练数据的状态切换。
- Validation: `npm run build` 通过；`git diff --check` 通过，仅有仓库既有 LF/CRLF 提示；Vite 服务仍在 `http://127.0.0.1:5182/`。

## Current Active Task Result
- Completed: `src/hooks/useYoloExport.ts` 新增内存训练数据集生成函数，备份下载和直接转训练中心共用同一套导出逻辑。
- Completed: `src/FieldDetectPanel.tsx` 与 `src/components/ManualLabelCard.tsx` 新增“转入训练中心”路径，点击后生成内存 ZIP 并打开训练中心。
- Completed: `src/App.tsx` 暂存页面内传递的数据集，并传给 `TrainingPage`。
- Completed: `src/TrainingPage.tsx` 支持接收初始数据集，打开后自动填入并提示可直接开始训练。
- Completed: `src/TrainingPage.tsx` 新增标注画布大小滑杆、左/右/上位置切换和位置提示；默认画布从 640 视觉宽度降为 520。
- Completed: `src/TrainingPage.tsx` 新增“作为训练数据”按钮，把地图草图面标注和整幅 `/amap-static` 底图生成内存 ZIP 并填入数据集选择。
- Completed: `src/TrainingPage.tsx` 的“作为训练数据”会自动接收当前 3 点以上待闭合面，生成 ZIP 后清空草图并切换到数据集训练状态。
- Completed: `src/App.tsx` 训练中心入口改为显式一次性传入数据集/地图草稿；返回地图时用 `replaceState` 并清空临时数据，避免从主页面再次进入时复用旧草图或旧 ZIP。
- Completed: `src/utils/yoloDataset.ts` 新增 `buildYoloDatasetZipFromImage`，用于把已有图片 Blob 与 GeoJSON 面标注打包成完整 YOLO segmentation 数据集。
- Completed: `src/hooks/useToolBridge.ts` 新增 `selectMapSnapshot`，用临时矩形框选生成地图草图底图范围。
- Completed: `src/FieldDetectPanel.tsx` 与 `src/components/ManualLabelCard.tsx` 将“当前地图去标注”改为“框选地图去标注”。
- Completed: `src/index.css` 去除浮窗玻璃/模糊效果，压缩农田识别卡片，训练中心固定为参数、过程、日志/结果三栏布局。
- Completed: `src/TrainingPage.tsx` 的面标注改为至少 3 点后点击起点附近闭合成面，按钮文案同步为“闭合面”。
- Validation: `npm run build` 通过；`git diff --check` 通过，仅有仓库既有 LF/CRLF 提示；当前 Vite 服务仍在 `http://127.0.0.1:5182/`。

## Goal
- 优化地块识别训练、推理与可视化闭环：模型可命名且每次训练保存新 `.pt`，推理阈值可调，训练中心展示后台实时训练状态。

## Success Criteria
- 训练数据校验不再用占位图片掩盖缺失真实影像。
- 每次训练按用户输入名称生成唯一 `.pt` 模型文件，并把模型路径/文件名返回前端。
- 训练中心可显示后台训练进度、轮次、指标、模型名、最终模型路径。
- 农田识别面板可复用刚训练出的模型，并允许调整 `yolo_conf`、`yolo_iou`、`min_area_m2` 以解决“当前阈值下无地块”的问题。
- 对涉及的运行时代码执行前端构建和后端编译验证。

## Current Plan
- 已完成主要代码修改和验证。
- 本地前后端服务已启动，交给用户按新流程重新训练/识别。

## Completed
- 创建 `agent_memory/`、`agent_memory/archive/`，并按全局模板补齐 `context.md`、`progress.md`、`bugs.md`。
- 梳理训练链路：人工标注/上传影像导出 YOLO ZIP，后端 `/train` 训练模型，`/segment` 推理后返回 GeoJSON。
- 修正训练校验：后端不再用灰色占位图替代缺失的 `images/train`，并校验标签是否有同名影像。
- 修正训练增强：Pillow `ROTATE_90` 对应的 YOLO 多边形坐标同步改为逆时针旋转。
- 修正地图截图推理：`getMapSnapshot` 返回高德静态图用 GCJ-02 中心点，同时返回 WGS-84 边界用于结果入库。
- 修正前端构建失败点：移除 `FieldDetectPanel` 中未使用的 `setManualMessage` 解构。
- 后端训练支持 `output_name`，按安全文件名加时间戳保存唯一 `.pt`，并返回 `modelPath`/`modelName`。
- 后端训练状态支持实时轮询 `results.csv` 指标，并通过 `/train/status` 和 SSE 暴露 `epoch`、`metrics`、`running`、模型信息。
- 前端人工标注卡片新增模型名输入，训练提交会带上输出名。
- 训练中心新增模型名输入，后台状态每秒刷新，并显示实时指标、最终模型文件和路径。
- 推理钩子新增刚训练模型路径复用，并把置信度、IoU、最小面积传给 `/segment`。
- 识别结果卡片新增当前模型展示、置信度/IoU/最小面积控件和更明确的无结果提示。

## Next
- 用户重新试训练和识别流程；如真实训练或推理仍无结果，再根据训练指标、模型文件和阈值继续定位。

## Validation
- 已运行 `npm run build`：通过；仍有既有 CSS minify warnings。
- 已运行 `python -m compileall backend\farmland_segmenter`：通过。
- 已启动后端分割服务：`http://127.0.0.1:8765/`。
- 已启动前端 Vite：`http://127.0.0.1:5182/`，训练中心为 `http://127.0.0.1:5182/train`。
