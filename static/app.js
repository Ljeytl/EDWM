let queue = [];
let wings = [];
let partyAlertShown = false;
const READY_UP_TIMEOUT = 15 * 60 * 1000; // 15 minutes to ready up

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
    const [queueRes, wingsRes] = await Promise.all([
        fetch('/api/queue'),
        fetch('/api/wings')
    ]);
    queue = await queueRes.json();
    wings = await wingsRes.json();
    checkReadyUpTimeouts();
    renderWings();
    renderQueue();
    checkPartyReady();
}

function isWithinTimeWindow(entry) {
    const now = new Date();
    const GRACE_MINS = 5; // 5 min grace on both ends

    if (entry.availableFromUTC) {
        const from = new Date(entry.availableFromUTC);
        // Ready up to 5 mins early
        if (now < new Date(from.getTime() - GRACE_MINS * 60 * 1000)) return false;
    }

    if (entry.availableToUTC) {
        const until = new Date(entry.availableToUTC);
        // Stay ready up to 5 mins after window closes
        if (now > new Date(until.getTime() + GRACE_MINS * 60 * 1000)) return false;
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

// Group ready queue into potential wings (4 unique CMDRs each)
// Only returns complete wings (exactly 4 unique CMDRs)
function getPotentialWings() {
    const ready = getReadyQueue();
    const potentialWings = [];
    const assigned = new Set();

    while (true) {
        const wing = [];
        const usedCmdrs = new Set();

        for (const entry of ready) {
            if (assigned.has(entry.id)) continue;
            const cmdrLower = entry.cmdr.toLowerCase().trim();
            if (usedCmdrs.has(cmdrLower)) continue;

            wing.push(entry);
            usedCmdrs.add(cmdrLower);

            if (wing.length === 4) break;
        }

        // Only add complete wings with 4 unique CMDRs
        if (wing.length === 4) {
            potentialWings.push(wing);
            wing.forEach(e => assigned.add(e.id));
        } else {
            break; // Not enough unique CMDRs for more wings
        }
    }

    return potentialWings;
}

function getWingNumber(entryId) {
    const potentialWings = getPotentialWings();
    for (let i = 0; i < potentialWings.length; i++) {
        if (potentialWings[i].some(e => e.id === entryId)) {
            return i + 1;
        }
    }
    return null; // Not in a potential wing yet
}

function checkPartyReady() {
    const potentialWings = getPotentialWings();

    // Check if user is in any potential wing that's ready to form
    for (const wing of potentialWings) {
        const userInWing = wing.some(e => isMyEntry(e.id));
        const allReadiedUp = wing.every(e => e.readyUp);
        const userReadiedUp = wing.find(e => isMyEntry(e.id))?.readyUp;

        if (userInWing && !userReadiedUp && !partyAlertShown) {
            showPartyAlert(wing);
            playPing();
            partyAlertShown = true;
            return;
        }
    }

    // Reset if user not in any wing
    const userInAnyWing = potentialWings.some(w => w.some(e => isMyEntry(e.id)));
    if (!userInAnyWing) {
        partyAlertShown = false;
    }
}

function checkReadyUpTimeouts() {
    const now = Date.now();
    queue.forEach(entry => {
        if (entry.readyUp && entry.readyUpTime) {
            const readyUpAt = new Date(entry.readyUpTime).getTime();
            if (now - readyUpAt > READY_UP_TIMEOUT) {
                // Reset on server
                resetReadyUp(entry.id);
            }
        }
    });
}

async function resetReadyUp(id) {
    await fetch(`/api/queue/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readyUp: false, readyUpTime: null })
    });
}

async function readyUp(id) {
    await fetch(`/api/ready-up/${id}`, { method: 'POST' });
    fetchQueue();
}

async function completeWing(wingId) {
    await fetch(`/api/wings/${wingId}/complete`, { method: 'POST' });
    toast('Wing complete! o7');
    fetchQueue();
}

function renderWings() {
    const container = document.getElementById('active-wings');
    const sysWings = wings.filter(w => w.system.toLowerCase() === getCurrentSystem());

    if (sysWings.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = sysWings.map(wing => {
        const isMember = wing.members.some(m => isMyEntry(m.id));
        return `
        <div class="active-wing">
            <div class="wing-header">
                <span class="wing-title">🚀 Wing Active</span>
                ${isMember ? `<button onclick="completeWing('${wing.id}')" class="btn-complete-wing">Wing Complete</button>` : ''}
            </div>
            <div class="wing-members">
                ${wing.members.map(m => `
                    <span class="wing-member ${isMyEntry(m.id) ? 'mine' : ''}">${esc(m.cmdr)} (${m.credits}M)</span>
                `).join('')}
            </div>
        </div>`;
    }).join('');
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

    // Show unique CMDRs in slots (max 4)
    const potentialWings = getPotentialWings();
    const uniqueCmdrs = [];
    const seenCmdrs = new Set();
    for (const entry of readyQueue) {
        const cmdrLower = entry.cmdr.toLowerCase().trim();
        if (!seenCmdrs.has(cmdrLower)) {
            uniqueCmdrs.push(entry);
            seenCmdrs.add(cmdrLower);
            if (uniqueCmdrs.length === 4) break;
        }
    }
    updateSlots(uniqueCmdrs.length, uniqueCmdrs);

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
        const wingNum = getWingNumber(entry.id);
        const inPotentialWing = wingNum !== null;
        const pos = readyQueue.findIndex(e => e.id === entry.id) + 1;
        const mine = isMyEntry(entry.id);
        const from = entry.availableFromUTC ? utcToDisplay(entry.availableFromUTC) : '';
        const until = entry.availableToUTC ? utcToDisplay(entry.availableToUTC) : '';
        let timeDisplay = 'now';
        if (from && until) timeDisplay = `${from} - ${until}`;
        else if (from) timeDisplay = `from ${from}`;
        else if (until) timeDisplay = `until ${until}`;

        return `
        <tr class="${status} ${inPotentialWing ? 'in-party' : ''} ${mine ? 'mine' : ''}">
            <td class="cmdr">${esc(entry.cmdr)}${mine ? ' <span class="you">(you)</span>' : ''}${wingNum ? ` <span class="wing-num">W${wingNum}</span>` : ''}</td>
            <td class="stack">${entry.credits}M</td>
            <td class="stations">${entry.stations}</td>
            <td class="missions">${entry.missions || 20}</td>
            <td class="available">${timeDisplay}</td>
            <td class="status-cell">
                ${status === 'ready' && entry.readyUp
                    ? `<span class="badge readied-up">✓ W${wingNum}</span>`
                    : status === 'ready' && wingNum
                    ? `<span class="badge ready">W${wingNum} #${pos}</span>`
                    : status === 'ready'
                    ? `<span class="badge ready">Ready</span>`
                    : `<span class="badge waiting">Waiting</span>`
                }
            </td>
            <td class="actions">
                ${mine ? `
                    ${status === 'ready' && inPotentialWing && !entry.readyUp
                        ? `<button onclick="readyUp('${entry.id}')" class="btn-readyup">Ready Up!</button>`
                        : ''
                    }
                    ${status === 'ready' && !inPotentialWing
                        ? `<button onclick="turnedIn('${entry.id}')" class="btn-done">Leave</button>`
                        : ''
                    }
                    ${status !== 'ready'
                        ? `<button onclick="markReady('${entry.id}')" class="btn-ready">Ready</button>`
                        : ''
                    }
                    <button onclick="editEntry('${entry.id}')" class="btn-edit">✏️</button>
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

function localTimeToUTC(timeStr, isUntil = false, fromTimeStr = '') {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // If "from" time is more than 1 hour in the past, assume tomorrow
    // Gives grace period for human error (e.g., entering 6:05 at 6:06)
    if (!isUntil && date < oneHourAgo) {
        date.setDate(date.getDate() + 1);
    }

    // Smart "next day" logic for "until" times
    if (isUntil) {
        // If until time is in the past, assume tomorrow
        if (date < now) {
            date.setDate(date.getDate() + 1);
        }
        // If from time exists and until is earlier, assume next day
        if (fromTimeStr) {
            const [fh, fm] = fromTimeStr.split(':').map(Number);
            if (h < fh || (h === fh && m < fm)) {
                // Until is earlier than from - must be next day
                const fromDate = new Date();
                fromDate.setHours(fh, fm, 0, 0);
                if (fromDate < now) fromDate.setDate(fromDate.getDate() + 1);
                if (date <= fromDate) {
                    date.setDate(date.getDate() + 1);
                }
            }
        }
    }

    return date.toISOString();
}

function get24HoursFromNow() {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    return future.toISOString();
}

function utcToDisplay(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    if (isToday) return time;
    if (isTomorrow) return `tomorrow ${time}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
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
        availableToUTC: localTimeToUTC(untilLocal, true, fromLocal) || get24HoursFromNow(),
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

function editEntry(id) {
    const entry = queue.find(e => e.id === id);
    if (!entry || !isMyEntry(id)) return;

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-credits').value = entry.credits;
    document.getElementById('edit-stations').value = entry.stations;
    document.getElementById('edit-missions').value = entry.missions || 20;
    document.getElementById('edit-from').value = utcToTimeInput(entry.availableFromUTC);
    document.getElementById('edit-until').value = utcToTimeInput(entry.availableToUTC);

    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const newFrom = document.getElementById('edit-from').value;
    const newUntil = document.getElementById('edit-until').value;

    updateEntry(id, {
        credits: parseInt(document.getElementById('edit-credits').value) || 0,
        stations: parseInt(document.getElementById('edit-stations').value) || 4,
        missions: parseInt(document.getElementById('edit-missions').value) || 20,
        availableFromUTC: localTimeToUTC(newFrom),
        availableToUTC: localTimeToUTC(newUntil, true, newFrom) || get24HoursFromNow()
    });

    closeEditModal();
}

function utcToTimeInput(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
}

async function updateEntry(id, data) {
    await fetch(`/api/queue/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
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

document.getElementById('add-form').addEventListener('submit', addEntry);
document.getElementById('copy-btn').addEventListener('click', copyForDiscord);
document.getElementById('clear-btn').addEventListener('click', clearMyEntries);
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
