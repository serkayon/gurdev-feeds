from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import ALL_BLUEPRINTS


# Create app.

def create_app() -> FastAPI:
    app = FastAPI(title="Poultry ERP API")
    app.router.redirect_slashes = False
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for blueprint in ALL_BLUEPRINTS:
        app.include_router(blueprint.router)

    return app

