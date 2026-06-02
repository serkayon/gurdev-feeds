# Poultry ERP - Complete Project Documentation

This document explains the full project in simple language so that even a college student can:

1. Understand what the system does.
2. Understand how data moves page to page.
3. Understand backend APIs and database design.
4. Build a similar system by following this as a reference.

---

## How To Read This Document

1. Start with **Section 3 and Section 4** for architecture and flow.
2. Read **Section 6** for table structures.
3. Read **Section 7** to see which page uses which APIs.
4. Use **Section 12** as the single source of truth for all APIs (endpoint-by-endpoint).
5. Use **Section 15** if you want plain rectangle-arrow diagrams in text format.

---

## 1) Project Overview

This is a **Poultry Feed Mill ERP + Runtime Monitoring** system.

It has:

1. A React frontend (`frontend/`) for business users.
2. A FastAPI backend (`backend/app/`) for APIs and business logic.
3. A PostgreSQL database for all records and ledgers.
4. A small HMI dashboard (`backend/HMI/`) for machine/process controls.
5. A PLC data simulator service that continuously writes live sensor data when process is ON.

Main business modules:

1. Raw Material inward + lab report.
2. Production batch planning and reports.
3. Dispatch finished feed.
4. Stock ledgers (Raw material and feed stock).
5. Settings (types, recipes, PIN controls).
6. Dashboard (live machine + daily KPI + charts).

---

## 2) Tech Stack

#### Frontend

1. React 18 + Vite
2. Tailwind CSS
3. Axios
4. Recharts

#### Backend

1. FastAPI
2. SQLAlchemy ORM
3. PostgreSQL
4. JWT auth (token creation/verification)
5. ReportLab/OpenPyXL/CSV exports

---

## 3) High-Level Architecture

```mermaid
flowchart LR
    U[User] --> FE[React Frontend]
    FE -->|HTTP /api/*| BE[FastAPI Backend]
    BE --> DB[(PostgreSQL)]
    BE --> EX[PDF/Excel/CSV Export Utils]
    HMI[HMI Web App] -->|HTTP /api/*| BE
    PLCBG[PLC Background Writer Thread] --> DB
    BE --> PLCBG
```

### Request Lifecycle

```mermaid
sequenceDiagram
    participant UI as Frontend Page
    participant API as FastAPI Route
    participant S as Service Layer
    participant DB as PostgreSQL

    UI->>API: Request (JSON/query)
    API->>S: Validate + business rules
    S->>DB: Insert/Update/Select
    DB-->>S: Rows
    S-->>API: Final payload
    API-->>UI: JSON / file (pdf,xlsx,csv)
```

---

## 4) Core Business Flows

### 4.1 Raw Material Flow

```mermaid
flowchart TD
    A[Add RM Entry] --> B[raw_material_entries]
    B --> C[Rebuild RM Stock Ledger]
    C --> D[rm_stock_ledger updated]
    A --> E[Optional Lab Report]
    E --> F[raw_material_lab_reports]
```

### 4.2 Production Flow

```mermaid
flowchart TD
    A[Create Batch] --> B[production_batches]
    A --> C[production_batch_materials]
    C --> D[Consume RM from rm_stock_ledger]
    A --> E[Produce Feed to feed_stock]
    A --> F[Optional Production Report]
    F --> G[production_reports]
```

### 4.3 Dispatch Flow

```mermaid
flowchart TD
    A[Create Dispatch Entry] --> B[dispatch_entries]
    A --> C[dispatch_products]
    C --> D[Dispatch quantity deducted from feed_stock]
```

### 4.4 PLC/HMI Runtime Flow

```mermaid
flowchart TD
    A[Machine Start] --> B[machine_state.is_running=true]
    B --> C[PLC writer inserts plc_data_snapshots every few seconds]
    B --> D[Active batch progress sync]
    D --> E[When complete: finalize batch state]
    E --> F[Post stock + rebuild RM ledger]
```

---

## 5) Backend Module Structure (Quick Map)

| Module | Responsibility |
|---|---|
| `backend/app/factory.py` | Creates FastAPI app, CORS, DB init, starts PLC writer |
| `backend/app/database.py` | SQLAlchemy engine/session, table create, seed + migration helpers |
| `backend/app/api/routes/*.py` | All APIs grouped by feature |
| `backend/app/models/*.py` | Database table models |
| `backend/app/services/stock.py` | Ledger updates and stock validation |
| `backend/app/services/production_runtime.py` | Runtime batch progression/finalization rules |
| `backend/app/services/plc_simulator.py` | PLC data generation and machine state helpers |
| `backend/app/utils/export.py` | PDF/Excel/CSV generation |
| `backend/HMI/app.py` | Separate HMI dashboard calling backend APIs |

---

## 6) Database Table Structure

Below are the main tables and key columns.

### `users`

| Column | Type | Purpose |
|---|---|---|
| `id` | int PK | User ID |
| `email` | string unique | Login email |
| `password` | string | Password (currently plain text storage in code) |
| `role` | string | `vendor` or `customer` |
| `full_name` | string | User name |
| `company_name` | string nullable | Company |
| `address` | string nullable | Address |
| `is_active` | bool | Enable/disable login |
| `settings_pin_hash` + scoped pin columns | string | 4-digit PIN values for guarded actions |
| `created_by_id` | int nullable | Vendor who created customer |
| `created_at` / `updated_at` | datetime | Audit |

### `raw_material_types`

| Column | Type |
|---|---|
| `id` (PK) | int |
| `name` | string unique |
| `created_at` | datetime |
| `last_modified_at` | datetime nullable |

### `raw_material_entries`

| Column | Type |
|---|---|
| `id` (PK) | int |
| `client_id` | int |
| `date` | datetime |
| `rm_type` | string |
| `supplier` | string |
| `challan_no` | string |
| `vehicle_no` | string |
| `total_weight` | float |
| `remarks` | text nullable |
| `created_at` / `last_modified_at` | datetime |

### `raw_material_lab_reports`

| Column | Type |
|---|---|
| `id` (PK) | int |
| `entry_id` (unique FK) | int |
| Chemical fields | float nullable |
| Maize-specific fields | string nullable |
| `created_at` | datetime |

### `product_types`

| Column | Type |
|---|---|
| `id` | int PK |
| `name` | string unique |
| `created_at` | datetime |
| `last_modified_at` | datetime nullable |

### `recipes`

| Column | Type |
|---|---|
| `id` | int PK |
| `name` | string unique |
| `created_at` | datetime |
| `last_modified_at` | datetime nullable |

### `recipe_materials`

| Column | Type |
|---|---|
| `id` | int PK |
| `recipe_id` FK | int |
| `rm_name` | string |
| `quantity` | float (per batch/run) |
| `created_at` | datetime |

### `production_batches`

| Column | Type |
|---|---|
| `id` | int PK |
| `client_id` | int |
| `batch_no` | string nullable |
| `date` | datetime |
| `product_name` | string |
| `batch_size` | float |
| `mop` / `water` | float nullable |
| `num_bags` / `weight_per_bag` | float nullable |
| `output` | float |
| `recipe_id` | int nullable |
| `hmi_duration_seconds` | float nullable |
| `hmi_completed_count` | int |
| `hmi_status` | string (`pending/running/stopped/completed`) |
| `hmi_started_at` / `hmi_completed_at` | datetime nullable |
| `stock_posted` | bool |
| `rm_shortage_flag` | bool |
| `rm_shortage_detail` | text nullable |
| `created_at` / `last_modified_at` | datetime |

### `production_batch_materials`

| Column | Type |
|---|---|
| `id` | int PK |
| `batch_id` FK | int |
| `rm_name` | string |
| `quantity` | float |
| `created_at` | datetime |

### `production_reports`

| Column | Type |
|---|---|
| `id` | int PK |
| `batch_id` unique FK | int |
| Nutrition and physical fields | float nullable |
| `created_at` | datetime |

### `dispatch_entries`

| Column | Type |
|---|---|
| `id` | int PK |
| `client_id` | int |
| `date` | datetime |
| `party_name` | string |
| `party_phone` / `party_address` / `pincode` | string nullable |
| `vehicle_no` | string |
| `price` | float nullable |
| `created_at` / `last_modified_at` | datetime |

