# Demo video: shot-by-shot script

A 1:45 video for a judging audience. It shows the problem, two "wow" moments (reserve and check in
by QR, find a colleague on the office screen) and the planning view. There are 8 scenes. Record each one
as its own short clip, then put them together with the narration.

**Total narration: about 210 words**, read at a calm pace (about 120 words a minute, plus pauses).

## Before you record

1. **Choose the time.** Reservations follow the real clock, so record between **08:30 and 11:30** or
   **13:15 and 17:00**. Outside those times some scenes won't work.
2. **Start the scenario** about 10 minutes before the first take, so the floor fills up:

   ```
   git switch 2026-10-20-Demo
   npm run demo:video
   ```

   It starts a fresh demo (simulated people, sensors, reservations) and sets up the cast:

   | Who / what | Where | Used in |
   |---|---|---|
   | A free desk for the booking scene, kept free by the simulator | **L1-DF-07** (or SAP's first pre-allocated desk; the window prints which) | Scenes 3 and 4 |
   | **Rachel Tan** (STREAM), checked in and at her desk | **L2-GO-12**, Level 2 | Scene 6 |
   | A reservation nobody comes for (**Marcus Lim**, then other names) | **L1-AI-05**, then L1-AI-06, -11, -12 | Scene 5 |

   Leave the window open. It prints the addresses, and when the no-show will be released. Two commands
   work in that window for retakes:

   - **`n` + Enter**: stage another no-show. It is released about 2 minutes later, and the window prints the time.
   - **`r` + Enter**: free the booking desk again, so you can redo scenes 3 and 4. It shows *Away* for up
     to 2 minutes (someone just left), then free.

   On screen the no-show is released after 2 minutes so you don't have to wait. The real rule (and the
   narration) is 30 minutes.
3. **Set up the browser** (Chrome or Edge):
   - One window, full screen (**F11**), with the bookmarks bar hidden.
   - Zoom to **110%** (Ctrl + plus) so the text reads well on video.
   - Theme: light for the dashboard and /book, dark for /display (the moon button). The browser remembers each choice.
4. **Set up recording:**
   - Screen at 1920 × 1080.
   - Record with **OBS Studio**, or Win + Alt + R (Xbox Game Bar records the active window).
   - Turn on "show clicks" or a cursor highlight if your recorder has it.
   - Close chat apps so no notifications pop up.

## The scenes

Times are positions in the finished video. Record each clip 2–3 seconds longer at both ends, for trimming.

### Scene 1 · The problem (0:00–0:10)

- **Screen:** title card with the logo, on a blurred still of the dashboard floor plan (made in the editor).
- **Caption:** *Booked. Empty. Again.*
- **Narration:** "In a hot-desking office, desks get booked and then sit empty, while people waste time
  hunting for a seat, or for their team."

### Scene 2 · The live office (0:10–0:24)

- **Page:** dashboard `http://localhost:3000`, scrolled to the top.
- **Do:**
  1. Hold for 2 seconds on the KPI cards and the floor plan; seats change colour as people come and go.
  2. Hover a **blue (occupied)** chair: its card shows the person and project.
  3. Hover a **yellow (away)** chair: its card shows *Auto-release hh:mm*.
- **Caption:** *Live from under-desk sensors + QR check-in*
- **Narration:** "Hot Desk shows every desk live. Under-desk sensors see who's there, a QR code on each
  desk handles check-in, and desks free themselves when people leave."

### Scene 3 · Reserve a desk (0:24–0:37)

