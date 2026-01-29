"""
Python Bridge Server - FastAPI + WebSocket
Multi-Robot Control System

Ez a szerver közvetít a Node.js backend és a Python device driverek között.
HTTP REST API-t és WebSocket-et biztosít a kommunikációhoz.
"""

import asyncio
import json
import os
from typing import Dict, Optional, Any, List
from pathlib import Path
from contextlib import asynccontextmanager

import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from base import DeviceDriver, DeviceState, DeviceStatus, Position, DeviceType
from grbl_driver import GrblDevice
from linuxcnc_driver import LinuxCNCDevice
from simulated_device import SimulatedDevice, SimulationMode

# Szimulációs mód már csak eszközönként (devices.yaml simulated mezője)


# =========================================
# KONFIGURÁCIÓS MODELLEK
# =========================================

class DeviceConfig(BaseModel):
    """Eszköz konfiguráció"""
    id: str
    name: str
    driver: str  # "grbl" | "linuxcnc"
    type: str
    enabled: bool = True
    simulated: bool = True  # Szimulált eszköz (true) vagy valós (false)
    config: Dict[str, Any] = {}


class JogRequest(BaseModel):
    """Jog kérés"""
    axis: str
    distance: float
    feed_rate: float


class GCodeRequest(BaseModel):
    """G-code kérés"""
    gcode: str


class FileRequest(BaseModel):
    """Fájl betöltés kérés"""
    filepath: str


class OverrideRequest(BaseModel):
    """Override kérés"""
    percent: float


# =========================================
# DEVICE MANAGER
# =========================================

class DeviceMetadata:
    """Eszköz metaadatok tárolása"""
    def __init__(self, simulated: bool, connection_info: str = ""):
        self.simulated = simulated
        self.connection_info = connection_info
        self.last_error: Optional[str] = None


