from __future__ import annotations

import json
import logging
import threading
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import paho.mqtt.client as mqtt
from fastapi import FastAPI
from sqlalchemy import create_engine, text

app = FastAPI(title="N720 MQTT Listener")

ENV_FILE = Path(__file__).resolve().parent / ".env"
APP_ENV_FILE = Path(__file__).resolve().parents[1] / "app" / ".env"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(APP_ENV_FILE)
_load_dotenv(ENV_FILE)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# EMQX settings (loaded from backend/n720/.env)
MQTT_HOST = os.getenv("N720_EMQX_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("N720_EMQX_PORT", "8083"))
MQTT_TOPIC = os.getenv("N720_EMQX_TOPIC", "/demo")
MQTT_USERNAME = os.getenv("N720_EMQX_USERNAME", "")
MQTT_PASSWORD = os.getenv("N720_EMQX_PASSWORD", "")
MQTT_WS_PATH = os.getenv("N720_EMQX_WS_PATH", "/mqtt")
MQTT_KEEPALIVE = int(os.getenv("N720_EMQX_KEEPALIVE_SECONDS", "60"))
N720_BATCH_DURATION_SECONDS = _env_float("N720_BATCH_DURATION_SECONDS", 5.0)
N720_IDLE_TIMEOUT_MINUTES = _env_float("N720_IDLE_TIMEOUT_MINUTES", 10.0)
APP_TIMEZONE_NAME = os.getenv("APP_TIMEZONE", os.getenv("TIMEZONE", "Asia/Kolkata"))

# Database settings (sourced from backend/app/.env; override in backend/n720/.env if needed)
DATABASE_URL = os.getenv("DATABASE_URL")
DB_SCHEMA = os.getenv("DB_SCHEMA")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required in backend/n720/.env")
if not DB_SCHEMA:
    raise RuntimeError("DB_SCHEMA is required in backend/n720/.env")

DATA_FILE = Path(__file__).resolve().parent / "data" / "plc.json"
LOG = logging.getLogger("n720")

mqtt_client: mqtt.Client | None = None
mqtt_lock = threading.Lock()
plc_state_lock = threading.Lock()
idle_watchdog_stop = threading.Event()
idle_watchdog_thread: threading.Thread | None = None
last_process_switch: int | None = None
last_batch_switch: int | None = None
active_batch_id: int | None = None
active_process_batch_id: int | None = None
active_process_product: int | None = None
last_mqtt_message_at: datetime | None = None
last_mqtt_payload: dict[str, Any] | None = None

db_connect_args: dict[str, str] = {}
if DATABASE_URL.startswith("postgresql"):
    db_connect_args["options"] = f"-csearch_path={DB_SCHEMA} -ctimezone={APP_TIMEZONE_NAME}"
db_engine = create_engine(DATABASE_URL, connect_args=db_connect_args)


def _app_timezone():
    timezone_name = str(APP_TIMEZONE_NAME or "Asia/Kolkata").strip() or "Asia/Kolkata"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name in {"IST", "Asia/Calcutta"}:
            return timezone(timedelta(hours=5, minutes=30), name="IST")
        return ZoneInfo("Asia/Kolkata")


APP_TIMEZONE = _app_timezone()


def _app_now_aware() -> datetime:
    return datetime.now(APP_TIMEZONE)


def _idle_timeout_seconds() -> float:
    try:
        minutes = float(N720_IDLE_TIMEOUT_MINUTES)
    except (TypeError, ValueError):
        minutes = 10.0
    return max(1.0, minutes * 60.0)


def _ensure_data_file() -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text("[]", encoding="utf-8")


def _append_message(topic: str, raw_payload: str) -> None:
    _ensure_data_file()
    try:
        payload_obj: Any = json.loads(raw_payload)
    except Exception:
        payload_obj = raw_payload

    record = {
        "received_at": _app_now_aware().isoformat(),
        "topic": topic,
        "payload": payload_obj,
    }

    try:
        existing = json.loads(DATA_FILE.read_text(encoding="utf-8") or "[]")
        if not isinstance(existing, list):
            existing = []
    except Exception:
        existing = []

    existing.append(record)
    DATA_FILE.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _scaled_float(value: Any, divisor: float) -> float | None:
    parsed = _to_float(value)
    if parsed is None:
        return None
    return parsed / divisor


def _parse_process_switch(payload: dict[str, Any]) -> int:
    raw_value = payload.get("process_switch", 0)
    try:
        return 1 if int(raw_value) == 1 else 0
    except (TypeError, ValueError):
        return 0


def _parse_batch_switch(payload: dict[str, Any]) -> int:
    raw_value = payload.get("batch_switch", 0)
    try:
        return 1 if int(raw_value) == 1 else 0
    except (TypeError, ValueError):
        return 0


def _parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _batch_code_letter(source: str) -> str:
    for ch in str(source or ""):
        if ch.isalpha():
            return ch.upper()
    return "X"


def _generate_batch_code(recipe_type: str, batch_id: int) -> str:
    # Same spirit as dispatch/raw-material codes: PREFIX + LETTER + 5 digits.
    total_digits = 5
    max_numeric = 10 ** total_digits
    multiplier = 7919
    offset = 12345
    mapped = ((int(batch_id) * multiplier) + offset) % max_numeric
    return f"PB{_batch_code_letter(recipe_type)}{mapped:0{total_digits}d}"


def _upsert_machine_state(is_running: bool, active_batch: int | None = None) -> None:
    with db_engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {DB_SCHEMA}.machine_state (id, is_running, active_batch_id, updated_at)
                VALUES (1, :is_running, :active_batch_id, LOCALTIMESTAMP)
                ON CONFLICT (id) DO UPDATE
                SET is_running = EXCLUDED.is_running,
                    active_batch_id = EXCLUDED.active_batch_id,
                    updated_at = LOCALTIMESTAMP
                """
            ),
            {"is_running": is_running, "active_batch_id": active_batch},
        )


def _resolve_process_batch_id(conn, process_product: int) -> int | None:
    if process_product <= 0:
        return None

    recipe_row = conn.execute(
        text(
            f"""
            SELECT name
            FROM {DB_SCHEMA}.recipe_types
            WHERE id = :recipe_id
            LIMIT 1
            """
        ),
        {"recipe_id": process_product},
    ).mappings().first()
    recipe_name = str(recipe_row["name"] or "").strip() if recipe_row else ""
    if not recipe_name:
        recipe_name = f"Recipe {process_product}"

    batch_row = conn.execute(
        text(
            f"""
            SELECT id
            FROM {DB_SCHEMA}.production_batches
            WHERE DATE(date) = CURRENT_DATE
              AND LOWER(COALESCE(recipe_type, product_name, '')) = LOWER(:recipe_name)
              AND LOWER(COALESCE(hmi_status, '')) IN ('stopped', 'completed')
              AND NOT EXISTS (
                  SELECT 1
                  FROM {DB_SCHEMA}.plc_data_snapshots existing_snapshots
                  WHERE existing_snapshots.batch_id = production_batches.id
                  LIMIT 1
              )
            ORDER BY COALESCE(hmi_completed_at, last_modified_at, created_at, date) ASC, id ASC
            LIMIT 1
            """
        ),
        {"recipe_name": recipe_name},
    ).mappings().first()
    return int(batch_row["id"]) if batch_row else None


def _insert_plc_snapshot(payload: dict[str, Any], process_status: int, batch_id: int | None = None) -> None:
    process_product = _parse_int(payload.get("Process_Product"), 0)
    with db_engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {DB_SCHEMA}.plc_data_snapshots (
                    running_status,
                    process_status,
                    process_product,
                    batch_id,
                    ambient_temp,
                    humidity,
                    pressure_before,
                    pressure_after,
                    conditioner_temp,
                    bagging_temp,
                    motor_temp,
                    motor_rpm,
                    pellet_feeder_speed,
                    pellet_motor_load,
                    recorded_at
                ) VALUES (
                    :running_status,
                    :process_status,
                    :process_product,
                    :batch_id,
                    :ambient_temp,
                    :humidity,
                    :pressure_before,
                    :pressure_after,
                    :conditioner_temp,
                    :bagging_temp,
                    :motor_temp,
                    :motor_rpm,
                    :pellet_feeder_speed,
                    :pellet_motor_load,
                    LOCALTIMESTAMP
                )
                """
            ),
            {
                "running_status": bool(process_status == 100),
                "process_status": process_status,
                "process_product": process_product,
                "batch_id": batch_id,
                "ambient_temp": _scaled_float(payload.get("room_temp"), 10),
                "humidity": _scaled_float(payload.get("humidity"), 10),
                "pressure_before": _scaled_float(payload.get("pressure_before"), 10),
                "pressure_after": _scaled_float(payload.get("pressure_after"), 10),
                "conditioner_temp": _scaled_float(payload.get("conditioner_temp"), 100),
                "bagging_temp": _scaled_float(payload.get("bagging_temp"), 10),
                "motor_temp": _scaled_float(payload.get("motor_temp"), 10),
                "motor_rpm": _scaled_float(payload.get("motor_rpm"), 10),
                "pellet_feeder_speed": _scaled_float(payload.get("motor_speed"), 10),
                "pellet_motor_load": _scaled_float(payload.get("motor_current"), 10),
            },
        )


