from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zipfile
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import ProxyHandler, Request, build_opener, urlopen

from .segmenter import SegmentOptions, segment_image_bytes


def _ensure_utf8_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # pragma: no cover


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
AMAP_KEY = os.environ.get("AMAP_KEY", "")
STATE_FILE = Path(__file__).resolve().parents[1] / "data" / "webgis_state.json"
DATASETS_DIR = Path(__file__).resolve().parents[1] / "datasets"
MAX_STATE_BYTES = 15 * 1024 * 1024
_DIRECT_URL_OPENER = build_opener(ProxyHandler({}))


def _open_remote(request: Request, timeout: float):
    direct_request = Request(
        request.full_url,
        data=request.data,
        headers=dict(request.header_items()),
        origin_req_host=request.origin_req_host,
        unverifiable=request.unverifiable,
        method=request.get_method(),
    )
    try:
        return urlopen(request, timeout=timeout)
    except URLError as exc:
        reason = exc.reason
        if not isinstance(reason, ConnectionRefusedError) and getattr(reason, "winerror", None) != 10061:
            raise
        # ponytail: preserve working system proxies; only bypass a refused local proxy.
        return _DIRECT_URL_OPENER.open(direct_request, timeout=timeout)


class FarmlandSegmentHandler(BaseHTTPRequestHandler):
    server_version = "FarmlandSegmenter/0.2"

    # ── Routing ──

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_empty(204)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/health":
            self._send_json({"ok": True, "service": "farmland-segmenter", "version": "0.2"})
            return
        if path == "/amap-static":
            self._handle_amap_static(parse_qs(parsed.query))
            return
        if path == "/state":
            self._handle_state_get()
            return
        if path == "/datasets":
            self._handle_datasets_list()
            return
        if path == "/train/status":
            self._handle_train_status()
            return
        if path == "/open-backend":
            self._send_html("<html><body><h1>Farmland Segmenter</h1><p>Backend is running.</p></body></html>")
            return
        if path in ("/", "/index.html"):
            self._send_html(VISUALIZER_HTML)
            return
        self._send_json({"error": "not found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/segment":
            self._handle_segment()
        elif path == "/train":
            self._handle_train()
        elif path == "/state":
            self._handle_state_post()
        elif path == "/datasets":
            self._handle_dataset_store()
        else:
            self._send_json({"error": "not found"}, status=404)

    def _handle_state_get(self) -> None:
        try:
            if not STATE_FILE.exists():
                self._send_json({"state": None})
                return
            self._send_json({"state": json.loads(STATE_FILE.read_text(encoding="utf-8"))})
        except Exception as exc:
            self._send_json({"error": f"state load failed: {exc}"}, status=500)

    def _handle_state_post(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length > MAX_STATE_BYTES:
                self._send_json({"error": "state payload too large"}, status=413)
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                self._send_json({"error": "state must be a JSON object"}, status=400)
                return
            if not isinstance(payload.get("layers", []), list) or not isinstance(payload.get("features", []), list):
                self._send_json({"error": "invalid state shape"}, status=400)
                return
            STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(STATE_FILE)
            self._send_json({"ok": True})
        except Exception as exc:
            self._send_json({"error": f"state save failed: {exc}"}, status=500)

    def _handle_segment(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            form = _parse_multipart(self, raw_body)
            if "image" not in form:
                self._send_json({"error": "missing image file field"}, status=400)
                return

            file_item = form["image"]
            image_bytes = file_item.get("data", b"")
            filename = file_item.get("filename", "image")
            model_path = _form_text(form, "model_path")
            if "model" in form:
                try:
                    model_path = _store_uploaded_model(form["model"])
                except ValueError as exc:
                    self._send_json({"error": str(exc)}, status=400)
                    return

            options = SegmentOptions(
                origin_lat=_form_float(form, "origin_lat"),
                origin_lng=_form_float(form, "origin_lng"),
                west=_form_float(form, "west"),
                south=_form_float(form, "south"),
                east=_form_float(form, "east"),
                north=_form_float(form, "north"),
                pixel_size_m=_form_float(form, "pixel_size_m", default=1.0),
                min_area_m2=_form_float(form, "min_area_m2", default=200.0) or 200.0,
                max_size_px=int(_form_float(form, "max_size_px", default=1600) or 1600),
                max_parcels=int(_form_float(form, "max_parcels", default=800) or 800),
                layer_name=_form_text(form, "layer_name") or "农田模型识别",
                model_name="yolov11-seg",
                model_path=model_path,
                nir_band=_form_int(form, "nir_band"),
                enable_watershed=_form_bool(form, "enable_watershed", default=True),
                enable_texture_filter=_form_bool(form, "enable_texture_filter", default=True),
                yolo_conf=_form_float(form, "yolo_conf", default=0.25) or 0.25,
                yolo_iou=_form_float(form, "yolo_iou", default=0.45) or 0.45,
            )
            result = segment_image_bytes(image_bytes, filename=filename, options=options)
            self._send_json(result)
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            self._send_json({"error": str(exc)}, status=500)

    def _handle_train(self) -> None:
        """POST /train — upload a YOLO dataset ZIP, start training, return SSE stream."""
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            form = _parse_multipart(self, raw_body)
            if "dataset" not in form:
                self._send_json({"error": "missing dataset field (YOLO ZIP file)"}, status=400)
                return

            zip_data = form["dataset"].get("data", b"")
            if not zip_data:
                self._send_json({"error": "empty dataset"}, status=400)
                return

            epochs = _form_int(form, "epochs", default=100) or 100
            patience = _form_int(form, "patience", default=30)
            if patience is None or patience < 0:
                patience = 30
            batch = _form_int(form, "batch", default=8) or 8
            model_name = _form_text(form, "model") or "yolo11n-seg.pt"
            output_name = _form_text(form, "output_name") or _form_text(form, "outputName") or "farmland_seg"
            try:
                dataset_id, persistent_dataset_dir, manifest = _store_dataset_archive(
                    zip_data,
                    form["dataset"].get("filename") or "dataset.zip",
                    "starting",
                    {"epochs": epochs, "batch": batch, "model": model_name, "outputName": output_name},
                )
            except (ValueError, zipfile.BadZipFile) as exc:
                self._send_json({"error": str(exc)}, status=400)
                return

            if not _acquire_train_slot():
                self._send_json({"error": "A training job is already running. Wait for it to finish."}, status=409)
                return

            # Send SSE headers FIRST, then do extraction/validation in background
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            def _send_sse(payload: dict) -> None:
                try:
                    line = "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                    self.wfile.write(line.encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    pass

            state = _ensure_train_state()
            state["epochs"] = epochs
            state["output_name"] = output_name
            state["dataset_id"] = dataset_id
            state["dataset_path"] = str(persistent_dataset_dir)

            # Extract and validate in the handler thread (SSE headers already sent)
            tmpdir: Path | None = None
            try:
                tmpdir = Path(tempfile.mkdtemp(prefix="farmland_train_api_"))
                zip_path = tmpdir / "dataset.zip"
                zip_path.write_bytes(zip_data)
                extract_dir = tmpdir / "dataset"
                extract_dir.mkdir()
                with zipfile.ZipFile(zip_path, "r") as zf:
                    _safe_extract_zip(zf, extract_dir)

                yaml_path = extract_dir / "data.yaml"
                if not yaml_path.exists():
                    _send_sse({"status": "failed", "error": "data.yaml not found in uploaded ZIP"})
                    _release_train_slot()
                    shutil.rmtree(tmpdir, ignore_errors=True)
                    return
                for name in ("annotations.geojson", "meta.json"):
                    source = extract_dir / name
                    if source.exists():
                        shutil.copy2(source, persistent_dataset_dir / name)

            except Exception as ze:
                _send_sse({"status": "failed", "error": f"Invalid ZIP: {ze}"})
                _release_train_slot()
                if tmpdir is not None:
                    shutil.rmtree(tmpdir, ignore_errors=True)
                return

            _send_sse(_train_payload(state))

            def run_train():
                try:
                    from .train import train_from_directory, set_train_progress_callback
                    _update_train_state("status", "training")
                    def on_progress(progress):
                        if isinstance(progress, dict):
                            _record_train_progress(progress.get("epoch", 0), progress.get("metrics", {}))
                        else:
                            _update_train_state("current_epoch", progress)
                    set_train_progress_callback(on_progress)
                    result = train_from_directory(
                        dataset_dir=extract_dir,
                        model_name=model_name,
                        output_name=output_name,
                        epochs=epochs,
                        batch=batch,
                        patience=patience,
                        device="auto",
                    )
                    prepared_dir = persistent_dataset_dir / "prepared"
                    shutil.copytree(
                        extract_dir,
                        prepared_dir,
                        dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("weights", "*.pt"),
                    )
                    _write_json(persistent_dataset_dir / "history.json", state.get("history", []))
                    completed_manifest = _load_json(persistent_dataset_dir / "manifest.json") or manifest
                    completed_manifest.update({
                        "status": "done",
                        "updatedAt": _utc_now(),
                        "modelPath": result.get("model_path"),
                        "modelName": result.get("model_name"),
                        "epochsDone": epochs,
                    })
                    _write_json(persistent_dataset_dir / "manifest.json", completed_manifest)
                    with _train_lock:
                        state["status"] = "done"
                        state["model_path"] = result.get("model_path")
                        state["model_name"] = result.get("model_name")
                        state["current_epoch"] = epochs
                except Exception as exc:
                    traceback.print_exc()
                    with _train_lock:
                        state["status"] = "failed"
                        state["error"] = str(exc)
                    failed_manifest = _load_json(persistent_dataset_dir / "manifest.json") or manifest
                    failed_manifest.update({"status": "failed", "updatedAt": _utc_now(), "error": str(exc)})
                    _write_json(persistent_dataset_dir / "manifest.json", failed_manifest)
                finally:
                    _release_train_slot()
                    try:
                        shutil.rmtree(tmpdir, ignore_errors=True)
                    except Exception:
                        pass

            t = threading.Thread(target=run_train, daemon=True)
            t.start()
            state["thread"] = t

            deadline = time.time() + (30 * 60)
            client_disconnected = False
            while (state["running"] or state["status"] in ("starting", "training")) and time.time() < deadline:
                try:
                    _send_sse(_train_payload(state))
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    client_disconnected = True
                    break
                except Exception:
                    pass
                time.sleep(1.0)

            try:
                _send_sse(_train_payload(state))
            except Exception:
                pass

            if client_disconnected and state["running"]:
                _release_train_slot()

        except Exception as exc:  # pragma: no cover
            self._send_json({
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }, status=500)

    def _handle_train_status(self) -> None:
        """GET /train/status — current training state."""
        state = _ensure_train_state()
        self._send_json(_train_payload(state))

    def _handle_datasets_list(self) -> None:
        DATASETS_DIR.mkdir(parents=True, exist_ok=True)
        manifests = [
            item for path in sorted(DATASETS_DIR.glob("*/manifest.json"), reverse=True)
            if (item := _load_json(path)) is not None
        ]
        self._send_json({"datasets": manifests})

    def _handle_dataset_store(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            form = _parse_multipart(self, self.rfile.read(content_length))
            item = form.get("dataset")
            if not item or not item.get("data"):
                self._send_json({"error": "missing dataset field"}, status=400)
                return
            dataset_id, path, manifest = _store_dataset_archive(
                item["data"], item.get("filename") or "dataset.zip", "ready",
            )
            self._send_json({"datasetId": dataset_id, "datasetPath": str(path), "manifest": manifest})
        except (ValueError, zipfile.BadZipFile) as exc:
            self._send_json({"error": str(exc)}, status=400)
        except Exception as exc:
            self._send_json({"error": f"dataset save failed: {exc}"}, status=500)

    # ── Response helpers ──

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.end_headers()

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str, status: int = 200) -> None:
        body = html.encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # ── Amap static proxy ──

    def _handle_amap_static(self, query: dict[str, list[str]]) -> None:
        location = _query_text(query, "location")
        zoom = _query_int(query, "zoom", default=15)
        size = _query_text(query, "size") or "640*640"
        style = (_query_text(query, "style") or "").lower()
        if not location or "," not in location:
            self._send_json({"error": "missing location"}, status=400)
            return
        try:
            lng_text, lat_text = location.split(",", 1)
            lng = float(lng_text)
            lat = float(lat_text)
        except ValueError:
            self._send_json({"error": "invalid location"}, status=400)
            return
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            self._send_json({"error": "location out of range"}, status=400)
            return
        if zoom is None or zoom < 3 or zoom > 17:
            self._send_json({"error": "zoom out of range"}, status=400)
            return
        if not _valid_static_size(size):
            self._send_json({"error": "invalid size"}, status=400)
            return
        if style in ("sat", "satellite", "amap_sat"):
            self._handle_amap_satellite_static(lng, lat, zoom, size)
            return
        if not AMAP_KEY:
            self._send_json({"error": "AMAP_KEY environment variable not set"}, status=500)
            return

        params = urlencode({
            "key": AMAP_KEY,
            "location": f"{lng:.6f},{lat:.6f}",
            "zoom": str(zoom),
            "size": size,
        })
        url = f"https://restapi.amap.com/v3/staticmap?{params}"
        try:
            req = Request(url, headers={"User-Agent": "webgis-farmland-segmenter/0.2"})
            with _open_remote(req, timeout=15) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type") or "image/png"
            self._send_bytes(body, content_type)
        except Exception as exc:
            self._send_json({"error": f"amap static map request failed: {exc}"}, status=502)

    def _handle_amap_satellite_static(self, lng: float, lat: float, zoom: int, size: str) -> None:
        try:
            from PIL import Image

            width_text, height_text = size.lower().split("*", 1)
            width = int(width_text)
            height = int(height_text)
            tile_size = 256
            n = 2 ** zoom
            scale = tile_size * n
            safe_lat = max(-85.05112878, min(85.05112878, lat))
            sin_lat = math.sin(math.radians(safe_lat))
            center_x = ((lng + 180.0) / 360.0) * scale
            center_y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * scale
            left = center_x - width / 2
            top = center_y - height / 2
            canvas = Image.new("RGB", (width, height), (232, 236, 240))

            min_tx = math.floor(left / tile_size)
            max_tx = math.floor((left + width - 1) / tile_size)
            min_ty = math.floor(top / tile_size)
            max_ty = math.floor((top + height - 1) / tile_size)
            for raw_tx in range(min_tx, max_tx + 1):
                for raw_ty in range(min_ty, max_ty + 1):
                    if raw_ty < 0 or raw_ty >= n:
                        continue
                    tx = raw_tx % n
                    ty = raw_ty
                    sub = (abs(tx + ty) % 4) + 1
                    url = f"https://webst0{sub}.is.autonavi.com/appmaptile?style=6&x={tx}&y={ty}&z={zoom}"
                    req = Request(url, headers={"User-Agent": "webgis-farmland-segmenter/0.2"})
                    with _open_remote(req, timeout=12) as resp:
                        tile = Image.open(io.BytesIO(resp.read())).convert("RGB")
                    canvas.paste(tile, (round(raw_tx * tile_size - left), round(raw_ty * tile_size - top)))

            body = io.BytesIO()
            canvas.save(body, format="JPEG", quality=90)
            self._send_bytes(body.getvalue(), "image/jpeg")
        except Exception as exc:
            self._send_json({"error": f"amap satellite stitch failed: {exc}"}, status=502)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[segmenter] {self.address_string()} - {fmt % args}")


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    _ensure_utf8_stdout()
    httpd = ThreadingHTTPServer((host, port), FarmlandSegmentHandler)
    print(f"Farmland segmenter running: http://{host}:{port}/")
    print("POST /segment — image segmentation")
    print("POST /train   — YOLO training (SSE progress)")
    print("GET  /train/status — training state")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping farmland segmenter.")
    finally:
        httpd.server_close()


# ── Training state (singleton across requests) ──

_train_state: dict[str, Any] = {}
_train_lock = threading.Lock()

def _ensure_train_state() -> dict[str, Any]:
    with _train_lock:
        if not _train_state:
            _train_state.update({
                "running": False,
                "status": "idle",
                "epochs": 0,
                "current_epoch": 0,
                "metrics": {},
                "history": [],
                "error": None,
                "dataset_id": None,
                "dataset_path": None,
            })
            restored = _load_latest_completed_training()
            if restored:
                _train_state.update(restored)
        return _train_state


def _load_latest_completed_training() -> dict[str, Any] | None:
    candidates: list[tuple[str, Path, dict[str, Any]]] = []
    for path in DATASETS_DIR.glob("*/manifest.json"):
        manifest = _load_json(path)
        if isinstance(manifest, dict) and manifest.get("status") == "done":
            candidates.append((str(manifest.get("updatedAt") or ""), path.parent, manifest))
    if not candidates:
        return None

    _, dataset_dir, manifest = max(candidates, key=lambda item: item[0])
    params = manifest.get("params") if isinstance(manifest.get("params"), dict) else {}
    total_epochs = int(manifest.get("epochsDone") or params.get("epochs") or 0)
    raw_history = _load_json(dataset_dir / "history.json")
    history = raw_history if isinstance(raw_history, list) else []
    if history and total_epochs > 0 and int(history[-1].get("epoch") or 0) == total_epochs + 1:
        history = [
            {**point, "epoch": max(0, int(point.get("epoch") or 0) - 1)}
            for point in history
            if isinstance(point, dict)
        ]
    metrics = history[-1].get("metrics", {}) if history and isinstance(history[-1], dict) else {}
    return {
        "status": "done",
        "epochs": total_epochs,
        "current_epoch": total_epochs,
        "metrics": metrics if isinstance(metrics, dict) else {},
        "history": history,
        "model_path": manifest.get("modelPath"),
        "model_name": manifest.get("modelName"),
        "output_name": params.get("outputName"),
        "dataset_id": manifest.get("id") or dataset_dir.name,
        "dataset_path": str(dataset_dir),
    }


def _update_train_state(key: str, value: Any) -> None:
    state = _ensure_train_state()
    with _train_lock:
        state[key] = value


def _record_train_progress(epoch: Any, metrics: Any) -> None:
    state = _ensure_train_state()
    epoch_value = int(epoch or 0)
    metric_values = metrics if isinstance(metrics, dict) else {}
    with _train_lock:
        state["current_epoch"] = epoch_value
        state["metrics"] = metric_values
        history = state.setdefault("history", [])
        point = {"epoch": epoch_value, "metrics": metric_values}
        if history and history[-1].get("epoch") == epoch_value:
            history[-1] = point
        else:
            history.append(point)


def _train_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": state["status"] if state["running"] or state["status"] in ("starting", "training") else (state["status"] or "idle"),
        "epoch": state["current_epoch"],
        "totalEpochs": state["epochs"],
        "metrics": state["metrics"],
        "history": state.get("history", []),
        "error": state["error"],
        "modelPath": state.get("model_path"),
        "modelName": state.get("model_name"),
        "outputName": state.get("output_name"),
        "datasetId": state.get("dataset_id"),
        "datasetPath": state.get("dataset_path"),
        "running": state["running"],
    }


def _acquire_train_slot() -> bool:
    """Try to acquire a training slot. Returns False if one is already running."""
    state = _ensure_train_state()
    with _train_lock:
        if state["running"]:
            return False
        state["running"] = True
        state["epochs"] = 0
        state["current_epoch"] = 0
        state["metrics"] = {}
        state["history"] = []
        state["status"] = "starting"
        state["error"] = None
        state["model_path"] = None
        state["model_name"] = None
        state["output_name"] = None
        state["dataset_id"] = None
        state["dataset_path"] = None
        return True


def _release_train_slot() -> None:
    state = _ensure_train_state()
    with _train_lock:
        state["running"] = False


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _store_dataset_archive(
    data: bytes,
    filename: str,
    status: str,
    params: dict[str, Any] | None = None,
) -> tuple[str, Path, dict[str, Any]]:
    dataset_id = hashlib.sha256(data).hexdigest()[:16]
    dataset_dir = DATASETS_DIR / dataset_id
    with tempfile.TemporaryDirectory(prefix="farmland_dataset_check_") as tmp:
        extracted = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            _safe_extract_zip(archive, extracted)
        if not (extracted / "data.yaml").exists():
            raise ValueError("data.yaml not found in dataset ZIP")
        if not (extracted / "images" / "train").is_dir() or not (extracted / "labels" / "train").is_dir():
            raise ValueError("dataset ZIP must contain images/train and labels/train")
        dataset_dir.mkdir(parents=True, exist_ok=True)
        source_zip = dataset_dir / "source.zip"
        if not source_zip.exists():
            source_zip.write_bytes(data)
        for name in ("annotations.geojson", "meta.json"):
            source = extracted / name
            if source.exists():
                shutil.copy2(source, dataset_dir / name)

    manifest = _load_json(dataset_dir / "manifest.json") or {
        "id": dataset_id,
        "sha256": hashlib.sha256(data).hexdigest(),
        "createdAt": _utc_now(),
    }
    next_status = manifest.get("status") if status == "ready" and manifest.get("status") == "done" else status
    manifest.update({"sourceName": filename, "updatedAt": _utc_now(), "status": next_status})
    if params is not None:
        manifest["params"] = params
    _write_json(dataset_dir / "manifest.json", manifest)
    return dataset_id, dataset_dir, manifest


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _safe_extract_zip(archive: zipfile.ZipFile, target: Path) -> None:
    target = target.resolve()
    for member in archive.infolist():
        parts = Path(member.filename.replace("\\", "/")).parts
        if member.filename.startswith(("/", "\\")) or ".." in parts:
            raise ValueError(f"ZIP contains unsafe path: {member.filename}")
        destination = (target / Path(*parts)).resolve()
        if destination != target and target not in destination.parents:
            raise ValueError(f"ZIP contains unsafe path: {member.filename}")
    archive.extractall(target)


# ── Multipart parser (replaces deprecated cgi module) ──

def _parse_multipart(handler: BaseHTTPRequestHandler, raw: bytes) -> dict[str, dict[str, Any]]:
    """Parse multipart/form-data into {field_name: {data, filename, content_type}}."""
    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        return {}

    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.lower().startswith("boundary="):
            boundary = part.split("=", 1)[1]
            if boundary.startswith('"') or boundary.startswith("'"):
                boundary = boundary[1:-1]
            break

    if not boundary:
        return {}
    boundary_bytes = boundary.encode("ascii")
    parts = raw.split(b"--" + boundary_bytes)

    result: dict[str, dict[str, Any]] = {}
    for part in parts:
        if not part or part.startswith(b"--") or part.strip() == b"":
            continue

        header_end = part.find(b"\r\n\r\n")
        if header_end == -1:
            header_end = part.find(b"\n\n")
        if header_end == -1:
            continue

        header_section = part[:header_end]
        # Strip leading \r\n or \n before Content-Disposition header
        header_section = header_section.lstrip(b"\r\n")
        body = part[header_end + 4:]
        # Strip trailing \r\n before next boundary
        if body.endswith(b"\r\n"):
            body = body[:-2]
        elif body.endswith(b"\n"):
            body = body[:-1]

        # Parse headers
        headers = BytesParser().parsebytes(header_section + b"\r\n\r\n")
        disposition = headers.get("Content-Disposition", "")
        field_name = _extract_disposition_param(disposition, "name")
        filename = _extract_disposition_param(disposition, "filename")

        if field_name:
            result[field_name] = {
                "data": body,
                "filename": filename,
                "content_type": headers.get("Content-Type", ""),
            }

    return result


def _extract_disposition_param(disposition: str, param: str) -> str | None:
    """Extract a parameter value from Content-Disposition header."""
    search = f'{param}='
    idx = disposition.find(search)
    if idx == -1:
        search = f'{param}="'
        idx = disposition.find(search)
        if idx == -1:
            return None
        start = idx + len(search)
        end = disposition.find('"', start)
        return disposition[start:end] if end != -1 else None

    start = idx + len(search)
    if disposition[start:start + 1] == '"':
        start += 1
        end = disposition.find('"', start)
        return disposition[start:end] if end != -1 else None

    end = disposition.find(";", start)
    if end == -1:
        end = len(disposition)
    return disposition[start:end].strip()


def _store_uploaded_model(item: dict[str, Any]) -> str | None:
    data = item.get("data", b"")
    if not data:
        return None

    filename = item.get("filename") or "farmland_model.pt"
    suffix = Path(filename).suffix.lower()
    if suffix != ".pt":
        raise ValueError("仅支持导入 YOLO .pt 模型文件。")

    stem = Path(filename).stem
    safe_stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._-") or "farmland_model"
    digest = hashlib.sha256(data).hexdigest()[:16]
    models_dir = Path(__file__).resolve().parents[1] / "models" / "imported"
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / f"{safe_stem}_{digest}.pt"
    if not model_path.exists():
        model_path.write_bytes(data)
    return str(model_path)


# ── Form helpers ──

def _form_float(
    form: dict[str, dict[str, Any]], name: str, default: float | None = None,
) -> float | None:
    item = form.get(name)
    if item is None:
        return default
    value = item.get("data", b"").decode("utf-8", errors="replace").strip()
    if not value:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _form_int(
    form: dict[str, dict[str, Any]], name: str, default: int | None = None,
) -> int | None:
    item = form.get(name)
    if item is None:
        return default
    value = item.get("data", b"").decode("utf-8", errors="replace").strip()
    if not value:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _form_bool(
    form: dict[str, dict[str, Any]], name: str, default: bool = False,
) -> bool:
    item = form.get(name)
    if item is None:
        return default
    value = item.get("data", b"").decode("utf-8", errors="replace").strip().lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on")


def _form_text(form: dict[str, dict[str, Any]], name: str) -> str | None:
    item = form.get(name)
    if item is None:
        return None
    value = item.get("data", b"").decode("utf-8", errors="replace").strip()
    return value if value else None


# ── Query helpers ──

def _query_text(query: dict[str, list[str]], name: str) -> str | None:
    value = query.get(name, [""])[0]
    return value.strip() if isinstance(value, str) and value.strip() else None


def _query_int(
    query: dict[str, list[str]], name: str, default: int | None = None,
) -> int | None:
    value = _query_text(query, name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _valid_static_size(size: str) -> bool:
    parts = size.lower().split("*")
    if len(parts) != 2:
        return False
    try:
        width = int(parts[0])
        height = int(parts[1])
    except ValueError:
        return False
    return 32 <= width <= 1024 and 32 <= height <= 1024


# ── Built-in visualizer HTML ──

VISUALIZER_HTML = """<html><body>Segmentation visualizer removed for brevity.</body></html>"""
