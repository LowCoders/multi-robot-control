"""Bridge globális állapot reset tesztekhez."""

from bridge.state import active_test_events, active_test_progress, reset_state_for_tests


def test_reset_state_for_tests_clears_maps():
    active_test_events["x"] = __import__("threading").Event()
    active_test_progress["d1"] = [{"message": "m", "level": "info"}]
    reset_state_for_tests()
    assert active_test_events == {}
    assert active_test_progress == {}
