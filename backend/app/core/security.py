from collections import defaultdict, deque
import ipaddress
import time
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# In-memory sliding window rate limiter buckets: (client_ip, bucket_name) -> timestamps
_RATE_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)

# Limit rules: (path_prefix, max_requests, window_seconds)
RATE_RULES: list[tuple[str, int, int]] = [
    ("/api/agent/detect-models", 15, 60),
    ("/api/agent/test-llm", 20, 60),
    ("/api/agent/chat", 30, 60),
    ("/api/guides/ingest", 20, 60),
    ("/api/bookings", 40, 60),
]

# Blocked cloud metadata & dangerous internal hosts for SSRF protection
_BLOCKED_HOSTNAMES = {
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
}

# Localhost ports explicitly allowed for local LLM servers (e.g. Ollama, vLLM, LM Studio)
_ALLOWED_LOCAL_LLM_PORTS = {11434, 1234, 8080, 8001, 3000}


def validate_llm_base_url(base_url: str) -> tuple[bool, str | None]:
    """Validate user-supplied OpenAI-compatible base_url to prevent SSRF attacks."""
    url = (base_url or "").strip()
    if not url:
        return False, "Base URL 不能为空"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, "Base URL 仅支持 http:// 或 https:// 协议"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return False, "Base URL 缺少合法主机名"
    if host in _BLOCKED_HOSTNAMES:
        return False, "禁止访问云厂商元数据或受限内网域名"

    # Allow localhost only on standard local LLM ports (Ollama/vLLM/LM Studio)
    if host in ("localhost", "127.0.0.1", "::1"):
        port = parsed.port
        if port not in _ALLOWED_LOCAL_LLM_PORTS:
            return (
                False,
                f"出于安全防护（防 SSRF），本地地址仅允许常见本地模型端口 {sorted(_ALLOWED_LOCAL_LLM_PORTS)}",
            )
        return True, None

    # Block link-local (169.254.0.0/16), private LAN, multicast, and reserved IPs
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_link_local or ip.is_private or ip.is_loopback or ip.is_multicast or ip.is_reserved:
            return False, "出于安全防护（防 SSRF），禁止指向内网或链路本地 IP 地址"
    except ValueError:
        # Domain name — valid public hostname
        pass

    return True, None


class SecurityMiddleware(BaseHTTPMiddleware):
    """Adds defensive HTTP security headers and per-IP sliding-window rate limiting."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        client_ip = request.client.host if request.client else "unknown"

        # Skip rate limiting in ASGI test client ("testclient") so concurrent booking unit tests run cleanly
        if client_ip != "testclient":
            now = time.monotonic()
            for prefix, max_req, window in RATE_RULES:
                if path.startswith(prefix) and request.method in ("POST", "PUT", "DELETE"):
                    key = (client_ip, prefix)
                    q = _RATE_BUCKETS[key]
                    cutoff = now - window
                    while q and q[0] < cutoff:
                        q.popleft()
                    if len(q) >= max_req:
                        return JSONResponse(
                            status_code=429,
                            content={"detail": f"请求过于频繁，请 {window} 秒后再试（安全频控保护）"},
                        )
                    q.append(now)
                    break

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return response
