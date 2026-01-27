let queue = [];
let partyAlertShown = false;

// Track your own entries in localStorage (anti-grief)
function getMyEntries() {
    return JSON.parse(localStorage.getItem('myEntries') || '[]');
}

function addMyEntry(id) {
    const mine = getMyEntries();
    mine.push(id);
    localStorage.setItem('myEntries', JSON.stringify(mine));
}

function removeMyEntry(id) {
    const mine = getMyEntries().filter(x => x !== id);
    localStorage.setItem('myEntries', JSON.stringify(mine));
}

function isMyEntry(id) {
    return getMyEntries().includes(id);
}

async function fetchQueue() {
    const res = await fetch('/api/queue');
    queue = await res.json();
    renderQueue();
    checkPartyReady();
}

function isWithinTimeWindow(entry) {
    const now = new Date();

    if (entry.availableFromUTC) {
        const from = new Date(entry.availableFromUTC);
        if (now < from) return false;
    }

    if (entry.availableToUTC) {
        const until = new Date(entry.availableToUTC);
        if (now > until) return false;
    }

    return true;
}

function getEffectiveStatus(entry) {
    if (entry.status === 'done') return 'done';
    if (entry.status === 'waiting') return 'waiting';
    return isWithinTimeWindow(entry) ? 'ready' : 'waiting';
}

function getCurrentSystem() {
    return (document.getElementById('system').value || 'Anana').toLowerCase().trim();
}

function getSystemQueue() {
    const sys = getCurrentSystem();
    return queue.filter(e => (e.system || '').toLowerCase().trim() === sys);
}

function getReadyQueue() {
    return getSystemQueue()
        .filter(e => getEffectiveStatus(e) === 'ready')
        .sort((a, b) => new Date(a.readySince || a.joined) - new Date(b.readySince || b.joined));
}

function checkPartyReady() {
    const readyQueue = getReadyQueue();
    if (readyQueue.length >= 4 && !partyAlertShown) {
        showPartyAlert(readyQueue.slice(0, 4));
        playPing();
        partyAlertShown = true;
    } else if (readyQueue.length < 4) {
        partyAlertShown = false;
    }
}

function showPartyAlert(party) {
    const names = party.map(e => e.cmdr).join(', ');
    document.querySelector('.party-alert p').textContent = `${names}`;
    document.getElementById('party-alert').classList.remove('hidden');
}

function hidePartyAlert() {
    document.getElementById('party-alert').classList.add('hidden');
}

function playPing() {
    if (!document.getElementById('sound-toggle')?.checked) return;

    // Try to play mp3 file first, fall back to Web Audio
    const audio = new Audio('/static/notify.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {
        // Fallback: gentle Web Audio chime
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            // C5 and E5 - a pleasant major third
            [523, 659].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                const start = ctx.currentTime + (i * 0.12);
                osc.start(start);
                // Very soft with smooth envelope
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.04, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
                osc.stop(start + 0.4);
            });
        } catch (e) {}
    });
}

function formatTimeWindow(entry) {
    if (!entry.availableTo) return 'Now';
    return `until ${entry.availableTo}`;
}

