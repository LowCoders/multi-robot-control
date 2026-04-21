"""WebSocket endpoint a valós idejű kommunikációhoz."""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import TypeAdapter, ValidationError

try:
    from log_config import get_logger
except ImportError:
    from ...log_config import get_logger

try:
    from api_models import WsIncoming
except ImportError:
    from ...api_models import WsIncoming

from ..state import device_manager

logger = get_logger(__name__)
router = APIRouter()

_ws_incoming_adapter = TypeAdapter(WsIncoming)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint valós idejű kommunikációhoz."""
    await websocket.accept()
    device_manager.register_ws_client(websocket)

    try:
        for device_id, device in device_manager.devices.items():
            status = await device.get_status()
            await websocket.send_json(
                {
                    "type": "status",
                    "device_id": device_id,
                    "status": status.to_dict(),
                }
            )
            control = device_manager.get_control_state(device_id)
            if control is not None:
                await websocket.send_json(
                    {
                        "type": "control_state",
                        "device_id": device_id,
                        "control": control,
                    }
                )

        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as exc:
                await websocket.send_json(
                    {"type": "error", "code": "invalid_json", "message": f"Invalid JSON: {str(exc)}"}
                )
                continue
            except ValueError as exc:
                await websocket.send_json(
                    {"type": "error", "code": "parse_error", "message": f"Parse error: {str(exc)}"}
                )
                continue

            try:
                msg = _ws_incoming_adapter.validate_python(data)
            except ValidationError as exc:
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "invalid_message",
                        "detail": exc.errors(include_url=False),
                    }
                )
                continue

            if msg.type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg.type == "get_status":
                device = device_manager.get_device(msg.device_id)
                if device:
                    status = await device.get_status()
                    await websocket.send_json(
                        {
                            "type": "status",
                            "device_id": msg.device_id,
                            "status": status.to_dict(),
                        }
                    )

            elif msg.type == "jog":
                device = device_manager.get_device(msg.device_id)
                if device:
                    await device.jog(
                        msg.axis,
                        msg.distance,
                        msg.feed_rate,
                    )

            elif msg.type == "command":
                device = device_manager.get_device(msg.device_id)
                if device:
                    cmd = msg.command
                    if cmd == "run":
                        await device.run()
                    elif cmd == "pause":
                        await device.pause()
                    elif cmd == "resume":
                        await device.resume()
                    elif cmd == "stop":
                        await device.stop()
                    elif cmd == "home":
                        await device.home()
                    elif cmd == "reset":
                        await device.reset()

    except WebSocketDisconnect:
        device_manager.unregister_ws_client(websocket)
    except Exception as exc:
        logger.error(f"WebSocket hiba: {str(exc)}")
        device_manager.unregister_ws_client(websocket)
