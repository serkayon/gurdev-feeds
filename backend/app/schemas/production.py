from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# Schema model for `ProductionBatchCreate` request/response payloads.

class ProductionBatchCreate(BaseModel):
    batch_no: Optional[str] = None
    date: datetime
    product_name: str
    batch_size: float
    mop: Optional[float] = None
    water: Optional[float] = None
    num_bags: float
    weight_per_bag: float
    output: float
    recipe_id: Optional[int] = None


# Schema model for `ProductionReportCreate` request/response payloads.

class ProductionReportCreate(BaseModel):
    batch_id: int
    date: Optional[datetime] = None
    batch_no: Optional[str] = None
    batch_size: Optional[float] = None
    mop: Optional[float] = None
    water: Optional[float] = None
    num_bags: Optional[float] = None
    weight_per_bag: Optional[float] = None
    output: Optional[float] = None
    protein: Optional[float] = None
    fat: Optional[float] = None
    fiber: Optional[float] = None
    ash: Optional[float] = None
    calcium: Optional[float] = None
    phosphorus: Optional[float] = None
    salt: Optional[float] = None
    hm_retention: Optional[float] = None
    mixer_moisture: Optional[float] = None
    conditioner_moisture: Optional[float] = None
    moisture_addition: Optional[float] = None
    final_feed_moisture: Optional[float] = None
    water_activity: Optional[float] = None
    hardness: Optional[float] = None
    pellet_diameter: Optional[float] = None
    fines: Optional[float] = None


# Schema model for `ProductionBatchResponse` request/response payloads.

class ProductionBatchResponse(BaseModel):
    id: int
    batch_no: str
    date: datetime
    product_name: str
    recipe_type: Optional[str] = None
    batch_size: float
    mop: Optional[float] = None
    water: Optional[float] = None
    num_bags: Optional[float] = None
    weight_per_bag: Optional[float] = None
    output: float
    has_report: bool = False
    created_at: datetime
    last_modified_at: Optional[datetime] = None

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True


# Schema model for `ProductionReportResponse` request/response payloads.

class ProductionReportResponse(BaseModel):
    id: int
    batch_id: int
    protein: Optional[float] = None
    fat: Optional[float] = None
    fiber: Optional[float] = None
    ash: Optional[float] = None
    calcium: Optional[float] = None
    phosphorus: Optional[float] = None
    salt: Optional[float] = None
    final_feed_moisture: Optional[float] = None
    hardness: Optional[float] = None
    pellet_diameter: Optional[float] = None
    fines: Optional[float] = None
    created_at: datetime

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True
