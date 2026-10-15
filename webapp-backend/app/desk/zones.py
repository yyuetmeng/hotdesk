"""Seats per zone (spec 2026-10-15-floor-zones §4-§6). Membership comes from positions and is never
stored: a seat is in a zone when its cell is inside the zone's rectangle (zones never overlap)."""

ZONE_TYPE = "zone"
COUNTED = ("available", "booked", "occupied")  # usable seats: anything but not_bookable


def zone_name(label: str | None) -> str:
    return (label or "").strip() or "Unnamed zone"


def _contains(zone, seat: dict) -> bool:
    return zone.x <= seat["x"] < zone.x + zone.w and zone.y <= seat["y"] < zone.y + zone.h


def _row(id_, name, zone, seats: list[dict]) -> dict:
    counts = {state: sum(1 for s in seats if s["state"] == state) for state in COUNTED}
    total = sum(counts.values())
    return {"id": id_, "name": name,
            "x": zone.x if zone else None, "y": zone.y if zone else None,
            "w": zone.w if zone else None, "h": zone.h if zone else None,
            "color": zone.color if zone else None,
            "total": total, "free": counts["available"], "occupied": counts["occupied"], "booked": counts["booked"],
            "pct": round(100 * (counts["occupied"] + counts["booked"]) / total) if total else None}


def zone_summary(elements, seats: list[dict]) -> list[dict]:
    """Rows for one published floor: its zones by name, then "No zone" for usable seats outside every
    zone. A floor without zones is a single "Whole floor" row. `seats` are seat_states() dicts."""
    usable = [s for s in seats if s["state"] in COUNTED]
    zones = sorted((el for el in elements if el.type == ZONE_TYPE), key=lambda z: zone_name(z.label).casefold())
    if not zones:
        return [_row(None, "Whole floor", None, usable)]
    rows = [_row(str(z.element_id), zone_name(z.label), z, [s for s in usable if _contains(z, s)]) for z in zones]
    outside = [s for s in usable if not any(_contains(z, s) for z in zones)]
    if outside:
        rows.append(_row(None, "No zone", None, outside))
    return rows


def drawn_zones(elements, seats: list[dict]) -> list[dict]:
    """The real zones of a floor, for drawing with "N of M free"."""
    return [row for row in zone_summary(elements, seats) if row["id"]]
