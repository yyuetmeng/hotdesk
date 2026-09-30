# Connecting desk sensors to Hot Desk Monitor

Getting a sensor's readings onto the dashboard takes three steps:

1. **Register the sensor** on your wireless network (usually a LoRaWAN network server).
2. **Point the network server at this app** with a webhook. You do this once, not per sensor.
3. **Link each sensor to its desk** so the app knows which desk a reading belongs to.

```
 Desk sensor ──radio──▶ Floor gateway ──▶ Network server (TTN / ChirpStack) ──webhook──▶ Hot Desk Monitor
 (DevEUI 24E1…41)                           decodes the payload                        sensor 24E1…41 = desk L1-DF-01
```

Before you start, the app must be running at a permanent HTTPS address (see [GITHUB.md](GITHUB.md), step 4)
with `SENSOR_API_KEY` set. The network server needs to reach that address.

---

## 1. Choose and register sensors

Any under-desk occupancy sensor that reports "occupied / vacant" works. Common LoRaWAN choices:

| Sensor type | Examples | Field it reports |
|---|---|---|
| Under-desk PIR + thermopile | Milesight VS341 / WS202, Browan TBMS100 | `occupancy: "occupied"` / `"vacant"`, or `pir: "trigger"` / `"idle"` |
| Desk / room occupancy | Elsys ERS Desk, ERS Eye | `occupancy: 0 / 1 / 2` |
| Chair / desk pressure or motion | Pressac, Disruptive Technologies (via bridge) | `occupied: true/false`, `motion` |

For each sensor:

1. Add it as a device in your network server (The Things Stack or ChirpStack) using the DevEUI, JoinEUI and
   AppKey supplied with it.
2. Choose the vendor's **payload formatter / codec** (both network servers have a device repository with them
   built in) so readings arrive already decoded.
3. Set its reporting interval to **5–10 minutes** with "report on change" enabled, so the app gets a reading
   when someone sits down or leaves and a regular heartbeat in between.

The app recognises the common field names (`occupancy`, `occupied`, `presence`, `pir`, `motion`, ...) and
values (`occupied`/`vacant`, `trigger`/`idle`, `true`/`false`, numbers). Messages without an occupancy field,
such as battery reports, still count as "sensor alive".

## 2. Point the network server at the app (one-off)

Use the address shown on the app's **Sensors** page (`/sensors`), which fills in your real host name.

**The Things Stack (TTN)**

1. Open your application → **Integrations → Webhooks → + Add webhook → Custom webhook**.
2. Webhook ID: `hotdesk`. Webhook format: **JSON**.
3. Base URL: `https://<your-host>/api/integrations/ttn`
4. Additional headers: `X-Api-Key` = your `SENSOR_API_KEY`.
5. Enabled event types: tick **Uplink message** only (leave the path empty).
6. Save.

**ChirpStack v4**

1. Open your application → **Integrations → HTTP → +**.
2. Payload encoding: **JSON**.
3. Event endpoint URL: `https://<your-host>/api/integrations/chirpstack`
4. Headers: `X-Api-Key` = your `SENSOR_API_KEY`.
5. Submit. ChirpStack posts every event type to that URL. The app only uses uplinks and ignores the rest.

**Anything else** (a different network server, an MQTT bridge, a BLE gateway, your own script):
POST JSON to `https://<your-host>/api/sensors/events` with the `X-Api-Key` header:

```bash
curl -X POST https://<your-host>/api/sensors/events \
  -H 'content-type: application/json' -H "x-api-key: $SENSOR_API_KEY" \
  -d '[{"sensorId":"24E124136B316941","presence":true},{"sensorId":"24E124136B316942"}]'
```

Omit `presence` for a heartbeat. `at` (an ISO timestamp) is optional and is used to discard out-of-order readings.

## 3. Link each sensor to its desk

Pick whichever of these suits your installers. You can mix them.

**A. Name the device after its desk (no linking needed).**
When adding the device in the network server, set its device ID / name to the desk's placeholder ID:
`s-l1-df-01` for desk `L1-DF-01`. Case doesn't matter. The first reading links it automatically.

**B. Link sensors as they come online.**
Install the sensor and trigger it (sit at the desk or wave at it). Then open **Sensors** on the dashboard.
The sensor appears under **Sensors waiting to be linked** with its DevEUI and network-server name. Pick the
desk and press **Link**.

**C. Type or paste the ID per desk.**
On the **Sensors** page, find the desk, paste the sensor's DevEUI (printed on the sensor, often as a QR code)
into its row and press **Save**.

**D. Link everything from a spreadsheet.**
Keep an install sheet with two columns, `desk` and `sensor`. Paste it into **Bulk link from a spreadsheet** and
press **Link all**. **Download current links (CSV)** gives you the same format back for your records.

The admin API does the same thing:

```bash
# one desk
curl -X PUT https://<your-host>/api/seats/L1-DF-01/sensor \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"sensorId":"24E124136B316941"}'
# many desks (sensorId null unlinks)
curl -X POST https://<your-host>/api/sensors/links \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '[{"seatId":"L1-DF-01","sensorId":"24E124136B316941"},{"seatId":"L1-DF-02","sensorId":"24E124136B316942"}]'
```

Rules:
- A sensor can only be on one desk. Linking it to a new desk moves it, and the old desk becomes QR-only.
- Sensor IDs are not case-sensitive.
- Links are saved with the app's state and survive restarts.
- Until a desk has a sensor that has reported, it works as a QR check-in desk.

## 4. Check it's working

On the **Sensors** page:

| Sensor column | Meaning | What to do |
|---|---|---|
| 🟢 Reporting · someone there / empty | Working | Nothing |
| 🟡 Waiting for first reading | Linked, but no reading yet | Trigger the sensor. Check it joined the network and the webhook is set up |
| 🟡 Stopped reporting | No reading for 15 min (`SENSOR_OFFLINE_MINUTES`) | Check battery and gateway coverage. The desk falls back to QR check-in meanwhile |
| ⚪ No sensor | Nothing linked | Link one, or leave it as a QR-only desk |

The dashboard shows desks with a silent sensor as **Sensor offline**. The server log also prints a line the
first time an unknown sensor reports.

## Troubleshooting

- **Nothing arrives at all:** check the webhook's delivery log in the network server. `401` means the
  `X-Api-Key` header doesn't match `SENSOR_API_KEY`. A connection error means the network server can't
  reach the app's address.
- **The sensor shows under "waiting to be linked" but never updates the desk:** link it (step 3).
- **The desk never shows "someone there":** the payload may use a field name the app doesn't know. Look at
  the decoded payload in the network server's live data and use a field the app recognises in your payload
  formatter (`occupancy: "occupied"|"vacant"` is safest). Alternatively, send readings to
  `/api/sensors/events` from a small bridge.