### `dispatch_products`

| Column | Type |
|---|---|
| `id` | int PK |
| `dispatch_id` FK | int |
| `product_type` | string |
| `num_bags` | float |
| `weight_per_bag` | float |
| `total_weight` | float |

### `rm_stock_ledger`

| Column | Type |
|---|---|
| `id` | int PK |
| `client_id` | int |
| `date` | datetime (day bucket) |
| `rm_name` | string |
| `opening_stock` | float |
| `received` | float |
| `consumption` | float |
| `closing_stock` | float |
| `created_at` | datetime |

### `feed_stock`

| Column | Type |
|---|---|
| `id` | int PK |
| `client_id` | int |
| `date` | datetime (day bucket) |
| `feed_type` | string |
| `bag_weight_grams` | int nullable |
| `opening_stock` | float |
| `produced` | float |
| `dispatched` | float |
| `closing_stock` | float |
| `created_at` | datetime |

### `plc_data_snapshots`

| Column | Type |
|---|---|
| `id` | int PK |
| `client_id` | int nullable |
| `running_status` | bool |
| `process_status` | int |
| Sensor columns | float nullable |
| `recorded_at` | datetime |

### `machine_state`

| Column | Type |
|---|---|
| `id` | int PK (single row, usually `1`) |
| `is_running` | bool |
| `active_batch_id` | int nullable |
| `updated_at` | datetime |

---

## 7) UI Pages and API Used (Ordered by Navigation)

### 7.1 `/` Client Login Page

APIs:

1. `POST /api/auth/login`

Flow:

1. User enters email/password.
2. Backend verifies user.
3. Frontend accepts only `customer` role here.
4. JWT stored in localStorage and user goes to `/layout`.

### 7.2 Layout Wrapper (background poller)

APIs:

1. `GET /api/production/batches` every 10 seconds (notification logic).

Flow:

1. Checks for new batches, completed batches, shortage flags.
2. Shows notification prompts to complete details/report.

### 7.3 Dashboard Page (`/layout`)

APIs:

1. `GET /api/stock/rm`
2. `GET /api/stock/feed?date=YYYY-MM-DD`
3. `GET /api/dispatch?from_date=...&to_date=...`
4. `GET /api/production/batches?date=YYYY-MM-DD`
5. `GET /api/plc/latest`
6. `GET /api/plc/machine/status`
7. `GET /api/plc/history?minutes=60&current_process_only=1`
8. Download APIs for RM/Dispatch/Production/Feed PDFs

Purpose:

1. Daily KPI cards.
2. Running batch info.
3. Live PLC graphs.

### 7.4 Production Page (`/layout/production`)

APIs:

1. `GET /api/config/recipes`
2. `GET /api/production/batches/filtered/{period}/{product}`
3. `GET /api/production/batches/summary/{period}/{product}`
4. `GET /api/production/batches/{id}`
5. `POST /api/production/batches`
6. `PUT /api/production/batches/{id}/details`
7. `GET /api/production/batches/{id}/mark-complete-eligibility`
8. `POST /api/production/batches/{id}/mark-complete`
9. `POST /api/production/report`
10. `GET /api/production/download`
11. `GET /api/production/{id}/download`
12. `GET /api/production/{id}/consumption/download`
13. `GET /api/stock/rm` (for available RM display)
14. `POST /api/auth/pin/verify` via PIN modal

PIN scopes used:

1. `production_details_edit`
2. `production_report_access`

### 7.5 Raw Material Page (`/layout/raw-material`)

APIs:

1. `GET /api/raw-material/filtered/{period}/{rm_type}`
2. `GET /api/raw-material/types`
3. `GET /api/stock/rm`
4. `GET /api/raw-material/summary/{period}/{rm_type}`
5. `POST /api/raw-material`
6. `PUT /api/raw-material/{id}`
7. `GET /api/raw-material/lab-report/{entry_id}`
8. `POST /api/raw-material/lab-report`
9. `GET /api/raw-material/download`
10. `GET /api/raw-material/{id}/download`
11. `POST /api/raw-material/types` (quick add type modal)
12. `POST /api/auth/pin/verify` via PIN modal

PIN scopes used:

1. `rm_entry_edit`
2. `rm_lab_edit`

### 7.6 Dispatch Page (`/layout/dispatch`)

APIs:

1. `GET /api/dispatch/filtered/{period}/{product_type}`
2. `GET /api/dispatch/summary/{period}/{product_type}`
3. `GET /api/config/product-types`
4. `GET /api/stock/feed/summary`
5. `POST /api/dispatch`
6. `PUT /api/dispatch/{id}`
7. `GET /api/dispatch/download`
8. `GET /api/dispatch/{id}/download`
9. `GET /api/dispatch/{id}/invoice`
10. `POST /api/auth/pin/verify`

PIN scope used:

1. `dispatch_edit`

### 7.7 Stock Page (`/layout/stock`)

APIs:

1. `GET /api/raw-material/types`
2. `GET /api/stock/rm/summary`
3. `GET /api/stock/feed/summary`
4. `GET /api/stock/rm/filtered/{period}`
5. `GET /api/stock/feed/filtered/{period}`
6. `GET /api/stock/download/rm`
7. `GET /api/stock/download/feed`
8. `GET /api/stock/download/overall`

### 7.8 Settings Page (`/layout/settings`)

APIs:

1. `GET /api/raw-material/types`
2. `POST /api/raw-material/types`
3. `PUT /api/raw-material/types/{id}`
4. `DELETE /api/raw-material/types/{id}`
5. `GET /api/config/product-types/manage`
6. `PUT /api/config/product-types/{id}`
7. `DELETE /api/config/product-types/{id}`
8. `GET /api/config/recipes`
9. `POST /api/config/recipes`
10. `PUT /api/config/recipes/{id}`
11. `DELETE /api/config/recipes/{id}`
12. `POST /api/auth/pin/verify`
13. `POST /api/auth/pin/change`

PIN scopes used:

1. default `settings`
2. `recipe_access`

### 7.9 HMI Page (`backend/HMI`)

APIs consumed by HMI app:

1. `GET /api/plc/machine/status`
2. `GET /api/production/batches`
3. `POST /api/plc/machine/start`
4. `POST /api/plc/machine/stop`
5. `POST /api/production/hmi/start-batch`
6. `POST /api/production/hmi/stop-active-batch`

---

## 8) API Conventions

1. Base URL in frontend client becomes `${VITE_API_URL}/api` (or uses value already ending with `/api`).
2. Dates are sent as ISO strings (often with `+05:30` from frontend).
3. Some filters support period values:
   - `today`, `last_7`, `last_15`, `last_30`, `this_month`, `custom`
4. For `custom`, pass `from_date` and `to_date`.
5. File downloads return binary blob (`pdf`, `xlsx`, `csv`).
6. JWT token is added automatically as `Authorization: Bearer <token>`.

---

## 9) Startup and Environment

### Backend

```powershell
cd backend\app
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
$env:DATABASE_URL="postgresql+psycopg://YOUR_USER:YOUR_PASSWORD@localhost:5432/poultry"
uvicorn main:app --reload --host 127.0.0.1 --port 8007
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Required frontend env:

1. `VITE_API_URL` (example: `http://127.0.0.1:8007`)

Default customer login (seeded):

1. Email: `client@gmail.com`
2. Password: `open@123`

---

## 10) Important Implementation Notes

1. Most business APIs use `DEFAULT_CLIENT_ID = 1` (single-client style).
2. RM and feed ledgers are auto-updated/rebuilt after create/update actions.
3. Production completion is controlled by RM stock validation.
4. HMI runtime can create pending/running batches and machine-linked progress.
5. Background PLC writer thread starts with backend app startup.
6. PIN guard is implemented in frontend using `auth/pin/verify`.
7. Period filtering is IST-aware in backend helper logic.

---

## 11) How to Build a Similar System (Student Guide)

If you want to create same kind of app from scratch, follow this order:

