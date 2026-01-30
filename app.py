"""
EDWM - Elite Dangerous Wing Mission Share
Backend API Server
"""

from flask import Flask, jsonify, request, render_template
from datetime import datetime, timedelta
import uuid
import json
import os

# ============================================
# Configuration
# ============================================
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'queue_data.json')
HISTORY_FILE = os.path.join(BASE_DIR, 'history.json')

CONFIG = {
    'EXPIRY_HOURS': 24,
    'HISTORY_LIMIT': 500,
    'ADMIN_PASSWORD': 'wmm2026',
    'GRACE_MINUTES': 5
}

# ============================================
# Redis Setup
# ============================================
redis_client = None
REDIS_URL = (
    os.environ.get('REDIS_URL') or
    os.environ.get('REDIS_PRIVATE_URL') or
    os.environ.get('REDIS_PUBLIC_URL')
)

if REDIS_URL:
    import redis
    try:
        redis_client = redis.from_url(REDIS_URL)
        redis_client.ping()
    except Exception as e:
        print(f"Redis connection failed: {e}")
        redis_client = None

# ============================================
# Data Access Layer
# ============================================
def load_json_file(filepath, default=None):
    """Load JSON from file with fallback to default."""
    if default is None:
        default = []
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except:
            return default
    return default


def save_json_file(filepath, data):
    """Save data as JSON to file."""
    with open(filepath, 'w') as f:
        json.dump(data, f)


def load_queue():
    """Load queue from Redis or local file."""
    if redis_client:
        data = redis_client.get('wmm:queue')
        return json.loads(data) if data else []
    return load_json_file(DATA_FILE)


def save_queue(q):
    """Save queue to Redis or local file."""
    if redis_client:
        redis_client.set('wmm:queue', json.dumps(q))
    else:
        save_json_file(DATA_FILE, q)


def load_wings():
    """Load active wings from Redis."""
    if redis_client:
        data = redis_client.get('wmm:wings')
        return json.loads(data) if data else []
    return []


def save_wings(w):
    """Save active wings to Redis."""
    if redis_client:
        redis_client.set('wmm:wings', json.dumps(w))


def load_history():
    """Load history from Redis or local file."""
    if redis_client:
        data = redis_client.get('wmm:history')
        return json.loads(data) if data else []
    return load_json_file(HISTORY_FILE)


def save_history(h):
    """Save history (capped at limit) to Redis or local file."""
    h = h[-CONFIG['HISTORY_LIMIT']:]
    if redis_client:
        redis_client.set('wmm:history', json.dumps(h))
    else:
        save_json_file(HISTORY_FILE, h)


# ============================================
# History Logging
# ============================================
def log_entry(entry, status):
    """Log an entry event to history."""
    history = load_history()
    history.append({
        'cmdr': entry.get('cmdr'),
        'credits': entry.get('credits'),
        'system': entry.get('system'),
        'status': status,
        'timestamp': datetime.now().isoformat(),
        'original_id': entry.get('id')
    })
    save_history(history)


# ============================================
# Time Utilities
# ============================================
def parse_iso_datetime(iso_str):
    """Parse ISO datetime string to datetime object."""
    if not iso_str:
        return None
    try:
        return datetime.fromisoformat(iso_str.replace('Z', '+00:00')).replace(tzinfo=None)
    except:
        return None


def is_within_time_window(entry):
    """Check if entry is within their available time window (with grace period)."""
    now = datetime.now()
    grace = timedelta(minutes=CONFIG['GRACE_MINUTES'])

    from_time = parse_iso_datetime(entry.get('availableFromUTC'))
    if from_time and now < from_time - grace:
        return False

    to_time = parse_iso_datetime(entry.get('availableToUTC'))
    if to_time and now > to_time + grace:
        return False

    return True