class DeviceManager:
    """Eszközök kezelése"""
    
    def __init__(self):
        self.devices: Dict[str, DeviceDriver] = {}
        self.device_metadata: Dict[str, DeviceMetadata] = {}
        self._ws_clients: List[WebSocket] = []
    
    async def load_config(self, config_path: str) -> None:
        """Konfiguráció betöltése YAML fájlból"""
        if not os.path.exists(config_path):
            print(f"Konfiguráció nem található: {config_path}")
            return
        
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
        
        devices_config = config.get('devices', [])
        
        for device_conf in devices_config:
            if not device_conf.get('enabled', True):
                continue
            
            await self.add_device(DeviceConfig(**device_conf))
    
    async def add_device(self, config: DeviceConfig) -> bool:
        """Új eszköz hozzáadása"""
        try:
            driver = config.driver.lower()
            device = None
            connection_info = ""
            
            # Szimuláció döntés: devices.yaml simulated mezője alapján
            use_simulation = driver == "simulated" or config.simulated
            
            if use_simulation:
                device_type = DeviceType.CNC_MILL
                if config.type == "laser_cutter":
                    device_type = DeviceType.LASER_CUTTER
                elif config.type == "cnc_lathe":
                    device_type = DeviceType.CNC_LATHE
                elif config.type == "3d_printer":
                    device_type = DeviceType.PRINTER_3D
                elif config.type == "robot_arm":
                    device_type = DeviceType.ROBOT_ARM
                
                device = SimulatedDevice(
                    device_id=config.id,
                    name=config.name,
                    device_type=device_type,
                    simulation_mode=SimulationMode.NORMAL,
                    max_x=config.config.get('max_x', 300.0),
                    max_y=config.config.get('max_y', 200.0),
                    max_z=config.config.get('max_z', 100.0),
                )
                connection_info = "Szimulált"
                print(f"🎮 Szimulált eszköz: {config.name}")
            elif driver == "grbl":
                port = config.config.get('port', '/dev/ttyUSB0')
                device = GrblDevice(
                    device_id=config.id,
                    device_name=config.name,
                    port=port,
                    baudrate=config.config.get('baudrate', 115200),
                )
                connection_info = port
                print(f"🔌 Valós GRBL eszköz: {config.name} ({port})")
            elif driver == "linuxcnc":
                ini_file = config.config.get('ini_file')
                device = LinuxCNCDevice(
                    device_id=config.id,
                    device_name=config.name,
                    ini_file=ini_file,
                )
                connection_info = ini_file or "LinuxCNC"
                print(f"🔌 Valós LinuxCNC eszköz: {config.name}")
            else:
                print(f"Ismeretlen driver: {driver}")
                return False
            
            if device is None:
                return False
            
            # Metaadatok tárolása
            self.device_metadata[config.id] = DeviceMetadata(
                simulated=use_simulation,
                connection_info=connection_info
            )
            
            # Callback-ek beállítása
            device_id = config.id
            device.on_state_change = lambda old, new, d_id=device_id: asyncio.create_task(
                self._broadcast_state_change(d_id, old, new)
            )
            device.on_position_update = lambda pos, d_id=device_id: asyncio.create_task(
                self._broadcast_position(d_id, pos)
            )
            device.on_error = lambda msg, d_id=device_id: asyncio.create_task(
                self._broadcast_error(d_id, msg)
            )
            device.on_job_complete = lambda file, d_id=device_id: asyncio.create_task(
                self._broadcast_job_complete(d_id, file)
            )
            device.on_job_progress = lambda progress, line, total, d_id=device_id: asyncio.create_task(
                self._broadcast_job_progress(d_id, progress, line, total)
            )
            
            self.devices[config.id] = device
            print(f"Eszköz hozzáadva: {config.id} ({config.name})")
            return True
            
        except Exception as e:
            print(f"Eszköz hozzáadási hiba ({config.id}): {str(e)}")
            return False
    
    def get_device(self, device_id: str) -> Optional[DeviceDriver]:
        """Eszköz lekérdezése ID alapján"""
        return self.devices.get(device_id)
    
    async def connect_all(self) -> Dict[str, bool]:
        """Összes eszköz csatlakoztatása"""
        results = {}
        for device_id, device in self.devices.items():
            try:
                results[device_id] = await device.connect()
            except Exception as e:
                print(f"Csatlakozási hiba ({device_id}): {str(e)}")
                results[device_id] = False
        return results
    
    async def disconnect_all(self) -> None:
        """Összes eszköz lecsatlakoztatása"""
        for device in self.devices.values():
            try:
                await device.disconnect()
            except Exception:
                pass
    
    # =========================================
    # WEBSOCKET BROADCAST
    # =========================================
    
    def register_ws_client(self, websocket: WebSocket) -> None:
        """WebSocket kliens regisztrálása"""
        self._ws_clients.append(websocket)
    
    def unregister_ws_client(self, websocket: WebSocket) -> None:
        """WebSocket kliens eltávolítása"""
        if websocket in self._ws_clients:
            self._ws_clients.remove(websocket)
    
    async def _broadcast(self, message: Dict[str, Any]) -> None:
        """Üzenet küldése minden kliensnek"""
        disconnected = []
        for client in self._ws_clients:
            try:
                await client.send_json(message)
            except Exception:
                disconnected.append(client)
        
        for client in disconnected:
            self.unregister_ws_client(client)
    
    async def _broadcast_state_change(
        self,
        device_id: str,
        old_state: DeviceState,
        new_state: DeviceState,
    ) -> None:
        await self._broadcast({
            "type": "state_change",
            "device_id": device_id,
            "old_state": old_state.value,
            "new_state": new_state.value,
        })
    
    async def _broadcast_position(self, device_id: str, position: Position) -> None:
        await self._broadcast({
            "type": "position",
            "device_id": device_id,
            "position": position.to_dict(),
        })
    
    async def _broadcast_error(self, device_id: str, message: str) -> None:
        # Hiba tárolása a metaadatokban
        if device_id in self.device_metadata:
            self.device_metadata[device_id].last_error = message
        
        await self._broadcast({
            "type": "error",
            "device_id": device_id,
            "message": message,
        })
    
    async def _broadcast_job_complete(self, device_id: str, file: str) -> None:
        await self._broadcast({
            "type": "job_complete",
            "device_id": device_id,
            "file": file,
        })
    
    async def _broadcast_job_progress(
        self, 
        device_id: str, 
        progress: float, 
        current_line: int, 
        total_lines: int
    ) -> None:
        await self._broadcast({
            "type": "job_progress",
            "device_id": device_id,
            "progress": progress,
            "current_line": current_line,
            "total_lines": total_lines,
        })


# =========================================
# GLOBAL DEVICE MANAGER
# =========================================

device_manager = DeviceManager()


# =========================================
# FASTAPI APP
# =========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifecycle management"""
    # Startup
    config_path = os.environ.get(
        'DEVICES_CONFIG',
        str(Path(__file__).parent.parent / 'config' / 'devices.yaml')
    )
    await device_manager.load_config(config_path)
    await device_manager.connect_all()
    
    yield
    
    # Shutdown
    await device_manager.disconnect_all()