1. Create master tables first: users, raw material types, product types, recipes.
2. Build transaction tables: RM inward, production batch, dispatch.
3. Build ledger tables: RM stock and feed stock.
4. Write service functions to update ledgers on every transaction.
5. Add validation rules (stock availability, mandatory fields).
6. Create report tables (lab and production reports).
7. Build REST APIs module by module.
8. Build frontend pages in this order:
   - Login
   - Raw Material
   - Production
   - Dispatch
   - Stock
   - Dashboard
   - Settings
9. Add export utilities (pdf/excel/csv).
10. Add runtime monitoring (machine state + PLC history).

This project already follows this same pattern, so this document is your blueprint.


---

## 12) Complete API-by-API Deep Reference (All Backend APIs)

This section lists **every backend API one by one** with:

1. Exact endpoint
2. Route handler function
3. Internal helper/service functions called
4. Main tables touched
5. Sample request
6. Sample response

### API-001 `GET /api/health`
- Handler: `health()` in `backend/app/api/routes/health.py`
- What it does: Simple backend health check.
- Internal calls: `jsonify({"status":"ok"})`
- Tables touched: none
- Sample request: `GET /api/health`
- Sample response:
```json
{"status":"ok"}
```

### API-002 `POST /api/auth/login`
- Handler: `auth_login()`
- What it does: Authenticates user and returns JWT token + user profile.
- Internal calls: `json_body()`, `required()`, `db_session()`, `get_user_by_email()`, `verify_password()`, `token_response()` -> `create_access_token()` + `serialize_user()`
- Tables touched: `users`
- Sample request:
```json
{"email":"client@gmail.com","password":"open@123"}
```
- Sample response:
```json
{"access_token":"jwt-token","token_type":"bearer","user":{"id":1,"email":"client@gmail.com","role":"customer"}}
```

### API-003 `POST /api/auth/vendor-signup`
- Handler: `vendor_signup()`
- What it does: Creates a new vendor user account.
- Internal calls: `json_body()`, `required()`, `get_user_by_email()`, `hash_password()`, `serialize_user()`
- Tables touched: `users`
- Sample request:
```json
{"email":"vendor@demo.com","password":"vendor123","full_name":"Vendor User","company_name":"Demo Mill","address":"Coimbatore"}
```
- Sample response:
```json
{"id":5,"email":"vendor@demo.com","role":"vendor","full_name":"Vendor User","company_name":"Demo Mill"}
```

### API-004 `POST /api/auth/vendor/customer-signup`
- Handler: `vendor_create_customer()`
- What it does: Vendor creates customer login account.
- Internal calls: `current_user()`, role check, `get_user_by_email()`, `hash_password()`, `serialize_user()`
- Tables touched: `users`
- Sample request:
```json
{"email":"customer@demo.com","password":"cust123","full_name":"Customer A","company_name":"Farm A","address":"Erode"}
```
- Sample response:
```json
{"id":6,"email":"customer@demo.com","role":"customer","full_name":"Customer A"}
```

### API-005 `POST /api/auth/demo/vendor`
- Handler: `demo_vendor_login()`
- What it does: Returns token for pre-created demo vendor account.
- Internal calls: `get_user_by_email()`, `token_response()`
- Tables touched: `users`
- Sample request: empty body
- Sample response: same shape as login token response.

### API-006 `POST /api/auth/demo/customer`
- Handler: `demo_customer_login()`
- What it does: Returns token for pre-created demo customer account.
- Internal calls: `get_user_by_email()`, `token_response()`
- Tables touched: `users`
- Sample request: empty body
- Sample response: same shape as login token response.

### API-007 `POST /api/auth/pin/verify`
- Handler: `verify_settings_pin()`
- What it does: Verifies 4-digit PIN for selected scope.
- Internal calls: `json_body()`, `_normalize_pin_type()`, `_resolve_pin_user()`, `current_user()`
- Tables touched: `users`
- Sample request:
```json
{"pin":"1234","pin_type":"dispatch_edit"}
```
- Sample response:
```json
{"ok":true,"pin_type":"dispatch_edit"}
```

### API-008 `POST /api/auth/pin/change`
- Handler: `change_settings_pin()`
- What it does: Changes PIN for selected scope after current PIN check.
- Internal calls: `json_body()`, `_normalize_pin_type()`, `_resolve_pin_user()`
- Tables touched: `users`
- Sample request:
```json
{"current_pin":"1234","new_pin":"4321","pin_type":"settings"}
```
- Sample response:
```json
{"ok":true,"detail":"PIN updated successfully","pin_type":"settings"}
```

### API-009 `GET /api/config/product-types`
- Handler: `list_product_types()`
- What it does: Returns product type names list.
- Internal calls: `db_session()`, SQLAlchemy `select(ProductType)`
- Tables touched: `product_types`
- Sample request: `GET /api/config/product-types`
- Sample response:
```json
["Broiler Starter","Layer Mash"]
```

### API-010 `GET /api/config/product-types/manage`
- Handler: `list_product_types_manage()`
- What it does: Returns product type detailed rows.
- Internal calls: `_serialize_product_type()`
- Tables touched: `product_types`
- Sample response:
```json
[{"id":1,"name":"Broiler Starter","created_at":"2026-04-02T06:00:00Z","last_modified_at":"2026-04-02T06:00:00Z"}]
```

### API-011 `POST /api/config/product-types`
- Handler: `add_product_type()`
- What it does: Disabled route; product types are managed via recipe create/rename.
- Internal calls: `error("Product type is created from recipes...")`
- Tables touched: none
- Sample response:
```json
{"detail":"Product type is created from recipes. Add or rename recipe instead."}
```

### API-012 `PUT /api/config/product-types/{product_type_id}`
- Handler: `update_product_type(product_type_id)`
- What it does: Renames product type.
- Internal calls: `request.args.get()`, duplicate check using `func.lower()`, `_serialize_product_type()`
- Tables touched: `product_types`
- Sample request: `PUT /api/config/product-types/1?name=Broiler Finisher`
- Sample response:
```json
{"id":1,"name":"Broiler Finisher","created_at":"...","last_modified_at":"..."}
```

### API-013 `DELETE /api/config/product-types/{product_type_id}`
- Handler: `delete_product_type(product_type_id)`
- What it does: Deletes product type row.
- Internal calls: `db.get(ProductType, id)`
- Tables touched: `product_types`
- Sample response:
```json
{"id":1,"deleted":true}
```

### API-014 `GET /api/config/recipes`
- Handler: `list_recipes()`
- What it does: Lists recipes with material rows.
- Internal calls: `selectinload(Recipe.materials)`, `_serialize_recipe()`
- Tables touched: `recipes`, `recipe_materials`
- Sample response:
```json
[{"id":2,"name":"Broiler Starter","materials":[{"id":8,"rm_name":"MAIZE","quantity":55.0}]}]
```

### API-015 `POST /api/config/recipes`
- Handler: `add_recipe()`
- What it does: Creates recipe + recipe materials and syncs `product_types`.
- Internal calls: `json_body()`, `_parse_recipe_materials()`, duplicate checks, `_serialize_recipe()`
- Tables touched: `recipes`, `recipe_materials`, `product_types`
- Sample request:
```json
{"name":"Broiler Starter","materials":[{"rm_name":"MAIZE","quantity":55},{"rm_name":"SOYA","quantity":25}]}
```
- Sample response: recipe object with created materials.

### API-016 `PUT /api/config/recipes/{recipe_id}`
- Handler: `update_recipe(recipe_id)`
- What it does: Updates recipe name/materials and ensures product type exists.
- Internal calls: `_parse_recipe_materials()`, delete old materials, insert new, `_serialize_recipe()`
- Tables touched: `recipes`, `recipe_materials`, `product_types`
- Sample request:
```json
{"name":"Broiler Starter Updated","materials":[{"rm_name":"MAIZE","quantity":54},{"rm_name":"SOYA","quantity":26}]}
```
- Sample response: updated recipe object.

### API-017 `DELETE /api/config/recipes/{recipe_id}`
- Handler: `delete_recipe(recipe_id)`
- What it does: Deletes recipe row (and cascade materials).
- Internal calls: `db.get(Recipe, id)`
- Tables touched: `recipes`, `recipe_materials`
- Sample response:
```json
{"id":2,"deleted":true}
```

