"""WebSocket endpoint a valós idejű kommunikációhoz."""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

try:
    from log_config import get_logger
except ImportError:
    from ...log_config import get_logger

from ..state import device_manager

logger = get_logger(__name__)
router = APIRouter()


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
                    {"type": "error", "message": f"Invalid JSON: {str(exc)}"}
                )
                continue
            except ValueError as exc:
                await websocket.send_json(
                    {"type": "error", "message": f"Parse error: {str(exc)}"}
                )
                continue

            msg_type = data.get("type")
            device_id = data.get("device_id")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "get_status" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    status = await device.get_status()
                    await websocket.send_json(
                        {
                            "type": "status",
                            "device_id": device_id,
                            "status": status.to_dict(),
                        }
                    )

            elif msg_type == "jog" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    await device.jog(
                        data.get("axis", "X"),
                        data.get("distance", 1.0),
                        data.get("feed_rate", 1000),
                    )

            elif msg_type == "command" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    cmd = data.get("command")
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
