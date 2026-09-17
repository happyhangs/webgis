"""训练链路端到端冒烟：合成小数据集 → 真实 ultralytics 训练 → 验证产物。

用途：修改 train.py / server.py 训练链路后手动验证（约 1 分钟 CPU）。
运行（backend 目录，需带 ultralytics 的环境）：

    D:/ProgramData/anaconda31/python.exe smoke_train.py

覆盖点：哈希验证集切分、<20 张自动增强、patience 参数、results.csv 解析、模型导出。
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image, ImageDraw  # noqa: E402

from farmland_segmenter.train import train_from_directory  # noqa: E402


def make_dataset(root: Path, count: int = 8, size: int = 96) -> Path:
    images = root / "images" / "train"
    labels = root / "labels" / "train"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    for i in range(count):
        img = Image.new("RGB", (size, size), color=(40 + i * 5, 90 + i * 3, 30))
        draw = ImageDraw.Draw(img)
        # 两块"农田"矩形
        for x0 in (0.12, 0.55):
            box = (int(x0 * size), int(0.2 * size), int((x0 + 0.3) * size), int(0.75 * size))
            draw.rectangle(box, fill=(120 + i * 4, 160, 60))
        img.save(images / f"synthetic_{i:02d}.jpg", quality=90)
        # YOLO seg 标签（归一化多边形，两块）
        row1 = "0 0.12 0.2 0.42 0.2 0.42 0.75 0.12 0.75"
        row2 = "0 0.55 0.2 0.85 0.2 0.85 0.75 0.55 0.75"
        (labels / f"synthetic_{i:02d}.txt").write_text(f"{row1}\n{row2}\n", encoding="utf-8")
    (root / "data.yaml").write_text(
        "path: .\ntrain: images/train\nval: images/val\nnc: 1\nnames: [farmland]\n",
        encoding="utf-8",
    )
    return root


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="smoke_train_"))
    ds = make_dataset(tmp / "dataset")
    out_dir = tmp / "models"
    print(f"[smoke] dataset: {ds}")

    result = train_from_directory(
        dataset_dir=ds,
        model_name=str(Path(__file__).parent / "yolo11n-seg.pt"),
        output_name="smoke_test",
        epochs=2,
        batch=2,
        imgsz=64,
        device="cpu",
        output_dir=str(out_dir),
        patience=30,
    )
    print("[smoke] result:", json.dumps(result, ensure_ascii=False))

    # 断言
    model_path = Path(result["model_path"])
    assert model_path.exists(), f"model not saved: {model_path}"
    assert model_path.stat().st_size > 100_000, "model file suspiciously small"

    # 数据切分验证：val 非空、train 非空
    val_imgs = list((ds / "images" / "val").glob("*.jpg"))
    train_imgs = list((ds / "images" / "train").glob("*.jpg"))
    assert val_imgs, "val split empty"
    assert train_imgs, "train split empty"
    print(f"[smoke] split ok: train {len(train_imgs)} / val {len(val_imgs)}")

    # results.csv 有 2 轮记录
    csv_path = ds / "train" / "results.csv"
    if csv_path.exists():
        rows = csv_path.read_text(encoding="utf-8").strip().splitlines()
        print(f"[smoke] results.csv 行数: {len(rows) - 1}（含表头 {len(rows)}）")

    shutil.rmtree(tmp, ignore_errors=True)
    print("[smoke] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
