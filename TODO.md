# WMM TODO / Roadmap

## Staged (Ready to Deploy)
- [x] 1-hour grace period for "From" time entry (fixes "tomorrow" bug)
- [x] 5-min grace on time window checks (ready 5min early, stay 5min late)
- [x] Admin export/import backup feature
- [x] Fixed "Waiting" status showing for ready entries

## Bugs to Investigate
- [ ] 12 PM to 12 AM time flip - need more details to reproduce
- [ ] Verify Redis data survives deploys

## Features - Soon
- [ ] Credits per wing display (sum of 4 members)
- [ ] Quick info section on main page (how it works, process, find your system)
- [ ] Separate /info page later (leaderboard, detailed FAQ, admin access)
- [ ] Link to PTN AFK Guide: https://pilotstradenetwork.com/guides/afk-laser-disco/
- [ ] Logs export (admin) - activity logs for debugging
- [ ] Analytics/SLI - unique visitors, traffic stats (Plausible/Umami or Redis counter)

## Features - Later
- [ ] Leaderboard tab (public!) - track credits earned per CMDR, show on main page
- [ ] Discord bot integration (BLOCKER: requires PTN approval if integrating with their server)
  - Queue commands from Discord
  - Notifications when wing forming
  - Sync between web and Discord

- [ ] Timezone indicator on times (e.g., "21:31 PST")
- [ ] Better midnight/12am display

## Done
- [x] Redis persistence for Railway
- [x] Wing ready-up system
- [x] Parallel wings support
- [x] Edit entry modal
- [x] Admin page (/admin)
- [x] History logging
- [x] Sound notifications (toggleable)
- [x] Smart time logic (next-day for until times)
- [x] Anti-grief (localStorage ownership)
- [x] Admin: delete individual entries
- [x] Admin: edit any entry
- [x] Admin: force ready/ready-up status
- [x] Admin: kick from wing (returns to queue)
- [x] Code cleanup (CSS variables, JS CONFIG, Python organization)
