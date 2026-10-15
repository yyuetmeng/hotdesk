"""Insights for admins: live utilisation by zone (/api/admin/insights/zones).

Spec: docs/superpowers/specs/2026-10-15-floor-zones-design.md §6.
"""
from flask import g, jsonify
from flask_jwt_extended import get_jwt_identity

from app.core.security import admin_required
from app.desk import rules, service
from app.desk.zones import ZONE_TYPE, zone_summary

from . import admin_bp


@admin_bp.get("/insights/zones")
@admin_required
def zone_utilisation():
    g.jwt_uid = get_jwt_identity()
    at = rules.now()
    today = rules.local_today(at)
    floors = sorted(service.published_floors(), key=lambda p: p.published_version.name.casefold())
    rows, has_zones = [], False
    for plan in floors:
        live = plan.published_version
        has_zones = has_zones or any(el.type == ZONE_TYPE for el in live.elements)
        seats = service.seat_states(plan, today, None, at)
        for row in zone_summary(live.elements, seats):
            rows.append({"plan_id": str(plan.id), "level": live.name, "zone_id": row["id"], "name": row["name"],
                         **{k: row[k] for k in ("total", "free", "occupied", "booked", "pct")}})
    return jsonify(now=at.isoformat(), has_zones=has_zones, rows=rows)
