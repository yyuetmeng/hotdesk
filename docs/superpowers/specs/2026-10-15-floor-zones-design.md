# Floor zones and "Utilisation by zone" — design

Date: 2026-10-15. Status: draft for the product owner's approval (builder check done).

## 1. Intent

Admins want to group the seats in one area of a floor under a name such as "Digital Factory", "Discussion Area" or "AI Lab". They mark an area by drawing a thin outline around it in the floor plan editor and giving it a label. The seats inside the outline belong to that zone.

Zones show up in two places:
- On the floor drawings, as a labelled outline with "N of M free".
- On the Insights page, as a "Utilisation by zone" card that shows how full each zone is right now.

The product owner supplied two reference screenshots: a floor with three labelled outlines, and the utilisation card. Both are described below.

## 2. Goals, non-goals, anti-goals

**Goals**
- Draw, move, resize, name and colour zones in the floor plan editor.
- Group seats into zones automatically from where they sit. Nobody assigns seats to zones by hand.
- Show zones on Book a desk and on the public floor display.
- Add a live "Utilisation by zone" card to the Insights page, for admins only.

**Non-goals**
- Day or month history per zone. That belongs to the paused statistics piece (piece 5), which can build on zones later.
- Zones that span more than one floor plan.
- Booking rules based on zones. Project teams still decide who may use a seat.
- Sensor data. "Sensor offline" from the screenshot is dropped (owner ruling).

**Anti-goals** (failures even if the feature technically works)
- Zones getting in the way of editing: a zone that blocks clicking, placing or moving seats and tables inside it.
- A seat counted in two zones, or utilisation numbers that disagree with what Book a desk shows.

## 3. Drawing zones (owner approved the mockup)

- **Palette:** "Zone" is a new item in the editor's palette. It is a new `floor_elements` catalog type `zone`, resizable, using the existing `label` and `color` fields of placed elements.
- **Drawing:**
  - A zone is drawn as a thin outline in its colour, with a faint fill at most, and its label in the top-left corner.
  - Under the label, the editor shows "N seats", the number of seats inside.
- **Selecting:** the selected-zone panel has the name, an outline colour, the automatic seat count, and width and height.
- **Layering and gestures** (my call, after the builder check):
  - Zones are drawn behind every other element. Pressing a seat or table works exactly as today.
  - A zone's inside acts like bare grid: dragging across it box-selects as today, and a click on an empty cell inside it changes nothing.
  - A zone is selected, moved and resized only through its outline or its label chip. The outline has a hit band a few pixels wide, and the label chip works as a handle.
- **Overlaps:**
  - A zone may overlap any non-zone element. In fact it is meant to surround seats and tables.
  - Two zones may not share any cell.
  - Non-zone elements keep the current rule that they never overlap one another. Both the frontend's `placementError` and the backend's `_validate_elements` need this exception.
- **Size:** a zone may be as large as the plan grid (up to 80 × 80). It is not capped at `MAX_ELEMENT_SIZE` (20), which still applies to other types.
- **Rotation:** rotation is meaningless for a zone, so the builder may hide or ignore it.
- **Label:** the label is the zone's name, up to 60 characters like any element label. A zone without a label shows as "Unnamed zone" everywhere.
- **Publishing:** zones are part of the draft and go live only when the plan is published, like seats and project team tags. Published versions snapshot them as ordinary version elements, so no new tables are needed.

## 4. Which seats are in a zone

- A seat belongs to a zone when the seat's cell is inside the zone's rectangle. Seats are 1 × 1.
- Membership is always worked out from positions and is never stored. Moving a seat or resizing a zone changes membership at once.
- Zones never overlap, so a seat is in at most one zone. A seat outside every zone has no zone.

## 5. Zones on the floor drawings

- **Book a desk** (`FloorView`) and the **public floor display** (`FloorDrawing`) draw each zone's outline, name and "N of M free".
  - **M:** the number of usable seats in the zone. A seat is usable when its current state is anything but `not_bookable`. This rule follows the state, not the tag (my call). A seat that just lost its tag but still has someone checked in counts as occupied, the same as Book a desk shows it.
  - **N:** the usable seats whose current state is `available`.
- These counts use the same seat states the page already shows, so they always agree with the seats drawn.
- If a zone has no usable seats, it shows the name only.

## 6. Insights: "Utilisation by zone" (owner approved the mockup)

The card goes at the top of the Insights page. The existing simulated planning content stays below it, unchanged for now. Only admins can see the card.

**Card text**
- Title: "Utilisation by zone".
- Subtitle: "Free seats and how the rest are used, per zone."
- A small "Live · updated HH:MM" note, in Singapore time.

**Table**
- **Columns:** ZONE (the name, with the floor plan's name underneath as the level), FREE ("free / total"), and IN USE (a bar with the percentage).
- **Bar:** two segments, blue for **Occupied (checked in)** and amber for **Booked, not yet checked in**.
- **Legend** under the table: "Occupied (checked in)" and "Booked, not yet checked in".

**Rows**
- One row per zone on every published floor plan.
- The rows are ordered by floor plan name, then zone name.
- Each floor that has usable seats outside every zone also gets a "No zone" row, shown last for that floor.
- A published floor with no zones at all appears as a single "Whole floor" row covering all its usable seats (owner ruling). The "No zones yet" empty state applies only when no published floor has any zone.
- A zone with no usable seats shows "0 / 0", an empty bar and "—" in place of a percentage.

**Numbers per row** (over usable seats only; `not_bookable` seats are left out)
- total = usable seats in the zone
- free = seats in state `available`
- occupied = seats in state `occupied`
- booked = seats in state `booked`
- percentage = round(100 × (occupied + booked) ÷ total)

"Right now" means the same now-window that the floor display uses: `seat_states(plan, today, None, now)`.

**Behaviour**
- **Refresh:** the card refreshes on its own every 30 seconds while the page is open (builder's call, matching the floor display).
- **No zones:** if no published plan has a zone, the card says "No zones yet. Draw zones in Manage Floor Plan and publish." and links to Manage Floor Plan.

## 7. Constraints

- The stack stays as it is: Flask, SQLAlchemy 2.0 ORM, React 19 + Vite. Follow `docs/CODING_GUIDELINES.md`.
- The only schema change is a SQL script, `webapp-backend/sql/0020_floor_zones.sql`. It inserts the `zone` catalog row and relaxes the `w`/`h` checks on `floor_plan_elements`, which are `between 1 and 20` today (from `0008`), to `between 1 and 80`. The 20 cap for non-zone types is enforced in code.
  - It must also cover anything the catalog needs so that a zone may exceed the generic size cap and overlap other elements.
  - The builder chooses how: for example a `config` flag on the catalog row, or special-casing the `zone` type.
- A new admin-only endpoint, for example `GET /api/admin/insights/zones`, returns the rows above. Membership and counts are computed in one tested backend function that the floor drawings' counts also use, or mirror exactly.
- Times are in Singapore time. Tests run against the local Postgres only.

## 8. Left to the builder

- The default outline colour and the colour choices offered for zones.
- How a zone is drawn while it is being dragged.
- The exact way the frontend gets zone counts: computed client-side from the elements and seat states already loaded, or returned by the API. Either is fine as long as it matches §4–§6.
- Whether the editor warns on publish about zones with no seats. Optional.
