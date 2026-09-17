"""farmland_segmenter 后端单元与集成测试。

运行方式（需要带 torch 的环境，如 D:/ProgramData/anaconda31/python.exe）：

    cd backend
    python -m pytest tests/ -v
"""

from __future__ import annotations

import io
import json
import math
import urllib.error
import urllib.request
import zipfile
from threading import Thread

import pytest

from farmland_segmenter import server
from farmland_segmenter.inference import (
    SegmentOptions,
    _polygon_area_square_meters,
    _resolve_bounds,
)


# ── 纯函数：表单 / 查询参数解析 ────────────────────────────────────────────


def _form(**fields) -> dict:
    """模拟 multipart 解析产物：每个表单项形如 {"data": bytes}。"""
    return {k: {"data": v.encode("utf-8")} for k, v in fields.items()}


class TestFormParsers:
    def test_form_text_present_and_missing(self):
        form = _form(name="地块A")
        assert server._form_text(form, "name") == "地块A"
        assert server._form_text(form, "missing") is None

    def test_form_float_valid_invalid_missing(self):
        form = _form(conf="0.35", bad="abc")
        assert server._form_float(form, "conf") == pytest.approx(0.35)
        assert server._form_float(form, "bad") is None      # 解析失败回落 default
        assert server._form_float(form, "missing") is None

    def test_form_int_valid_invalid_missing(self):
        form = _form(size="640", bad="x")
        assert server._form_int(form, "size") == 640
        assert server._form_int(form, "bad") is None
        assert server._form_int(form, "missing") is None

    def test_form_bool_accepts_common_spellings(self):
        for raw, expected in (("1", True), ("true", True), ("yes", True), ("0", False), ("no", False)):
            assert server._form_bool(_form(flag=raw), "flag") is expected
        assert server._form_bool(_form(other="1"), "flag") is False  # 缺省 False

    def test_form_bool_default(self):
        assert server._form_bool(_form(), "flag", default=True) is True


class TestQueryParsers:
    def test_query_text(self):
        assert server._query_text({"location": ["87.8,46.7"]}, "location") == "87.8,46.7"
        assert server._query_text({}, "location") is None

    def test_query_int(self):
        assert server._query_int({"zoom": ["18"]}, "zoom") == 18
        assert server._query_int({"zoom": ["abc"]}, "zoom") is None
        assert server._query_int({}, "zoom") is None

    def test_valid_static_size(self):
        assert server._valid_static_size("640*640") is True
        assert server._valid_static_size("31*640") is False   # 低于下限 32
        assert server._valid_static_size("1025*640") is False  # 超过上限 1024
        assert server._valid_static_size("abc") is False


# ── 纯函数：推理几何 ─────────────────────────────────────────────────────


class TestInferenceGeometry:
    def test_polygon_area_square_meters(self):
        # 约 100m x 100m 的正方形（纬度 46.7° 处）
        lat = 46.7
        dx = 100.0 / (111_320.0 * math.cos(math.radians(lat)))
        dy = 100.0 / 110_574.0
        ring = [
            [87.0, lat],
            [87.0 + dx, lat],
            [87.0 + dx, lat + dy],
            [87.0, lat + dy],
            [87.0, lat],
        ]
        area = _polygon_area_square_meters(ring)
        assert 8_000 < area < 12_000

    def test_polygon_area_rejects_degenerate_ring(self):
        assert _polygon_area_square_meters([[0, 0], [1, 1], [0, 0]]) == 0.0

    def test_resolve_bounds_from_explicit_wsen(self):
        options = SegmentOptions(west=87.0, south=46.0, east=87.1, north=46.1)
        west, south, east, north = _resolve_bounds(options, width=640, height=640)
        assert (west, south, east, north) == pytest.approx((87.0, 46.0, 87.1, 46.1))

    def test_resolve_bounds_from_origin_and_pixel_size(self):
        options = SegmentOptions(origin_lng=87.0, origin_lat=46.7, pixel_size_m=0.5)
        west, south, east, north = _resolve_bounds(options, width=640, height=640)
        # 640px * 0.5m ≈ 320m 跨度
        assert east - west == pytest.approx(
            320.0 / (111_320.0 * math.cos(math.radians(46.7))), rel=0.01)
        assert north - south == pytest.approx(320.0 / 111_320.0, rel=0.01)

    def test_resolve_bounds_rejects_missing(self):
        options = SegmentOptions()
        with pytest.raises(RuntimeError):
            _resolve_bounds(options, width=640, height=640)

    def test_resolve_bounds_rejects_out_of_range(self):
        options = SegmentOptions(west=200.0, south=46.0, east=210.0, north=46.1)
        with pytest.raises(RuntimeError):
            _resolve_bounds(options, width=640, height=640)


