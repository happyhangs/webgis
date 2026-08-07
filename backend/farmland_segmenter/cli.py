from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .segmenter import SegmentOptions, segment_image_file
from .server import DEFAULT_HOST, DEFAULT_PORT, run_server


def _ensure_utf8_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # pragma: no cover


def main(argv: list[str] | None = None) -> int:
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(description="农田地块后端分割服务 v0.2")
    parser.add_argument("image", nargs="?", help="输入影像路径；不传则启动 HTTP 服务")
    parser.add_argument("-o", "--output", help="输出 GeoJSON 文件路径")
    parser.add_argument("--serve", action="store_true", help="启动本地 HTTP/API/预览服务")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--origin-lat", type=float)
    parser.add_argument("--origin-lng", type=float)
    parser.add_argument("--pixel-size-m", type=float, default=1.0)
    parser.add_argument("--min-area-m2", type=float, default=200.0)
    parser.add_argument("--max-size-px", type=int, default=1600)
    parser.add_argument("--max-parcels", type=int, default=800)
    parser.add_argument("--layer-name", default="农田分割结果")
    parser.add_argument("--model", type=str, default=None,
                        help="训练好的 YOLO .pt 模型路径。指定后跳过传统 ExG 管线，直接用模型推理。")
    parser.add_argument("--yolo-conf", type=float, default=0.25,
                        help="YOLO 置信度阈值（默认 0.25）")
    parser.add_argument("--yolo-iou", type=float, default=0.45,
                        help="YOLO NMS IoU 阈值（默认 0.45）")
    parser.add_argument("--nir-band", type=int, default=None,
                        help="NIR 波段索引（0-based），默认自动检测 4 波段 GeoTIFF")
    parser.add_argument("--no-watershed", action="store_true", help="禁用分水岭精修（YOLO 推理时忽略）")
    parser.add_argument("--no-texture-filter", action="store_true", help="禁用纹理过滤（YOLO 推理时忽略）")
    args = parser.parse_args(argv)

    if args.serve or not args.image:
        run_server(args.host, args.port)
        return 0

    model_path = args.model
    if model_path and not Path(model_path).exists():
        print(f"ERROR: model file not found: {model_path}")
        return 1

    if model_path:
        print(f"Using YOLO model: {Path(model_path).name}")

    options = SegmentOptions(
        origin_lat=args.origin_lat,
        origin_lng=args.origin_lng,
        pixel_size_m=args.pixel_size_m,
        min_area_m2=args.min_area_m2,
        max_size_px=args.max_size_px,
        max_parcels=args.max_parcels,
        layer_name=args.layer_name,
        model_name="yolov11-seg" if model_path else "baseline-exg-otsu",
        model_path=model_path,
        nir_band=args.nir_band,
        enable_watershed=not args.no_watershed,
        enable_texture_filter=not args.no_texture_filter,
        yolo_conf=args.yolo_conf,
        yolo_iou=args.yolo_iou,
    )
    result = segment_image_file(args.image, options)
    output = Path(args.output) if args.output else Path(args.image).with_suffix(".farmland.geojson")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {output}")
    summary = result.get("summary", {})
    print(f"Parcels: {summary.get('parcelCount', 0)}")
    print(f"Total area: {summary.get('totalAreaMu', 'N/A')} 亩")
    model_info = result.get("model", {})
    print(f"Model: {model_info.get('name', 'N/A')}")
    print(f"Trained: {model_info.get('trained', False)}")
    if result.get("warnings"):
        for w in result["warnings"]:
            print(f"[WARN] {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
