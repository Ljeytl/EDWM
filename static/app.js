/**
 * EDWM - Elite Dangerous Wing Mission Share
 * Frontend Application
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    READY_UP_TIMEOUT: 15 * 60 * 1000,  // 15 minutes
    POLL_INTERVAL: 5000,                // 5 seconds
    GRACE_MINUTES: 5,                   // Time window grace period
    ENTRY_GRACE_HOURS: 1                // Grace for "from" time entry
};

// ============================================
// State
// ============================================
let queue = [];
let wings = [];
let partyAlertShown = false;

// ============================================
// Local Storage (Entry Ownership)
// ============================================
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

// ============================================
// API Functions
// ============================================
async function fetchQueue() {
    try {
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
    } catch (err) {
        console.error('Failed to fetch queue:', err);
    }
}

async function updateEntry(id, data) {
    await fetch(`/api/queue/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    fetchQueue();
}

async function deleteEntry(id) {
    await fetch(`/api/queue/${id}`, { method: 'DELETE' });
}

// ============================================
// Time Utilities
// ============================================
function isWithinTimeWindow(entry) {
    const now = new Date();
    const graceMs = CONFIG.GRACE_MINUTES * 60 * 1000;

    if (entry.availableFromUTC) {
        const from = new Date(entry.availableFromUTC);
        if (now < new Date(from.getTime() - graceMs)) return false;
    }

    if (entry.availableToUTC) {
        const until = new Date(entry.availableToUTC);
        if (now > new Date(until.getTime() + graceMs)) return false;
    }

    return true;
}

function localTimeToUTC(timeStr, isUntil = false, fromTimeStr = '') {
    if (!timeStr) return '';

    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);

    const now = new Date();
    const graceMs = CONFIG.ENTRY_GRACE_HOURS * 60 * 60 * 1000;

    // "From" time: if more than 1 hour in past, assume tomorrow
    if (!isUntil && date < new Date(now.getTime() - graceMs)) {
        date.setDate(date.getDate() + 1);
    }

    // "Until" time: smart next-day logic
    if (isUntil) {
        if (date < now) {
            date.setDate(date.getDate() + 1);
        }
        if (fromTimeStr) {
            const [fh, fm] = fromTimeStr.split(':').map(Number);
            if (h < fh || (h === fh && m < fm)) {
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

function utcToDisplay(isoStr) {
    if (!isoStr) return '';

    const d = new Date(isoStr);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const time = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    if (d.toDateString() === now.toDateString()) return time;
    if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function utcToTimeInput(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function get24HoursFromNow() {
    const future = new Date();
    future.setHours(future.getHours() + 24);
    return future.toISOString();
}

// ============================================
// Queue Logic
// ============================================
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

// ============================================
// Wing Formation Logic
// ============================================
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

        if (wing.length === 4) {
            potentialWings.push(wing);
            wing.forEach(e => assigned.add(e.id));
        } else {
            break;
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
    return null;
}

function checkPartyReady() {
    const potentialWings = getPotentialWings();

    for (const wing of potentialWings) {
        const userInWing = wing.some(e => isMyEntry(e.id));
        const userReadiedUp = wing.find(e => isMyEntry(e.id))?.readyUp;

        if (userInWing && !userReadiedUp && !partyAlertShown) {
            showPartyAlert(wing);
            playNotification();
            partyAlertShown = true;
            return;
        }
    }

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
            if (now - readyUpAt > CONFIG.READY_UP_TIMEOUT) {
                resetReadyUp(entry.id);
            }
        }
    });
}

async function resetReadyUp(id) {
    await updateEntry(id, { readyUp: false, readyUpTime: null });
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

// ============================================
// Rendering
// ============================================
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
            </div>
        `;
    }).join('');
}

function renderQueue() {
    const tbody = document.getElementById('queue-body');
    const systemQueue = getSystemQueue();
    const readyQueue = getReadyQueue();

    if (systemQueue.length === 0) {
        const sys = getCurrentSystem();
        const sysDisplay = sys.charAt(0).toUpperCase() + sys.slice(1);
        tbody.innerHTML = `<tr><td colspan="7" class="empty">No CMDRs in ${sysDisplay} Queue</td></tr>`;
        updateSlots(0, []);
        return;
    }

    // Get unique CMDRs for slots
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

    // Sort: ready first, then waiting
    const sorted = [...systemQueue].sort((a, b) => {
        const aReady = getEffectiveStatus(a) === 'ready';
        const bReady = getEffectiveStatus(b) === 'ready';
        if (aReady !== bReady) return bReady - aReady;
        if (aReady) {
            return new Date(a.readySince || a.joined) - new Date(b.readySince || b.joined);
        }
        return new Date(a.joined) - new Date(b.joined);
    });

    tbody.innerHTML = sorted.map(entry => renderQueueRow(entry, readyQueue)).join('');
}

function renderQueueRow(entry, readyQueue) {
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

    const statusBadge = getStatusBadge(status, entry.readyUp, wingNum, pos);
    const actions = mine ? getActionButtons(entry, status, inPotentialWing) : '';

    return `
        <tr class="${status} ${inPotentialWing ? 'in-party' : ''} ${mine ? 'mine' : ''}">
            <td class="cmdr">
                ${esc(entry.cmdr)}
                ${mine ? '<span class="you">(you)</span>' : ''}
                ${wingNum ? `<span class="wing-num">W${wingNum}</span>` : ''}
            </td>
            <td class="stack">${entry.credits}M</td>
            <td class="stations">${entry.stations}</td>
            <td class="missions">${entry.missions || 20}</td>
            <td class="available">${timeDisplay}</td>
            <td class="status-cell">${statusBadge}</td>
            <td class="actions">${actions}</td>
        </tr>
    `;
}

function getStatusBadge(status, readyUp, wingNum, pos) {
    if (status === 'ready' && readyUp) {
        return `<span class="badge readied-up">✓ W${wingNum}</span>`;
    }
    if (status === 'ready' && wingNum) {
        return `<span class="badge ready">W${wingNum} #${pos}</span>`;
    }
    if (status === 'ready') {
        return `<span class="badge ready">Ready</span>`;
    }
    return `<span class="badge waiting">Waiting</span>`;
}

function getActionButtons(entry, status, inPotentialWing) {
    let buttons = '';

    if (status === 'ready' && inPotentialWing && !entry.readyUp) {
        buttons += `<button onclick="readyUp('${entry.id}')" class="btn-readyup">Ready Up!</button>`;
    }
    if (status === 'ready' && !inPotentialWing) {
        buttons += `<button onclick="leaveQueue('${entry.id}')" class="btn-done">Leave</button>`;
    }
    if (status !== 'ready') {
        buttons += `<button onclick="markReady('${entry.id}')" class="btn-ready">Ready</button>`;
    }

    buttons += `<button onclick="editEntry('${entry.id}')" class="btn-edit">✏️</button>`;
    buttons += `<button onclick="removeEntry('${entry.id}')" class="btn-x">×</button>`;

    return buttons;
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

// ============================================
// User Actions
// ============================================
async function addEntry(e) {
    e.preventDefault();

    const fromLocal = document.getElementById('available-from').value;
    const untilLocal = document.getElementById('available-to').value;

    const data = {
        cmdr: document.getElementById('cmdr').value.trim(),
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

    // Clear form
    document.getElementById('cmdr').value = '';
    document.getElementById('credits').value = '';
    document.getElementById('available-from').value = '';
    document.getElementById('available-to').value = '';

    fetchQueue();
}

async function markReady(id) {
    await updateEntry(id, {
        status: 'ready',
        readySince: new Date().toISOString()
    });
}

async function leaveQueue(id) {
    if (!isMyEntry(id)) return;
    await deleteEntry(id);
    removeMyEntry(id);
    toast('Removed - thanks for sharing!');
    fetchQueue();
}

async function removeEntry(id) {
    if (!isMyEntry(id)) return;
    await deleteEntry(id);
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
        await deleteEntry(id);
    }

    localStorage.setItem('myEntries', '[]');
    partyAlertShown = false;
    hidePartyAlert();
    fetchQueue();
}

// ============================================
// Edit Modal
// ============================================
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

// ============================================
// Notifications & UI
// ============================================
function showPartyAlert(party) {
    const names = party.map(e => e.cmdr).join(', ');
    document.querySelector('.party-alert p').textContent = names;
    document.getElementById('party-alert').classList.remove('hidden');
}

function hidePartyAlert() {
    document.getElementById('party-alert').classList.add('hidden');
}

function playNotification() {
    if (!document.getElementById('sound-toggle')?.checked) return;

    const audio = new Audio('/static/notify.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {
        // Fallback: Web Audio chime
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [523, 659].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                const start = ctx.currentTime + (i * 0.12);
                osc.start(start);
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.04, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
                osc.stop(start + 0.4);
            });
        } catch (e) {}
    });
}

function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

function copyForDiscord() {
    const system = document.getElementById('system').value || 'Anana';
    const ready = getReadyQueue();
    const systemQueue = getSystemQueue();
    const waiting = systemQueue.filter(e => getEffectiveStatus(e) !== 'ready');

    let text = `**${system} WMM Queue**\n`;

    if (ready.length >= 4) {
        text += `\n🎯 **WING READY**\n`;
    }

    ready.forEach((e, i) => {
        const marker = i < 4 ? '→' : ' ';
        text += `${marker} ${i + 1}. ${e.cmdr} | ${e.credits}M | ${e.stations} stn\n`;
    });

    if (waiting.length) {
        text += `\n**Waiting:**\n`;
        waiting.forEach(e => {
            const until = e.availableToUTC ? utcToDisplay(e.availableToUTC) : 'Now';
            text += `- ${e.cmdr} | ${e.credits}M | until ${until}\n`;
        });
    }

    navigator.clipboard.writeText(text).then(() => toast('Copied!'));
}

// ============================================
// Utilities
// ============================================
function esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function setDefaultFromTime() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('available-from').value = `${h}:${m}`;
}

// ============================================
// Event Listeners
// ============================================
document.getElementById('add-form').addEventListener('submit', addEntry);
document.getElementById('copy-btn').addEventListener('click', copyForDiscord);
document.getElementById('clear-btn').addEventListener('click', clearMyEntries);
document.getElementById('dismiss-alert').addEventListener('click', hidePartyAlert);
document.getElementById('system').addEventListener('input', renderQueue);

// ============================================
// Initialize
// ============================================
setDefaultFromTime();
fetchQueue();
setInterval(fetchQueue, CONFIG.POLL_INTERVAL);
