PLAN_WALL_REASON = "CoinGlass plan wall"

def plan_wall_latched() -> bool:
    return False

def chair_window_ok(snap=None) -> bool:
    return True

def coinglass_hud_ok(raw_ok=False, reason=None) -> bool:
    return bool(raw_ok)

def glass_seats_must_wait(*args, **kwargs) -> bool:
    return False

class CoinGlassClient:
    def __init__(self, *a, **k):
        pass
