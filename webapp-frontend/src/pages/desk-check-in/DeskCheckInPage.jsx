import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { request, storage } from '../../api.js';
import { Notice, PageTitle, Status } from '../../components.jsx';
import { options } from '../shared.jsx';

export function DeskCheckInPage() {
  const location = useLocation(); const navigate = useNavigate();
  const [seatId, setSeatId] = useState(new URLSearchParams(location.search).get('seat') ?? '');
  const [seat, setSeat] = useState(null); const [config, setConfig] = useState(null);
  const [user, setUser] = useState(storage.get('hotdesk.user')); const [team, setTeam] = useState(storage.get('hotdesk.team'));
  const [slot, setSlot] = useState('auto'); const [message, setMessage] = useState('');
  useEffect(() => { request('/api/checkin-options').then(setConfig).catch((error) => setMessage(error.message)); }, []);
  const loadSeat = useCallback(async (id = seatId) => { try { setSeat(await request(`/api/seats/${encodeURIComponent(id)}`)); setMessage(''); } catch (error) { setMessage(error.message); setSeat(null); } }, [seatId]);
  useEffect(() => { if (seatId) loadSeat(); }, [seatId, loadSeat]);
  const submit = async (action) => { try { const result = await request(`/api/seats/${encodeURIComponent(seatId)}/${action}`, { method: 'POST', body: { user, projectTeam: team, ...(action === 'checkin' ? { slot } : {}) } }); storage.set('hotdesk.user', user); storage.set('hotdesk.team', team); setSeat(result); setMessage(action === 'checkin' ? 'You are checked in.' : 'You are checked out.'); } catch (error) { setMessage(error.message); } };
  return <main className="page narrow"><PageTitle title="Desk check-in"><p>Scan a desk QR code or enter the desk ID printed at the workstation.</p></PageTitle>
    <section className="card"><form onSubmit={(e) => { e.preventDefault(); navigate(`/checkin?seat=${encodeURIComponent(seatId)}`); loadSeat(); }} className="inline-form"><label>Desk ID<input value={seatId} onChange={(e) => setSeatId(e.target.value.toUpperCase())} placeholder="L1-DF-01" required /></label><button className="button" type="submit">Find desk</button></form>
      {message && <Notice kind={seat ? 'success' : 'error'}>{message}</Notice>}
      {seat && <div className="checkin-card"><h2>{seat.id}</h2><p>{seat.floorName} · {seat.zoneName}</p><Status value={seat.status} />{seat.reservation && <Notice>This desk has a reservation for {seat.reservation.slotLabel}.</Notice>}
        <label>Your name or employee ID<input value={user} onChange={(e) => setUser(e.target.value)} /></label><label>Project team<select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Choose a project</option>{options(config?.projects ?? [])}</select></label><label>Duration<select value={slot} onChange={(e) => setSlot(e.target.value)}>{options([{ id: 'auto', label: 'Recommended' }, ...(config?.checkinSlots ?? [])], 'id', 'label')}</select></label>
        <div className="button-row"><button className="button primary" type="button" onClick={() => submit('checkin')}>Check in</button><button className="button" type="button" onClick={() => submit('checkout')}>I am leaving</button></div></div>}
    </section><Link className="quiet-link" to="/book">Reserve a desk ahead</Link></main>;
}