def _create_n720_batch(payload: dict[str, Any]) -> int | None:
    recipe_id = _parse_int(payload.get("Batch_Product"), 0)
    set_batch = _to_float(payload.get("set_batch"))
    current_batch = max(0, _parse_int(payload.get("current_batch"), 0))
    bag_count = _to_float(payload.get("bag_count"))

    if set_batch is None or set_batch <= 0:
        return None

    with db_engine.begin() as conn:
        recipe_row = None
        if recipe_id > 0:
            recipe_row = conn.execute(
                text(
                    f"""
                    SELECT id, name
                    FROM {DB_SCHEMA}.recipe_types
                    WHERE id = :recipe_id
                    LIMIT 1
                    """
                ),
                {"recipe_id": recipe_id},
            ).mappings().first()

        recipe_type = str(recipe_row["name"] or "").strip() if recipe_row else ""
        product_name = recipe_type or "Pending Recipe Selection"

        inserted = conn.execute(
            text(
                f"""
                INSERT INTO {DB_SCHEMA}.production_batches (
                    batch_no,
                    date,
                    recipe_type,
                    product_name,
                    batch_size,
                    mop,
                    water,
                    num_bags,
                    weight_per_bag,
                    output,
                    hmi_duration_seconds,
                    hmi_completed_count,
                    hmi_status,
                    hmi_started_at,
                    hmi_completed_at,
                    stock_posted,
                    rm_reduced,
                    rm_shortage_flag,
                    rm_shortage_detail,
                    created_at,
                    last_modified_at
                ) VALUES (
                    NULL,
                    LOCALTIMESTAMP,
                    :recipe_type,
                    :product_name,
                    :batch_size,
                    NULL,
                    NULL,
                    :num_bags,
                    NULL,
                    0,
                    NULL,
                    :hmi_completed_count,
                    'running',
                    LOCALTIMESTAMP,
                    NULL,
                    FALSE,
                    FALSE,
                    FALSE,
                    NULL,
                    LOCALTIMESTAMP,
                    LOCALTIMESTAMP
                )
                RETURNING id
                """
            ),
            {
                "recipe_type": recipe_type or None,
                "product_name": product_name,
                "batch_size": float(set_batch),
                "num_bags": float(bag_count) if bag_count is not None else None,
                "hmi_completed_count": current_batch,
            },
        ).mappings().first()
        if not inserted:
            return None
        new_batch_id = int(inserted["id"])

        batch_code = _generate_batch_code(recipe_type=recipe_type or product_name, batch_id=new_batch_id)
        conn.execute(
            text(
                f"""
                UPDATE {DB_SCHEMA}.production_batches
                SET batch_no = :batch_no, last_modified_at = LOCALTIMESTAMP
                WHERE id = :batch_id
                """
            ),
            {"batch_no": batch_code, "batch_id": new_batch_id},
        )

        if recipe_row:
            recipe_material_rows = conn.execute(
                text(
                    f"""
                    SELECT rm_name, quantity
                    FROM {DB_SCHEMA}.recipe_materials
                    WHERE recipe_id = :recipe_id
                    ORDER BY id ASC
                    """
                ),
                {"recipe_id": recipe_id},
            ).mappings().all()

            for material in recipe_material_rows:
                conn.execute(
                    text(
                        f"""
                        INSERT INTO {DB_SCHEMA}.production_batch_materials (
                            batch_id,
                            rm_name,
                            quantity,
                            total_quantity,
                            created_at
                        ) VALUES (
                            :batch_id,
                            :rm_name,
                            :quantity,
                            NULL,
                            LOCALTIMESTAMP
                        )
                        """
                    ),
                    {
                        "batch_id": new_batch_id,
                        "rm_name": str(material["rm_name"] or "").strip(),
                        "quantity": float(material["quantity"] or 0),
                    },
                )

        return new_batch_id


