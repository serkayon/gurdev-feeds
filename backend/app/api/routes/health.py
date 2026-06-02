from ..fastapi_compat import Blueprint, jsonify

health_bp = Blueprint("health", __name__)


# Simple health-check endpoint that confirms service availability.

@health_bp.get("api/health")
def health():
    return jsonify({"status": "ok"})
