# OMNES Media Group CRM — Developer Deployment Guide

## Overview

This is a full-stack web application:

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | React 18 + Vite                     |
| Backend    | Node.js 18+ / Express               |
| Database   | PostgreSQL 15+                      |
| Auth       | JWT (Bearer tokens, 8-hour sessions)|

---

## Project Structure

```
omnes-crm/
├── backend/
│   ├── src/
│   │   ├── server.js          ← Express entry point
│   │   ├── db/
│   │   │   ├── pool.js        ← PostgreSQL connection pool
│   │   │   ├── schema.sql     ← Run this first to create tables
│   │   │   └── seed.js        ← Seed demo users and data
│   │   ├── middleware/
│   │   │   └── auth.js        ← JWT verify + RBAC middleware
│   │   └── routes/
│   │       ├── auth.js        ← /api/auth/*
│   │       ├── users.js       ← /api/users/*
│   │       ├── leads.js       ← /api/leads/*
│   │       └── activities.js  ← /api/activities/* + /api/reports/*
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── main.jsx           ← React entry point
    │   ├── App.jsx            ← Full application UI
    │   └── api.js             ← All API calls (single source of truth)
    ├── index.html
    ├── vite.config.js
    ├── .env.example
    └── package.json
```

---

## Step-by-Step Deployment

### 1. Prerequisites

Install these on the server:
- **Node.js 18+**: https://nodejs.org
- **PostgreSQL 15+**: https://postgresql.org
- **Git**: to pull code

```bash
node --version   # must be >= 18
psql --version   # must be >= 15
```

---

### 2. Database Setup

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Create database and user
CREATE DATABASE omnes_crm;
CREATE USER omnes_user WITH ENCRYPTED PASSWORD 'your_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE omnes_crm TO omnes_user;
\q

# Run the schema to create all tables
psql -U omnes_user -d omnes_crm -f backend/db/schema.sql
```

---

### 3. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://omnes_user:your_strong_password_here@localhost:5432/omnes_crm
PORT=4000
NODE_ENV=production
JWT_SECRET=generate_this_with_openssl_rand_hex_32
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=12
CORS_ORIGINS=https://crm.omnesmedia.com
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# Seed the database with initial users and demo data
npm run seed

# Start the server (development)
npm run dev

# Start the server (production)
npm start
```

The API will be available at: `http://localhost:4000`

Test it:
```bash
curl http://localhost:4000/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

Edit `frontend/.env`:
```
VITE_API_URL=https://api.omnesmedia.com
# Or if running on same server with nginx proxy:
# VITE_API_URL=
```

```bash
# Build for production
npm run build
# Output goes to: frontend/dist/

# Or run dev server
npm run dev
# Available at: http://localhost:5173
```

---

### 5. Production Server Setup (Recommended: Ubuntu + Nginx + PM2)

#### Install PM2 (process manager)
```bash
npm install -g pm2
```

#### Start backend with PM2
```bash
cd backend
pm2 start src/server.js --name omnes-crm-api
pm2 save
pm2 startup    # auto-restart on server reboot
```

#### Nginx Configuration
```nginx
# /etc/nginx/sites-available/omnes-crm

