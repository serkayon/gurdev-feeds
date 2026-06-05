# Configuration routes for product types and recipes.


from datetime import datetime

from ..fastapi_compat import Blueprint, jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..common import db_session, dt, error, json_body
from app.models.config import ProductType, Recipe, RecipeMaterial
from ...utils.timezone import app_now

config_bp = Blueprint("config", __name__, url_prefix="/api/config")


# Return all product type names.

@config_bp.get("/product-types")
def list_product_types():
    with db_session() as db:
        rows = db.execute(select(ProductType).order_by(ProductType.name.asc())).scalars().all()

    return jsonify([row.name for row in rows])


# Serialize a product type for management views.

def _serialize_product_type(product_type: ProductType) -> dict:
    return {
        "id": product_type.id,
        "name": product_type.name,
        "created_at": dt(product_type.created_at),
        "last_modified_at": dt(product_type.last_modified_at),
    }


# Return product types with metadata for admin screens.

@config_bp.get("/product-types/manage")
def list_product_types_manage():
    with db_session() as db:
        rows = db.execute(select(ProductType).order_by(ProductType.name.asc())).scalars().all()

    return jsonify([_serialize_product_type(row) for row in rows])


# Create a new product type.

@config_bp.post("/product-types")
def add_product_type():
    name = request.args.get("name", "").strip()
    if not name:
        try:
            payload = json_body()
            name = str(payload.get("name") or "").strip()
        except ValueError:
            name = ""
    if not name:
        return error("Product type name is required")

    with db_session() as db:
        existing = (
            db.execute(select(ProductType).where(ProductType.name == name))
            .scalars()
            .one_or_none()
        )
        if existing:
            return error("Product type already exists")

        row = ProductType(name=name)
        db.add(row)
        db.flush()
        return jsonify(_serialize_product_type(row))


# Update an existing product type.

@config_bp.put("/product-types/<int:product_type_id>")
def update_product_type(product_type_id: int):
    name = request.args.get("name", "").strip()
    if not name:
        return error("Product type name is required")

    with db_session() as db:
        row = db.get(ProductType, product_type_id)
        if not row:
            return error("Product type not found", 404)

        existing = (
            db.execute(
                select(ProductType).where(
                    ProductType.name == name,
                    ProductType.id != product_type_id,
                )
            )
            .scalars()
            .one_or_none()
        )
        if existing:
            return error("Product type already exists")

        row.name = name
        row.last_modified_at = app_now()
        db.flush()
        return jsonify(_serialize_product_type(row))


# Delete a product type.

@config_bp.delete("/product-types/<int:product_type_id>")
def delete_product_type(product_type_id: int):
    with db_session() as db:
        row = db.get(ProductType, product_type_id)
        if not row:
            return error("Product type not found", 404)

        db.delete(row)
        db.flush()
        return jsonify({"id": product_type_id, "deleted": True})


# Validate recipe materials from a request payload.

