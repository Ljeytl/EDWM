# Elite Dangerous Wing Mission Share (EDWM)

**Live App**: https://ed-wmm-production.up.railway.app/

A lightweight webapp for coordinating Elite Dangerous massacre mission wing shares. Replaces Discord chat coordination with a structured queue interface.

## Features

- **Queue Management** - Join queue with credits, stations, missions, availability window
- **Wing Formation** - Auto-detects when 4 unique CMDRs are ready, Ready Up system
- **Time Windows** - Set when you're available, auto-shows as Ready/Waiting
- **Real-time Updates** - Polling every 5 seconds
- **Sound Alerts** - Optional notification when wing is forming
- **Anti-grief** - Only you can edit/remove your entries (localStorage tracking)
- **Admin Panel** - `/admin` for history, debug info, backup/restore
- **Copy for Discord** - One-click formatted queue for sharing

## Tech Stack

- **Backend**: Python Flask
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Persistence**: Redis (Railway) / JSON file (local dev)

## Running Locally

```bash
# Clone
git clone https://github.com/Ljeytl/EDWM.git
cd EDWM

# Setup
python3 -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt

# Run
python3 app.py
# Open http://localhost:5001
```

## Deploying to Railway

1. Push to GitHub
2. Create new Railway project from repo
3. Add Redis database service
4. Link Redis to app (add `REDIS_URL` variable)
5. Deploy

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_URL` | Redis connection string | For persistence on Railway |
| `PORT` | Server port (default 5001) | No |

## Admin Access

Navigate to `/admin` and enter password (default: `wmm2026`)

## Links

- [PTN AFK Laser Disco Guide](https://pilotstradenetwork.com/guides/afk-laser-disco/)
- [PTN Wing Mining Missions](https://pilotstradenetwork.com/guides/wing-mining-missions/)

## Disclaimer

Not affiliated with Pilots Trade Network (PTN) or Frontier Developments.
Elite Dangerous is a trademark of Frontier Developments plc.

## License

MIT - Built by CMDR Ljeytl