# Frontend
server {
    listen 80;
    server_name crm.omnesmedia.com;

    root /var/www/omnes-crm/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;  # SPA routing
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/omnes-crm /etc/nginx/sites-enabled/
nginx -t        # test config
systemctl reload nginx

# Add HTTPS with Let's Encrypt (strongly recommended)
apt install certbot python3-certbot-nginx
certbot --nginx -d crm.omnesmedia.com
```

---

### 6. Alternative: Deploy to Railway / Render (Fastest Option)

If you want to skip server management entirely:

**Backend on Railway:**
1. Go to https://railway.app → New Project → Deploy from GitHub
2. Add PostgreSQL plugin (auto-creates DATABASE_URL)
3. Set environment variables (JWT_SECRET, CORS_ORIGINS, etc.)
4. Deploy — Railway auto-runs `npm start`

**Frontend on Vercel:**
1. Go to https://vercel.com → Import project
2. Set `VITE_API_URL` to your Railway backend URL
3. Deploy — Vercel auto-runs `npm run build`

Total setup time: ~30 minutes.

---

## API Reference

| Method | Endpoint                          | Access        | Description               |
|--------|-----------------------------------|---------------|---------------------------|
| POST   | /api/auth/login                   | Public        | Login, returns JWT token  |
| POST   | /api/auth/logout                  | Auth          | Invalidate session        |
| GET    | /api/auth/me                      | Auth          | Get current user          |
| POST   | /api/auth/change-password         | Auth          | Change own password       |
| GET    | /api/users                        | Auth          | List all users            |
| POST   | /api/users                        | Admin         | Invite new user           |
| PATCH  | /api/users/:id                    | Admin         | Update role/team/status   |
| POST   | /api/users/:id/reset-password     | Super Admin   | Force password reset      |
| GET    | /api/leads                        | Auth          | List leads (filtered)     |
| POST   | /api/leads                        | Auth (non-viewer) | Create lead           |
| PATCH  | /api/leads/:id                    | Auth (non-viewer) | Update lead           |
| DELETE | /api/leads/:id                    | Manager+      | Delete lead               |
| GET    | /api/activities                   | Auth          | List activities           |
| POST   | /api/activities                   | Auth (non-viewer) | Log activity          |
| GET    | /api/reports/summary              | Manager+      | Full report data          |
| GET    | /api/reports/audit                | Super Admin   | Audit log                 |

---

## Default User Accounts

All accounts use password: **`Omnes2026!`**

Users are **forced to change their password** on first login.

| Name               | Email                     | Role          | Team       |
|--------------------|---------------------------|---------------|------------|
| Layla Al Mansoori  | layla@omnesmedia.com      | Super Admin   | Management |
| James Carter       | james@omnesmedia.com      | Sales Manager | UAE Sales  |
| Sara Khalid        | sara@omnesmedia.com       | Sales Rep     | UAE Sales  |
| Rami Hassan        | rami@omnesmedia.com       | Sales Rep     | KSA Sales  |
| Nour Farouk        | nour@omnesmedia.com       | Viewer        | Finance    |

---

## Role Permissions

| Feature              | Super Admin | Admin | Sales Manager | Sales Rep | Viewer |
|----------------------|:-----------:|:-----:|:-------------:|:---------:|:------:|
| View own leads       | ✅          | ✅    | ✅            | ✅        | ✅     |
| View all leads       | ✅          | ✅    | ✅            | ❌        | ❌     |
| Create/edit leads    | ✅          | ✅    | ✅            | ✅        | ❌     |
| Delete leads         | ✅          | ✅    | ✅            | ❌        | ❌     |
| Log activities       | ✅          | ✅    | ✅            | ✅        | ❌     |
| View reports         | ✅          | ✅    | ✅            | ❌        | ❌     |
| Manage users         | ✅          | ✅    | ❌            | ❌        | ❌     |
| Reset passwords      | ✅          | ❌    | ❌            | ❌        | ❌     |
| View audit log       | ✅          | ❌    | ❌            | ❌        | ❌     |

---

## Security Checklist

Before going live, confirm:

- [ ] `JWT_SECRET` is a random 32+ byte hex string (not a human-readable word)
- [ ] `BCRYPT_ROUNDS` is 12 or higher
- [ ] `NODE_ENV=production` is set
- [ ] HTTPS is enabled (via Let's Encrypt or your hosting provider)
- [ ] `CORS_ORIGINS` is set to your exact frontend domain only
- [ ] PostgreSQL is not publicly accessible (only accessible from the app server)
- [ ] All demo passwords have been changed
- [ ] Regular PostgreSQL backups are configured

---

## Estimated Deployment Time

| Path                          | Time       |
|-------------------------------|------------|
| Railway + Vercel (cloud)      | 30–60 min  |
| Ubuntu VPS + Nginx (self-host)| 2–4 hours  |

---

## Support

For questions about this codebase, refer back to Claude (OMNES CRM was designed to be extended).
Suggested next features:
- Email notifications via SendGrid/Mailgun
- Calendar/meeting integration
- WhatsApp/Teams notifications
- Mobile-responsive layout
- File attachments on deals