### API-018 `GET /api/raw-material/types`
- Handler: `list_rm_types()`
- What it does: Returns raw material type master data.
- Internal calls: `select(RawMaterialType)`
- Tables touched: `raw_material_types`
- Sample response:
```json
[{"id":1,"name":"MAIZE","created_at":"...","last_modified_at":"..."}]
```

### API-019 `POST /api/raw-material/types`
- Handler: `add_rm_type()`
- What it does: Adds new raw material type from query param.
- Internal calls: `request.args.get("name")`, duplicate check, insert
- Tables touched: `raw_material_types`
- Sample request: `POST /api/raw-material/types?name=RICE_BRAN`
- Sample response:
```json
{"id":7,"name":"RICE_BRAN","created_at":"...","last_modified_at":"..."}
```

### API-020 `PUT /api/raw-material/types/{type_id}`
- Handler: `update_rm_type(type_id)`
- What it does: Renames RM type and propagates rename to dependent tables.
- Internal calls: updates related rows in `RecipeMaterial`, `RawMaterialEntry`, `ProductionBatchMaterial`, `RMStockLedger`
- Tables touched: `raw_material_types`, `recipe_materials`, `raw_material_entries`, `production_batch_materials`, `rm_stock_ledger`
- Sample request: `PUT /api/raw-material/types/1?name=MAIZE_YELLOW`
- Sample response:
```json
{"id":1,"name":"MAIZE_YELLOW","created_at":"...","last_modified_at":"..."}
```

### API-021 `DELETE /api/raw-material/types/{type_id}`
- Handler: `delete_rm_type(type_id)`
- What it does: Deletes RM type if not used in recipes.
- Internal calls: recipe usage check on `RecipeMaterial`
- Tables touched: `raw_material_types`, `recipe_materials` (read)
- Sample response:
```json
{"id":7,"deleted":true}
```

### API-022 `GET /api/raw-material`
- Handler: `list_raw_material_entries()`
- What it does: Lists RM entries with optional date/rm_type filtering.
- Internal calls: `parse_datetime()`, `serialize_raw_entry()`, lab report existence check
- Tables touched: `raw_material_entries`, `raw_material_lab_reports`
- Sample request: `GET /api/raw-material?from_date=2026-04-01T00:00:00Z&to_date=2026-04-02T23:59:59Z&rm_type=MAIZE`
- Sample response: array of serialized RM entries.

### API-023 `GET /api/raw-material/filtered/{period}/{rm_type}`
- Handler: `list_raw_material_entries_by_period(period, rm_type)`
- What it does: Period-based filtered listing (`today`, `last_7`, `custom`, etc.).
- Internal calls: `resolve_period_range()`, `_normalize_filter_token()`
- Tables touched: `raw_material_entries`, `raw_material_lab_reports`
- Sample request: `GET /api/raw-material/filtered/last_7/all`
- Sample response: array of serialized RM entries.

### API-024 `GET /api/raw-material/summary/{period}/{rm_type}`
- Handler: `summarize_raw_material_by_period(period, rm_type)`
- What it does: Returns total received and total stock for selected period/type.
- Internal calls: `resolve_period_range()`, aggregates from RM entries + latest closing stock from RM ledger
- Tables touched: `raw_material_entries`, `rm_stock_ledger`
- Sample response:
```json
{"period":"this_month","rm_type":"all","from_date":"...","to_date":"...","total_received_kg":42000.0,"total_stock_kg":17500.0}
```

### API-025 `POST /api/raw-material`
- Handler: `create_raw_material_entry()`
- What it does: Creates inward RM entry and rebuilds RM stock ledger.
- Internal calls: `json_body()`, `required()`, `parse_datetime()`, `parse_float()`, `rebuild_rm_stock_ledger()`
- Tables touched: `raw_material_entries`, `rm_stock_ledger`
- Sample request:
```json
{"date":"2026-04-02T10:00:00+05:30","rm_type":"MAIZE","supplier":"ABC","challan_no":"CH1","vehicle_no":"TN01","total_weight":2000,"remarks":"Lot 5"}
```
- Sample response: serialized created RM entry.

### API-026 `PUT /api/raw-material/{entry_id}`
- Handler: `update_raw_material_entry(entry_id)`
- What it does: Updates RM inward entry and rebuilds RM ledger.
- Internal calls: validators + `rebuild_rm_stock_ledger()`
- Tables touched: `raw_material_entries`, `rm_stock_ledger`, `raw_material_lab_reports` (existence read)
- Sample request: same as create, with updated values.
- Sample response: serialized updated entry.

### API-027 `POST /api/raw-material/lab-report`
- Handler: `submit_raw_material_lab_report()`
- What it does: Creates or updates lab report for RM entry.
- Internal calls: `parse_float()` for numeric fields
- Tables touched: `raw_material_entries`, `raw_material_lab_reports`
- Sample request:
```json
{"entry_id":22,"protein":9.5,"fat":4.1,"moisture":11.0,"fungus":"No"}
```
- Sample response:
```json
{"id":11,"entry_id":22}
```

### API-028 `GET /api/raw-material/lab-report/{entry_id}`
- Handler: `get_raw_material_lab_report(entry_id)`
- What it does: Gets lab report by RM entry ID.
- Internal calls: `_serialize_lab_report()`
- Tables touched: `raw_material_entries`, `raw_material_lab_reports`
- Sample response:
```json
{"entry_id":22,"report":{"id":11,"entry_id":22,"protein":9.5,"fat":4.1}}
```

### API-029 `GET /api/raw-material/download`
- Handler: `download_raw_material()`
- What it does: Exports RM report by filters in `pdf/csv/xlsx`.
- Internal calls: `parse_datetime()`, `export_table_to_pdf()`, `export_table_to_csv()`, `export_table_to_excel()`
- Tables touched: `raw_material_entries`
- Sample request: `GET /api/raw-material/download?format=pdf&from_date=...&to_date=...&rm_type=MAIZE&q=abc`
- Sample response: binary file (`application/pdf` or csv/xlsx).

### API-030 `GET /api/raw-material/{entry_id}/download`
- Handler: `download_raw_material_entry(entry_id)`
- What it does: Exports single RM entry detail + lab report.
- Internal calls: `export_multi_table_to_pdf()` or `export_table_to_excel()`
- Tables touched: `raw_material_entries`, `raw_material_lab_reports`
- Sample request: `GET /api/raw-material/22/download?format=pdf`
- Sample response: binary file.

### API-031 `GET /api/dispatch`
- Handler: `list_dispatch_entries()`
- What it does: Lists dispatch entries with product lines.
- Internal calls: `parse_datetime()`, `selectinload(DispatchEntry.products)`, `_serialize_dispatch()`
- Tables touched: `dispatch_entries`, `dispatch_products`
- Sample request: `GET /api/dispatch?from_date=...&to_date=...&product_type=Broiler%20Starter`
- Sample response: array of dispatch entries.

### API-032 `GET /api/dispatch/filtered/{period}/{product_type}`
- Handler: `list_dispatch_entries_by_period(period, product_type)`
- What it does: Period filter + optional product filter.
- Internal calls: `resolve_period_range()`, `_normalize_filter_token()`
- Tables touched: `dispatch_entries`, `dispatch_products`
- Sample request: `GET /api/dispatch/filtered/last_7/all`
- Sample response: array of dispatch entries.

### API-033 `GET /api/dispatch/summary/{period}/{product_type}`
- Handler: `summarize_dispatch_by_period(period, product_type)`
- What it does: Returns finished goods produced vs dispatched totals.
- Internal calls: `resolve_period_range()`, feed produced sum from `FeedStock`
- Tables touched: `dispatch_entries`, `dispatch_products`, `feed_stock`
- Sample response:
```json
{"period":"this_month","product_type":"all","from_date":"...","to_date":"...","total_finished_goods_kg":84000.0,"total_dispatched_kg":62000.0}
```

### API-034 `POST /api/dispatch`
- Handler: `create_dispatch_entry()`
- What it does: Creates dispatch with multiple products and deducts feed stock.
- Internal calls: `_parse_dispatch_products()`, product type validation, `add_feed_dispatched()`
- Tables touched: `dispatch_entries`, `dispatch_products`, `product_types`, `feed_stock`
- Sample request:
```json
{"date":"2026-04-02T13:30:00+05:30","party_name":"Green Farm","party_phone":"9876543210","party_address":"Salem","pincode":"636001","vehicle_no":"TN22AA1111","price":34.5,"products":[{"product_type":"Broiler Starter","num_bags":60,"weight_per_bag":50}]}
```
- Sample response: serialized dispatch entry with `products`, `total_bags`, `total_weight`.

