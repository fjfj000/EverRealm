# -*- coding: utf-8 -*-
"""属性行动编辑器的本地保存服务。

只监听本机。页面从这里打开时，「保存并更新导表」会写回输入 JSON，
并重新生成产出目录里的 xlsx。不要把这个服务暴露到局域网。
"""
import json
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from build_workbook import INPUT_PATH, OUTPUT_PATH, build, validate, warn_design

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 8765
MAX_BODY = 8 * 1024 * 1024


def write_input(doc):
    """校验通过后原子替换 JSON，再重建 xlsx。"""
    errors = validate(doc)
    if errors:
        raise ValueError("\n".join(errors))
    INPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = INPUT_PATH.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(INPUT_PATH)
    build(doc, OUTPUT_PATH)
    return warn_design(doc)


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            self.respond_json(200, json.loads(INPUT_PATH.read_text(encoding="utf-8")))
            return
        if path == "/":
            self.path = "/工具/属性行动编辑器.html"
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/save":
            self.respond_json(404, {"ok": False, "error": "未知接口"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            self.respond_json(400, {"ok": False, "error": "正文为空或过大"})
            return
        try:
            doc = json.loads(self.rfile.read(length).decode("utf-8"))
            warnings = write_input(doc)
        except ValueError as exc:
            self.respond_json(400, {"ok": False, "error": str(exc)})
            return
        except json.JSONDecodeError:
            self.respond_json(400, {"ok": False, "error": "JSON 无法解析"})
            return
        self.respond_json(200, {"ok": True, "warnings": warnings})

    def respond_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    server = ThreadingHTTPServer((HOST, PORT), EditorHandler)
    url = f"http://{HOST}:{PORT}/工具/属性行动编辑器.html"
    print(f"属性行动编辑器：{url}", flush=True)
    print("保存会写回 输入/属性行动.json，并更新 产出/属性行动.xlsx", flush=True)
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
