from flask import Flask, jsonify, request, render_template
from datetime import datetime, timedelta
import uuid
import json
import os

app = Flask(__name__)

DATA_FILE = 'queue_data.json'
EXPIRY_HOURS = 24

def load_queue():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_queue(q):
    with open(DATA_FILE, 'w') as f:
        json.dump(q, f)

queue = load_queue()

def cleanup_expired():
    global queue
    now = datetime.now()
    before = len(queue)
    queue = [e for e in queue if datetime.fromisoformat(e['joined']) > now - timedelta(hours=EXPIRY_HOURS)]
    if len(queue) != before:
        save_queue(queue)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/queue', methods=['GET'])
def get_queue():
    cleanup_expired()
    return jsonify(queue)

@app.route('/api/queue', methods=['POST'])
def add_to_queue():
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
    queue = [e for e in queue if e['id'] != entry_id]
    save_queue(queue)
    return jsonify({'success': True})

@app.route('/api/queue/clear', methods=['POST'])
def clear_queue():
    global queue
    queue = []
    save_queue(queue)
    return jsonify({'success': True})

ADMIN_PASSWORD = 'wmm2024'  # Change this!

@app.route('/api/queue/admin-clear', methods=['POST'])
def admin_clear_queue():
    global queue
    data = request.json or {}
    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 403
    queue = []
    save_queue(queue)
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
