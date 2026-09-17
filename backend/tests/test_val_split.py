"""_ensure_validation_split 的稳定切分测试。

运行：cd backend && python -m pytest tests/test_val_split.py -v
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from PIL import Image

from farmland_segmenter.train import _ensure_validation_split, _file_sha1


def _make_dataset(root: Path, names: list[str]) -> Path:
    """构建最小可切分数据集：N 张影像（内容各异）+ 同名标签。"""
    images = root / "images" / "train"
    labels = root / "labels" / "train"
    images.mkdir(parents=True)
    labels.mkdir(parents=True)
    for i, name in enumerate(names):
        # 每张影像像素不同 → 内容哈希不同
        Image.new("RGB", (8, 8), color=(i * 17 % 255, i * 43 % 255, i * 91 % 255)).save(images / f"{name}.jpg")
        (labels / f"{name}.txt").write_text("0 0.5 0.5 0.6 0.5 0.6 0.6 0.5 0.6\n", encoding="utf-8")
    (root / "data.yaml").write_text("path: .\ntrain: images/train\nval: images/val\nnames: {0: farmland}\n", encoding="utf-8")
    return root


class TestStableValidationSplit:
    def test_deterministic_and_image_disjoint(self, tmp_path):
        names = [f"tile_{i:02d}" for i in range(20)]
        ds = _make_dataset(tmp_path / "ds", names)
        _ensure_validation_split(ds)

        val_images = {p.stem for p in (ds / "images" / "val").iterdir()}
        train_images = {p.stem for p in (ds / "images" / "train").iterdir()}
        # 影像级互斥
        assert not (val_images & train_images)
        # 比例合理：20 张 → 2~8 张 val（哈希 1/5 目标 + 保底修正）
        assert 1 <= len(val_images) <= 8
        # 标签同步搬移
        val_labels = {p.stem for p in (ds / "labels" / "val").iterdir()}
        assert val_labels == val_images

    def test_same_content_same_assignment_across_datasets(self, tmp_path):
        names = [f"parcel_{i}" for i in range(12)]
        ds1 = _make_dataset(tmp_path / "ds1", names)
        ds2 = _make_dataset(tmp_path / "ds2", names)  # 同名同内容（像素一致）
        _ensure_validation_split(ds1)
        _ensure_validation_split(ds2)

        val1 = {p.stem for p in (ds1 / "images" / "val").iterdir()}
        val2 = {p.stem for p in (ds2 / "images" / "val").iterdir()}
        # 关键性质：同一张影像跨数据集切分结果一致 → 验证集固定、mAP 可比
        assert val1 == val2
        assert len(val1) > 0

    def test_registry_persists_and_reapply_noop(self, tmp_path):
        names = [f"field_{i}" for i in range(10)]
        ds = _make_dataset(tmp_path / "ds", names)
        _ensure_validation_split(ds)
        registry = json.loads((ds / ".val_split_registry.json").read_text(encoding="utf-8"))
        assert isinstance(registry, dict) and registry

        # 再次执行（val 已有内容）应直接返回，不改变现状
        val_before = {p.stem for p in (ds / "images" / "val").iterdir()}
        _ensure_validation_split(ds)
        val_after = {p.stem for p in (ds / "images" / "val").iterdir()}
        assert val_before == val_after

    def test_degraded_registry_falls_back_to_hash_seed(self, tmp_path):
        names = [f"plot_{i}" for i in range(10)]
        ds = _make_dataset(tmp_path / "ds", names)
        # 预写损坏的注册表 → 应忽略并按哈希重切，不崩溃
        (ds / ".val_split_registry.json").write_text("{not json", encoding="utf-8")
        _ensure_validation_split(ds)
        val = {p.stem for p in (ds / "images" / "val").iterdir()}
        train = {p.stem for p in (ds / "images" / "train").iterdir()}
        # 真正的不变量：val 非空、train 非空、两侧互斥
        assert len(val) >= 1 and len(train) >= 1
        assert not (val & train)

    def test_single_image_spatial_split_still_works(self, tmp_path):
        # 单张影像走空间切分（原有逻辑）：左右各一个多边形 → 应成功拆出 train/val
        ds = tmp_path / "ds"
        images = ds / "images" / "train"
        labels = ds / "labels" / "train"
        images.mkdir(parents=True)
        labels.mkdir(parents=True)
        Image.new("RGB", (8, 8), color=(100, 150, 200)).save(images / "solo.jpg")
        # 左侧 (0.1-0.3) 和右侧 (0.7-0.9) 各一个多边形
        (labels / "solo.txt").write_text(
            "0 0.1 0.5 0.3 0.5 0.3 0.7 0.1 0.7\n"
            "0 0.7 0.3 0.9 0.3 0.9 0.5 0.7 0.5\n",
            encoding="utf-8",
        )
        (ds / "data.yaml").write_text("path: .\ntrain: images/train\nval: images/val\n", encoding="utf-8")
        _ensure_validation_split(ds)
        val_images = [p.stem for p in (ds / "images" / "val").iterdir()]
        train_images = [p.stem for p in (ds / "images" / "train").iterdir()]
        assert any(name.endswith("_val") for name in val_images)
        assert any(name.endswith("_train") for name in train_images)

    def test_file_sha1_stable(self, tmp_path):
        p = tmp_path / "a.bin"
        p.write_bytes(b"hello world")
        first = _file_sha1(p)
        assert first == _file_sha1(p)
        p.write_bytes(b"hello world!")
        assert _file_sha1(p) != first
