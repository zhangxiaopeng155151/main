#!/usr/bin/env python3
"""单端口同源预览代理：把 Next 前端与后端 API 合成一个端口。

项目本身是"前端 3300 + 后端 8200"两端口结构，而线上预览通常只暴露一个端口。
本脚本监听一个对外端口，把 `/api`、`/static`、`/docs`、`/openapi.json`、`/redoc`
转发给后端，其余请求转发给 Next 前端，从而让浏览器用**同源相对路径**访问接口，
避免跨域、也避免把 127.0.0.1 写进浏览器。

用法：
    python scripts/preview_proxy.py --listen 3301 --frontend 3302 --backend 8200

配合前端构建：NEXT_PUBLIC_API_BASE 必须等于对外访问的完整地址
（例如 https://3301-<sandbox>.e2b.app），否则打包进 bundle 的接口地址不可达。
"""

from __future__ import annotations

import argparse
import http.client
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BACKEND_PREFIXES = ("/api", "/static", "/docs", "/openapi.json", "/redoc")
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}

CONFIG = {"frontend": ("127.0.0.1", 3302), "backend": ("127.0.0.1", 8200)}


class Handler(BaseHTTPRequestHandler):
    """按路径把请求分发到前端或后端，并按流式回写响应。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: D102 - 精简访问日志
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _target(self) -> tuple[str, int, str]:
        """决定本次请求的去向。

        Returns:
            (主机, 端口, 路径) 三元组。
        """
        if self.path.startswith(BACKEND_PREFIXES):
            host, port = CONFIG["backend"]
        else:
            host, port = CONFIG["frontend"]
        return host, port, self.path

    def _proxy(self) -> None:
        """转发请求并流式回写响应（兼容 SSE）。"""
        host, port, path = self._target()
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        # 保留浏览器发来的真实 Host，让 Next 生成的绝对链接/hreflang 指向对外地址而不是内网端口。
        headers["Host"] = self.headers.get("Host") or f"{host}:{port}"
        headers["X-Forwarded-Host"] = headers["Host"]
        headers["X-Forwarded-Proto"] = self.headers.get("X-Forwarded-Proto", "https")
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["Accept-Encoding"] = "identity"  # 交给浏览器处理压缩，避免二次解码
        connection = http.client.HTTPConnection(host, port, timeout=900)
        try:
            connection.request(self.command, path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            for key, value in response.getheaders():
                if key.lower() not in HOP_BY_HOP:
                    self.send_header(key, value)
            # HEAD 与 204/304 不允许带响应体，否则调用方会等一个永远不会到来的 chunk。
            if self.command == "HEAD" or response.status in (204, 304):
                self.end_headers()
                return
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            try:
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(b"%X\r\n%s\r\n" % (len(chunk), chunk))
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass  # 浏览器提前断开（例如切换页面、取消 SSE）
        except (ConnectionError, OSError) as failure:
            message = f"上游不可用：{host}:{port}（{failure}）".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
        finally:
            connection.close()

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _proxy


def main() -> None:
    """解析参数并启动代理服务。"""
    parser = argparse.ArgumentParser(description="单端口同源预览代理")
    parser.add_argument("--listen", type=int, default=3301, help="对外监听端口")
    parser.add_argument("--frontend", type=int, default=3302, help="Next 前端端口")
    parser.add_argument("--backend", type=int, default=8200, help="后端 API 端口")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（预览环境用 0.0.0.0）")
    args = parser.parse_args()

    CONFIG["frontend"] = ("127.0.0.1", args.frontend)
    CONFIG["backend"] = ("127.0.0.1", args.backend)

    server = ThreadingHTTPServer((args.host, args.listen), Handler)
    server.daemon_threads = True
    print(
        f"[preview_proxy] 监听 {args.host}:{args.listen} → 前端 127.0.0.1:{args.frontend}"
        f"，后端 127.0.0.1:{args.backend}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[preview_proxy] 已停止", flush=True)


if __name__ == "__main__":
    main()