### API-035 `PUT /api/dispatch/{entry_id}`
- Handler: `update_dispatch_entry(entry_id)`
- What it does: Updates dispatch and fully rebuilds feed ledger.
- Internal calls: `_parse_dispatch_products()`, `rebuild_feed_stock_ledger()`
- Tables touched: `dispatch_entries`, `dispatch_products`, `product_types`, `feed_stock`
- Sample request: same as create with edited values.
- Sample response: updated serialized dispatch entry.

### API-036 `DELETE /api/dispatch/{entry_id}`
- Handler: `delete_dispatch_entry(entry_id)`
- What it does: Deletes dispatch and rebuilds feed ledger.
- Internal calls: `rebuild_feed_stock_ledger()`
- Tables touched: `dispatch_entries`, `dispatch_products`, `feed_stock`
- Sample response:
```json
{"id":71,"deleted":true}
```

### API-037 `GET /api/dispatch/download`
- Handler: `download_dispatch()`
- What it does: Exports dispatch report in `pdf/csv/xlsx`.
- Internal calls: export helper functions
- Tables touched: `dispatch_entries`, `dispatch_products`
- Sample request: `GET /api/dispatch/download?format=xlsx&from_date=...&to_date=...`
- Sample response: binary file.

### API-038 `GET /api/dispatch/{entry_id}/download`
- Handler: `download_single_dispatch_entry(entry_id)`
- What it does: Exports one dispatch row with line details and totals.
- Internal calls: `export_table_to_pdf/csv/excel`
- Tables touched: `dispatch_entries`, `dispatch_products`
- Sample request: `GET /api/dispatch/71/download?format=pdf`
- Sample response: binary file.

### API-039 `GET /api/dispatch/{entry_id}/invoice`
- Handler: `download_invoice(entry_id)`
- What it does: Generates invoice PDF.
- Internal calls: `generate_invoice_pdf(entry, entry.products)`
- Tables touched: `dispatch_entries`, `dispatch_products`
- Sample request: `GET /api/dispatch/71/invoice`
- Sample response: PDF binary.

### API-040 `GET /api/production/hmi/batch-no/suggest`
- Handler: `suggest_hmi_batch_no()`
- What it does: Suggests next batch no like `BATCH00031`.
- Internal calls: `_suggest_next_hmi_batch_no()`
- Tables touched: `production_batches`
- Sample response:
```json
{"batch_no":"BATCH00031"}
```

### API-041 `GET /api/production/batches`
- Handler: `list_batches()`
- What it does: Lists production batches with active status and report flag.
- Internal calls: `parse_datetime()`, `get_or_create_machine_state()`, `sync_active_batch_progress()`, `try_post_batch_stock()`, `serialize_batch()`
- Tables touched: `production_batches`, `production_reports`, `machine_state`, `feed_stock` (via posting)
- Sample request: `GET /api/production/batches?date=2026-04-02T00:00:00+05:30`
- Sample response: array of serialized batch objects.

### API-042 `GET /api/production/batches/filtered/{period}/{product_name}`
- Handler: `list_batches_by_period(period, product_name)`
- What it does: Period-based filtered batch list.
- Internal calls: `resolve_period_range()`, `_normalize_filter_token()`, runtime sync helpers
- Tables touched: `production_batches`, `production_reports`, `machine_state`
- Sample request: `GET /api/production/batches/filtered/last_7/all`
- Sample response: array of serialized batches.

### API-043 `GET /api/production/batches/summary/{period}/{product_name}`
- Handler: `summarize_batches_by_period(period, product_name)`
- What it does: Returns total batch count and total produced kg for period.
- Internal calls: `resolve_period_range()`, runtime sync helpers
- Tables touched: `production_batches`, `machine_state`
- Sample response:
```json
{"period":"this_month","product_name":"all","from_date":"...","to_date":"...","total_batches":18,"total_production_kg":84000.0}
```

### API-044 `POST /api/production/batches`
- Handler: `create_batch()`
- What it does: Creates manual completed batch, consumes RM stock, adds feed stock.
- Internal calls: `_parse_bag_output_fields()`, `_batch_no_exists()`, recipe resolution, `_parse_materials()`, `collect_rm_shortages()`, `format_rm_shortage_message()`, `add_rm_consumption()`, `add_feed_produced()`, `serialize_batch()`
- Tables touched: `production_batches`, `production_batch_materials`, `recipes`, `rm_stock_ledger`, `feed_stock`
- Sample request:
```json
{"batch_no":"PB-2402","date":"2026-04-02T10:00:00+05:30","product_name":"Broiler Starter","recipe_id":2,"batch_size":5,"mop":2.5,"water":1.2,"num_bags":100,"weight_per_bag":50,"output":5000,"materials":[{"rm_name":"MAIZE","quantity":55},{"rm_name":"SOYA","quantity":25}]}
```
- Sample response: serialized batch + `materials`.

### API-045 `POST /api/production/hmi/batches`
- Handler: `create_hmi_batch()`
- What it does: Creates pending HMI batch (not started running yet).
- Internal calls: `_parse_hmi_batch_count()`, `_parse_hmi_duration()`, `_resolve_hmi_recipe_identity()`, `_suggest_next_hmi_batch_no()`, `_collect_recipe_material_payload()`
- Tables touched: `production_batches`, `production_batch_materials`, `recipes`
- Sample request:
```json
{"batch_no":"BATCH00031","batch_count":5,"duration_per_count_seconds":120,"recipe_id":2,"date":"2026-04-02T11:00:00+05:30"}
```
- Sample response: serialized batch with `run_status: pending`.

### API-046 `POST /api/production/hmi/start-batch`
- Handler: `start_hmi_batch()`
- What it does: Starts new running batch when machine process is ON.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, `_resolve_hmi_recipe_identity()`, `collect_rm_shortages()`, `format_rm_shortage_message()`, `_suggest_next_hmi_batch_no()`
- Tables touched: `machine_state`, `production_batches`, `production_batch_materials`, `recipes`
- Sample request:
```json
{"batch_no":"BATCH00032","batch_count":5,"duration_per_count_seconds":120,"recipe_id":2,"date":"2026-04-02T11:20:00+05:30"}
```
- Sample response: serialized batch with `run_status: running`, `is_active: true`.

### API-047 `POST /api/production/hmi/stop-active-batch`
- Handler: `stop_hmi_active_batch()`
- What it does: Stops active HMI batch and finalizes runtime consumption state.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, `finalize_batch_runtime_state()`
- Tables touched: `machine_state`, `production_batches`, `rm_stock_ledger`
- Sample request: empty JSON body
- Sample response: serialized stopped/completed batch.

### API-048 `POST /api/production/batches/{batch_id}/mark-complete`
- Handler: `mark_batch_complete(batch_id)`
- What it does: Marks pending/stopped batch complete after RM eligibility check.
- Internal calls: `evaluate_mark_complete_eligibility()`, `finalize_batch_runtime_state()`, `try_post_batch_stock()`
- Tables touched: `production_batches`, `machine_state`, `rm_stock_ledger`, `feed_stock`
- Sample request: empty JSON body
- Sample response:
```json
{"batch":{"id":101,"run_status":"completed","stock_posted":true}}
```

### API-049 `GET /api/production/batches/{batch_id}/mark-complete-eligibility`
- Handler: `get_mark_complete_eligibility(batch_id)`
- What it does: Returns if mark-complete is allowed and why.
- Internal calls: `evaluate_mark_complete_eligibility()`
- Tables touched: `production_batches`, `machine_state`, `production_batch_materials`, `rm_stock_ledger`
- Sample response:
```json
{"allowed":true,"detail":null}
```