def _update_n720_batch(payload: dict[str, Any], batch_id: int) -> None:
    current_batch = max(0, _parse_int(payload.get("current_batch"), 0))
    set_batch = _to_float(payload.get("set_batch"))
    bag_count = _to_float(payload.get("bag_count"))
    with db_engine.begin() as conn:
        conn.execute(
            text(
                f"""
                UPDATE {DB_SCHEMA}.production_batches
                SET hmi_completed_count = :current_batch,
                    batch_size = COALESCE(:set_batch, batch_size),
                    num_bags = :bag_count,
                    hmi_status = 'running',
                    last_modified_at = LOCALTIMESTAMP
                WHERE id = :batch_id
                """
            ),
            {
                "current_batch": current_batch,
                "set_batch": float(set_batch) if set_batch is not None and set_batch > 0 else None,
                "bag_count": float(bag_count) if bag_count is not None else None,
                "batch_id": batch_id,
            },
        )


def _stop_n720_batch(batch_id: int) -> None:
    with db_engine.begin() as conn:
        conn.execute(
            text(
                f"""
                UPDATE {DB_SCHEMA}.production_batches
                SET hmi_status = 'stopped',
                    hmi_completed_at = LOCALTIMESTAMP,
                    last_modified_at = LOCALTIMESTAMP
                WHERE id = :batch_id
                """
            ),
            {"batch_id": batch_id},
        )


