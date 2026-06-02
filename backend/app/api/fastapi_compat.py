from __future__ import annotations

import inspect
import json
import re
from contextvars import ContextVar
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response as StarletteResponse


_current_request: ContextVar["_CompatRequest"] = ContextVar("current_request")

PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/vendor-signup",
}

PROTECTED_PREFIXES = (
    "/api/auth",
    "/api/config",
    "/api/raw-material",
    "/api/dispatch",
    "/api/stock",
    "/api/production",
)

HMI_EXEMPT_PREFIXES = (
    "/api/production/hmi",
)


# Define RequestProxy.

class _RequestProxy:
    # Get value.

    def _get(self) -> "_CompatRequest":
        current = _current_request.get(None)
        if current is None:
            raise RuntimeError("Request context is not available")
        return current

    # Handle getattr.

    def __getattr__(self, name: str) -> Any:
        return getattr(self._get(), name)


# Define CompatRequest.

class _CompatRequest:
    # Handle init.

    def __init__(
        self,
        request: Request,
        json_payload: Any,
        json_error: Exception | None,
    ) -> None:
        self._request = request
        self._json_payload = json_payload
        self._json_error = json_error

    # Handle args.

    @property
    def args(self):
        return self._request.query_params

    # Handle headers.

    @property
    def headers(self):
        return self._request.headers

    # Get json.

    def get_json(self, silent: bool = False):
        if self._json_error is not None:
            if silent:
                return None
            raise ValueError("Invalid JSON request body") from self._json_error
        return self._json_payload


request = _RequestProxy()


# Define Response.

class Response(StarletteResponse):
    # Handle init.

    def __init__(
        self,
        response: Any = None,
        status: int = 200,
        headers: dict[str, str] | None = None,
        mimetype: str | None = None,
        content_type: str | None = None,
        media_type: str | None = None,
    ) -> None:
        resolved_media_type = media_type or mimetype or content_type
        super().__init__(
            content=response,
            status_code=status,
            headers=headers,
            media_type=resolved_media_type,
        )


# Handle jsonify.

def jsonify(*args, **kwargs) -> JSONResponse:
    if args and kwargs:
        raise TypeError("jsonify accepts either args or kwargs, not both")
    if len(args) == 1:
        payload = args[0]
    elif len(args) > 1:
        payload = list(args)
    else:
        payload = kwargs
    return JSONResponse(content=payload)


_ROUTE_PARAM_RE = re.compile(r"<(?:(?P<converter>\w+):)?(?P<name>\w+)>")
_CONVERTER_MAP = {
    "int": "int",
    "float": "float",
    "path": "path",
    "uuid": "uuid",
}


# Convert route path.

def _convert_route_path(path: str) -> str:
    if path == "":
        return path
    if not path.startswith("/"):
        path = f"/{path}"

    # Handle replace.

    def _replace(match: re.Match[str]) -> str:
        converter = (match.group("converter") or "").lower()
        name = match.group("name")
        mapped = _CONVERTER_MAP.get(converter)
        if mapped:
            return f"{{{name}:{mapped}}}"
        return f"{{{name}}}"

    return _ROUTE_PARAM_RE.sub(_replace, path)


# Handle response from tuple.

def _response_from_tuple(result: tuple[Any, ...]) -> StarletteResponse:
    if len(result) not in (2, 3):
        raise ValueError("Unsupported tuple response shape")

    body = result[0]
    status_code = int(result[1])
    headers = result[2] if len(result) == 3 else None

    if isinstance(body, StarletteResponse):
        response = body
    elif isinstance(body, (dict, list)) or body is None:
        response = JSONResponse(content=body)
    else:
        response = Response(body)

    response.status_code = status_code
    if headers:
        response.headers.update(headers)
    return response


# Normalize response.

def _normalize_response(result: Any) -> Any:
    if isinstance(result, StarletteResponse):
        return result
    if isinstance(result, tuple):
        return _response_from_tuple(result)
    if isinstance(result, (dict, list)) or result is None:
        return JSONResponse(content=result)
    return result


# Build compat request.

async def _build_compat_request(raw_request: Request) -> _CompatRequest:
    json_payload = None
    json_error = None
    try:
        body = await raw_request.body()
        if body:
            json_payload = json.loads(body)
    except Exception as exc:
        json_error = exc
    return _CompatRequest(raw_request, json_payload=json_payload, json_error=json_error)


def _normalize_path(path: str) -> str:
    raw_path = str(path or "").strip()
    if not raw_path:
        return "/"
    if len(raw_path) > 1 and raw_path.endswith("/"):
        return raw_path[:-1]
    return raw_path


def _requires_auth(path: str) -> bool:
    normalized_path = _normalize_path(path)
    if normalized_path in PUBLIC_PATHS:
        return False
    if any(normalized_path.startswith(prefix) for prefix in HMI_EXEMPT_PREFIXES):
        return False
    return any(normalized_path.startswith(prefix) for prefix in PROTECTED_PREFIXES)


def _enforce_authentication() -> None:
    from app.db import SessionLocal
    from .common import current_user

    db = SessionLocal()
    try:
        current_user(db)
    finally:
        db.close()


# Handle wrap endpoint.

def _wrap_endpoint(func: Callable[..., Any]) -> Callable[..., Any]:
    # Handle endpoint.

    async def endpoint(request: Request):
        compat_request = await _build_compat_request(request)
        token = _current_request.set(compat_request)
        try:
            if _requires_auth(request.url.path):
                try:
                    _enforce_authentication()
                except PermissionError as exc:
                    return JSONResponse(content={"detail": str(exc)}, status_code=401)
            path_params = dict(request.path_params)
            if inspect.iscoroutinefunction(func):
                result = await func(**path_params)
            else:
                result = await run_in_threadpool(func, **path_params)
        finally:
            _current_request.reset(token)
        return _normalize_response(result)

    endpoint.__name__ = func.__name__
    endpoint.__doc__ = func.__doc__
    return endpoint


# Define Blueprint.

class Blueprint:
    # Handle init.

    def __init__(self, name: str, import_name: str, url_prefix: str = "") -> None:
        self.name = name
        self.import_name = import_name
        self.url_prefix = url_prefix
        self.router = APIRouter(prefix=url_prefix)

    # Handle route.

    def route(self, path: str, methods: list[str] | tuple[str, ...] | None = None):
        resolved_methods = list(methods) if methods else ["GET"]
        return self._register(path, resolved_methods)

    # Get value.

    def get(self, path: str):
        return self._register(path, ["GET"])

    # Handle post.

    def post(self, path: str):
        return self._register(path, ["POST"])

    # Handle put.

    def put(self, path: str):
        return self._register(path, ["PUT"])

    # Delete value.

    def delete(self, path: str):
        return self._register(path, ["DELETE"])

    # Handle patch.

    def patch(self, path: str):
        return self._register(path, ["PATCH"])

    # Handle register.

    def _register(self, path: str, methods: list[str]):
        converted_path = _convert_route_path(path)

        # Handle decorator.

        def decorator(func: Callable[..., Any]):
            self.router.add_api_route(
                converted_path,
                _wrap_endpoint(func),
                methods=[method.upper() for method in methods],
                name=func.__name__,
            )
            return func

        return decorator