def is_entry_valid(entry):
    """Check if entry should still be in queue (not expired)."""
    now = datetime.now()
    expiry = timedelta(hours=CONFIG['EXPIRY_HOURS'])

    # Has end time: expire 1 hour after
    to_time = parse_iso_datetime(entry.get('availableToUTC'))
    if to_time:
        return now < to_time + timedelta(hours=1)

    # Has start time only: expire after EXPIRY_HOURS
    from_time = parse_iso_datetime(entry.get('availableFromUTC'))
    if from_time:
        return now < from_time + expiry

    # No times: expire EXPIRY_HOURS after joining
    joined = parse_iso_datetime(entry.get('joined'))
    if joined:
        return now < joined + expiry

    return False


# ============================================
# Queue Management
# ============================================
queue = load_queue()
wings = load_wings()


def cleanup_expired():
    """Remove expired entries from queue."""
    global queue

    expired = [e for e in queue if not is_entry_valid(e)]
    queue = [e for e in queue if is_entry_valid(e)]

    for e in expired:
        log_entry(e, 'expired')

    if expired:
        save_queue(queue)


def check_form_wing():
    """Check if any system has 4 ready CMDRs to form a wing."""
    global wings, queue

    systems = set(e.get('system', 'Anana').lower() for e in queue)

    for sys in systems:
        sys_queue = [e for e in queue if e.get('system', 'Anana').lower() == sys]
        ready = [
            e for e in sys_queue
            if e.get('status') == 'ready'
            and e.get('readyUp')
            and is_within_time_window(e)
        ]
        ready.sort(key=lambda x: x.get('readySince', x.get('joined')))

        # Build wing with unique CMDRs
        wing_members = []
        used_cmdrs = set()

        for entry in ready:
            cmdr_lower = entry['cmdr'].lower().strip()
            if cmdr_lower not in used_cmdrs:
                wing_members.append(entry)
                used_cmdrs.add(cmdr_lower)
            if len(wing_members) == 4:
                break

        # Form wing if we have 4
        if len(wing_members) == 4:
            wing = {
                'id': str(uuid.uuid4()),
                'system': sys,
                'members': wing_members,
                'formed': datetime.now().isoformat()
            }
            wings.append(wing)
            save_wings(wings)

            for m in wing_members:
                log_entry(m, 'wing_formed')

            member_ids = {m['id'] for m in wing_members}
            queue[:] = [e for e in queue if e['id'] not in member_ids]
            save_queue(queue)


# ============================================
# Routes: Pages
# ============================================
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/admin')
def admin():
    return render_template('admin.html')


# ============================================
# Routes: Queue API
# ============================================
@app.route('/api/queue', methods=['GET'])
def get_queue():
    global queue
    queue = load_queue()
    cleanup_expired()
    return jsonify(queue)


@app.route('/api/queue', methods=['POST'])
def add_to_queue():
    global queue
    queue = load_queue()

    data = request.json
    now = datetime.now().isoformat()

    entry = {
        'id': str(uuid.uuid4()),
        'cmdr': data.get('cmdr', '').strip(),
        'credits': min(data.get('credits', 0), 999),
        'stations': data.get('stations', 4),
        'missions': data.get('missions', 20),
        'system': data.get('system', 'Anana').strip(),
        'availableFromUTC': data.get('availableFromUTC', ''),
        'availableToUTC': data.get('availableToUTC', ''),
        'status': data.get('status', 'ready'),
        'joined': now,
        'readySince': data.get('readySince', now)
    }

    if not entry['cmdr']:
        return jsonify({'error': 'CMDR name required'}), 400

    queue.append(entry)
    save_queue(queue)
    return jsonify(entry), 201