def _handle_n720_batch_flow(payload: dict[str, Any], process_switch: int) -> None:
    global last_batch_switch, active_batch_id
    batch_switch = _parse_batch_switch(payload)
    previous_batch_switch = last_batch_switch

    if batch_switch == 1 and previous_batch_switch != 1:
        # OFF -> ON: create a new batch.
        created_id = _create_n720_batch(payload)
        if created_id is not None:
            active_batch_id = created_id
            _upsert_machine_state(is_running=process_switch == 1, active_batch=active_batch_id)
    elif batch_switch == 1 and active_batch_id is not None:
        # Keep updating same running batch while switch remains ON.
        _update_n720_batch(payload, active_batch_id)
        _upsert_machine_state(is_running=process_switch == 1, active_batch=active_batch_id)
    elif batch_switch == 0 and previous_batch_switch == 1:
        # ON -> OFF: stop current batch and wait for next ON cycle.
        if active_batch_id is not None:
            _stop_n720_batch(active_batch_id)
            active_batch_id = None
        _upsert_machine_state(is_running=process_switch == 1, active_batch=None)

    last_batch_switch = batch_switch


def _handle_plc_db_flow(raw_payload: str) -> None:
    global last_process_switch, active_batch_id, active_process_batch_id, active_process_product
    try:
        payload_obj = json.loads(raw_payload)
    except Exception:
        return
    if not isinstance(payload_obj, dict):
        return

    process_switch = _parse_process_switch(payload_obj)
    with plc_state_lock:
        previous_switch = last_process_switch

        if process_switch == 1:
            # ON state: keep machine running and insert live snapshots with status 100.
            process_product = _parse_int(payload_obj.get("Process_Product"), 0)
            if (
                active_process_batch_id is None
                or active_process_product != process_product
            ):
                with db_engine.begin() as conn:
                    active_process_batch_id = _resolve_process_batch_id(conn, process_product)
                active_process_product = process_product
            _upsert_machine_state(is_running=True, active_batch=active_batch_id)
            _insert_plc_snapshot(
                payload_obj,
                process_status=100,
                batch_id=active_process_batch_id)
        elif previous_switch == 1 and process_switch == 0:
            # Transition ON -> OFF: write exactly one 0-status row, then stop.
            _upsert_machine_state(is_running=False, active_batch=active_batch_id)
            _insert_plc_snapshot(
                payload_obj,
                process_status=0,
                batch_id=active_process_batch_id)
            active_process_batch_id = None
            active_process_product = None
        else:
            _upsert_machine_state(is_running=False, active_batch=active_batch_id)

        _handle_n720_batch_flow(payload_obj, process_switch)
        last_process_switch = process_switch


def _mark_message_seen(payload_obj: dict[str, Any]) -> None:
    global last_mqtt_message_at, last_mqtt_payload
    with plc_state_lock:
        last_mqtt_message_at = _app_now_aware()
        last_mqtt_payload = dict(payload_obj)


