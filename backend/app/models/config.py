from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base


# Define ProductType.

class ProductType(Base):
    __tablename__ = "feed_types"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# Define Recipe.

class Recipe(Base):
    __tablename__ = "recipe_types"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    materials: Mapped[list["RecipeMaterial"]] = relationship(
        "RecipeMaterial",
        back_populates="recipe",
        cascade="all, delete-orphan",
    )


# Define RecipeMaterial.

class RecipeMaterial(Base):
    __tablename__ = "recipe_materials"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipe_types.id", onupdate="CASCADE"))
    rm_name: Mapped[str] = mapped_column(String(120))
    quantity: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="materials")
