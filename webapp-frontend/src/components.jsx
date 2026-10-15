import PinLoader from './PinLoader.jsx';

export const STATUS_LABEL = { available: 'Available', occupied: 'Occupied', away: 'Away', reserved: 'Reserved', offline: 'Sensor offline' };

// Loading state: a thin layer over the whole page with the pin loader in the middle.
export function Loading({ label = 'Loading...' }) { return <div className="pin-loader-overlay"><PinLoader label={label} /></div>; }
export function Notice({ children, kind = 'info' }) { return <p className={`notice ${kind}`}>{children}</p>; }
export function Status({ value }) { return <span className={`status status-${value}`}>{STATUS_LABEL[value] ?? value}</span>; }

export function AdminGate({ error, onRetry, children }) {
  if (!error) return children;
  return <main className="page narrow"><section className="card"><h1>Administrator access needed</h1><Notice kind="error">{error.message}</Notice><button className="button primary" onClick={onRetry}>Enter administrator token</button></section></main>;
}

export function SeatGrid({ seats, selected, onSelect, selectable = () => true, slotMode = false }) {
  const floors = [...new Map(seats.map((seat) => [seat.floor, seat.floorName])).entries()];
  return <div className="seat-grid">
    {floors.map(([floor, name]) => <section key={floor} className="floor-card"><h3>{name}</h3>
      {[...new Map(seats.filter((seat) => seat.floor === floor).map((seat) => [seat.zone, seat.zoneName])).entries()].map(([zone, zoneName]) =>
        <div className="zone" key={zone}><h4>{zoneName}</h4><div className="seats">
          {seats.filter((seat) => seat.floor === floor && seat.zone === zone).map((seat) => {
            const state = slotMode ? seat.slotState?.state ?? 'free' : seat.status;
            const enabled = selectable(seat);
            return <button key={seat.id} type="button" disabled={!enabled} onClick={() => onSelect?.(seat)} aria-pressed={selected === seat.id}
              className={`seat seat-${state} ${selected === seat.id ? 'selected' : ''}`} title={`${seat.id}: ${state}`}>
              <span>{seat.id.split('-').at(-1)}</span><small>{seat.id}</small>
            </button>;
          })}
        </div></div>)}
    </section>)}
  </div>;
}

// Page heading; `action` (optional) sits on the right, e.g. a link back to the parent page.
export function PageTitle({ title, children, action }) { return <div className="page-title"><div><h1>{title}</h1>{children}</div>{action && <div className="page-title-action">{action}</div>}</div>; }