def _handle_idle_timeout() -> None:
    with plc_state_lock:
        should_stop = last_process_switch == 1 or last_batch_switch == 1
        if not should_stop:
            return
        stop_payload = dict(last_mqtt_payload or {})
        stop_payload["process_switch"] = 0
        stop_payload["batch_switch"] = 0

    LOG.warning(
        "No N720 MQTT data for %.1f minute(s); stopping machine, process, and active batch.",
        N720_IDLE_TIMEOUT_MINUTES,
    )
    _handle_plc_db_flow(json.dumps(stop_payload))


def _idle_watchdog_loop() -> None:
    interval_seconds = min(60.0, max(5.0, _idle_timeout_seconds() / 6.0))
    while not idle_watchdog_stop.wait(interval_seconds):
        with plc_state_lock:
            seen_at = last_mqtt_message_at
            should_check = last_process_switch == 1 or last_batch_switch == 1
        if not should_check or seen_at is None:
            continue

        elapsed_seconds = (_app_now_aware() - seen_at).total_seconds()
        if elapsed_seconds >= _idle_timeout_seconds():
            _handle_idle_timeout()


def _on_connect(client: mqtt.Client, userdata, flags, rc, properties=None):
    if rc == 0:
        LOG.info("Connected to MQTT broker %s:%s", MQTT_HOST, MQTT_PORT)
        client.subscribe(MQTT_TOPIC, qos=1)
        LOG.info("Subscribed to topic: %s", MQTT_TOPIC)
    else:
        LOG.error("MQTT connection failed with rc=%s", rc)


def _on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage):
    payload_text = msg.payload.decode("utf-8", errors="replace")
    print(f"[MQTT] topic={msg.topic} payload={payload_text}")
    _append_message(msg.topic, payload_text)
    try:
        payload_obj = json.loads(payload_text)
    except Exception:
        payload_obj = None
    if isinstance(payload_obj, dict):
        _mark_message_seen(payload_obj)
    _handle_plc_db_flow(payload_text)


def _start_mqtt() -> None:
    global mqtt_client
    with mqtt_lock:
        if mqtt_client is not None:
            return

        client = mqtt.Client(client_id="n720-fastapi-listener", transport="websockets")
        if MQTT_USERNAME or MQTT_PASSWORD:
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        client.ws_set_options(path=MQTT_WS_PATH)
        client.on_connect = _on_connect
        client.on_message = _on_message
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=MQTT_KEEPALIVE)
        client.loop_start()
        mqtt_client = client


def _start_idle_watchdog() -> None:
    global idle_watchdog_thread
    if idle_watchdog_thread is not None and idle_watchdog_thread.is_alive():
        return
    idle_watchdog_stop.clear()
    idle_watchdog_thread = threading.Thread(
        target=_idle_watchdog_loop,
        name="n720-idle-watchdog",
        daemon=True,
    )
    idle_watchdog_thread.start()


def _stop_mqtt() -> None:
    global mqtt_client
    with mqtt_lock:
        if mqtt_client is None:
            return
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        mqtt_client = None


def _stop_idle_watchdog() -> None:
    idle_watchdog_stop.set()
    if idle_watchdog_thread is not None:
        idle_watchdog_thread.join(timeout=5)


@app.on_event("startup")
def startup_event() -> None:
    _ensure_data_file()
    with db_engine.begin() as conn:
        conn.execute(text("SELECT 1"))
        conn.execute(
            text(
                f"""
                ALTER TABLE {DB_SCHEMA}.plc_data_snapshots
                ADD COLUMN IF NOT EXISTS process_product INTEGER
                """
            )
        )
        conn.execute(
            text(
                f"""
                ALTER TABLE {DB_SCHEMA}.plc_data_snapshots
                ADD COLUMN IF NOT EXISTS batch_id INTEGER
                """
            )
        )
        conn.execute(
            text(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conname = 'fk_plc_data_snapshots_batch_id'
                    ) THEN
                        ALTER TABLE {DB_SCHEMA}.plc_data_snapshots
                        ADD CONSTRAINT fk_plc_data_snapshots_batch_id
                        FOREIGN KEY (batch_id)
                        REFERENCES {DB_SCHEMA}.production_batches(id)
                        ON DELETE SET NULL;
                    END IF;
                END $$;
                """
            )
        )
    _start_mqtt()
    _start_idle_watchdog()


@app.on_event("shutdown")
def shutdown_event() -> None:
    _stop_idle_watchdog()
    _stop_mqtt()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "n720"}