@app.route('/api/queue/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    global queue
    queue = load_queue()
    data = request.json

    for entry in queue:
        if entry['id'] == entry_id:
            old_status = entry['status']
            new_status = data.get('status', entry['status'])

            # Update fields
            entry['status'] = new_status
            entry['credits'] = data.get('credits', entry['credits'])
            entry['stations'] = data.get('stations', entry['stations'])
            entry['availableFromUTC'] = data.get('availableFromUTC', entry.get('availableFromUTC', ''))
            entry['availableToUTC'] = data.get('availableToUTC', entry.get('availableToUTC', ''))

            if 'readyUp' in data:
                entry['readyUp'] = data['readyUp']
            if 'readyUpTime' in data:
                entry['readyUpTime'] = data['readyUpTime']

            # Update readySince when transitioning to ready
            if 'readySince' in data:
                entry['readySince'] = data['readySince']
            elif old_status != 'ready' and new_status == 'ready':
                entry['readySince'] = datetime.now().isoformat()

            save_queue(queue)
            return jsonify(entry)

    return jsonify({'error': 'Entry not found'}), 404


@app.route('/api/queue/<entry_id>', methods=['DELETE'])
def remove_entry(entry_id):
    global queue
    queue = load_queue()

    removed = [e for e in queue if e['id'] == entry_id]
    if removed:
        log_entry(removed[0], 'left')

    queue = [e for e in queue if e['id'] != entry_id]
    save_queue(queue)
    return jsonify({'success': True})


@app.route('/api/queue/clear', methods=['POST'])
def clear_queue():
    global queue
    queue = []
    save_queue(queue)
    return jsonify({'success': True})


# ============================================
# Routes: Wings API
# ============================================
@app.route('/api/wings', methods=['GET'])
def get_wings():
    global wings
    wings = load_wings()
    return jsonify(wings)


@app.route('/api/ready-up/<entry_id>', methods=['POST'])
def ready_up(entry_id):
    global wings, queue
    queue = load_queue()
    wings = load_wings()

    for entry in queue:
        if entry['id'] == entry_id:
            entry['readyUp'] = True
            entry['readyUpTime'] = datetime.now().isoformat()
            save_queue(queue)
            check_form_wing()
            return jsonify(entry)

    return jsonify({'error': 'Entry not found'}), 404


@app.route('/api/wings/<wing_id>/complete', methods=['POST'])
def complete_wing(wing_id):
    global wings
    wings = load_wings()
    wings = [w for w in wings if w['id'] != wing_id]
    save_wings(wings)
    return jsonify({'success': True})


# ============================================
# Routes: Admin API
# ============================================
def verify_admin(data):
    """Verify admin password from request data."""
    return data.get('password') == CONFIG['ADMIN_PASSWORD']


@app.route('/api/admin/entry/<entry_id>', methods=['DELETE'])
def admin_delete_entry(entry_id):
    """Admin: Delete any entry regardless of ownership."""
    global queue
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    queue = load_queue()
    removed = [e for e in queue if e['id'] == entry_id]

    if not removed:
        return jsonify({'error': 'Entry not found'}), 404

    log_entry(removed[0], 'admin_deleted')
    queue = [e for e in queue if e['id'] != entry_id]
    save_queue(queue)
    return jsonify({'success': True})


@app.route('/api/admin/entry/<entry_id>', methods=['PUT'])
def admin_edit_entry(entry_id):
    """Admin: Edit any entry regardless of ownership."""
    global queue
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    queue = load_queue()

    for entry in queue:
        if entry['id'] == entry_id:
            # Update allowed fields
            if 'cmdr' in data:
                entry['cmdr'] = data['cmdr'].strip()
            if 'credits' in data:
                entry['credits'] = min(data['credits'], 999)
            if 'stations' in data:
                entry['stations'] = data['stations']
            if 'missions' in data:
                entry['missions'] = data['missions']
            if 'status' in data:
                entry['status'] = data['status']
            if 'availableFromUTC' in data:
                entry['availableFromUTC'] = data['availableFromUTC']
            if 'availableToUTC' in data:
                entry['availableToUTC'] = data['availableToUTC']

            save_queue(queue)
            return jsonify(entry)

    return jsonify({'error': 'Entry not found'}), 404


@app.route('/api/admin/entry/<entry_id>/force-ready', methods=['POST'])
def admin_force_ready(entry_id):
    """Admin: Force an entry to ready status."""
    global queue
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    queue = load_queue()

    for entry in queue:
        if entry['id'] == entry_id:
            entry['status'] = 'ready'
            entry['readySince'] = datetime.now().isoformat()
            save_queue(queue)
            return jsonify(entry)

    return jsonify({'error': 'Entry not found'}), 404


@app.route('/api/admin/entry/<entry_id>/force-readyup', methods=['POST'])
def admin_force_readyup(entry_id):
    """Admin: Force ready-up for an entry."""
    global queue, wings
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    queue = load_queue()
    wings = load_wings()

    for entry in queue:
        if entry['id'] == entry_id:
            entry['status'] = 'ready'
            entry['readyUp'] = True
            entry['readyUpTime'] = datetime.now().isoformat()
            save_queue(queue)
            check_form_wing()
            return jsonify(entry)

    return jsonify({'error': 'Entry not found'}), 404


@app.route('/api/admin/wing/<wing_id>/kick/<entry_id>', methods=['POST'])
def admin_kick_from_wing(wing_id, entry_id):
    """Admin: Kick a member from an active wing."""
    global wings, queue
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    wings = load_wings()
    queue = load_queue()

    for wing in wings:
        if wing['id'] == wing_id:
            kicked = [m for m in wing['members'] if m['id'] == entry_id]
            if not kicked:
                return jsonify({'error': 'Member not in wing'}), 404

            kicked_member = kicked[0]

            # Remove from wing
            wing['members'] = [m for m in wing['members'] if m['id'] != entry_id]
            log_entry(kicked_member, 'admin_kicked')

            # Re-add kicked member to queue (back of line, reset ready-up)
            kicked_member['readyUp'] = False
            kicked_member['readyUpTime'] = None
            kicked_member['readySince'] = datetime.now().isoformat()
            queue.append(kicked_member)

            # If wing now has < 4 members, dissolve it and return all to queue
            if len(wing['members']) < 4:
                for member in wing['members']:
                    member['readyUp'] = False
                    member['readyUpTime'] = None
                    member['readySince'] = datetime.now().isoformat()
                    queue.append(member)
                wings = [w for w in wings if w['id'] != wing_id]

            save_wings(wings)
            save_queue(queue)
            return jsonify({'success': True, 'wing_dissolved': len(wing['members']) < 4})

    return jsonify({'error': 'Wing not found'}), 404


@app.route('/api/queue/admin-clear', methods=['POST'])
def admin_clear_queue():
    global queue, wings
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    for e in queue:
        log_entry(e, 'admin_cleared')

    queue = []
    wings = []
    save_queue(queue)
    save_wings(wings)
    return jsonify({'success': True})


@app.route('/api/admin/history', methods=['POST'])
def get_history():
    data = request.json or {}
    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403
    return jsonify(load_history())


@app.route('/api/admin/clear-history', methods=['POST'])
def clear_history():
    data = request.json or {}
    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403
    save_history([])
    return jsonify({'success': True})


@app.route('/api/admin/debug', methods=['POST'])
def debug_info():
    data = request.json or {}
    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403
    return jsonify({
        'redis_connected': redis_client is not None,
        'redis_url_set': REDIS_URL is not None,
        'queue_count': len(queue),
        'wings_count': len(wings)
    })


@app.route('/api/admin/export', methods=['POST'])
def export_data():
    data = request.json or {}
    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403
    return jsonify({
        'queue': load_queue(),
        'wings': load_wings(),
        'history': load_history()
    })


@app.route('/api/admin/import', methods=['POST'])
def import_data():
    global queue, wings
    data = request.json or {}

    if not verify_admin(data):
        return jsonify({'error': 'Invalid password'}), 403

    if 'queue' in data:
        queue = data['queue']
        save_queue(queue)
    if 'wings' in data:
        wings = data['wings']
        save_wings(wings)
    if 'history' in data:
        save_history(data['history'])

    return jsonify({
        'success': True,
        'imported': {'queue': len(queue), 'wings': len(wings)}
    })


# ============================================
# Entry Point
# ============================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=False, host='0.0.0.0', port=port)
