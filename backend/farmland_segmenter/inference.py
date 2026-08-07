"""Trained YOLO inference and mask-to-GeoJSON conversion."""

from __future__ import annotations

import io
import math
import sys
import threading
from pathlib import Path
from typing import Any

from PIL import Image

from .segmenter import SegmentOptions


_model_cache: dict[str, tuple[int, int, Any]] = {}
_model_lock = threading.Lock()


def _default_model_path() -> Path:
    return Path(__file__).resolve().parents[1] / "models" / "farmland_seg_best.pt"


def _resolve_model_path(value: str | None) -> Path:
    path = Path(value).expanduser() if value else _default_model_path()
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / path
    path = path.resolve()
    if not path.is_file():
        raise RuntimeError(f"未找到训练模型：{path}。请先完成训练。")
    return path


def _load_model(path: Path):
    key = str(path)
    stat = path.stat()
    signature = (stat.st_mtime_ns, stat.st_size)
    cached = _model_cache.get(key)
    if cached is not None and cached[:2] == signature:
        return cached[2]
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "本地 YOLO 推理环境缺少 ultralytics，请运行 "
            f"`{sys.executable} -m pip install -r requirements.txt`。当前 Python: {sys.executable}"
        ) from exc
    model = YOLO(key)
    _model_cache[key] = (*signature, model)
    return model


def _resolve_bounds(
    options: SegmentOptions,
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    explicit = (options.west, options.south, options.east, options.north)
    if all(value is not None for value in explicit):
        west, south, east, north = (float(value) for value in explicit)
    elif options.origin_lng is not None and options.origin_lat is not None:
        lat_scale = 111_320.0
        lng_scale = max(1.0, lat_scale * math.cos(math.radians(options.origin_lat)))
        half_width = width * options.pixel_size_m / lng_scale / 2
        half_height = height * options.pixel_size_m / lat_scale / 2
        west = options.origin_lng - half_width
        east = options.origin_lng + half_width
        south = options.origin_lat - half_height
        north = options.origin_lat + half_height
    else:
        raise RuntimeError("缺少影像地理范围，请提供 west、south、east、north。")

    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise RuntimeError("影像地理范围无效。")
    return west, south, east, north


def _polygon_area_square_meters(ring: list[list[float]]) -> float:
    if len(ring) < 4:
        return 0.0
    mean_lat = sum(point[1] for point in ring[:-1]) / max(1, len(ring) - 1)
    x_scale = 111_320.0 * math.cos(math.radians(mean_lat))
    y_scale = 111_320.0
    area_twice = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index][0] * x_scale, ring[index][1] * y_scale
        x2, y2 = ring[index + 1][0] * x_scale, ring[index + 1][1] * y_scale
        area_twice += x1 * y2 - x2 * y1
    return abs(area_twice) / 2


def _normalized_mask_to_ring(
    points: Any,
    bounds: tuple[float, float, float, float],
) -> list[list[float]]:
    west, south, east, north = bounds
    ring: list[list[float]] = []
    for point in points:
        if len(point) < 2:
            continue
        x = min(1.0, max(0.0, float(point[0])))
        y = min(1.0, max(0.0, float(point[1])))
        coordinate = [west + x * (east - west), north - y * (north - south)]
        if not ring or coordinate != ring[-1]:
            ring.append(coordinate)
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0].copy())
    return ring


def segment_image_bytes(
    image_bytes: bytes,
    filename: str,
    options: SegmentOptions,
) -> dict[str, Any]:
    if not image_bytes:
        raise RuntimeError("上传影像为空。")
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise RuntimeError(f"无法读取影像 {filename}：{exc}") from exc

    bounds = _resolve_bounds(options, image.width, image.height)
    model_path = _resolve_model_path(options.model_path)
    with _model_lock:
        model = _load_model(model_path)
        results = model.predict(
            source=image,
            conf=options.yolo_conf,
            iou=options.yolo_iou,
            imgsz=min(max(32, options.max_size_px), 1600),
            device="cpu",
            verbose=False,
        )

    features: list[dict[str, Any]] = []
    if results:
        result = results[0]
        masks = getattr(result, "masks", None)
        normalized_polygons = (
            list(masks.xyn)
            if masks is not None and getattr(masks, "xyn", None) is not None
            else []
        )
        boxes = getattr(result, "boxes", None)
        confidences: list[float] = []
        if boxes is not None and getattr(boxes, "conf", None) is not None:
            confidences = boxes.conf.detach().cpu().tolist()

        for polygon_index, points in enumerate(normalized_polygons[: options.max_parcels]):
            ring = _normalized_mask_to_ring(points, bounds)
            if len(ring) < 4:
                continue
            area_square_meters = _polygon_area_square_meters(ring)
            if area_square_meters < options.min_area_m2:
                continue
            parcel_index = len(features) + 1
            confidence = (
                float(confidences[polygon_index])
                if polygon_index < len(confidences)
                else 0.0
            )
            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "parcelCode": f"YOLO-{parcel_index:03d}",
                    "parcelIndex": parcel_index,
                    "parcelGroup": "模型识别",
                    "parcelAreaSquareMeters": round(area_square_meters, 2),
                    "parcelAreaMu": round(area_square_meters / 666.667, 2),
                    "parcelConfidence": round(confidence, 4),
                    "parcelRole": "parcel",
                    "source": f"yolov11-seg:{model_path.stem}",
                },
            })

    return {
        "type": "FeatureCollection",
        "name": options.layer_name,
        "features": features,
        "summary": {
            "parcelCount": len(features),
            "totalAreaMu": round(
                sum(item["properties"]["parcelAreaMu"] for item in features),
                2,
            ),
        },
        "model": {
            "name": "yolov11-seg",
            "path": str(model_path),
            "trained": True,
        },
        "bounds": {
            "west": bounds[0],
            "south": bounds[1],
            "east": bounds[2],
            "north": bounds[3],
        },
    }
