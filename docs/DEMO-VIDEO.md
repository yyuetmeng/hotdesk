# Demo video: shot-by-shot script

A 1:53 video for a judging audience. It opens and closes on the **Hot Desk splash card** and the **floor display, fast-forwarded**, so the
judges see desks fill up and free up on their own. In between are six short scenes, and each one starts
with its **title and a one-line description** on screen. The whole video uses the **light theme**.

| Time | Part | Title on screen |
|---|---|---|
| 0:00–0:03 | Splash: the end card (logo and tagline) | **Hot Desk** |
| 0:03–0:12 | Intro: floor display, fast-forwarded | **Every desk in the office, live** |
| 0:09–0:21 | Scene 1 | **The live office** |
| 0:21–0:34 | Scene 2 | **Reserve a desk** |
| 0:34–0:50 | Scene 3 | **Scan to check in** |
| 0:50–1:03 | Scene 4 | **No ghost bookings** |
| 1:03–1:16 | Scene 5 | **Find a colleague** |
| 1:16–1:32 | Scene 6 | **Plan the office** |
| 1:32–1:45 | Outro: floor display, fast-forwarded, then the end card | **Every desk used, nobody searching** |

Each part dips to black (about 1 second) before the next one. **Total narration: about 170 words**, in a
professional, cheerful voice; each line starts just after its part fades in.

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
   | A free desk for the booking scene, kept free by the simulator | **L1-DF-07** (or SAP's first pre-allocated desk; the window prints which) | Scenes 2 and 3 |
   | **Rachel Tan** (STREAM), checked in and at her desk | **L2-GO-12**, Level 2 | Scene 5 |
   | A reservation nobody comes for (**Marcus Lim**, then other names) | **L1-AI-05**, then L1-AI-06, -11, -12 | Scene 4 |

   Leave the window open. It prints the addresses, and when the no-show will be released. Two commands
   work in that window for retakes:

   - **`n` + Enter**: stage another no-show. It is released about 2 minutes later, and the window prints the time.
   - **`r` + Enter**: free the booking desk again, so you can redo scenes 2 and 3. It shows *Away* for up
     to 2 minutes (someone just left), then free.

   On screen the no-show is released after 2 minutes so you don't have to wait. The real rule (and the
   narration) is 30 minutes.
3. **Set up the browser** (Chrome or Edge):
   - One window, full screen (**F11**), with the bookmarks bar hidden.
   - Zoom to **110%** (Ctrl + plus) so the text reads well on video.
   - Theme: **light everywhere**, including /display (if it's dark, click the moon button once; the browser
     remembers it).
4. **Set up recording:**
   - Screen at 1920 × 1080.
   - Record with **OBS Studio**, or Win + Alt + R (Xbox Game Bar records the active window).
   - Turn on "show clicks" or a cursor highlight if your recorder has it.
   - Close chat apps so no notifications pop up.

## The scenes

Times are positions in the finished video. Record each clip 2–3 seconds longer at both ends, for trimming.

**Title and description:** show them as a card at the bottom left, fading in over the first half-second and out
after about 7 seconds (sooner if a zoom-in would collide with it; the intro and outro keep theirs).
The exact wording is under **On screen** in each part. Keep the same card style throughout: the logo, a small
"Scene n of 6" line, the title in bold, and the description underneath.

### Intro · Hot Desk (0:00–0:09)

- **Page:** `http://localhost:3000/display`, light theme.
- **Record:** about 70 seconds without touching anything (the demo already runs 10× faster than real
  time). In the edit, speed it up **8×** so it lasts about 9 seconds: people arrive, leave and step away
  in fast motion.
- **Before it:** the splash card (the same as the end card) for about 3 seconds, fading into the display.
- **On screen:** **Every desk in the office, live**: *A working day at DIC - Digital Factory*. No speed badge.
- **Narration:** "In a hot-desking office, desk availability is always an issue, and people waste time hunting for a seat. Hot Desk fixes that."
- **Then:** fade into scene 1.

### Scene 1 · The live office (0:09–0:21)

- **Page:** dashboard `http://localhost:3000`, scrolled to the top.
- **Do:**
  1. Hold for 1.5 seconds on the KPI cards, then scroll down so the **Level 1 plan sits in the middle of the
     screen**, clear of the title card.
  2. Hover an **occupied** chair (coloured by its project): its card shows the person and project.
  3. Hover a **yellow (away)** chair: its card shows *Auto-release hh:mm*.
- **On screen:** **The live office**: *Under-desk sensors and QR check-in show who is where, in real time.*
- **Narration:** "Every desk is live. Desk sensors see who's there, a QR code on each desk handles check-in, and desks free themselves when people leave, or did not appear."

### Scene 2 · Reserve a desk (0:21–0:34)

