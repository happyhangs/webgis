"""Farmland parcel segmentation backend v0.2.

New in v0.2:
- Multi-scale ExG vegetation index fusion
- NDVI support for multi-band (R/G/B/NIR) GeoTIFF
- Sauvola local adaptive + Otsu global hybrid thresholding
- Texture-aware filtering to separate farmland from forest
- Watershed refinement for touching parcels
- Python 3.9+ only (rasterio CRS support)
- Replaced deprecated `cgi` module with pure Python multipart parser
- YOLOv11-seg fine-tuning & inference: train on your own labels, then segment

Usage:
    # Baseline (traditional):
    python -m farmland_segmenter image.tif

    # YOLO inference (after training):
    python -m farmland_segmenter image.tif --model models/farmland_seg_best.pt

    # Training:
    python -m farmland_segmenter.train path/to/dataset.zip

    # HTTP server:
    python -m farmland_segmenter --serve
"""

from .segmenter import SegmentOptions, segment_image_bytes, segment_image_file

__all__ = ["SegmentOptions", "segment_image_bytes", "segment_image_file"]
