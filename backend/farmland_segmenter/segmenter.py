"""Farmland parcel segmentation backend with trained YOLO inference.

The public API stays stable while the implementation lives in inference.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SegmentOptions:
    origin_lat: float | None = None
    origin_lng: float | None = None
    west: float | None = None
    south: float | None = None
    east: float | None = None
    north: float | None = None
    pixel_size_m: float = 1.0
    min_area_m2: float = 200.0
    max_size_px: int = 1600
    max_parcels: int = 800
    layer_name: str = "农田模型识别"
    model_name: str = "yolov11-seg"
    model_path: str | None = None
    nir_band: int | None = None
    enable_watershed: bool = True
    enable_texture_filter: bool = True
    yolo_conf: float = 0.25
    yolo_iou: float = 0.45


def segment_image_bytes(image_bytes, filename="image", options=None):
    from .inference import segment_image_bytes as run_inference

    return run_inference(image_bytes, filename=filename, options=options or SegmentOptions())


def segment_image_file(path, options=None):
    from pathlib import Path

    image_path = Path(path)
    return segment_image_bytes(image_path.read_bytes(), filename=image_path.name, options=options)
