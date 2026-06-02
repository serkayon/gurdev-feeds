from .auth import auth_bp
from .config import config_bp
from .dispatch import dispatch_bp
from .health import health_bp
from .plc import plc_bp
from .production import production_bp
from .raw_material import raw_material_bp
from .stock import stock_bp

ALL_BLUEPRINTS = (
    health_bp,
    plc_bp,
    config_bp,
    raw_material_bp,
    dispatch_bp,
    production_bp,
    stock_bp,
    auth_bp,
)
