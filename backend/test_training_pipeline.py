import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from backend.farmland_segmenter import server
from backend.farmland_segmenter.train import _crop_yolo_labels, _ensure_validation_split, _read_latest_results


class TrainingPipelineTest(unittest.TestCase):
    def test_single_image_is_spatially_split_into_train_and_val(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images = root / "images" / "train"
            labels = root / "labels" / "train"
            images.mkdir(parents=True)
            labels.mkdir(parents=True)
            Image.new("RGB", (100, 60), "green").save(images / "map.jpg")
            labels.joinpath("map.txt").write_text(
                "0 0.10 0.20 0.40 0.20 0.40 0.80 0.10 0.80\n"
                "0 0.60 0.20 0.90 0.20 0.90 0.80 0.60 0.80\n",
                encoding="utf-8",
            )

            _ensure_validation_split(root)

            self.assertEqual(len(list((root / "images" / "train").glob("*.jpg"))), 1)
            self.assertEqual(len(list((root / "images" / "val").glob("*.jpg"))), 1)
            self.assertTrue(next((root / "labels" / "train").glob("*.txt")).read_text().strip())
            self.assertTrue(next((root / "labels" / "val").glob("*.txt")).read_text().strip())

    def test_polygon_crop_normalizes_coordinates(self):
        cropped = _crop_yolo_labels(
            "0 0.25 0.25 0.75 0.25 0.75 0.75 0.25 0.75",
            (0.0, 0.0, 0.5, 1.0),
        )
        values = [float(value) for value in cropped.split()[1:]]
        self.assertGreaterEqual(len(values), 6)
        self.assertTrue(all(0 <= value <= 1 for value in values))

    def test_training_history_replaces_duplicate_epoch(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_dir = server.DATASETS_DIR
            server.DATASETS_DIR = Path(tmp)
            try:
                server._train_state.clear()
                server._record_train_progress(1, {"train/seg_loss": 0.8})
                server._record_train_progress(1, {"train/seg_loss": 0.7})
                server._record_train_progress(2, {"train/seg_loss": 0.6})

                payload = server._train_payload(server._ensure_train_state())
                self.assertEqual([point["epoch"] for point in payload["history"]], [1, 2])
                self.assertEqual(payload["history"][0]["metrics"]["train/seg_loss"], 0.7)
            finally:
                server._train_state.clear()
                server.DATASETS_DIR = original_dir

    def test_results_csv_epoch_is_not_incremented(self):
        with tempfile.TemporaryDirectory() as tmp:
            results = Path(tmp) / "results.csv"
            results.write_text("epoch,train/seg_loss\n100,1.25\n", encoding="utf-8")

            latest = _read_latest_results(results)

            self.assertIsNotNone(latest)
            self.assertEqual(latest[0], 100)

    def test_zip_extraction_rejects_parent_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                archive.writestr("../outside.txt", "unsafe")
            with zipfile.ZipFile(io.BytesIO(buffer.getvalue()), "r") as archive:
                with self.assertRaises(ValueError):
                    server._safe_extract_zip(archive, Path(tmp))

    def test_dataset_archive_is_persisted_with_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_dir = server.DATASETS_DIR
            server.DATASETS_DIR = Path(tmp)
            try:
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w") as archive:
                    archive.writestr("data.yaml", "path: .\ntrain: images/train\nval: images/train\n")
                    archive.writestr("images/train/sample.jpg", b"image")
                    archive.writestr("labels/train/sample.txt", "0 0 0 1 0 1 1\n")
                    archive.writestr("annotations.geojson", '{"type":"FeatureCollection","features":[]}')
                dataset_id, dataset_dir, manifest = server._store_dataset_archive(
                    buffer.getvalue(), "sample.zip", "ready",
                )
                self.assertEqual(dataset_dir.name, dataset_id)
                self.assertTrue((dataset_dir / "source.zip").is_file())
                self.assertTrue((dataset_dir / "annotations.geojson").is_file())
                self.assertEqual(manifest["status"], "ready")
            finally:
                server.DATASETS_DIR = original_dir

    def test_latest_completed_training_is_restored(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_dir = server.DATASETS_DIR
            server.DATASETS_DIR = Path(tmp)
            dataset = server.DATASETS_DIR / "dataset-one"
            dataset.mkdir()
            dataset.joinpath("manifest.json").write_text(
                '{"id":"dataset-one","status":"done","updatedAt":"2026-07-11T10:00:00Z",'
                '"epochsDone":100,"modelPath":"model.pt","modelName":"model.pt",'
                '"params":{"epochs":100,"outputName":"farmland"}}',
                encoding="utf-8",
            )
            dataset.joinpath("history.json").write_text(
                '[{"epoch":101,"metrics":{"metrics/mAP50(M)":0.25}}]',
                encoding="utf-8",
            )
            try:
                server._train_state.clear()
                state = server._ensure_train_state()
                self.assertEqual(state["status"], "done")
                self.assertEqual(state["current_epoch"], 100)
                self.assertEqual(state["history"][0]["epoch"], 100)
                self.assertEqual(state["metrics"]["metrics/mAP50(M)"], 0.25)
            finally:
                server._train_state.clear()
                server.DATASETS_DIR = original_dir


if __name__ == "__main__":
    unittest.main()