app = FastAPI(
    title="Multi-Robot Control System - Device Bridge",
    description="Python bridge server for device communication",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================
# REST API ENDPOINTS
# =========================================

@app.get("/")
async def root():
    """Root endpoint"""
    return {"status": "ok", "service": "device-bridge"}


@app.get("/devices")
async def list_devices():
    """Összes eszköz listázása"""
    devices = []
    for device_id, device in device_manager.devices.items():
        metadata = device_manager.device_metadata.get(device_id)
        devices.append({
            "id": device_id,
            "name": device.device_name,
            "type": device.device_type.value,
            "connected": device.is_connected,
            "state": device.state.value,
            "simulated": metadata.simulated if metadata else True,
            "connectionInfo": metadata.connection_info if metadata else "",
            "lastError": metadata.last_error if metadata else None,
        })
    return {"devices": devices}


@app.post("/devices")
async def add_device(config: DeviceConfig):
    """Új eszköz hozzáadása"""
    # Check if device already exists
    if device_manager.get_device(config.id):
        raise HTTPException(status_code=400, detail="Eszköz már létezik ezzel az ID-val")
    
    # Add device
    success = await device_manager.add_device(config)
    
    if success:
        # Auto-connect the new device
        device = device_manager.get_device(config.id)
        if device:
            await device.connect()
        
        return {"success": True, "message": "Eszköz sikeresen hozzáadva és csatlakoztatva"}
    else:
        raise HTTPException(status_code=500, detail="Nem sikerült hozzáadni az eszközt")


@app.get("/devices/{device_id}")
async def get_device(device_id: str):
    """Eszköz részletek"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    return device.get_info()


@app.get("/devices/{device_id}/status")
async def get_device_status(device_id: str):
    """Eszköz állapot lekérdezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    status = await device.get_status()
    return status.to_dict()


@app.get("/devices/{device_id}/capabilities")
async def get_device_capabilities(device_id: str):
    """Eszköz képességek lekérdezése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    capabilities = await device.get_capabilities()
    return capabilities.to_dict()


@app.post("/devices/{device_id}/connect")
async def connect_device(device_id: str):
    """Csatlakozás az eszközhöz"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.connect()
    return {"success": result}


@app.post("/devices/{device_id}/disconnect")
async def disconnect_device(device_id: str):
    """Lecsatlakozás az eszközről"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    await device.disconnect()
    return {"success": True}


@app.post("/devices/{device_id}/home")
async def home_device(device_id: str, axes: Optional[List[str]] = None):
    """Homing végrehajtása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.home(axes)
    return {"success": result}


@app.post("/devices/{device_id}/jog")
async def jog_device(device_id: str, request: JogRequest):
    """Jog mozgás"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.jog(request.axis, request.distance, request.feed_rate)
    return {"success": result}


@app.post("/devices/{device_id}/jog/stop")
async def jog_stop_device(device_id: str):
    """Jog leállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.jog_stop()
    return {"success": result}


@app.post("/devices/{device_id}/gcode")
async def send_gcode(device_id: str, request: GCodeRequest):
    """G-code parancs küldése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    response = await device.send_gcode(request.gcode)
    return {"response": response}


@app.post("/devices/{device_id}/load")
async def load_file(device_id: str, request: FileRequest):
    """G-code fájl betöltése"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.load_file(request.filepath)
    return {"success": result}


@app.post("/devices/{device_id}/run")
async def run_device(device_id: str, from_line: int = 0):
    """Program futtatás indítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.run(from_line)
    return {"success": result}


@app.post("/devices/{device_id}/pause")
async def pause_device(device_id: str):
    """Program megállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.pause()
    return {"success": result}


@app.post("/devices/{device_id}/resume")
async def resume_device(device_id: str):
    """Program folytatása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.resume()
    return {"success": result}


@app.post("/devices/{device_id}/stop")
async def stop_device(device_id: str):
    """Program leállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.stop()
    return {"success": result}


@app.post("/devices/{device_id}/reset")
async def reset_device(device_id: str):
    """Eszköz reset"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.reset()
    return {"success": result}


@app.post("/devices/{device_id}/feed-override")
async def set_feed_override(device_id: str, request: OverrideRequest):
    """Feed rate override beállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.set_feed_override(request.percent)
    return {"success": result}


@app.post("/devices/{device_id}/spindle-override")
async def set_spindle_override(device_id: str, request: OverrideRequest):
    """Spindle speed override beállítása"""
    device = device_manager.get_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Eszköz nem található")
    
    result = await device.set_spindle_override(request.percent)
    return {"success": result}


# =========================================
# WEBSOCKET
# =========================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint valós idejű kommunikációhoz"""
    await websocket.accept()
    device_manager.register_ws_client(websocket)
    
    try:
        # Kezdeti állapot küldése
        for device_id, device in device_manager.devices.items():
            status = await device.get_status()
            await websocket.send_json({
                "type": "status",
                "device_id": device_id,
                "status": status.to_dict(),
            })
        
        # Üzenetek fogadása
        while True:
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as e:
                # Handle invalid JSON - send error response but continue
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid JSON: {str(e)}",
                })
                continue
            except ValueError as e:
                # Handle other value errors in JSON parsing
                await websocket.send_json({
                    "type": "error", 
                    "message": f"Parse error: {str(e)}",
                })
                continue
            
            # Parancs feldolgozás
            msg_type = data.get("type")
            device_id = data.get("device_id")
            
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif msg_type == "get_status" and device_id:
                device = device_manager.get_device(device_id)
                if device:
                    status = await device.get_status()
                    await websocket.send_json({
                        "type": "status",
                        "device_id": device_id,
                        "status": status.to_dict(),
                    })
            
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
    except Exception as e:
        print(f"WebSocket hiba: {str(e)}")
        device_manager.unregister_ws_client(websocket)


# =========================================
# MAIN
# =========================================

def main():
    """Bridge szerver indítása"""
    import uvicorn
    
    host = os.environ.get('BRIDGE_HOST', '0.0.0.0')
    port = int(os.environ.get('BRIDGE_PORT', '4002'))
    
    print(f"Bridge szerver indítása: http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