### API-050 `GET /api/production/batches/{batch_id}`
- Handler: `get_batch(batch_id)`
- What it does: Returns batch detail, report detail, and material lines.
- Internal calls: runtime sync helpers, `serialize_batch()`, `serialize_report()`, `serialize_batch_material()`
- Tables touched: `production_batches`, `production_reports`, `production_batch_materials`, `machine_state`
- Sample response:
```json
{"batch":{"id":101,"batch_no":"PB-2402"},"report":{"id":31,"batch_id":101,"protein":20.5},"materials":[{"id":333,"batch_id":101,"rm_name":"MAIZE","quantity":55}]}
```

### API-051 `PUT /api/production/batches/{batch_id}/details`
- Handler: `update_batch_details(batch_id)`
- What it does: Updates batch details/materials/output and optionally rebuilds RM ledger.
- Internal calls: `_parse_batch_no()`, `_batch_no_exists()`, `parse_datetime()`, `parse_float()`, `_parse_materials()`, `rebuild_rm_stock_ledger()`, `try_post_batch_stock()`
- Tables touched: `production_batches`, `production_batch_materials`, `rm_stock_ledger`, `feed_stock`, `recipes`, `product_types`
- Sample request:
```json
{"product_name":"Broiler Starter","batch_size":5,"mop":2.6,"water":1.3,"num_bags":100,"weight_per_bag":50,"output":5000,"materials":[{"rm_name":"MAIZE","quantity":55},{"rm_name":"SOYA","quantity":25}]}
```
- Sample response:
```json
{"batch":{"id":101,"stock_posted":true},"materials":[{"id":333,"rm_name":"MAIZE","quantity":55}],"stock_posted":true}
```

### API-052 `POST /api/production/report`
- Handler: `submit_production_report()`
- What it does: Creates/updates production quality report for batch.
- Internal calls: `required()`, `parse_float()` for report fields
- Tables touched: `production_batches`, `production_reports`
- Sample request:
```json
{"batch_id":101,"protein":20.5,"fat":4.2,"fiber":3.1,"hardness":7.5,"fines":1.2}
```
- Sample response:
```json
{"id":31,"batch_id":101,"stock_posted":true}
```

### API-053 `GET /api/production/consumption`
- Handler: `consumption_report()`
- What it does: Returns per-batch RM consumption lines + total line.
- Internal calls: `resolve_effective_batch_run_count()`
- Tables touched: `production_batches`, `production_batch_materials`
- Sample request: `GET /api/production/consumption?from_date=...&to_date=...`
- Sample response:
```json
[{"batch_id":101,"batch_no":"PB-2402","date":"2026-04-02","product_name":"Broiler Starter","rm_name":"MAIZE","weight_per_batch":55,"total_batch":5,"total_weight":275,"is_total":false}]
```

### API-054 `GET /api/production/download`
- Handler: `download_production()`
- What it does: Exports production report list.
- Internal calls: `export_table_to_pdf/csv/excel`
- Tables touched: `production_batches`, `production_reports`
- Sample request: `GET /api/production/download?format=pdf&from_date=...&to_date=...`
- Sample response: binary file.

### API-055 `GET /api/production/{batch_id}/download`
- Handler: `download_single_batch(batch_id)`
- What it does: Exports single batch report + PLC chart data in PDF path.
- Internal calls: `_resolve_batch_plc_window()`, `ensure_plc_live_data()`, `export_batch_report_pdf()` / table exporters
- Tables touched: `production_batches`, `production_reports`, `production_batch_materials`, `plc_data_snapshots`
- Sample request: `GET /api/production/101/download?format=pdf`
- Sample response: binary file.

### API-056 `GET /api/production/{batch_id}/consumption/download`
- Handler: `download_batch_consumption_report(batch_id)`
- What it does: Exports consumption details for a single batch.
- Internal calls: `resolve_effective_batch_run_count()`, `export_multi_table_to_pdf/excel`
- Tables touched: `production_batches`, `production_batch_materials`
- Sample request: `GET /api/production/101/consumption/download?format=xlsx`
- Sample response: binary file.

### API-057 `GET /api/plc/latest`
- Handler: `plc_latest()`
- What it does: Returns latest PLC row + running status.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, `try_post_batch_stock()`, `ensure_plc_live_data()`, `_serialize_plc_row()`
- Tables touched: `machine_state`, `plc_data_snapshots`, `production_batches`, `feed_stock`
- Sample response:
```json
{"running_status":true,"process_status":100,"ambient_temp":29.1,"humidity":64.3,"recorded_at":"2026-04-02T08:11:40Z"}
```

### API-058 `GET /api/plc/history`
- Handler: `plc_history()`
- What it does: Returns PLC history window, with optional current-process-only mode.
- Internal calls: `ensure_plc_live_data()`, `_process_status_expr()`, `_serialize_plc_history_row()`
- Tables touched: `machine_state`, `plc_data_snapshots`, `production_batches`, `feed_stock`
- Sample request: `GET /api/plc/history?minutes=60&current_process_only=1`
- Sample response: array of PLC history points.

### API-059 `GET /api/plc/machine/status`
- Handler: `machine_status()`
- What it does: Returns machine ON/OFF state and active batch payload.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, `_active_batch_payload()`, `_machine_status_payload()`
- Tables touched: `machine_state`, `production_batches`, `production_batch_materials`, `production_reports`, `plc_data_snapshots`
- Sample response:
```json
{"is_running":true,"process_status":100,"active_batch_id":101,"active_batch":{"id":101,"batch_no":"BATCH00031","run_status":"running"}}
```

### API-060 `POST /api/plc/machine/start`
- Handler: `machine_start()`
- What it does: Turns machine ON and optionally attaches/starts a pending batch.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, RM shortage check via `collect_rm_shortages()`, `set_machine_running()`, `try_post_batch_stock()`
- Tables touched: `machine_state`, `production_batches`, `production_batch_materials`, `plc_data_snapshots`, `rm_stock_ledger`, `feed_stock`
- Sample request:
```json
{"batch_id":101}
```
- Sample response: machine status payload with active batch.

### API-061 `POST /api/plc/machine/stop`
- Handler: `machine_stop()`
- What it does: Turns machine OFF and finalizes active batch if needed.
- Internal calls: `get_or_create_machine_state()`, `sync_active_batch_progress()`, `finalize_batch_runtime_state()`, `set_machine_running()`
- Tables touched: `machine_state`, `production_batches`, `plc_data_snapshots`, `rm_stock_ledger`
- Sample request: empty body
- Sample response: machine status payload with `is_running:false`.

### API-062 `GET /api/stock/rm`
- Handler: `get_rm_stock()`
- What it does: Returns RM day-ledger rows.
- Internal calls: `parse_datetime()`, `dt()`
- Tables touched: `rm_stock_ledger`
- Sample request: `GET /api/stock/rm?date=2026-04-02T00:00:00+05:30`
- Sample response:
```json
[{"date":"2026-04-02T00:00:00Z","rm_name":"MAIZE","opening_stock":10000,"received":2000,"consumption":1200,"closing_stock":10800}]
```

### API-063 `GET /api/stock/rm/filtered/{period}`
- Handler: `get_rm_stock_by_period(period)`
- What it does: Period-filtered RM ledger rows.
- Internal calls: `_normalize_stock_period()`, `resolve_period_range()`
- Tables touched: `rm_stock_ledger`
- Sample request: `GET /api/stock/rm/filtered/last_7`
- Sample response: array of RM ledger rows.

### API-064 `GET /api/stock/rm/summary`
- Handler: `rm_summary()`
- What it does: Latest closing stock per RM type.
- Internal calls: ordered RM types + latest ledger row by name
- Tables touched: `raw_material_types`, `rm_stock_ledger`
- Sample response:
```json
[{"rm_name":"MAIZE","quantity":10800},{"rm_name":"SOYA","quantity":5400}]
```

### API-065 `GET /api/stock/feed`
- Handler: `get_feed_stock()`
- What it does: Returns feed day-ledger rows with bag variant info.
- Internal calls: `_bag_weight_kg()`, `_feed_variant_name()`
- Tables touched: `feed_stock`
- Sample response:
```json
[{"date":"2026-04-02T00:00:00Z","feed_type":"Broiler Starter","bag_weight_kg":50,"feed_variant":"Broiler Starter (50kg/bag)","opening_stock":4000,"produced":5000,"dispatched":3000,"closing_stock":6000}]
```

