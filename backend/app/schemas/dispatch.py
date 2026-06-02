from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# Schema model for `DispatchCreate` request/response payloads.

class DispatchCreate(BaseModel):
    date: datetime
    party_name: str
    vehicle_no: str
    quantity: float
    product_type: str
    price: Optional[float] = None


# Schema model for `DispatchResponse` request/response payloads.

class DispatchResponse(BaseModel):
    dispatch_code: str
    date: datetime
    party_name: str
    vehicle_no: str
    quantity: float
    product_type: str
    price: Optional[float] = None
    created_at: datetime

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True
