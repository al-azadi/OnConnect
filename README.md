# OnConnect — Stage 1

Independent community platform starter. Stack: Python, Django 5.2 LTS, Django REST
Framework, TypeScript, Vite and a fresh MySQL database named `onconnect_db`.

## Database isolation
This project connects only to `onconnect_db`. It does not read, migrate, or modify
`learningazdev_db` or `devsphere`. Do not change `DB_NAME` to either database.

## Prerequisites
- Python 3.11+ (3.12 recommended)
- Node.js 20+
- MySQL 8
- VS Code

## 1. Create the project directory
Use PowerShell:
```powershell
cd C:\Users\27099\Desktop
mkdir OnConnect
cd OnConnect
```
Extract this starter ZIP into `C:\Users\27099\Desktop\OnConnect`, keeping the
`backend` and `frontend` folders at the project root.

## 2. Create a separate MySQL database and app user
Open MySQL as an administrator:
```powershell
mysql -u root -p
```
Run the following SQL in the MySQL prompt. Choose a strong password and save it
locally; do not send it in chat. If `onconnect_db` or `onconnect_app` already
exists, inspect it first instead of blindly rerunning these statements.
```sql
CREATE DATABASE onconnect_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'onconnect_app'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON onconnect_db.* TO 'onconnect_app'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```
These statements target only the new `onconnect_db` database and `onconnect_app`
account. They do not alter other databases.

## 3. Configure Django
```powershell
cd C:\Users\27099\Desktop\OnConnect
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```
Set `DB_PASSWORD` to the password chosen above. Also replace `DJANGO_SECRET_KEY`
with a long random secret. Keep `.env` private.

## 4. Check and migrate
```powershell
python backend\manage.py check
python backend\manage.py makemigrations accounts
python backend\manage.py migrate --plan
```
Inspect the plan. It should create the initial Django and OnConnect accounts tables.
If the database unexpectedly contains tables or migration history, stop and inspect
before applying anything. Do not drop tables or fake migrations.

If the plan is expected:
```powershell
python backend\manage.py migrate
python backend\manage.py createsuperuser
python backend\manage.py runserver 127.0.0.1:8000
```

## 5. Start the frontend (second PowerShell terminal)
```powershell
cd C:\Users\27099\Desktop\OnConnect\frontend
npm install
npm run dev
```
Open the Vite URL printed in the terminal, usually http://127.0.0.1:5173.

## 6. Verify
- API health: http://127.0.0.1:8000/api/health/
- Django admin: http://127.0.0.1:8000/admin/
- Frontend: http://127.0.0.1:5173/

The frontend proxies `/api` and `/admin` to Django. Session authentication and
CSRF protection are enabled for the authentication endpoints.

## Stage 1 API
- `GET /api/health/`
- `GET /api/auth/csrf/`
- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `GET /api/auth/me/`

Stage 1 is a working foundation, not the complete social platform yet. Groups,
posts, chats, project publishing and research publishing are planned for later
stages.

---

## Reddit-style frontend

The frontend (`frontend/src`) has been redesigned as a Reddit-style site:
top navbar with search, left navigation + community list, Hot/New/Top feed,
vote rail on every post, community pages with Join/Leave, post pages with
threaded replies, a create-post page (text, link, images), explore page,
search, profiles, light/dark theme and a mobile drawer.

- No backend API was changed, apart from `is_staff` now being returned by
  `/api/auth/me/` so staff can open **Brand settings**.
- After unzipping, run `npm install` in `frontend/` again (node_modules is not
  included) and `npm run dev`.
- Community prefix (`r/`) and colours are easy to change: see the constants at
  the top of `frontend/src/main.ts` and the variables at the top of
  `frontend/src/style.css`.
- Frontend files: `main.ts` (app), `utils.ts` (types/helpers), `style.css`.

### Appearance and profile pictures

- **Appearance** (sliders icon in the navbar): light / dark / system theme,
  accent colour and card / compact post layout. Saved per browser.
- **Edit profile** (user menu): change display name, bio and upload or remove a
  profile picture. Needs `Pillow` (`pip install -r backend/requirements.txt`).
  Uploaded pictures are stored in `backend/media/avatars/` and shown next to
  your comments and on your profile page.
- Backend additions: `PATCH /api/auth/me/` and an `author_avatar` field on
  posts and comments. No database migration is required.

---

## Upgrade: people, private chat and the Aurora look

### What is new

**Connections**
- A **People** page (`#/people`) with Discover, Requests and Connections tabs and a search box.
- Members you share communities with are listed first.
- Press **Connect** to send a request. If the other person already asked you, pressing it simply accepts theirs.
- Accept, decline, cancel a request, or remove a connection.
- Profile pages now show a bio, shared communities, a connection count and the right buttons (Connect, Accept, Message).

**Private chat**
- A **Messages** page (`#/messages` and `#/messages/<username>`) with a conversation list and a chat window.
- Only connected members can message each other (enforced on the server).
- New messages appear automatically (the browser checks every 2.5 seconds), with day dividers, sent and seen ticks, Enter to send and Shift+Enter for a new line.
- Unread badges on the top bar and the side menu, a pop-up when a message arrives on another page, and a short chime that you can mute (the speaker icon).

**Design**
- New gradient "Aurora" theme in `frontend/src/upgrade.css`: glass top bar, animated welcome banner, lifted cards, gradient buttons, avatar rings and smooth motion.
- Works in light and dark mode and follows the accent colour chosen in the Appearance panel.
- Respects the "reduce motion" setting of the operating system.

### New back-end app: `backend/connections`

| Route | Purpose |
|---|---|
| `GET /api/people/?search=` | Members with their connection status and shared communities |
| `GET /api/people/<username>/` | One member, with connection count |
| `GET, POST /api/connections/` | List connections and requests; send or auto-accept a request |
| `POST /api/connections/<id>/respond/` | Accept or decline (`{"action": "accept"}`) |
| `DELETE /api/connections/<id>/` | Cancel a request or remove a connection |
| `GET /api/messages/` | Conversations with last message and unread count |
| `GET, POST /api/messages/with/<username>/` | Read (`?after=<id>` for new only) or send a message |
| `GET /api/notifications/summary/` | Unread messages and pending requests (used for badges) |

### After pulling this upgrade

```powershell
pip install -r backend\requirements.txt
python backend\manage.py migrate          # creates the two new tables
python backend\manage.py test connections # optional: run the new tests
```

The front end needs no new packages. Create two accounts, connect them in the People page, and open Messages in two browsers to try the chat.

### Other fixes included
- `vite.config.ts` now proxies to port 8000 (as in this README). Set `VITE_API_TARGET` to use another port.
- The unused Django scaffold files at the project root, a stray SQLite file and `backend/.env` were removed. Copy `backend/.env.example` to `backend/.env` and fill in your own values.

### Ideas for next steps
Group chats, image and voice messages, typing indicators with WebSockets (Django Channels), and email or browser notifications.
