from flask import Flask, jsonify, request, render_template
from datetime import datetime, timedelta
import uuid
import json
import os

app = Flask(__name__)

# Use absolute path for data file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'queue_data.json')

EXPIRY_HOURS = 24
ADMIN_PASSWORD = 'wmm2026'

# Redis setup (falls back to JSON file for local dev)
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
        redis_client.ping()  # Test connection
    except Exception as e:
        print(f"Redis connection failed: {e}")
        redis_client = None

def load_queue():
    if redis_client:
        data = redis_client.get('wmm:queue')
        return json.loads(data) if data else []
    else:
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []

def save_queue(q):
    if redis_client:
        redis_client.set('wmm:queue', json.dumps(q))
    else:
        with open(DATA_FILE, 'w') as f:
            json.dump(q, f)

def load_wings():
    if redis_client:
        data = redis_client.get('wmm:wings')
        return json.loads(data) if data else []
    return []

def save_wings(w):
    if redis_client:
        redis_client.set('wmm:wings', json.dumps(w))

def load_history():
    if redis_client:
        data = redis_client.get('wmm:history')
        return json.loads(data) if data else []
    else:
        history_file = os.path.join(BASE_DIR, 'history.json')
        if os.path.exists(history_file):
            try:
                with open(history_file, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []

def save_history(h):
    # Keep last 500 entries
    h = h[-500:]
    if redis_client:
        redis_client.set('wmm:history', json.dumps(h))
    else:
        with open(os.path.join(BASE_DIR, 'history.json'), 'w') as f:
            json.dump(h, f)

def log_entry(entry, status):
    history = load_history()
    history.append({
        'cmdr': entry.get('cmdr'),
        'credits': entry.get('credits'),
        'system': entry.get('system'),
        'status': status,  # 'expired', 'wing_formed', 'left', 'completed'
        'timestamp': datetime.now().isoformat(),
        'original_id': entry.get('id')
    })
    save_history(history)

queue = load_queue()
wings = load_wings()

def cleanup_expired():
    global queue
    now = datetime.now()
    before = len(queue)

    def is_valid(entry):
        # If has end time, expire 1 hour after end time
        if entry.get('availableToUTC'):
            try:
                end_time = datetime.fromisoformat(entry['availableToUTC'].replace('Z', '+00:00')).replace(tzinfo=None)
                return now < end_time + timedelta(hours=1)
            except:
                pass
        # If has start time but no end time, expire 24 hours after start time
        if entry.get('availableFromUTC'):
            try:
                start_time = datetime.fromisoformat(entry['availableFromUTC'].replace('Z', '+00:00')).replace(tzinfo=None)
                return now < start_time + timedelta(hours=EXPIRY_HOURS)
            except:
                pass
        # No times at all - expire 24 hours after joining
        return datetime.fromisoformat(entry['joined']) > now - timedelta(hours=EXPIRY_HOURS)

    expired = [e for e in queue if not is_valid(e)]
    queue = [e for e in queue if is_valid(e)]

    # Log expired entries
    for e in expired:
        log_entry(e, 'expired')

    if len(queue) != before:
        save_queue(queue)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/api/queue', methods=['GET'])
def get_queue():
    global queue
    queue = load_queue()  # Reload from Redis for fresh data
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

            entry['status'] = new_status
            entry['availableFromUTC'] = data.get('availableFromUTC', entry.get('availableFromUTC', ''))
            entry['availableToUTC'] = data.get('availableToUTC', entry.get('availableToUTC', ''))
            entry['credits'] = data.get('credits', entry['credits'])
            entry['stations'] = data.get('stations', entry['stations'])
            if 'readyUp' in data:
                entry['readyUp'] = data['readyUp']
            if 'readyUpTime' in data:
                entry['readyUpTime'] = data['readyUpTime']

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

def is_within_time_window(entry):
    now = datetime.now()
    GRACE_MINS = 5  # 5 min grace on both ends

    if entry.get('availableFromUTC'):
        try:
            from_time = datetime.fromisoformat(entry['availableFromUTC'].replace('Z', '+00:00')).replace(tzinfo=None)
            # Ready up to 5 mins early
            if now < from_time - timedelta(minutes=GRACE_MINS):
                return False
        except:
            pass
    if entry.get('availableToUTC'):
        try:
            to_time = datetime.fromisoformat(entry['availableToUTC'].replace('Z', '+00:00')).replace(tzinfo=None)
            # Stay ready up to 5 mins after window closes
            if now > to_time + timedelta(minutes=GRACE_MINS):
                return False
        except:
            pass
    return True

def check_form_wing():
    global wings, queue
    systems = set(e.get('system', 'Anana').lower() for e in queue)
    for sys in systems:
        sys_queue = [e for e in queue if e.get('system', 'Anana').lower() == sys.lower()]
        # Only include entries that are ready AND within their time window
        ready = [e for e in sys_queue if e.get('status') == 'ready' and e.get('readyUp') and is_within_time_window(e)]
        ready.sort(key=lambda x: x.get('readySince', x.get('joined')))

        wing_members = []
        used_cmdrs = set()
        for entry in ready:
            cmdr_lower = entry['cmdr'].lower().strip()
            if cmdr_lower not in used_cmdrs:
                wing_members.append(entry)
                used_cmdrs.add(cmdr_lower)
            if len(wing_members) == 4:
                break

        if len(wing_members) == 4:
            wing = {
                'id': str(uuid.uuid4()),
                'system': sys,
                'members': wing_members,
                'formed': datetime.now().isoformat()
            }
            wings.append(wing)
            save_wings(wings)
            # Log wing formation
            for m in wing_members:
                log_entry(m, 'wing_formed')
            member_ids = [m['id'] for m in wing_members]
            queue[:] = [e for e in queue if e['id'] not in member_ids]
            save_queue(queue)

@app.route('/api/queue/admin-clear', methods=['POST'])
def admin_clear_queue():
    global queue, wings
    data = request.json or {}
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    # Log all cleared entries
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
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    return jsonify(load_history())

@app.route('/api/admin/debug', methods=['POST'])
def debug_info():
    data = request.json or {}
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    return jsonify({
        'redis_connected': redis_client is not None,
        'redis_url_set': REDIS_URL is not None,
        'queue_count': len(queue),
        'wings_count': len(wings)
    })

@app.route('/api/admin/clear-history', methods=['POST'])
def clear_history():
    data = request.json or {}
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    save_history([])
    return jsonify({'success': True})

@app.route('/api/admin/export', methods=['POST'])
def export_data():
    data = request.json or {}
    if data.get('password') != ADMIN_PASSWORD:
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
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    if 'queue' in data:
        queue = data['queue']
        save_queue(queue)
    if 'wings' in data:
        wings = data['wings']
        save_wings(wings)
    if 'history' in data:
        save_history(data['history'])
    return jsonify({'success': True, 'imported': {'queue': len(queue), 'wings': len(wings)}})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=False, host='0.0.0.0', port=port)