- **Page:** `http://localhost:3000/book`. Open it once before recording: the project you choose is remembered.
- **Do:**
  1. **1 Your project team:** choose **SAP**.
  2. **2 When:** **Today**, then the slot under way (**Morning** before 13:00, **Afternoon** after).
  3. Tap the chair **L1-DF-07** (the cue sheet's desk). The name is already filled in with a sample name.
  4. Click **Reserve L1-DF-07 · Today morning**. The green confirmation appears.
  5. Scroll up a little: **My reservations** shows it, marked *Reserved*.
- **Caption:** *Reserve for a morning, afternoon or full day*
- **Narration:** "Need a desk tomorrow, or this afternoon? Reserve one by slot: morning, afternoon or full day.
  A reservation only holds it…"

### Scene 4 · Scan to check in (0:37–0:52)

- **Pages:** `http://localhost:3000/labels?seat=L1-DF-07` (the desk's QR sticker; zoom the browser to
  200%), and the dashboard.
- **Do:**
  1. Show the label for a second, then **click it**. The phone check-in window opens, just as scanning
     the QR code would.
  2. The phone page says ***Your reservation (name): tap Check in to confirm it.*** with the name and
     project filled in. Tap **Check in**.
  3. Cut to the dashboard: **L1-DF-07** is now taken (blue).
- **Tip:** put the dashboard and the phone window side by side and record one take. The seat changes
  colour the moment you tap Check in.
- **Caption:** *Scan → checked in → dashboard updates instantly*
- **Narration:** "…until you arrive and scan the QR code on the desk. Checking in confirms it, and
  everyone sees the desk is taken, instantly."

### Scene 5 · No ghost bookings (0:52–1:05)

- **Page:** dashboard.
- **Do:**
  1. Type **`n` + Enter** in the demo window about **90 seconds before** you record. It prints the release time.
  2. Click the **Reserved** status chip above the plan. The no-show desk (L1-AI-0x, teal, dashed) stands out.
  3. Wait for the release: the desk turns free, and the KPI card's *Reserved* count drops.
  4. Scroll to **Recent activity**: *"Marcus Lim did not check in at L1-AI-05 … : released"*.
- **Edit:** speed up the waiting 4–8×.
- **Caption:** *No check-in in 30 min → released automatically*
- **Narration:** "And if someone books but never shows up? With no check-in within thirty minutes, the desk
  is released automatically. No more ghost bookings."

### Scene 6 · Find a colleague (1:05–1:20)

- **Page:** `http://localhost:3000/display` (dark theme), the screen at the office entrance.
- **Do:**
  1. Hold for 2 seconds: whole-office cards on top, live plan, and the colleague list.
  2. Type **Rachel** in the search box, then tap **Rachel Tan**. The display switches to **Level 2**,
     and her desk **L2-GO-12** pulses.
- **Caption:** *Find anyone, from the office screen*
- **Narration:** "On the screen at the entrance, anyone can find a colleague: tap a name, and their desk
  lights up."

### Scene 7 · Plan the office (1:20–1:37)

- **Pages:** dashboard, then `http://localhost:3000/insights`.
- **Do:**
  1. On the dashboard, scroll to **Occupancy** and switch the period **1H → 6H**, then glance at
     **Utilisation by zone**.
  2. Open **Insights** from the sidebar. Hold on the **Capacity outlook**.
  3. In the **What-if capacity planner**, drag **Extra headcount by the end of 12 weeks** up: the outlook reacts.
- **Caption:** *Utilisation and capacity planning* (and, small, on the Insights shot: *simulated data*)
- **Narration:** "Facilities teams see utilisation by zone and how busy the office gets, and Insights turns
  that history into a capacity forecast, shown here on simulated data."

### Scene 8 · Close (1:37–1:45)

- **Screen:** end card: the logo, ***Hot Desk: every desk used, nobody searching***, and your team name.
- **Narration:** "Hot Desk. Every desk used, and nobody searching."

## Edit (Clipchamp, built into Windows 11)

1. Lay out the clips in scene order and trim each to its time above.
2. Add the narration track, then nudge the clips so each action lands on its words.
3. **Zoom in** (crop and scale) on the small moments:
   - the seat turning blue in scene 4;
   - the phone message in scene 4;
   - the activity line in scene 5;
   - the pulsing desk in scene 6.
4. Add the captions above as text overlays (judges often watch muted). Add background music at about −25 dB.
5. Export at 1080p. Before submitting, check that someone who has never seen the app can say the problem
   and the solution afterwards.

## If something goes wrong

| Problem | Fix |
|---|---|
| The booking desk is taken, or already reserved from an earlier take | `r` + Enter in the demo window, then wait up to 2 minutes |
| "This slot is over or nearly over" on /book | It's within the slot's last hour; pick the next slot or record later |
| The phone page doesn't fill in the name | Open the phone window from the same browser you reserved in (the label page or the dashboard's **Open check-in page**) |
| No reserved desk to show in scene 5 | `n` + Enter, wait about 90 seconds |
| You want to start completely over | Ctrl + C in the demo window, then `npm run demo:video` again |