- **Page:** `http://localhost:3000/book`.
- **Do:**
  1. **1 Your project team:** choose **SAP**.
  2. **2 When:** **Today**, then the slot under way (**Morning** before 13:00, **Afternoon** after).
  3. Tap the chair **L1-DF-07** (the cue sheet's desk). The name is already filled in with a sample name.
  4. Click **Reserve L1-DF-07 · Today morning**. The green confirmation appears.
  5. Scroll up a little: **My reservations** shows it, marked *Reserved*.
- **On screen:** **Reserve a desk**: *Book a morning, afternoon or full day, today or tomorrow.*
- **Narration:** "How to reserve a desk? You can choose your slot: morning, afternoon or full day. A reservation will hold your seat…"

### Scene 3 · Scan to check in (0:34–0:50)

- **Pages:** `http://localhost:3000/labels?seat=L1-DF-07` (the desk's QR sticker; zoom the browser to 200%),
  then the dashboard with the phone window beside it.
- **Do:**
  1. Show the label for a second, then **click it**. The phone check-in window opens, just as scanning the QR
     code would.
  2. The phone says ***Your reservation (name): tap Check in to confirm it.*** with the name and project filled
     in. Tap **Check in**.
  3. On the dashboard beside it, **L1-DF-07** turns taken (in SAP's colour). Hover it to show its card.
- **On screen:** **Scan to check in**: *The QR code on the desk confirms the reservation. The dashboard updates
  instantly.*
- **Narration:** "Scan QR or tap your phone via NFC on the desk. Checking in confirms your reservation, and everyone sees the desk is taken."

### Scene 4 · No ghost bookings (0:50–1:03)

- **Page:** dashboard.
- **Do:**
  1. Type **`n` + Enter** in the demo window about **90 seconds before** you record. It prints the release time.
  2. Click the **Reserved** status chip above the plan, then hover the teal, dashed desk: *Reserved by …,
     released if no check-in by hh:mm*.
  3. Wait for the release: the desk turns free, and the *Reserved* count drops.
  4. Scroll to **Recent activity**: *"… did not check in at L1-AI-0x … : released"*.
- **Edit:** speed up the waiting 6–8×.
- **On screen:** **No ghost bookings**: *No check-in within 30 minutes? The desk is released automatically.*
- **Narration:** "Booked but never showed up? With no check-in within thirty minutes, the desk is released for someone else."
  Then at about **1:07**, just before the zoom on Recent activity: "You can see that the desk is released in the recent activity."

### Scene 5 · Find a colleague (1:03–1:16)

- **Page:** `http://localhost:3000/display` (light theme): the screen at the office entrance.
- **Do:** type **Rachel** in the search box, then tap **Rachel Tan**. The display switches to **Level 2**, and
  her desk **L2-GO-12** pulses.
- **On screen:** **Find a colleague**: *Search the office screen, and their desk lights up.*
- **Narration:** "Using the display placed at the entrance, anyone can find a colleague: tap a name, and their desk lights up. No more searching around."

### Scene 6 · Plan the office (1:16–1:32)

- **Pages:** dashboard, then `http://localhost:3000/insights`.
- **Do:**
  1. On the dashboard, scroll to **Occupancy** and switch the period to **1H**, then glance at
     **Utilisation by zone**.
  2. Open **Insights** from the sidebar. Hold on the **Capacity outlook**.
  3. In the **What-if capacity planner**, drag **Extra headcount by the end of 12 weeks** up: the outlook reacts.
- **On screen:** **Plan the office**: *Utilisation by zone, occupancy trends and a capacity forecast.*
- **For the recording**, the "simulated" labels on Insights and the sidebar are hidden (the app itself keeps them).
- **Narration:** "Admin can see utilisation by zone and how busy the office gets."
  Then at about **1:30**, when the page changes to Capacity & demand planning: "And Insights turns that into a capacity
  forecast. You can see the capacity outlook, do capacity planning and more…"

### Outro · Every desk used, nobody searching (1:32–1:45)

- **Page:** `http://localhost:3000/display` again, on another tab (e.g. **L1 · AI Lab**), recorded and sped
  up 8× like the intro (about 8 seconds).
- **On screen:** **Every desk used, nobody searching**: *Live occupancy · reservations · QR check-in · colleague
  finder · capacity planning*.
- **Then:** fade to the **end card** (about 5 seconds): the logo, ***Hot Desk: every desk used, nobody
  searching***, and your team name.
- **Narration:** "This is Hot Desk. An idea conceived on AI Builders' Day and turned into reality."
- **End card narration:** "Hot Desk. Every desk used, nobody searching."

## Edit (Clipchamp, built into Windows 11)

1. Lay out the parts in order and trim each to its time above. Speed up the intro, the outro and the waiting
   in scene 4.
2. Put a **dip to black** (about 1 s) between every two parts, so each cut-over is clear.
3. Add the title cards at the bottom left, the same style for every scene, each visible for about 7 seconds.
4. Add the narration track, then nudge the clips so each action lands on its words.
5. **Zoom in** (crop and scale) on the small moments:
   - the seat changing colour in scene 3;
   - the phone message in scene 3;
   - the activity line in scene 4;
   - the pulsing desk in scene 5.
6. Add background music at about −25 dB.
7. Export at 1080p. Before submitting, check that someone who has never seen the app can say the problem
   and the solution afterwards.

## If something goes wrong

| Problem | Fix |
|---|---|
| The booking desk is taken, or already reserved from an earlier take | `r` + Enter in the demo window, then wait up to 2 minutes |
| "This slot is over or nearly over" on /book | It's within the slot's last hour; pick the next slot or record later |
| The phone page doesn't fill in the name | Open the phone window from the same browser you reserved in (the label page or the dashboard's **Open check-in page**) |
| No reserved desk to show in scene 4 | `n` + Enter, wait about 90 seconds |
| You want to start completely over | Ctrl + C in the demo window, then `npm run demo:video` again |
