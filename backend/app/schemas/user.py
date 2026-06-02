from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


# Schema model for `UserCreate` request/response payloads.

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    company_name: Optional[str] = None
    address: Optional[str] = None


# Schema model for `UserLogin` request/response payloads.

class UserLogin(BaseModel):
    email: EmailStr
    password: str


# Schema model for `UserResponse` request/response payloads.

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    company_name: Optional[str] = None
    address: Optional[str] = None
    logo_url: Optional[str] = None
    is_active: bool
    created_at: datetime

    # Enable ORM-to-schema attribute mapping for response models.

    class Config:
        from_attributes = True


# Schema model for `Token` request/response payloads.

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