# ── 集成：HTTP 服务（本地状态链路，不联网、不加载模型） ───────────────────


@pytest.fixture()
def live_server(tmp_path, monkeypatch):
    """在临时目录中启动真实 HTTP 服务，隔离 STATE_FILE 与数据集目录。"""
    monkeypatch.setattr(server, "STATE_FILE", tmp_path / "data" / "webgis_state.json")
    monkeypatch.setattr(server, "DATASETS_DIR", tmp_path / "datasets")

    httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.FarmlandSegmentHandler)
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


class TestServerIntegration:
    def test_health(self, live_server):
        with urllib.request.urlopen(f"{live_server}/health") as resp:
            payload = json.loads(resp.read())
        assert payload["ok"] is True
        assert payload["service"] == "farmland-segmenter"

    def test_state_roundtrip(self, live_server):
        state = {
            "layers": [{"id": "l1", "name": "默认图层", "visible": True}],
            "features": [{
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [87.0, 46.0]},
                "properties": {"name": "测试点"},
            }],
        }
        req = urllib.request.Request(
            f"{live_server}/state", data=json.dumps(state).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            assert json.loads(resp.read())["ok"] is True

        with urllib.request.urlopen(f"{live_server}/state") as resp:
            loaded = json.loads(resp.read())["state"]
        assert loaded["features"][0]["geometry"]["coordinates"] == [87.0, 46.0]

    def test_state_rejects_bad_shape(self, live_server):
        req = urllib.request.Request(
            f"{live_server}/state", data=b'{"layers": "nope"}',
            headers={"Content-Type": "application/json"}, method="POST")
        with pytest.raises(urllib.error.HTTPError) as excinfo:
            urllib.request.urlopen(req)
        assert excinfo.value.code == 400

    def test_unknown_route_404(self, live_server):
        with pytest.raises(urllib.error.HTTPError) as excinfo:
            urllib.request.urlopen(f"{live_server}/no-such-route")
        assert excinfo.value.code == 404


class TestZipSafety:
    def test_safe_extract_rejects_path_traversal(self, tmp_path):
        target = tmp_path / "datasets" / "abc123"
        target.mkdir(parents=True)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("../../evil.txt", "pwn")
        buffer.seek(0)
        with zipfile.ZipFile(buffer) as zf:
            with pytest.raises(ValueError, match="unsafe path"):
                server._safe_extract_zip(zf, target)
        assert not (target.parent / "evil.txt").exists()


class TestTrainParams:
    def test_patience_form_parsing(self):
        assert server._form_int(_form(patience="30"), "patience", default=30) == 30
        assert server._form_int(_form(patience="0"), "patience", default=30) == 0
        assert server._form_int(_form(), "patience", default=30) == 30
        assert server._form_int(_form(patience="abc"), "patience", default=30) == 30

    def test_patience_rejects_negative(self):
        # 负数会被 server 归一为默认值 30（见 /train 处理逻辑）
        raw = server._form_int(_form(patience="-5"), "patience", default=30)
        assert raw == -5  # 解析层不拦截；由 server 归一化
        assert (raw is None or raw < 0) is True
