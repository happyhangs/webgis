# 农田地块后端分割服务 v0.2

这个目录提供本地可执行的农田地块分割后端。当前版本是可替换模型接口加传统图像处理基线：适合打通"上传影像 -> 输出 GeoJSON 地块 -> WebGIS 图层展示"的流程，不等同于已经训练好的生产级深度学习模型。

## v0.2 更新

- **多尺度 ExG 融合**：在 3 个分辨率层级上计算过量绿指数（ExG），加权融合，对大田块和小条田都更敏感。
- **NDVI 支持**：自动检测 4 波段（R/G/B/NIR）GeoTIFF，结合 NDVI 评分增强作物区分能力。CLI 可通过 `--nir-band` 显式指定波段索引。
- **Sauvola 自适应阈值**：全局 Otsu + 局部 Sauvola 混合判断，在光照不均和纹理复杂区域表现更好。稀疏/过饱和场景自动回退到宽松策略。
- **纹理感知过滤**：基于局部方差过滤森林冠层的高纹理区域，减少将林地错误标记为农田。
- **分水岭精修**：对紧邻地块进行距离变换 + 分水岭分割，减少地块粘连。CLI 可通过 `--no-watershed` 禁用。
- **Python 3.9+**：启用 `@dataclass(slots=True)`，移除旧 GeoTIFF Tag 解析回退（统一使用 rasterio CRS）。移除了已废弃的 `cgi` 模块，替换为纯 Python multipart 解析器。
- **植被活力标注**：每个地块输出 `vegetationVigor` 字段（高/中/低），基于地块内绿色通道均值。

## 环境要求

- Python 3.9 或更高版本
- 依赖安装：`pip install -r requirements.txt`（需要 rasterio 的 GDAL 底层依赖，Windows 建议从 [Christoph Gohlke](https://www.lfd.uci.edu/~gohlke/pythonlibs/) 安装预编译 wheel）

## 运行 API/可视化服务

```bash
cd backend
python -m farmland_segmenter --serve
```

打开：

```text
http://127.0.0.1:8765/
```

接口：

```text
POST http://127.0.0.1:8765/segment
multipart/form-data:
  image: tif/tiff/png/jpg/webp/bmp
  west/south/east/north: 影像对应的经纬度边界（前端模型识别使用）
  origin_lat: 普通图片近似配准中心纬度
  origin_lng: 普通图片近似配准中心经度
  pixel_size_m: 米/像素
  min_area_m2: 最小地块面积
  nir_band: NIR 波段索引（0-based，可选）
  enable_watershed: true/false（可选，默认 true）
  enable_texture_filter: true/false（可选，默认 true）
```

返回 `FeatureCollection`，每个地块包含 `parcelCode`、`parcelAreaSquareMeters`、`parcelAreaMu`、`parcelConfidence`、`vegetationVigor` 等属性。

当 `backend/models/farmland_seg_best.pt` 存在时，`/segment` 默认使用该训练模型；前端“模型识别并显示结果”会把返回多边形写入“农田模型识别”图层。

## 高德静态底图代理

网页端人工标定导出 YOLO 数据集时，如选择"高德选区底图"，会调用本地只读代理：

```text
GET http://127.0.0.1:8765/amap-static?location=86.080600,44.306100&zoom=15&size=640*640
```

该接口只转发高德 StaticMap 的 `location`、`zoom`、`size` 参数，不接受任意 URL。可通过环境变量 `AMAP_KEY` 覆盖默认 key。高德底图仅建议本地研究和标定验证；生产训练请优先使用自有或已授权影像。

## 命令行处理单张影像

```bash
cd backend
python -m farmland_segmenter path\to\image.tif -o result.geojson --origin-lat 44.3061 --origin-lng 86.0806 --pixel-size-m 1 --min-area-m2 200
```

新选项：

```bash
--model farmland_seg_best.pt  # 使用训练好的 YOLO 模型推理（替代 ExG 管线）
--yolo-conf 0.3               # YOLO 置信度阈值（默认 0.25）
--yolo-iou 0.5                # YOLO NMS IoU 阈值（默认 0.45）
--nir-band 3                  # 指定 NIR 波段索引（0-based）
--no-watershed                 # 禁用分水岭精修（仅基线管线）
--no-texture-filter            # 禁用纹理过滤（仅基线管线）
```

GeoTIFF 如果包含 CRS（通过 rasterio 识别），会优先使用影像地理参考。4 波段影像自动检测 NIR。普通图片需要填写中心点和像元尺寸。

当指定 `--model` 时，跳过传统 ExG 管线，直接用训练好的 YOLOv11-seg 模型执行实例分割推理。

## 用自己的标注训练模型

这是完整闭环的核心：前端标定 → 导出 ZIP → 训练 → 部署 → 自动分割。

### Step 1：在前端绘制标注

在点位工具的"农田识别"面板：

1. 选择"高德选区底图"或"上传影像"作为数据来源
2. 选择选区图层（或用内置的自动分割生一个）
3. 点击"开始标注"，用 Polygon/Rectangle 工具在地图上圈农田
4. 完成后点击"导出 YOLO 分割数据集"→ 得到一个 ZIP 文件

### Step 2：训练模型

```bash
cd backend
python -m pip install -r requirements.txt
python -m farmland_segmenter.train path/to/farmland_manual_yolo_2026-06-02.zip --epochs 100 --batch 8
```

如果 GPU 可用，训练会自动用 GPU；否则用 CPU（较慢但也可跑）。
Windows/Anaconda 环境如果 `torch` 报 DLL 初始化失败，可改装 CPU 轮子：
`python -m pip install --force-reinstall --no-deps torch==2.5.1+cpu torchvision==0.20.1+cpu --index-url https://download.pytorch.org/whl/cpu`。

参数说明：

```bash
--model yolo11n-seg.pt    # 基础模型：nano(最快)/small/medium/large
--epochs 100               # 训练轮数，标注少于 50 个增加可以到 200
--batch 8                  # 批次大小，GPU 显存不足时减小
--imgsz 640                # 输入图像尺寸
--device 0                 # GPU 设备号，默认 auto
```

训练完成后，最佳权重保存为 `backend/models/farmland_seg_best.pt`。

### Step 3：用训练好的模型分割

```bash
# CLI 模式
python -m farmland_segmenter new_image.tif --model models/farmland_seg_best.pt

# HTTP 模式（前端上传）
python -m farmland_segmenter --serve
# POST /segment 时传入 model_path 字段
```

生成的 GeoJSON 中每个地块标注 `source: yolov11-seg:farmland_seg_best`，置信度写入 `parcelConfidence`。

## 打包 Windows EXE

```powershell
cd backend
pip install pyinstaller
python -m PyInstaller --onefile --name farmland-segmenter farmland_segmenter/__main__.py
```

生成后运行：

```powershell
.\dist\farmland-segmenter.exe --serve
```

## 后续接入真实模型

保持 `/segment` 返回格式不变即可替换模型核心。推荐路线：

- 使用标注好的农田边界样本训练 UNet/DeepLab/SegFormer/SAM-adapter。
- 后端在 `segmenter.py` 中替换 `_make_farmland_mask` 或新增深度学习推理分支。
- 输出仍保持 GeoJSON `Polygon/MultiPolygon` 和面积属性，前端无需重做图层逻辑。
