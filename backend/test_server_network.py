import unittest
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import Request

from backend.farmland_segmenter import server


class RemoteOpenTest(unittest.TestCase):
    def test_retries_direct_when_local_proxy_refuses_connection(self):
        request = Request("https://example.com", headers={"User-Agent": "webgis-test"})
        direct_response = object()
        with patch.object(server, "urlopen", side_effect=URLError(ConnectionRefusedError(10061, "refused"))):
            with patch.object(server._DIRECT_URL_OPENER, "open", return_value=direct_response) as direct_open:
                self.assertIs(server._open_remote(request, 3), direct_response)
                direct_open.assert_called_once()
                direct_request = direct_open.call_args.args[0]
                self.assertIsNot(direct_request, request)
                self.assertEqual(direct_request.full_url, request.full_url)
                self.assertEqual(direct_request.get_header("User-agent"), "webgis-test")


if __name__ == "__main__":
    unittest.main()