### API-066 `GET /api/stock/feed/filtered/{period}`
- Handler: `get_feed_stock_by_period(period)`
- What it does: Period-filtered feed ledger rows.
- Internal calls: `_normalize_stock_period()`, `resolve_period_range()`
- Tables touched: `feed_stock`
- Sample request: `GET /api/stock/feed/filtered/this_month`
- Sample response: array of feed rows.

### API-067 `GET /api/stock/feed/summary`
- Handler: `feed_summary()`
- What it does: Latest closing stock per feed type + bag-size variant.
- Internal calls: grouped latest row logic using `(feed_type, bag_weight_grams)`
- Tables touched: `feed_stock`
- Sample response:
```json
[{"feed_type":"Broiler Starter","bag_weight_kg":50,"feed_variant":"Broiler Starter (50kg/bag)","quantity":6000}]
```

### API-068 `GET /api/stock/download/rm`
- Handler: `download_rm_stock()`
- What it does: Downloads RM ledger report.
- Internal calls: `export_table_to_pdf/csv/excel`
- Tables touched: `rm_stock_ledger`
- Sample request: `GET /api/stock/download/rm?format=csv&from_date=...&to_date=...`
- Sample response: binary file.

### API-069 `GET /api/stock/download/rm-summary`
- Handler: `download_rm_stock_summary()`
- What it does: Downloads current RM stock by type.
- Internal calls: summary builder + export helpers
- Tables touched: `raw_material_types`, `rm_stock_ledger`
- Sample request: `GET /api/stock/download/rm-summary?format=pdf`
- Sample response: binary file.

### API-070 `GET /api/stock/download/feed`
- Handler: `download_feed_stock()`
- What it does: Downloads feed stock ledger report.
- Internal calls: `_bag_weight_kg()`, `_feed_variant_name()`, exporters
- Tables touched: `feed_stock`
- Sample request: `GET /api/stock/download/feed?format=xlsx&from_date=...&to_date=...`
- Sample response: binary file.

### API-071 `GET /api/stock/download/overall`
- Handler: `download_overall_stock()`
- What it does: Downloads combined RM + feed stock report in one file.
- Internal calls: `export_multi_table_to_pdf()` or `export_multi_table_to_excel()`
- Tables touched: `rm_stock_ledger`, `feed_stock`
- Sample request: `GET /api/stock/download/overall?format=pdf`
- Sample response: binary file.

---

## 13) Notes on "Function Calling Flow" Inside APIs

When you asked "call this function, function does this, returns this", that exact flow in this codebase generally follows this pattern:

1. Route handler validates request (`required`, `parse_float`, `parse_datetime`).
2. Route opens DB transaction using `db_session()`.
3. Route calls service/helper functions (`collect_rm_shortages`, `add_feed_produced`, `rebuild_rm_stock_ledger`, etc.).
4. Helper functions read/write SQLAlchemy models.
5. Route serializes output using `serialize_*` functions and returns JSON or file response.

So each API above includes:

1. The route handler name.
2. The exact helper/service functions that are called by that handler.
3. The table-level impact.

---

## 14) Full Flow Chart Diagrams (End-to-End)

Use these Mermaid diagrams directly in Markdown viewers that support Mermaid.

### 15.1 Complete System End-to-End Flow

```mermaid
flowchart TD
    A[User Opens Frontend] --> B[Login Page]
    B -->|POST /api/auth/login| C[Backend Auth Route]
    C --> D[(users)]
    C --> E[JWT Token + User Profile]
    E --> F[Enter /layout]

    F --> G[Dashboard]
    F --> H[Raw Material Page]
    F --> I[Production Page]
    F --> J[Dispatch Page]
    F --> K[Stock Page]
    F --> L[Settings Page]

    G -->|GET /api/plc/latest, /api/plc/history, /api/plc/machine/status| M[PLC Routes]
    G -->|GET /api/stock/*, /api/dispatch, /api/production/batches| N[Stock/Dispatch/Production Routes]

    H -->|POST /api/raw-material| O[Raw Material Routes]
    O --> P[(raw_material_entries)]
    O -->|POST /api/raw-material/lab-report| Q[(raw_material_lab_reports)]
    O -->|rebuild_rm_stock_ledger| R[(rm_stock_ledger)]

    I -->|POST /api/production/batches| S[Production Routes]
    S --> T[(production_batches)]
    S --> U[(production_batch_materials)]
    S -->|add_rm_consumption / rebuild_rm_stock_ledger| R
    S -->|add_feed_produced| V[(feed_stock)]
    I -->|POST /api/production/report| W[(production_reports)]

    J -->|POST /api/dispatch| X[Dispatch Routes]
    X --> Y[(dispatch_entries)]
    X --> Z[(dispatch_products)]
    X -->|add_feed_dispatched / rebuild_feed_stock_ledger| V

    K -->|GET /api/stock/rm*| AA[RM Ledger Read]
    K -->|GET /api/stock/feed*| AB[Feed Ledger Read]
    AA --> R
    AB --> V

    L -->|Manage RM Types| AC[(raw_material_types)]
    L -->|Manage Product Types| AD[(product_types)]
    L -->|Manage Recipes| AE[(recipes + recipe_materials)]
    L -->|PIN verify/change| D

    AF[HMI App] -->|POST /api/plc/machine/start| M
    AF -->|POST /api/production/hmi/start-batch| S
    AF -->|POST /api/production/hmi/stop-active-batch| S

    AG[PLC Background Writer Thread] --> M
    AG -->|sync_active_batch_progress + try_post_batch_stock| S
    M --> AH[(machine_state)]
    M --> AI[(plc_data_snapshots)]
```

### 15.2 Frontend Page Navigation + API Calls Flow

```mermaid
flowchart LR
    A[/ Login /] -->|auth.login| B[/layout Dashboard/]
    B -->|polls plc + stock + dispatch + production APIs| C[Live Metrics]

    B --> D[/layout/raw-material/]
    B --> E[/layout/production/]
    B --> F[/layout/dispatch/]
    B --> G[/layout/stock/]
    B --> H[/layout/settings/]

    D -->|rawMaterial.* + stockApi.rm| I[RM Entry + Lab + Summary + Download]
    E -->|productionApi.* + configApi.recipes| J[Batch + Report + Completion + Download]
    F -->|dispatchApi.* + configApi.productTypes| K[Dispatch + Invoice + Download]
    G -->|stockApi.rmByPeriod/feedByPeriod + downloads| L[Ledger Reports]
    H -->|rawMaterial/config/auth pin APIs| M[Masters + PIN Settings]
```

### 15.3 Raw Material Detailed Flow

```mermaid
flowchart TD
    A[Create/Update RM Entry] --> B[Validate request fields]
    B --> C[Insert/Update raw_material_entries]
    C --> D[rebuild_rm_stock_ledger]
    D --> E[Delete old rm_stock_ledger rows]
    E --> F[Rebuild from all RM inward entries]
    F --> G[Apply production consumption rows]
    G --> H[Final opening/received/consumption/closing by day+rm]

    I[Submit Lab Report] --> J[Find RM entry]
    J --> K[Create/Update raw_material_lab_reports]
    K --> L[Return report id + entry_id]
```

### 15.4 Production Detailed Flow (Manual Batch)

```mermaid
flowchart TD
    A[POST /api/production/batches] --> B[Validate date/product/batch/materials/bag fields]
    B --> C[Resolve recipe + canonical product name]
    C --> D[collect_rm_shortages]
    D -->|shortage exists| E[Return error detail]
    D -->|no shortage| F[Create production_batches row]
    F --> G[Create production_batch_materials rows]
    G --> H[add_rm_consumption for each material]
    H --> I[add_feed_produced using output + bag weight]
    I --> J[set stock_posted=true]
    J --> K[Return batch + materials]
```

### 15.5 Production Runtime/HMI Flow

