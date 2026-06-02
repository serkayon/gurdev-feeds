from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# Schema model for `RawMaterialEntryCreate` request/response payloads.

class RawMaterialEntryCreate(BaseModel):
    date: datetime
    rm_type: str
    supplier: str
    challan_no: str
    vehicle_no: str
    total_weight: float
    remarks: Optional[str] = None


# Schema model for `LabReportCreate` request/response payloads.

class LabReportCreate(BaseModel):
    entry_code: str
    protein: Optional[float] = None
    fat: Optional[float] = None
    fiber: Optional[float] = None
    ash: Optional[float] = None
    calcium: Optional[float] = None
    phosphorus: Optional[float] = None
    salt: Optional[float] = None
    moisture: Optional[float] = None
    fungus: Optional[str] = None
    broke: Optional[str] = None
    water_damage: Optional[str] = None
    small: Optional[str] = None
    dunkey: Optional[str] = None
    fm: Optional[str] = None
    maize_count: Optional[str] = None
    colour: Optional[str] = None
    smell: Optional[str] = None


# Schema model for `RawMaterialEntryResponse` request/response payloads.

class RawMaterialEntryResponse(BaseModel):
    entry_code: str
    date: datetime
    rm_type: str
    supplier: str
    challan_no: str
    vehicle_no: str
    total_weight: float
    remarks: Optional[str] = None
    has_lab_report: bool = False
    created_at: datetime
    last_modified_at: Optional[datetime] = None

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True


# Schema model for `LabReportResponse` request/response payloads.

class LabReportResponse(BaseModel):
    entry_code: str
    protein: Optional[float] = None
    fat: Optional[float] = None
    moisture: Optional[float] = None
    created_at: datetime
    last_modified_at: Optional[datetime] = None

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True
