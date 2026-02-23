# TaskFlow — Agency Task Manager

A full-stack task allocation web app for digital marketing agencies.

## Features
- 🔐 Login for Admin + Team Members
- 📋 Add tasks with urgency levels (Low / Medium / High / Critical)
- 🤖 Auto-assign to the least-loaded team member per role
- ⏱️ 2-day buffer auto-applied to all task deadlines (Mon–Sat working days)
- 📅 Daily / Weekly / Monthly task views
- 👥 Team management (add/remove members with roles)
- ⚙️ Settings: manage roles, task types & daily capacities
- 🔄 Re-assignment preview before saving a task

---

## Setup Instructions

### 1. Install dependencies
```bash
cd agency-task-manager
npm install
```

### 2. Configure environment
Edit `.env` with your settings:
```
PORT=3000
JWT_SECRET=your-strong-secret-key-here
DB_PATH=./agency_tasks.db
```

### 3. Start the server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 4. Open in browser
```
http://localhost:3000
```

### Default Admin Login
- **Email:** admin@agency.com
- **Password:** Admin@1234

---

## Hostinger Node.js Deployment

1. Upload all files to your Hostinger Node.js hosting (via FTP or Git)
2. Set the **entry point** to `server.js`
3. Set environment variables in the Hostinger panel:
   - `JWT_SECRET` → a long random string
   - `PORT` → as provided by Hostinger (usually auto-set)
4. Run `npm install` via Hostinger's terminal
5. Start the app

---

## Pre-loaded Data

On first run, the database is seeded with:

### Roles
- Designer
- Video Editor
- Content Writer
- Social Media Manager

### Task Types & Capacities
| Task Type | Role | Daily Capacity |
|---|---|---|
| Graphic Design | Designer | 2/day |
| Ad Creative | Designer | 2/day |
| Story Design | Designer | 4/day |
| Email Template | Designer | 2/day |
| Reels | Video Editor | 4/day |
| Video Editing | Video Editor | 2/day |
| Content Writing | Content Writer | 4/day |
| Blog Post | Content Writer | 2/day |
| Caption Writing | Content Writer | 6/day |
| Social Media Post | Social Media Manager | 6/day |
| Campaign Planning | Social Media Manager | 2/day |

All capacities can be updated from **Settings → Task Types**.
