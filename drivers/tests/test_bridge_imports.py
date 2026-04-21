"""A bridge router modulok package-importja (ImportError fallback regresszió)."""


def test_import_bridge_router_modules():
    import bridge.routers.connect  # noqa: F401
    import bridge.routers.control  # noqa: F401
    import bridge.routers.devices  # noqa: F401
    import bridge.routers.diagnostics  # noqa: F401
    import bridge.routers.grbl  # noqa: F401
    import bridge.routers.motion  # noqa: F401
    import bridge.routers.robot  # noqa: F401
    import bridge.routers.usb  # noqa: F401
    import bridge.routers.ws  # noqa: F401