function renderQueue() {
    const tbody = document.getElementById('queue-body');
    const systemQueue = getSystemQueue();
    const readyQueue = getReadyQueue();

    if (systemQueue.length === 0) {
        const sys = getCurrentSystem();
        tbody.innerHTML = `<tr><td colspan="7" class="empty">No CMDRs in ${sys} queue</td></tr>`;
        updateSlots(0, []);
        return;
    }

    updateSlots(readyQueue.length, readyQueue.slice(0, 4));

    // Sort: ready first (by readySince), then waiting (by joined)
    const sorted = [...systemQueue].sort((a, b) => {
        const aReady = getEffectiveStatus(a) === 'ready';
        const bReady = getEffectiveStatus(b) === 'ready';
        if (aReady && !bReady) return -1;
        if (!aReady && bReady) return 1;
        if (aReady && bReady) {
            return new Date(a.readySince || a.joined) - new Date(b.readySince || b.joined);
        }
        return new Date(a.joined) - new Date(b.joined);
    });

    tbody.innerHTML = sorted.map(entry => {
        const status = getEffectiveStatus(entry);
        const inParty = readyQueue.slice(0, 4).some(e => e.id === entry.id);
        const pos = readyQueue.findIndex(e => e.id === entry.id) + 1;
        const mine = isMyEntry(entry.id);
        const from = entry.availableFromUTC ? utcToDisplay(entry.availableFromUTC) : '';
        const until = entry.availableToUTC ? utcToDisplay(entry.availableToUTC) : '';
        let timeDisplay = 'now';
        if (from && until) timeDisplay = `${from} - ${until}`;
        else if (from) timeDisplay = `from ${from}`;
        else if (until) timeDisplay = `until ${until}`;

        return `
        <tr class="${status} ${inParty ? 'in-party' : ''} ${mine ? 'mine' : ''}">
            <td class="cmdr">${esc(entry.cmdr)}${mine ? ' <span class="you">(you)</span>' : ''}</td>
            <td class="stack">${entry.credits}M</td>
            <td class="stations">${entry.stations}</td>
            <td class="missions">${entry.missions || 20}</td>
            <td class="available">${timeDisplay}</td>
            <td class="status-cell">
                ${status === 'ready'
                    ? `<span class="badge ready">#${pos} Ready</span>`
                    : `<span class="badge waiting">Waiting</span>`
                }
            </td>
            <td class="actions">
                ${mine ? `
                    ${status === 'ready'
                        ? `<button onclick="turnedIn('${entry.id}')" class="btn-done">Done</button>`
                        : `<button onclick="markReady('${entry.id}')" class="btn-ready">Ready</button>`
                    }
                    <button onclick="removeEntry('${entry.id}')" class="btn-x">×</button>
                ` : ''}
            </td>
        </tr>`;
    }).join('');
}

function updateSlots(count, party) {
    for (let i = 0; i < 4; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (party[i]) {
            slot.classList.add('filled');
            slot.textContent = party[i].cmdr.slice(0, 3);
            slot.title = party[i].cmdr;
        } else {
            slot.classList.remove('filled');
            slot.textContent = '';
            slot.title = '';
        }
    }
    const countEl = document.getElementById('ready-count');
    countEl.textContent = count >= 4 ? 'GO!' : `${count}/4`;
    countEl.className = count >= 4 ? 'full' : '';
}

function localTimeToUTC(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const now = new Date();
    now.setHours(h, m, 0, 0);
    return now.toISOString();
}

function get24HoursFromNow() {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    return future.toISOString();
}

function utcToDisplay(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function addEntry(e) {
    e.preventDefault();
    const fromLocal = document.getElementById('available-from').value;
    const untilLocal = document.getElementById('available-to').value;
    const data = {
        cmdr: document.getElementById('cmdr').value,
        credits: parseInt(document.getElementById('credits').value) || 0,
        stations: parseInt(document.getElementById('stations').value) || 4,
        missions: parseInt(document.getElementById('missions').value) || 20,
        system: document.getElementById('system').value || 'Anana',
        availableFromUTC: localTimeToUTC(fromLocal),
        availableToUTC: localTimeToUTC(untilLocal) || get24HoursFromNow(),
        status: 'ready',
        readySince: new Date().toISOString()
    };
    const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const entry = await res.json();
    addMyEntry(entry.id);
    document.getElementById('cmdr').value = '';
    document.getElementById('credits').value = '';
    document.getElementById('available-from').value = '';
    document.getElementById('available-to').value = '';
    fetchQueue();
}

async function markReady(id) {
    await fetch(`/api/queue/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ready', readySince: new Date().toISOString() })
    });
    fetchQueue();
}

async function turnedIn(id) {
    if (!isMyEntry(id)) return;
    await fetch(`/api/queue/${id}`, { method: 'DELETE' });
    removeMyEntry(id);
    toast('Removed - thanks for sharing!');
    fetchQueue();
}

async function removeEntry(id) {
    if (!isMyEntry(id)) return;
    await fetch(`/api/queue/${id}`, { method: 'DELETE' });
    removeMyEntry(id);
    fetchQueue();
}

async function clearMyEntries() {
    const mine = getMyEntries();
    if (mine.length === 0) {
        toast('No entries to clear');
        return;
    }
    if (!confirm(`Remove your ${mine.length} entry/entries?`)) return;
    for (const id of mine) {
        await fetch(`/api/queue/${id}`, { method: 'DELETE' });
    }
    localStorage.setItem('myEntries', '[]');
    partyAlertShown = false;
    hidePartyAlert();
    fetchQueue();
}

function copyForDiscord() {
    const system = document.getElementById('system').value || 'Anana';
    const ready = getReadyQueue();
    const systemQueue = getSystemQueue();
    const waiting = systemQueue.filter(e => getEffectiveStatus(e) !== 'ready');

    let text = `**${system} WMM Queue**\n`;

    if (ready.length >= 4) {
        text += `\n🎯 **PARTY READY**\n`;
    }

    ready.forEach((e, i) => {
        const marker = i < 4 ? '→' : ' ';
        text += `${marker} ${i+1}. ${e.cmdr} | ${e.credits}M | ${e.stations} stn\n`;
    });

    if (waiting.length) {
        text += `\n**Waiting:**\n`;
        waiting.forEach(e => {
            text += `- ${e.cmdr} | ${e.credits}M | ${e.stations} stn | ${formatTimeWindow(e)}\n`;
        });
    }

    navigator.clipboard.writeText(text).then(() => toast('Copied!'));
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

function esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

async function adminClear() {
    const pw = prompt('Admin password:');
    if (!pw) return;
    const res = await fetch('/api/queue/admin-clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
    });
    if (res.ok) {
        toast('Queue cleared!');
        partyAlertShown = false;
        hidePartyAlert();
        fetchQueue();
    } else {
        toast('Wrong password');
    }
}

document.getElementById('add-form').addEventListener('submit', addEntry);
document.getElementById('copy-btn').addEventListener('click', copyForDiscord);
document.getElementById('clear-btn').addEventListener('click', clearMyEntries);
document.getElementById('admin-clear-btn').addEventListener('click', adminClear);
document.getElementById('dismiss-alert').addEventListener('click', hidePartyAlert);
document.getElementById('system').addEventListener('input', renderQueue);

// Set default "From" time to now
function setDefaultFromTime() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('available-from').value = `${h}:${m}`;
}

setDefaultFromTime();
fetchQueue();
setInterval(fetchQueue, 5000);