def _parse_recipe_materials(materials: object) -> list[dict]:
    if not isinstance(materials, list) or len(materials) == 0:
        raise ValueError("materials is required and must be a non-empty list")

    parsed: list[dict] = []
    seen_rm_names: set[str] = set()
    for index, item in enumerate(materials, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"materials[{index}] must be an object")

        rm_name = str(item.get("rm_name") or "").strip()
        if not rm_name:
            raise ValueError(f"materials[{index}].rm_name is required")
        rm_key = rm_name.lower()
        if rm_key in seen_rm_names:
            raise ValueError(f"materials[{index}].rm_name is duplicated")
        seen_rm_names.add(rm_key)

        try:
            quantity = float(
                item.get("quantity")
                if item.get("quantity") not in (None, "")
                else item.get("percentage")
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(f"materials[{index}].quantity must be a number") from exc
        if quantity <= 0:
            raise ValueError(f"materials[{index}].quantity must be greater than 0")

        parsed.append({"rm_name": rm_name, "quantity": quantity})

    return parsed


# Serialize a recipe and its material rows.

def _serialize_recipe(recipe: Recipe) -> dict:
    return {
        "id": recipe.id,
        "name": recipe.name,
        "created_at": dt(recipe.created_at),
        "last_modified_at": dt(recipe.last_modified_at),
        "materials": [
            {
                "id": item.id,
                "recipe_id": item.recipe_id,
                "rm_name": item.rm_name,
                "quantity": item.quantity,
                "created_at": dt(item.created_at),
                "last_modified_at": dt(item.last_modified_at),
            }
            for item in sorted(
                recipe.materials,
                key=lambda value: (
                    value.created_at or datetime.min,
                    value.id,
                ),
            )
        ],
    }


# Validate a recipe ID in the supported range.

def _parse_recipe_id(raw_value: object) -> int:
    try:
        recipe_id = int(str(raw_value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("recipe_id must be an integer") from exc
    if recipe_id < 1 or recipe_id > 20:
        raise ValueError("recipe_id must be between 1 and 20")
    return recipe_id


# Return recipes ordered by name.

@config_bp.get("/recipes")
def list_recipes():
    with db_session() as db:
        rows = (
            db.execute(select(Recipe).options(selectinload(Recipe.materials)).order_by(Recipe.name.asc()))
            .scalars()
            .all()
        )
    return jsonify([_serialize_recipe(row) for row in rows])


# Create a recipe with a manually selected ID.

@config_bp.post("/recipes")
def add_recipe():
    try:
        payload = json_body()
        recipe_id = _parse_recipe_id(payload.get("recipe_id"))
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        add_to_product_type = bool(payload.get("add_to_product_type"))
        materials = _parse_recipe_materials(payload.get("materials"))
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        existing_recipe = (
            db.execute(select(Recipe).where(Recipe.name == name))
            .scalars()
            .one_or_none()
        )
        if existing_recipe:
            return error("Recipe name already exists")

        existing_id = db.get(Recipe, recipe_id)
        if existing_id:
            return error(f"Recipe ID {recipe_id} already exists")

        recipe = Recipe(id=recipe_id, name=name)
        db.add(recipe)
        db.flush()
        for item in materials:
            material = RecipeMaterial(
                recipe_id=recipe.id,
                rm_name=item["rm_name"],
                quantity=item["quantity"],
            )
            db.add(material)
        db.flush()

        if add_to_product_type:
            existing_product_type = (
                db.execute(select(ProductType).where(ProductType.name == name))
                .scalars()
                .one_or_none()
            )
            if not existing_product_type:
                db.add(ProductType(name=name))

        db.flush()
        db.refresh(recipe)
        recipe = (
            db.execute(select(Recipe).options(selectinload(Recipe.materials)).where(Recipe.id == recipe.id))
            .scalars()
            .one()
        )
        return jsonify(_serialize_recipe(recipe))


# Update a recipe, including optional ID reassignment.

@config_bp.put("/recipes/<int:recipe_id>")
def update_recipe(recipe_id: int):
    try:
        payload = json_body()
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        add_to_product_type = bool(payload.get("add_to_product_type"))
        new_recipe_id = (
            _parse_recipe_id(payload.get("recipe_id"))
            if "recipe_id" in payload
            else recipe_id
        )
        materials = _parse_recipe_materials(payload.get("materials"))
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        recipe = db.get(Recipe, recipe_id)
        if not recipe:
            return error("Recipe not found", 404)

        if new_recipe_id != recipe_id:
            existing_recipe_id = db.get(Recipe, new_recipe_id)
            if existing_recipe_id:
                return error(f"Recipe ID {new_recipe_id} already exists")

        existing_recipe = (
            db.execute(
                select(Recipe).where(
                    Recipe.name == name,
                    Recipe.id != recipe_id,
                )
            )
            .scalars()
            .one_or_none()
        )
        if existing_recipe:
            return error("Recipe name already exists")

        now: datetime | None = None
        recipe_changed = False

        def _now() -> datetime:
            nonlocal now
            if now is None:
                now = app_now()
            return now

        existing_materials = list(recipe.materials)
        existing_by_name = {
            str(row.rm_name or "").strip().lower(): row
            for row in existing_materials
        }

        if new_recipe_id != recipe_id:
            recipe.id = new_recipe_id
            for row in existing_materials:
                row.recipe_id = new_recipe_id
            recipe_changed = True
        if recipe.name != name:
            recipe.name = name
            recipe_changed = True

        incoming_by_name = {
            str(item["rm_name"]).strip().lower(): item
            for item in materials
        }

        # Remove materials that are no longer part of the recipe.
        for key, row in existing_by_name.items():
            if key not in incoming_by_name:
                db.delete(row)
                recipe_changed = True

        # Update existing materials in-place to preserve created_at and track edits.
        for key, item in incoming_by_name.items():
            existing_row = existing_by_name.get(key)
            if existing_row is None:
                db.add(
                    RecipeMaterial(
                        recipe_id=recipe.id,
                        rm_name=item["rm_name"],
                        quantity=item["quantity"],
                    )
                )
                recipe_changed = True
                continue

            has_change = False
            if existing_row.rm_name != item["rm_name"]:
                existing_row.rm_name = item["rm_name"]
                has_change = True
            if existing_row.quantity != item["quantity"]:
                existing_row.quantity = item["quantity"]
                has_change = True
            if has_change:
                existing_row.last_modified_at = _now()
                recipe_changed = True
        if recipe_changed:
            recipe.last_modified_at = _now()
        db.flush()

        if add_to_product_type:
            existing_product_type = (
                db.execute(select(ProductType).where(ProductType.name == name))
                .scalars()
                .one_or_none()
            )
            if not existing_product_type:
                db.add(ProductType(name=name))

        db.flush()
        recipe = (
            db.execute(select(Recipe).options(selectinload(Recipe.materials)).where(Recipe.id == recipe.id))
            .scalars()
            .one()
        )
        return jsonify(_serialize_recipe(recipe))


# Delete a recipe and its materials.

@config_bp.delete("/recipes/<int:recipe_id>")
def delete_recipe(recipe_id: int):
    with db_session() as db:
        recipe = db.get(Recipe, recipe_id)
        if not recipe:
            return error("Recipe not found", 404)

        db.delete(recipe)

        db.flush()
        return jsonify({"id": recipe_id, "deleted": True})

