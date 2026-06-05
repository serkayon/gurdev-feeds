from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.plc import MachineState
from app.utils.timezone import app_now

MACHINE_STATE_ID = 1


def get_or_create_machine_state(db: Session) -> MachineState:
    machine_state = db.get(MachineState, MACHINE_STATE_ID)
    if machine_state is not None:
        return machine_state

    machine_state = MachineState(id=MACHINE_STATE_ID, is_running=False, active_batch_id=None)
    db.add(machine_state)
    db.flush()
    return machine_state


def set_machine_running(
    db: Session,
    *,
    running: bool,
    active_batch_id: int | None = None,
) -> MachineState:
    machine_state = get_or_create_machine_state(db)
    machine_state.is_running = bool(running)
    machine_state.updated_at = app_now()
    machine_state.active_batch_id = active_batch_id if running else None
    return machine_state