```mermaid
flowchart TD
    A[Machine ON from HMI or PLC route] --> B[machine_state.is_running=true]
    B --> C[Create/Start HMI batch]
    C --> D[production_batches hmi_status=running]
    D --> E[Background thread every few seconds]
    E --> F[sync_active_batch_progress]
    F --> G[Update hmi_completed_count]
    G --> H{Planned count reached?}
    H -->|No| E
    H -->|Yes| I[hmi_status=completed, hmi_completed_at set]
    I --> J[finalize_batch_runtime_state]
    J --> K[rebuild_rm_stock_ledger]
    I --> L[try_post_batch_stock]
    L --> M[add_feed_produced + stock_posted=true]
    M --> N[Batch finalized]
```

### 15.6 Dispatch + Feed Stock Flow

```mermaid
flowchart TD
    A[Create Dispatch Entry] --> B[Validate party + products]
    B --> C[Validate product types exist]
    C --> D[Insert dispatch_entries]
    D --> E[Insert dispatch_products rows]
    E --> F[For each line: add_feed_dispatched]
    F --> G[Update feed_stock ledger day+variant]
    G --> H[Return dispatch payload with totals]

    I[Update/Delete Dispatch] --> J[rebuild_feed_stock_ledger]
    J --> K[Rebuild feed stock from production outputs]
    K --> L[Apply all dispatch deductions in order]
```

### 15.7 Dashboard Live Data Flow

```mermaid
sequenceDiagram
    participant UI as Dashboard UI
    participant API as Backend API
    participant DB as PostgreSQL

    loop Every 5s
        UI->>API: GET /api/plc/latest
        UI->>API: GET /api/plc/machine/status
        UI->>API: GET /api/plc/history?minutes=60&current_process_only=1
        API->>DB: Read machine_state + plc_data_snapshots
        API-->>UI: latest row + status + chart points
    end

    loop Every 30s
        UI->>API: GET /api/stock/rm
        UI->>API: GET /api/stock/feed
        UI->>API: GET /api/dispatch
        UI->>API: GET /api/production/batches
        API->>DB: Read ledgers + transactions
        API-->>UI: KPI values
    end
```

### 15.8 API Internal Processing Flow (Generic)

```mermaid
flowchart TD
    A[HTTP Request] --> B[Route Handler]
    B --> C[Input parsing and validation]
    C --> D[Open db_session transaction]
    D --> E[Business helper/service function calls]
    E --> F[SQLAlchemy model read/write]
    F --> G[Optional ledger rebuild/posting]
    G --> H[Serialize response]
    H --> I[Return JSON or file binary]
```

---

## 15) Rectangle + Arrow Diagrams (Plain Text, No Mermaid Needed)

These are simple box-and-arrow diagrams that will display in any editor.

### 16.1 Full System Flow (Big Picture)

```text
+-------------------+         +-----------------------+         +----------------------+
|  User (Browser)   | ----->  | React Frontend (UI)   | ----->  | FastAPI Backend API  |
+-------------------+         +-----------------------+         +----------------------+
                                                                          |
                                                                          v
                                                               +----------------------+
                                                               | PostgreSQL Database  |
                                                               +----------------------+

Frontend pages:
+------------+   +--------------+   +------------+   +---------+   +----------+   +----------+
| Dashboard  |   | Raw Material |   | Production |   | Dispatch|   |  Stock   |   | Settings |
+------------+   +--------------+   +------------+   +---------+   +----------+   +----------+
      |                |                 |               |              |              |
      +----------------+-----------------+---------------+--------------+--------------+
                                       call /api/* routes
```

### 16.2 Login and Session Flow

```text
+------------------+      POST /api/auth/login      +-------------------------+
| Login Form (UI)  | ------------------------------> | auth_login()            |
+------------------+                                 +-------------------------+
                                                               |
                                                               v
                                                     +-------------------------+
                                                     | users table check       |
                                                     +-------------------------+
                                                               |
                                                               v
                                                     +-------------------------+
                                                     | JWT token returned      |
                                                     +-------------------------+
                                                               |
                                                               v
                                                     +-------------------------+
                                                     | UI stores token         |
                                                     +-------------------------+
```

### 16.3 Raw Material Flow

```text
+-----------------------+      POST /api/raw-material      +-----------------------------+
| Add RM Entry (UI)     | --------------------------------> | create_raw_material_entry() |
+-----------------------+                                   +-----------------------------+
                                                                     |
                                                                     v
                                                          +---------------------------+
                                                          | raw_material_entries      |
                                                          +---------------------------+
                                                                     |
                                                                     v
                                                          +---------------------------+
                                                          | rebuild_rm_stock_ledger() |
                                                          +---------------------------+
                                                                     |
                                                                     v
                                                          +---------------------------+
                                                          | rm_stock_ledger           |
                                                          +---------------------------+

+------------------------+   POST /api/raw-material/lab-report   +--------------------------+
| Add Lab Report (UI)    | -------------------------------------> | submit_lab_report()      |
+------------------------+                                        +--------------------------+
                                                                             |
                                                                             v
                                                                  +--------------------------+
                                                                  | raw_material_lab_reports |
                                                                  +--------------------------+
```

### 16.4 Production Flow (Manual Batch)

```text
+----------------------+       POST /api/production/batches      +---------------------+
| Create Batch (UI)    | --------------------------------------> | create_batch()      |
+----------------------+                                          +---------------------+
                                                                       |
                                                                       v
                                                             +-----------------------+
                                                             | collect_rm_shortages  |
                                                             +-----------------------+
                                                               |               |
                                                     shortage? | Yes           | No
                                                               v               v
                                                   +----------------+   +------------------------+
                                                   | return error   |   | production_batches     |
                                                   +----------------+   +------------------------+
                                                                              |
                                                                              v
                                                                    +------------------------+
                                                                    | production_batch_...   |
                                                                    +------------------------+
                                                                              |
                                                                              v
                                                                    +------------------------+
                                                                    | add_rm_consumption     |
                                                                    +------------------------+
                                                                              |
                                                                              v
                                                                    +------------------------+
                                                                    | add_feed_produced      |
                                                                    +------------------------+
                                                                              |
                                                                              v
                                                                    +------------------------+
                                                                    | response to UI         |
                                                                    +------------------------+
```

### 16.5 Production Runtime / HMI Flow

```text
+---------------------+   POST /api/plc/machine/start   +----------------------+
| HMI Start Process   | -------------------------------> | machine_start()      |
+---------------------+                                  +----------------------+
                                                                  |
                                                                  v
                                                        +----------------------+
                                                        | machine_state ON     |
                                                        +----------------------+
                                                                  |
                                                                  v
                                                        +----------------------+
                                                        | background writer    |
                                                        | sync_active_batch... |
                                                        +----------------------+
                                                                  |
                                                                  v
                                                        +----------------------+
                                                        | batch completed?     |
                                                        +----------------------+
                                                          | No            | Yes
                                                          v               v
                                                   +-------------+   +----------------------+
                                                   | keep running|   | finalize_batch_...   |
                                                   +-------------+   +----------------------+
                                                                          |
                                                                          v
                                                                +----------------------+
                                                                | rebuild RM ledger    |
                                                                +----------------------+
                                                                          |
                                                                          v
                                                                +----------------------+
                                                                | post feed stock      |
                                                                +----------------------+
```

### 16.6 Dispatch Flow

```text
+----------------------+      POST /api/dispatch        +-----------------------+
| Create Dispatch (UI) | ------------------------------> | create_dispatch_entry |
+----------------------+                                 +-----------------------+
                                                                   |
                                                                   v
                                                         +----------------------+
                                                         | dispatch_entries     |
                                                         +----------------------+
                                                                   |
                                                                   v
                                                         +----------------------+
                                                         | dispatch_products    |
                                                         +----------------------+
                                                                   |
                                                                   v
                                                         +----------------------+
                                                         | add_feed_dispatched  |
                                                         +----------------------+
                                                                   |
                                                                   v
                                                         +----------------------+
                                                         | feed_stock updated   |
                                                         +----------------------+
```

### 16.7 Stock Report Flow

```text
+------------------+      GET /api/stock/rm*        +-------------------+      +------------------+
| Stock Page (UI)  | ------------------------------> | stock RM routes    | ---> | rm_stock_ledger  |
+------------------+                                 +-------------------+      +------------------+
       |
       | GET /api/stock/feed*
       v
+-------------------+      +------------------+
| stock feed routes | ---> | feed_stock       |
+-------------------+      +------------------+
```
