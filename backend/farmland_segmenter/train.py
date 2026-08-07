#!/usr/bin/env python3
"""Fine-tune YOLOv11-seg on farmland labels exported from the WebGIS tool.

Also importable: train_from_directory() for use by the HTTP server.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from PIL import Image
import threading

# Training progress callback set by server.py
_train_progress_callback = None
_callback_lock = threading.Lock()

def set_train_progress_callback(cb):
    global _train_progress_callback
    with _callback_lock:
        _train_progress_callback = cb

def _update_dataset_progress(epoch_val: int, metrics: dict[str, float] | None = None):
    global _train_progress_callback
    with _callback_lock:
        cb = _train_progress_callback
    if cb:
        try:
            cb({"epoch": epoch_val, "metrics": metrics or {}})
        except Exception:
            pass


def _read_latest_results(results_csv: Path) -> tuple[int, dict[str, float]] | None:
    if not results_csv.exists():
        return None
    try:
        with results_csv.open("r", encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
    except Exception:
        return None
    if not rows:
        return None
    row = rows[-1]
    raw_epoch = row.get("epoch") or row.get("                  epoch") or next(iter(row.values()), None)
    try:
        epoch_val = int(float(str(raw_epoch).strip()))
    except (TypeError, ValueError):
        epoch_val = 0
    metrics: dict[str, float] = {}
    for key, value in row.items():
        clean_key = key.strip()
        if not clean_key or clean_key == "epoch":
            continue
        try:
            metrics[clean_key] = round(float(str(value).strip()), 6)
        except (TypeError, ValueError):
            continue
    return epoch_val, metrics


def _watch_training_results(results_dir: Path, stop_event: threading.Event) -> None:
    last_epoch = -1
    results_csv = results_dir / "results.csv"
    while not stop_event.is_set():
        latest = _read_latest_results(results_csv)
        if latest is not None:
            epoch_val, metrics = latest
            if epoch_val != last_epoch:
                _update_dataset_progress(epoch_val, metrics)
                last_epoch = epoch_val
        stop_event.wait(1.0)


def _default_models_dir() -> Path:
    this_dir = Path(__file__).resolve().parent.parent
    return this_dir / "models"


def _safe_model_stem(value: str | None) -> str:
    text = (value or "farmland_seg").strip()
    text = re.sub(r"[^0-9A-Za-z_.\-\u4e00-\u9fff]+", "_", text)
    text = text.strip("._-")
    return text or "farmland_seg"


def _unique_model_path(models_dir: Path, model_stem: str) -> Path:
    import datetime

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base = f"{_safe_model_stem(model_stem)}_{timestamp}"
    candidate = models_dir / f"{base}.pt"
    index = 2
    while candidate.exists():
        candidate = models_dir / f"{base}_{index}.pt"
        index += 1
    return candidate


def _prepare_ultralytics_config_dir() -> None:
    config_dir = _default_models_dir() / ".ultralytics"
    config_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(config_dir))


def _check_training_dependencies() -> None:
    missing = [
        package
        for package in ("ultralytics", "torch")
        if importlib.util.find_spec(package) is None
    ]
    if missing:
        missing_text = "、".join(missing)
        raise RuntimeError(
            "本地 YOLO 训练环境缺少依赖："
            f"{missing_text}。请在项目 backend 目录运行 "
            "`python -m pip install -r requirements.txt`，或单独运行 "
            "`python -m pip install ultralytics torch` 后重试。"
        )


def _resolve_train_device(device: str) -> str | int:
    requested = (device or "auto").strip().lower()
    if requested != "auto":
        return device

    import torch

    return 0 if torch.cuda.is_available() else "cpu"


def _resolve_dataset(path: str) -> Path:
    p = Path(path)
    if p.is_dir():
        return p
    if p.suffix.lower() == ".zip":
        extract_dir = Path(tempfile.mkdtemp(prefix="farmland_train_"))
        with zipfile.ZipFile(p, "r") as zf:
            zf.extractall(extract_dir)
        return extract_dir
    raise FileNotFoundError(f"Dataset path not found: {p}")


def _validate_dataset(dataset_dir: Path) -> None:
    yaml_path = dataset_dir / "data.yaml"
    if not yaml_path.exists():
        raise ValueError(f"data.yaml not found in {dataset_dir}")

    labels_dir = dataset_dir / "labels" / "train"
    if not labels_dir.exists() or not labels_dir.is_dir():
        raise ValueError(f"labels/train/ not found in {dataset_dir}")

    labels = sorted(labels_dir.glob("*.txt"))
    if len(labels) == 0:
        raise ValueError("No label files found in labels/train/.")

    images_dir = dataset_dir / "images" / "train"
    if not images_dir.exists() or not images_dir.is_dir():
        raise ValueError(
            "images/train/ not found. YOLO 训练必须包含与标签对应的真实影像，"
            "不能只上传 labels/train。"
        )

    images = sorted(
        list(images_dir.glob("*.jpg")) +
        list(images_dir.glob("*.jpeg")) +
        list(images_dir.glob("*.png"))
    )
    if len(images) == 0:
        raise ValueError("images/train/ exists but contains no JPG/PNG images.")

    image_stems = {image.stem for image in images}
    labels_without_images = [label.name for label in labels if label.stem not in image_stems]
    if labels_without_images:
        preview = ", ".join(labels_without_images[:5])
        more = "..." if len(labels_without_images) > 5 else ""
        raise ValueError(
            "YOLO label files have no matching images in images/train/: "
            f"{preview}{more}"
        )


def _patch_yaml_paths(dataset_dir: Path) -> None:
    yaml_path = dataset_dir / "data.yaml"
    content = yaml_path.read_text(encoding="utf-8")
    if re.search(r"(?m)^path\s*:", content):
        content = re.sub(r"(?m)^path\s*:.*$", "path: " + dataset_dir.as_posix(), content)
    else:
        content = "path: " + dataset_dir.as_posix() + "\n" + content
    content = re.sub(r"(?m)^train\s*:.*$", "train: images/train", content)
    if re.search(r"(?m)^val\s*:", content):
        content = re.sub(r"(?m)^val\s*:.*$", "val: images/val", content)
    else:
        content += "\nval: images/val\n"
    yaml_path.write_text(content, encoding="utf-8")


def _image_files(directory: Path) -> list[Path]:
    return sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


def _clip_polygon_to_rect(
    points: list[tuple[float, float]],
    rect: tuple[float, float, float, float],
) -> list[tuple[float, float]]:
    left, top, right, bottom = rect

    def clip(
        source: list[tuple[float, float]],
        inside,
        intersect,
    ) -> list[tuple[float, float]]:
        if not source:
            return []
        output: list[tuple[float, float]] = []
        previous = source[-1]
        previous_inside = inside(previous)
        for current in source:
            current_inside = inside(current)
            if current_inside != previous_inside:
                output.append(intersect(previous, current))
            if current_inside:
                output.append(current)
            previous, previous_inside = current, current_inside
        return output

    def vertical(a, b, x):
        ratio = 0.0 if b[0] == a[0] else (x - a[0]) / (b[0] - a[0])
        return x, a[1] + ratio * (b[1] - a[1])

    def horizontal(a, b, y):
        ratio = 0.0 if b[1] == a[1] else (y - a[1]) / (b[1] - a[1])
        return a[0] + ratio * (b[0] - a[0]), y

    result = clip(points, lambda p: p[0] >= left, lambda a, b: vertical(a, b, left))
    result = clip(result, lambda p: p[0] <= right, lambda a, b: vertical(a, b, right))
    result = clip(result, lambda p: p[1] >= top, lambda a, b: horizontal(a, b, top))
    return clip(result, lambda p: p[1] <= bottom, lambda a, b: horizontal(a, b, bottom))


def _crop_yolo_labels(text: str, rect: tuple[float, float, float, float]) -> str:
    left, top, right, bottom = rect
    width, height = right - left, bottom - top
    lines: list[str] = []
    for raw_line in text.splitlines():
        parts = raw_line.split()
        if len(parts) < 7 or len(parts) % 2 == 0:
            continue
        try:
            values = [float(value) for value in parts[1:]]
        except ValueError:
            continue
        points = list(zip(values[0::2], values[1::2]))
        clipped = _clip_polygon_to_rect(points, rect)
        if len(clipped) < 3:
            continue
        normalized = [((x - left) / width, (y - top) / height) for x, y in clipped]
        coords = " ".join(f"{value:.6f}" for point in normalized for value in point)
        lines.append(f"{parts[0]} {coords}")
    return "\n".join(lines)


def _ensure_validation_split(dataset_dir: Path) -> None:
    """Create an image-disjoint validation set; spatially split a single source image."""
    train_images = dataset_dir / "images" / "train"
    train_labels = dataset_dir / "labels" / "train"
    val_images = dataset_dir / "images" / "val"
    val_labels = dataset_dir / "labels" / "val"
    val_images.mkdir(parents=True, exist_ok=True)
    val_labels.mkdir(parents=True, exist_ok=True)

    if any((val_labels / f"{image.stem}.txt").exists() for image in _image_files(val_images)):
        return

    images = _image_files(train_images)
    paired_images = [image for image in images if (train_labels / f"{image.stem}.txt").exists()]
    if len(paired_images) >= 2:
        val_count = max(1, round(len(paired_images) * 0.2))
        for image in paired_images[-val_count:]:
            label = train_labels / f"{image.stem}.txt"
            shutil.move(str(image), val_images / image.name)
            if label.exists():
                shutil.move(str(label), val_labels / label.name)
        return

    image = paired_images[0]
    label = train_labels / f"{image.stem}.txt"
    label_text = label.read_text(encoding="utf-8")
    candidates = [
        ((0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 1.0, 1.0)),
        ((0.0, 0.0, 1.0, 0.5), (0.0, 0.5, 1.0, 1.0)),
    ]
    split = None
    split_score = (-1, -1)
    for first, second in candidates:
        first_labels = _crop_yolo_labels(label_text, first)
        second_labels = _crop_yolo_labels(label_text, second)
        if first_labels and second_labels:
            counts = (len(first_labels.splitlines()), len(second_labels.splitlines()))
            score = (min(counts), sum(counts))
            if score > split_score:
                split = (first, first_labels, second, second_labels)
                split_score = score
    if split is None:
        raise ValueError(
            "单张训练影像无法拆出独立验证区域；请在影像两侧标注地块，"
            "或上传至少两张带同名标签的训练影像。"
        )

    first_rect, first_labels, second_rect, second_labels = split
    if len(second_labels.splitlines()) > len(first_labels.splitlines()):
        first_rect, first_labels, second_rect, second_labels = second_rect, second_labels, first_rect, first_labels
    with Image.open(image) as source:
        width, height = source.size
        for suffix, rect, labels, image_dir, label_dir in (
            ("train", first_rect, first_labels, train_images, train_labels),
            ("val", second_rect, second_labels, val_images, val_labels),
        ):
            left, top, right, bottom = rect
            cropped = source.crop((round(left * width), round(top * height), round(right * width), round(bottom * height)))
            name = f"{image.stem}_{suffix}"
            cropped.save(image_dir / f"{name}.jpg", quality=92)
            (label_dir / f"{name}.txt").write_text(labels + "\n", encoding="utf-8")
    image.unlink()
    label.unlink()


def _maybe_augment(dataset_dir: Path) -> int:
    images_dir = dataset_dir / "images" / "train"
    labels_dir = dataset_dir / "labels" / "train"
    images = sorted(list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")))
    if len(images) >= 20:
        return 0

    new_count = 0
    for img_path in images:
        label_path = labels_dir / (img_path.stem + ".txt")
        if not label_path.exists():
            continue

        img = Image.open(img_path).convert("RGB")
        label_text = label_path.read_text(encoding="utf-8")

        hf_img = img.transpose(Image.FLIP_LEFT_RIGHT)
        hf_label = _flip_label_horizontal(label_text)
        hf_name = img_path.stem + "_hflip"
        hf_img.save(images_dir / (hf_name + ".jpg"), quality=92)
        (labels_dir / (hf_name + ".txt")).write_text(hf_label, encoding="utf-8")
        new_count += 1

        rot_img = img.transpose(Image.ROTATE_90)
        rot_label = _rotate_label_90(label_text)
        rot_name = img_path.stem + "_rot90"
        rot_img.save(images_dir / (rot_name + ".jpg"), quality=92)
        (labels_dir / (rot_name + ".txt")).write_text(rot_label, encoding="utf-8")
        new_count += 1

    return new_count


def _flip_label_horizontal(text: str) -> str:
    lines = []
    for line in text.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.strip().split()
        class_id = parts[0]
        coords = [float(p) for p in parts[1:]]
        flipped = []
        for i in range(0, len(coords), 2):
            flipped.extend([round(1.0 - coords[i], 6), round(coords[i + 1], 6)])
        lines.append(class_id + " " + " ".join(f"{v:.6f}" for v in flipped))
    return "\n".join(lines)


def _rotate_label_90(text: str) -> str:
    lines = []
    for line in text.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.strip().split()
        class_id = parts[0]
        coords = [float(p) for p in parts[1:]]
        rotated = []
        for i in range(0, len(coords), 2):
            x, y = coords[i], coords[i + 1]
            rotated.extend([round(y, 6), round(1.0 - x, 6)])
        lines.append(class_id + " " + " ".join(f"{v:.6f}" for v in rotated))
    return "\n".join(lines)


def train_from_directory(
    dataset_dir: str | Path,
    model_name: str = "yolo11n-seg.pt",
    output_name: str | None = None,
    epochs: int = 100,
    batch: int = 8,
    imgsz: int = 640,
    lr: float = 0.001,
    device: str = "auto",
    output_dir: str | None = None,
) -> dict[str, Any]:
    dataset_dir = Path(dataset_dir)
    _validate_dataset(dataset_dir)
    _ensure_validation_split(dataset_dir)
    _maybe_augment(dataset_dir)
    _patch_yaml_paths(dataset_dir)

    _prepare_ultralytics_config_dir()
    _check_training_dependencies()
    try:
        from ultralytics import YOLO
    except ImportError:
        raise RuntimeError(
            "本地 YOLO 训练环境加载失败。请确认已安装 ultralytics 和 torch："
            "`python -m pip install ultralytics torch`。"
        )

    # Try loading model; if not found, download with increased timeout and retries
    model = None
    try:
        model = YOLO(model_name)
    except Exception:
        print(f"[train] Downloading {model_name} from Ultralytics...")
        try:
            model = YOLO(model_name + ".yaml")  # This will download the pretrained weights
        except Exception as e:
            raise RuntimeError(
                f"Failed to load or download model {model_name}. "
                f"Please ensure you have internet access. Error: {e}"
            )

    train_device = _resolve_train_device(device)
    expected_results_dir = dataset_dir / "train"
    stop_watch = threading.Event()
    watcher = threading.Thread(
        target=_watch_training_results,
        args=(expected_results_dir, stop_watch),
        daemon=True,
    )
    watcher.start()
    try:
        results = model.train(
            data=str(dataset_dir / "data.yaml"),
            epochs=epochs,
            batch=batch,
            imgsz=imgsz,
            lr0=lr,
            device=train_device,
            project=str(dataset_dir),
            name="train",
            exist_ok=True,
            verbose=True,
            cos_lr=True,
            warmup_epochs=3,
            weight_decay=0.0005,
            augment=True,
            mixup=0.15,
            copy_paste=0.15,
            task="segment",
            save=True,
            save_period=-1,
        )
    finally:
        stop_watch.set()
        watcher.join(timeout=2.0)

    results_dir = Path(results.save_dir)
    if not results_dir.exists():
        results_dir = expected_results_dir
    latest = _read_latest_results(results_dir / "results.csv")
    if latest is not None:
        epoch_val, metrics = latest
        _update_dataset_progress(epoch_val, metrics)

    save_dir = Path(results.save_dir)
    src = save_dir / "weights" / "best.pt"
    if not src.exists():
        src = save_dir / "weights" / "last.pt"

    if not src.exists():
        raise RuntimeError("Training produced no checkpoint")

    out = Path(output_dir) if output_dir else _default_models_dir()
    out.mkdir(parents=True, exist_ok=True)
    dst = _unique_model_path(out, output_name or "farmland_seg")
    shutil.copy2(src, dst)

    return {
        "status": "done",
        "model_path": str(dst),
        "model_name": dst.name,
        "epochs_done": epochs,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train YOLOv11-seg on a farmland dataset")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--zip", help="YOLO dataset ZIP path")
    source.add_argument("--dataset", help="YOLO dataset directory path")
    parser.add_argument("--model", default="yolo11n-seg.pt", help="base model name or path")
    parser.add_argument("--output-name", default=None, help="output model stem")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--lr", type=float, default=0.001)
    parser.add_argument("--device", default="auto", help="auto, cpu, or cuda device index")
    parser.add_argument("--output-dir", default=None, help="model output directory")
    args = parser.parse_args(argv)

    result = train_from_directory(
        dataset_dir=args.zip or args.dataset,
        model_name=args.model,
        output_name=args.output_name,
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        lr=args.lr,
        device=args.device,
        output_dir=args.output_dir,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0
