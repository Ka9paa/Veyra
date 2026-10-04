import re
import json
import os
import sqlite3
import io
import zipfile
import secrets
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for, flash, send_file
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from openai import OpenAI
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

def extract_json_object(text):
    """Extract the first valid JSON object from model text."""
    if not text:
        raise ValueError("Veyra AI returned an empty response")

    text=str(text).strip()
    if text.startswith("```"):
        text=re.sub(r"^```(?:json)?\s*","",text,flags=re.I)
        text=re.sub(r"\s*```$","",text).strip()

    try:
        value=json.loads(text)
        if isinstance(value,dict):
            return value
    except Exception:
        pass

    decoder=json.JSONDecoder()
    for match in re.finditer(r"\{",text):
        try:
            value,end=decoder.raw_decode(text[match.start():])
            if isinstance(value,dict):
                return value
        except Exception:
            continue

    raise ValueError("Veyra AI did not return a valid project JSON object")


def veyra_model():
    """Primary customer-facing Veyra model."""
    return (os.getenv('VEYRA_MODEL') or 'gpt-6.1-sol').strip() or 'gpt-6.1-sol'


def veyra_fallback_model():
    """Optional secondary general-purpose model if the primary model is unavailable."""
    return (os.getenv('VEYRA_FALLBACK_MODEL') or 'gpt-6-sol').strip() or 'gpt-6-sol'


def classify_ai_error(exc):
    """Return a safe diagnostic code without leaking keys, request bodies, or secrets."""
    name=type(exc).__name__.lower()
    message=str(exc or '').lower()

    if 'authentication' in name or 'invalid_api_key' in message or 'incorrect api key' in message or '401' in message:
        return 'OPENAI_AUTH'
    if 'permission' in name or 'forbidden' in name or '403' in message:
        return 'OPENAI_ACCESS'
    if 'rate' in name or 'quota' in message or '429' in message:
        return 'OPENAI_RATE_LIMIT'
    if 'timeout' in name or 'timed out' in message:
        return 'OPENAI_TIMEOUT'
    if 'connection' in name or 'connect' in message:
        return 'OPENAI_CONNECTION'
    if 'model' in message and ('not found' in message or 'does not exist' in message or 'access' in message):
        return 'OPENAI_MODEL'
    if 'json' in name or 'json' in message or 'incomplete veyra project payload' in message:
        return 'OPENAI_RESPONSE'
    if 'badrequest' in name or 'bad request' in message or '400' in message:
        return 'OPENAI_REQUEST'
    return 'OPENAI_UNKNOWN'


def run_veyra_response(client, *, model, instructions, input_text, max_output_tokens=12000, reasoning='medium'):
    """Use the current OpenAI Responses API.

    output_text is the SDK's convenience accessor for text returned by the model.
    """
    kwargs={
        'model':model,
        'instructions':instructions,
        'input':input_text,
        'max_output_tokens':max_output_tokens,
        'store':False,
    }
    if reasoning:
        kwargs['reasoning']={'effort':reasoning}

    response=client.responses.create(**kwargs)
    output=(getattr(response,'output_text',None) or '').strip()
    if not output:
        raise ValueError('Empty Veyra AI response')
    return output, response


BASE=Path(__file__).resolve().parent
load_dotenv(BASE/'.env')
app=Flask(__name__)
app.secret_key=os.getenv('FLASK_SECRET_KEY','local-dev-change-me')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=bool(os.getenv('VERCEL')),
    SESSION_COOKIE_NAME='veyra_session',
    PERMANENT_SESSION_LIFETIME=60*60*24*30,
)

# Canonical public URL used by OAuth providers.
# Keep this stable so Google/Discord callbacks do not change between Vercel hosts.
PUBLIC_BASE_URL=(os.getenv('PUBLIC_BASE_URL') or 'https://buildveyra.xyz').strip().rstrip('/')
OAUTH_BASE_URL=(os.getenv('OAUTH_BASE_URL') or PUBLIC_BASE_URL or 'https://buildveyra.xyz').strip().rstrip('/')

def public_url(path):
    path='/' + str(path or '').lstrip('/')
    return f"{PUBLIC_BASE_URL}{path}"

def oauth_url(path):
    path='/' + str(path or '').lstrip('/')
    return f"{OAUTH_BASE_URL}{path}"

def oauth_request_url(path):
    """Return the exact public callback URL used for an OAuth attempt.

    Vercel/proxies can expose a different internal request host, so prefer the
    forwarded host when it is one of Veyra's two approved production hosts.
    """
    path='/' + str(path or '').lstrip('/')

    forwarded=(request.headers.get('X-Forwarded-Host') or '').split(',')[0].strip()
    raw_host=forwarded or (request.host or '')
    host=raw_host.split(':')[0].lower()

    if host in {'buildveyra.xyz','www.buildveyra.xyz'}:
        return f"https://{host}{path}"

    return oauth_url(path)
# Production uses the same Neon/Postgres database as the Discord admin bot.
# SQLite remains only as a local-development fallback.
DATABASE_URL=(os.getenv('DATABASE_URL') or '').strip()
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL='postgresql://' + DATABASE_URL[len('postgres://'):]

USE_POSTGRES=bool(DATABASE_URL)

if os.getenv('VERCEL'):
    DB=Path('/tmp/veyra.db')
else:
    DB=BASE/'data'/'veyra.db'


class _PgCursor:
    _ID_TABLES={'users','projects','vouches','support_threads','admin_audit','project_members','agents','project_databases','deployments','analytics_events'}

    def __init__(self, cursor):
        self._cursor=cursor
        self.lastrowid=None

    def execute(self, sql, params=None):
        sql=str(sql)
        params=() if params is None else params

        # The rest of Veyra uses SQLite-style ? placeholders. Convert them for psycopg.
        sql=sql.replace('?', '%s')

        # Emulate sqlite cursor.lastrowid for the few INSERTs that need it.
        match=re.match(r'\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)', sql, re.I)
        wants_id=bool(match and match.group(1).lower() in self._ID_TABLES and 'RETURNING' not in sql.upper())
        if wants_id:
            sql=sql.rstrip().rstrip(';') + ' RETURNING id'

        self._cursor.execute(sql, params)

        if wants_id:
            row=self._cursor.fetchone()
            if row:
                self.lastrowid=row.get('id') if isinstance(row,dict) else row[0]

        return self

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    @property
    def rowcount(self):
        return self._cursor.rowcount


class _PgConnection:
    def __init__(self):
        import psycopg
        from psycopg.rows import dict_row
        self._conn=psycopg.connect(DATABASE_URL,row_factory=dict_row)

    def cursor(self):
        return _PgCursor(self._conn.cursor())

    def execute(self, sql, params=None):
        cur=self.cursor()
        return cur.execute(sql,params)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()
        self._conn.close()
        return False


def db():
    if USE_POSTGRES:
        return _PgConnection()

    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB)
    c.row_factory=sqlite3.Row
    return c


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def init_db():
    with db() as c:
        if USE_POSTGRES:
            c.execute('''CREATE TABLE IF NOT EXISTS users(
                id BIGSERIAL PRIMARY KEY,
                provider TEXT NOT NULL,
                provider_user_id TEXT NOT NULL,
                discord_id TEXT,
                email TEXT,
                name TEXT,
                avatar_url TEXT,
                password_hash TEXT,
                credits INTEGER NOT NULL DEFAULT 50,
                plan TEXT NOT NULL DEFAULT 'free',
                is_blacklisted INTEGER NOT NULL DEFAULT 0,
                blacklist_reason TEXT DEFAULT '',
                last_active TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(provider,provider_user_id)
            )''')
            c.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT')
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'")
            c.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blacklisted INTEGER NOT NULL DEFAULT 0')
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS blacklist_reason TEXT DEFAULT ''")
            c.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TEXT')
            c.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT')
            c.execute('CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email))')

            c.execute('''CREATE TABLE IF NOT EXISTS projects(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                html TEXT DEFAULT '',
                css TEXT DEFAULT '',
                js TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS vouches(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                role TEXT DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 5,
                message TEXT NOT NULL,
                project_name TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                reviewed_at TEXT
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS support_threads(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS admin_audit(
                id BIGSERIAL PRIMARY KEY,
                admin_user_id BIGINT,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL DEFAULT 'user',
                target_id BIGINT,
                details TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS site_admins(
                discord_id TEXT PRIMARY KEY,
                discord_username TEXT,
                granted_by TEXT NOT NULL,
                granted_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS project_members(
                id BIGSERIAL PRIMARY KEY,
                project_id BIGINT NOT NULL,
                user_id BIGINT NOT NULL,
                role TEXT NOT NULL DEFAULT 'editor',
                added_by BIGINT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(project_id,user_id)
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS agents(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS project_databases(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                project_id BIGINT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'Postgres',
                status TEXT NOT NULL DEFAULT 'connected',
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS deployments(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                project_id BIGINT NOT NULL,
                url TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS analytics_events(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                project_id BIGINT NOT NULL,
                event_type TEXT NOT NULL,
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS login_events(
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                provider TEXT NOT NULL,
                email TEXT,
                account_name TEXT,
                discord_id TEXT,
                created_at TEXT NOT NULL,
                delivered INTEGER NOT NULL DEFAULT 0
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_login_events_delivered ON login_events(delivered,id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_analytics_project ON analytics_events(project_id)')
        else:
            c.execute('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,email TEXT,name TEXT,avatar_url TEXT,password_hash TEXT,credits INTEGER NOT NULL DEFAULT 50,created_at TEXT NOT NULL,UNIQUE(provider,provider_user_id))''')
            c.execute('''CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,description TEXT DEFAULT '',html TEXT DEFAULT '',css TEXT DEFAULT '',js TEXT DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS vouches(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,role TEXT DEFAULT '',rating INTEGER NOT NULL DEFAULT 5,message TEXT NOT NULL,project_name TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT)''')
            c.execute('''CREATE TABLE IF NOT EXISTS support_threads(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,created_at TEXT NOT NULL)''')
            cols={r['name'] for r in c.execute('PRAGMA table_info(users)').fetchall()}
            if 'password_hash' not in cols: c.execute('ALTER TABLE users ADD COLUMN password_hash TEXT')
            if 'plan' not in cols: c.execute("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'")
            if 'is_blacklisted' not in cols: c.execute("ALTER TABLE users ADD COLUMN is_blacklisted INTEGER NOT NULL DEFAULT 0")
            if 'blacklist_reason' not in cols: c.execute("ALTER TABLE users ADD COLUMN blacklist_reason TEXT DEFAULT ''")
            if 'last_active' not in cols: c.execute("ALTER TABLE users ADD COLUMN last_active TEXT")
            if 'discord_id' not in cols: c.execute("ALTER TABLE users ADD COLUMN discord_id TEXT")
            c.execute('''CREATE TABLE IF NOT EXISTS admin_audit(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user_id INTEGER,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL DEFAULT 'user',
                target_id INTEGER,
                details TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS site_admins(
                discord_id TEXT PRIMARY KEY,
                discord_username TEXT,
                granted_by TEXT NOT NULL,
                granted_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS project_members(id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'editor',added_by INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,user_id))''')
            c.execute('''CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'idle',created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS project_databases(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,project_id INTEGER,name TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'Postgres',status TEXT NOT NULL DEFAULT 'connected',created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS deployments(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,project_id INTEGER NOT NULL,url TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'ready',created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS analytics_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,project_id INTEGER NOT NULL,event_type TEXT NOT NULL,created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS login_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,provider TEXT NOT NULL,email TEXT,account_name TEXT,discord_id TEXT,created_at TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0)''')
        c.commit()

def _cache_user(user):
    if not user:
        return
    safe=dict(user)
    # Never store password hashes in the signed browser session.
    safe.pop('password_hash',None)
    session['user_cache']=safe

def record_login_event(user):
    """Write a safe login event for the Discord admin bot."""
    if not user:
        return
    try:
        provider=(user.get('provider') or 'account').strip().lower()
        discord_id=str(
            user.get('discord_id')
            or (user.get('provider_user_id') if provider=='discord' else '')
            or ''
        ).strip() or None

        with db() as c:
            c.execute(
                "INSERT INTO login_events(user_id,provider,email,account_name,discord_id,created_at,delivered) VALUES(?,?,?,?,?,?,0)",
                (
                    int(user['id']),
                    provider,
                    user.get('email'),
                    user.get('name'),
                    discord_id,
                    now(),
                )
            )
            c.commit()
    except Exception:
        app.logger.exception('Unable to record Veyra login event')


def _finish_login(uid, remember=True, user=None):
    session.clear()
    session['user_id']=int(uid)
    session.permanent=bool(remember)

    login_user=None

    if user:
        login_user=dict(user)
        _cache_user(login_user)
    else:
        try:
            with db() as c:
                r=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
                if r:
                    login_user=dict(r)
                    _cache_user(login_user)
        except Exception:
            app.logger.exception('Unable to cache user after login')

    try:
        with db() as c:
            c.execute('UPDATE users SET last_active=? WHERE id=?',(now(),uid))
            c.commit()
    except Exception:
        app.logger.exception('Unable to update last_active after login')

    if login_user:
        record_login_event(login_user)


def current_user():
    uid=session.get('user_id')
    if not uid:
        return None

    # Neon/Postgres is authoritative. Re-read the account each request so
    # Discord bot changes (plan, credits, blacklist, Discord link, admin grant)
    # show on the website immediately after refresh/navigation.
    try:
        with db() as c:
            r=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
            if r:
                user=dict(r)
                _cache_user(user)
                return user
    except Exception:
        app.logger.exception('current_user database lookup failed')

    # Short-lived session cache is only an outage fallback, not the source of truth.
    cached=session.get('user_cache')
    if isinstance(cached,dict) and str(cached.get('id'))==str(uid):
        return dict(cached)

    return None


def is_admin(user=None):
    user=user or current_user()
    if not user:
        return False

    # Keep owner-email access as an emergency fallback.
    allowed={x.strip().lower() for x in os.getenv('VEYRA_ADMIN_EMAILS','').split(',') if x.strip()}
    if user.get('email') and user['email'].lower() in allowed:
        return True

    discord_id=str(
        user.get('discord_id')
        or (user.get('provider_user_id') if user.get('provider')=='discord' else '')
        or ''
    ).strip()

    if not discord_id:
        return False

    try:
        with db() as c:
            row=c.execute(
                'SELECT discord_id FROM site_admins WHERE discord_id=?',
                (discord_id,)
            ).fetchone()
            return bool(row)
    except Exception:
        app.logger.exception('Discord admin lookup failed')
        return False

def admin_audit(action,target_id=None,details=None):
    actor=current_user()
    payload=details if isinstance(details,str) else json.dumps(details or {},separators=(',',':'))
    with db() as c:
        c.execute(
            'INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
            ((actor or {}).get('id'),action,'user',target_id,payload,now())
        )
        c.commit()

def login_required(fn):
    @wraps(fn)
    def w(*a,**k):
        user=current_user()
        if not user:return redirect(url_for('login',next=request.path))
        if int(user.get('is_blacklisted') or 0):
            session.clear()
            flash('This Veyra account is currently restricted.','error')
            return redirect(url_for('login'))
        return fn(*a,**k)
    return w

@app.context_processor
def inject():
    user=current_user()
    return {
        'current_user':user,
        'current_is_admin':is_admin(user) if user else False,
    }

def upsert_oauth(provider,pid,email,name,avatar):
    provider=(provider or '').strip().lower()
    pid=str(pid or '').strip()
    email=(email or '').strip().lower() or None

    with db() as c:
        r=None

        if provider=='discord':
            r=c.execute(
                'SELECT * FROM users WHERE discord_id=? OR (provider=? AND provider_user_id=?) LIMIT 1',
                (pid,'discord',pid)
            ).fetchone()

        if not r:
            r=c.execute(
                'SELECT * FROM users WHERE provider=? AND provider_user_id=?',
                (provider,pid)
            ).fetchone()

        # Same verified OAuth email = same Veyra account.
        if not r and email:
            r=c.execute(
                'SELECT * FROM users WHERE LOWER(email)=LOWER(?) ORDER BY id ASC LIMIT 1',
                (email,)
            ).fetchone()

        if r:
            uid=r['id']
            if provider=='discord':
                c.execute(
                    'UPDATE users SET email=COALESCE(?,email),name=?,avatar_url=?,discord_id=? WHERE id=?',
                    (email,name,avatar,pid,uid)
                )
            else:
                c.execute(
                    'UPDATE users SET email=COALESCE(?,email),name=?,avatar_url=? WHERE id=?',
                    (email,name,avatar,uid)
                )
        else:
            discord_id=pid if provider=='discord' else None
            cur=c.execute(
                'INSERT INTO users(provider,provider_user_id,discord_id,email,name,avatar_url,password_hash,credits,created_at) VALUES(?,?,?,?,?,?,NULL,50,?)',
                (provider,pid,discord_id,email,name,avatar,now())
            )
            uid=cur.lastrowid

        c.commit()
        return uid

oauth=OAuth(app)
google=oauth.register(name='google',client_id=os.getenv('GOOGLE_CLIENT_ID'),client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',client_kwargs={'scope':'openid email profile'})
discord_oauth=oauth.register(
    name='discord',
    client_id=os.getenv('DISCORD_CLIENT_ID'),
    client_secret=os.getenv('DISCORD_CLIENT_SECRET'),
    access_token_url='https://discord.com/api/oauth2/token',
    authorize_url='https://discord.com/oauth2/authorize',
    api_base_url='https://discord.com/api/',
    client_kwargs={'scope':'identify email'}
)

VEYRA_V10_FEATURES = ['Builder Quick Create', 'Builder Smart Search', 'Builder Context Memory', 'Builder History', 'Builder Favorites', 'Builder Templates', 'Builder Presets', 'Builder Recommendations', 'Builder Assistant', 'Builder Inspector', 'Builder Bulk Actions', 'Builder Import', 'Builder Export', 'Builder Duplicate', 'Builder Archive', 'Builder Restore', 'Builder Version Compare', 'Builder Diff Viewer', 'Builder Snapshots', 'Builder Branches', 'Builder Comments', 'Builder Review', 'Builder Approvals', 'Builder Permissions', 'Builder Sharing', 'Builder Live Sync', 'Builder Status Tracking', 'Builder Activity Log', 'Builder Notifications', 'Builder Shortcuts', 'Builder Command Palette', 'Builder Voice Control', 'Builder Keyboard Navigation', 'Builder Responsive Mode', 'Builder Mobile Mode', 'Builder Tablet Mode', 'Builder Desktop Mode', 'Builder Custom Viewport', 'Builder Auto Save', 'Builder Recovery', 'Builder Validation', 'Builder Testing', 'Builder Audit', 'Builder Auto Fix', 'Builder Optimization', 'Builder Generation', 'Builder Refactor', 'Builder Explain', 'Builder Documentation', 'Builder Handoff', 'Designer Quick Create', 'Designer Smart Search', 'Designer Context Memory', 'Designer History', 'Designer Favorites', 'Designer Templates', 'Designer Presets', 'Designer Recommendations', 'Designer Assistant', 'Designer Inspector', 'Designer Bulk Actions', 'Designer Import', 'Designer Export', 'Designer Duplicate', 'Designer Archive', 'Designer Restore', 'Designer Version Compare', 'Designer Diff Viewer', 'Designer Snapshots', 'Designer Branches', 'Designer Comments', 'Designer Review', 'Designer Approvals', 'Designer Permissions', 'Designer Sharing', 'Designer Live Sync', 'Designer Status Tracking', 'Designer Activity Log', 'Designer Notifications', 'Designer Shortcuts', 'Designer Command Palette', 'Designer Voice Control', 'Designer Keyboard Navigation', 'Designer Responsive Mode', 'Designer Mobile Mode', 'Designer Tablet Mode', 'Designer Desktop Mode', 'Designer Custom Viewport', 'Designer Auto Save', 'Designer Recovery', 'Designer Validation', 'Designer Testing', 'Designer Audit', 'Designer Auto Fix', 'Designer Optimization', 'Designer Generation', 'Designer Refactor', 'Designer Explain', 'Designer Documentation', 'Designer Handoff', 'Code Quick Create', 'Code Smart Search', 'Code Context Memory', 'Code History', 'Code Favorites', 'Code Templates', 'Code Presets', 'Code Recommendations', 'Code Assistant', 'Code Inspector', 'Code Bulk Actions', 'Code Import', 'Code Export', 'Code Duplicate', 'Code Archive', 'Code Restore', 'Code Version Compare', 'Code Diff Viewer', 'Code Snapshots', 'Code Branches', 'Code Comments', 'Code Review', 'Code Approvals', 'Code Permissions', 'Code Sharing', 'Code Live Sync', 'Code Status Tracking', 'Code Activity Log', 'Code Notifications', 'Code Shortcuts', 'Code Command Palette', 'Code Voice Control', 'Code Keyboard Navigation', 'Code Responsive Mode', 'Code Mobile Mode', 'Code Tablet Mode', 'Code Desktop Mode', 'Code Custom Viewport', 'Code Auto Save', 'Code Recovery', 'Code Validation', 'Code Testing', 'Code Audit', 'Code Auto Fix', 'Code Optimization', 'Code Generation', 'Code Refactor', 'Code Explain', 'Code Documentation', 'Code Handoff', 'Preview Quick Create', 'Preview Smart Search', 'Preview Context Memory', 'Preview History', 'Preview Favorites', 'Preview Templates', 'Preview Presets', 'Preview Recommendations', 'Preview Assistant', 'Preview Inspector', 'Preview Bulk Actions', 'Preview Import', 'Preview Export', 'Preview Duplicate', 'Preview Archive', 'Preview Restore', 'Preview Version Compare', 'Preview Diff Viewer', 'Preview Snapshots', 'Preview Branches', 'Preview Comments', 'Preview Review', 'Preview Approvals', 'Preview Permissions', 'Preview Sharing', 'Preview Live Sync', 'Preview Status Tracking', 'Preview Activity Log', 'Preview Notifications', 'Preview Shortcuts', 'Preview Command Palette', 'Preview Voice Control', 'Preview Keyboard Navigation', 'Preview Responsive Mode', 'Preview Mobile Mode', 'Preview Tablet Mode', 'Preview Desktop Mode', 'Preview Custom Viewport', 'Preview Auto Save', 'Preview Recovery', 'Preview Validation', 'Preview Testing', 'Preview Audit', 'Preview Auto Fix', 'Preview Optimization', 'Preview Generation', 'Preview Refactor', 'Preview Explain', 'Preview Documentation', 'Preview Handoff', 'Project Quick Create', 'Project Smart Search', 'Project Context Memory', 'Project History', 'Project Favorites', 'Project Templates', 'Project Presets', 'Project Recommendations', 'Project Assistant', 'Project Inspector', 'Project Bulk Actions', 'Project Import', 'Project Export', 'Project Duplicate', 'Project Archive', 'Project Restore', 'Project Version Compare', 'Project Diff Viewer', 'Project Snapshots', 'Project Branches', 'Project Comments', 'Project Review', 'Project Approvals', 'Project Permissions', 'Project Sharing', 'Project Live Sync', 'Project Status Tracking', 'Project Activity Log', 'Project Notifications', 'Project Shortcuts', 'Project Command Palette', 'Project Voice Control', 'Project Keyboard Navigation', 'Project Responsive Mode', 'Project Mobile Mode', 'Project Tablet Mode', 'Project Desktop Mode', 'Project Custom Viewport', 'Project Auto Save', 'Project Recovery', 'Project Validation', 'Project Testing', 'Project Audit', 'Project Auto Fix', 'Project Optimization', 'Project Generation', 'Project Refactor', 'Project Explain', 'Project Documentation', 'Project Handoff', 'Agent Quick Create', 'Agent Smart Search', 'Agent Context Memory', 'Agent History', 'Agent Favorites', 'Agent Templates', 'Agent Presets', 'Agent Recommendations', 'Agent Assistant', 'Agent Inspector', 'Agent Bulk Actions', 'Agent Import', 'Agent Export', 'Agent Duplicate', 'Agent Archive', 'Agent Restore', 'Agent Version Compare', 'Agent Diff Viewer', 'Agent Snapshots', 'Agent Branches', 'Agent Comments', 'Agent Review', 'Agent Approvals', 'Agent Permissions', 'Agent Sharing', 'Agent Live Sync', 'Agent Status Tracking', 'Agent Activity Log', 'Agent Notifications', 'Agent Shortcuts', 'Agent Command Palette', 'Agent Voice Control', 'Agent Keyboard Navigation', 'Agent Responsive Mode', 'Agent Mobile Mode', 'Agent Tablet Mode', 'Agent Desktop Mode', 'Agent Custom Viewport', 'Agent Auto Save', 'Agent Recovery', 'Agent Validation', 'Agent Testing', 'Agent Audit', 'Agent Auto Fix', 'Agent Optimization', 'Agent Generation', 'Agent Refactor', 'Agent Explain', 'Agent Documentation', 'Agent Handoff', 'Quality Quick Create', 'Quality Smart Search', 'Quality Context Memory', 'Quality History', 'Quality Favorites', 'Quality Templates', 'Quality Presets', 'Quality Recommendations', 'Quality Assistant', 'Quality Inspector', 'Quality Bulk Actions', 'Quality Import', 'Quality Export', 'Quality Duplicate', 'Quality Archive', 'Quality Restore', 'Quality Version Compare', 'Quality Diff Viewer', 'Quality Snapshots', 'Quality Branches', 'Quality Comments', 'Quality Review', 'Quality Approvals', 'Quality Permissions', 'Quality Sharing', 'Quality Live Sync', 'Quality Status Tracking', 'Quality Activity Log', 'Quality Notifications', 'Quality Shortcuts', 'Quality Command Palette', 'Quality Voice Control', 'Quality Keyboard Navigation', 'Quality Responsive Mode', 'Quality Mobile Mode', 'Quality Tablet Mode', 'Quality Desktop Mode', 'Quality Custom Viewport', 'Quality Auto Save', 'Quality Recovery', 'Quality Validation', 'Quality Testing', 'Quality Audit', 'Quality Auto Fix', 'Quality Optimization', 'Quality Generation', 'Quality Refactor', 'Quality Explain', 'Quality Documentation', 'Quality Handoff', 'Data Quick Create', 'Data Smart Search', 'Data Context Memory', 'Data History', 'Data Favorites', 'Data Templates', 'Data Presets', 'Data Recommendations', 'Data Assistant', 'Data Inspector', 'Data Bulk Actions', 'Data Import', 'Data Export', 'Data Duplicate', 'Data Archive', 'Data Restore', 'Data Version Compare', 'Data Diff Viewer', 'Data Snapshots', 'Data Branches', 'Data Comments', 'Data Review', 'Data Approvals', 'Data Permissions', 'Data Sharing', 'Data Live Sync', 'Data Status Tracking', 'Data Activity Log', 'Data Notifications', 'Data Shortcuts', 'Data Command Palette', 'Data Voice Control', 'Data Keyboard Navigation', 'Data Responsive Mode', 'Data Mobile Mode', 'Data Tablet Mode', 'Data Desktop Mode', 'Data Custom Viewport', 'Data Auto Save', 'Data Recovery', 'Data Validation', 'Data Testing', 'Data Audit', 'Data Auto Fix', 'Data Optimization', 'Data Generation', 'Data Refactor', 'Data Explain', 'Data Documentation', 'Data Handoff', 'API Quick Create', 'API Smart Search', 'API Context Memory', 'API History', 'API Favorites', 'API Templates', 'API Presets', 'API Recommendations', 'API Assistant', 'API Inspector', 'API Bulk Actions', 'API Import', 'API Export', 'API Duplicate', 'API Archive', 'API Restore', 'API Version Compare', 'API Diff Viewer', 'API Snapshots', 'API Branches', 'API Comments', 'API Review', 'API Approvals', 'API Permissions', 'API Sharing', 'API Live Sync', 'API Status Tracking', 'API Activity Log', 'API Notifications', 'API Shortcuts', 'API Command Palette', 'API Voice Control', 'API Keyboard Navigation', 'API Responsive Mode', 'API Mobile Mode', 'API Tablet Mode', 'API Desktop Mode', 'API Custom Viewport', 'API Auto Save', 'API Recovery', 'API Validation', 'API Testing', 'API Audit', 'API Auto Fix', 'API Optimization', 'API Generation', 'API Refactor', 'API Explain', 'API Documentation', 'API Handoff', 'Database Quick Create', 'Database Smart Search', 'Database Context Memory', 'Database History', 'Database Favorites', 'Database Templates', 'Database Presets', 'Database Recommendations', 'Database Assistant', 'Database Inspector', 'Database Bulk Actions', 'Database Import', 'Database Export', 'Database Duplicate', 'Database Archive', 'Database Restore', 'Database Version Compare', 'Database Diff Viewer', 'Database Snapshots', 'Database Branches', 'Database Comments', 'Database Review', 'Database Approvals', 'Database Permissions', 'Database Sharing', 'Database Live Sync', 'Database Status Tracking', 'Database Activity Log', 'Database Notifications', 'Database Shortcuts', 'Database Command Palette', 'Database Voice Control', 'Database Keyboard Navigation', 'Database Responsive Mode', 'Database Mobile Mode', 'Database Tablet Mode', 'Database Desktop Mode', 'Database Custom Viewport', 'Database Auto Save', 'Database Recovery', 'Database Validation', 'Database Testing', 'Database Audit', 'Database Auto Fix', 'Database Optimization', 'Database Generation', 'Database Refactor', 'Database Explain', 'Database Documentation', 'Database Handoff', 'Automation Quick Create', 'Automation Smart Search', 'Automation Context Memory', 'Automation History', 'Automation Favorites', 'Automation Templates', 'Automation Presets', 'Automation Recommendations', 'Automation Assistant', 'Automation Inspector', 'Automation Bulk Actions', 'Automation Import', 'Automation Export', 'Automation Duplicate', 'Automation Archive', 'Automation Restore', 'Automation Version Compare', 'Automation Diff Viewer', 'Automation Snapshots', 'Automation Branches', 'Automation Comments', 'Automation Review', 'Automation Approvals', 'Automation Permissions', 'Automation Sharing', 'Automation Live Sync', 'Automation Status Tracking', 'Automation Activity Log', 'Automation Notifications', 'Automation Shortcuts', 'Automation Command Palette', 'Automation Voice Control', 'Automation Keyboard Navigation', 'Automation Responsive Mode', 'Automation Mobile Mode', 'Automation Tablet Mode', 'Automation Desktop Mode', 'Automation Custom Viewport', 'Automation Auto Save', 'Automation Recovery', 'Automation Validation', 'Automation Testing', 'Automation Audit', 'Automation Auto Fix', 'Automation Optimization', 'Automation Generation', 'Automation Refactor', 'Automation Explain', 'Automation Documentation', 'Automation Handoff', 'Flow Quick Create', 'Flow Smart Search', 'Flow Context Memory', 'Flow History', 'Flow Favorites', 'Flow Templates', 'Flow Presets', 'Flow Recommendations', 'Flow Assistant', 'Flow Inspector', 'Flow Bulk Actions', 'Flow Import', 'Flow Export', 'Flow Duplicate', 'Flow Archive', 'Flow Restore', 'Flow Version Compare', 'Flow Diff Viewer', 'Flow Snapshots', 'Flow Branches', 'Flow Comments', 'Flow Review', 'Flow Approvals', 'Flow Permissions', 'Flow Sharing', 'Flow Live Sync', 'Flow Status Tracking', 'Flow Activity Log', 'Flow Notifications', 'Flow Shortcuts', 'Flow Command Palette', 'Flow Voice Control', 'Flow Keyboard Navigation', 'Flow Responsive Mode', 'Flow Mobile Mode', 'Flow Tablet Mode', 'Flow Desktop Mode', 'Flow Custom Viewport', 'Flow Auto Save', 'Flow Recovery', 'Flow Validation', 'Flow Testing', 'Flow Audit', 'Flow Auto Fix', 'Flow Optimization', 'Flow Generation', 'Flow Refactor', 'Flow Explain', 'Flow Documentation', 'Flow Handoff', 'Component Quick Create', 'Component Smart Search', 'Component Context Memory', 'Component History', 'Component Favorites', 'Component Templates', 'Component Presets', 'Component Recommendations', 'Component Assistant', 'Component Inspector', 'Component Bulk Actions', 'Component Import', 'Component Export', 'Component Duplicate', 'Component Archive', 'Component Restore', 'Component Version Compare', 'Component Diff Viewer', 'Component Snapshots', 'Component Branches', 'Component Comments', 'Component Review', 'Component Approvals', 'Component Permissions', 'Component Sharing', 'Component Live Sync', 'Component Status Tracking', 'Component Activity Log', 'Component Notifications', 'Component Shortcuts', 'Component Command Palette', 'Component Voice Control', 'Component Keyboard Navigation', 'Component Responsive Mode', 'Component Mobile Mode', 'Component Tablet Mode', 'Component Desktop Mode', 'Component Custom Viewport', 'Component Auto Save', 'Component Recovery', 'Component Validation', 'Component Testing', 'Component Audit', 'Component Auto Fix', 'Component Optimization', 'Component Generation', 'Component Refactor', 'Component Explain', 'Component Documentation', 'Component Handoff', 'Design System Quick Create', 'Design System Smart Search', 'Design System Context Memory', 'Design System History', 'Design System Favorites', 'Design System Templates', 'Design System Presets', 'Design System Recommendations', 'Design System Assistant', 'Design System Inspector', 'Design System Bulk Actions', 'Design System Import', 'Design System Export', 'Design System Duplicate', 'Design System Archive', 'Design System Restore', 'Design System Version Compare', 'Design System Diff Viewer', 'Design System Snapshots', 'Design System Branches', 'Design System Comments', 'Design System Review', 'Design System Approvals', 'Design System Permissions', 'Design System Sharing', 'Design System Live Sync', 'Design System Status Tracking', 'Design System Activity Log', 'Design System Notifications', 'Design System Shortcuts', 'Design System Command Palette', 'Design System Voice Control', 'Design System Keyboard Navigation', 'Design System Responsive Mode', 'Design System Mobile Mode', 'Design System Tablet Mode', 'Design System Desktop Mode', 'Design System Custom Viewport', 'Design System Auto Save', 'Design System Recovery', 'Design System Validation', 'Design System Testing', 'Design System Audit', 'Design System Auto Fix', 'Design System Optimization', 'Design System Generation', 'Design System Refactor', 'Design System Explain', 'Design System Documentation', 'Design System Handoff', 'Asset Quick Create', 'Asset Smart Search', 'Asset Context Memory', 'Asset History', 'Asset Favorites', 'Asset Templates', 'Asset Presets', 'Asset Recommendations', 'Asset Assistant', 'Asset Inspector', 'Asset Bulk Actions', 'Asset Import', 'Asset Export', 'Asset Duplicate', 'Asset Archive', 'Asset Restore', 'Asset Version Compare', 'Asset Diff Viewer', 'Asset Snapshots', 'Asset Branches', 'Asset Comments', 'Asset Review', 'Asset Approvals', 'Asset Permissions', 'Asset Sharing', 'Asset Live Sync', 'Asset Status Tracking', 'Asset Activity Log', 'Asset Notifications', 'Asset Shortcuts', 'Asset Command Palette', 'Asset Voice Control', 'Asset Keyboard Navigation', 'Asset Responsive Mode', 'Asset Mobile Mode', 'Asset Tablet Mode', 'Asset Desktop Mode', 'Asset Custom Viewport', 'Asset Auto Save', 'Asset Recovery', 'Asset Validation', 'Asset Testing', 'Asset Audit', 'Asset Auto Fix', 'Asset Optimization', 'Asset Generation', 'Asset Refactor', 'Asset Explain', 'Asset Documentation', 'Asset Handoff', 'Deployment Quick Create', 'Deployment Smart Search', 'Deployment Context Memory', 'Deployment History', 'Deployment Favorites', 'Deployment Templates', 'Deployment Presets', 'Deployment Recommendations', 'Deployment Assistant', 'Deployment Inspector', 'Deployment Bulk Actions', 'Deployment Import', 'Deployment Export', 'Deployment Duplicate', 'Deployment Archive', 'Deployment Restore', 'Deployment Version Compare', 'Deployment Diff Viewer', 'Deployment Snapshots', 'Deployment Branches', 'Deployment Comments', 'Deployment Review', 'Deployment Approvals', 'Deployment Permissions', 'Deployment Sharing', 'Deployment Live Sync', 'Deployment Status Tracking', 'Deployment Activity Log', 'Deployment Notifications', 'Deployment Shortcuts', 'Deployment Command Palette', 'Deployment Voice Control', 'Deployment Keyboard Navigation', 'Deployment Responsive Mode', 'Deployment Mobile Mode', 'Deployment Tablet Mode', 'Deployment Desktop Mode', 'Deployment Custom Viewport', 'Deployment Auto Save', 'Deployment Recovery', 'Deployment Validation', 'Deployment Testing', 'Deployment Audit', 'Deployment Auto Fix', 'Deployment Optimization', 'Deployment Generation', 'Deployment Refactor', 'Deployment Explain', 'Deployment Documentation', 'Deployment Handoff', 'Team Quick Create', 'Team Smart Search', 'Team Context Memory', 'Team History', 'Team Favorites', 'Team Templates', 'Team Presets', 'Team Recommendations', 'Team Assistant', 'Team Inspector', 'Team Bulk Actions', 'Team Import', 'Team Export', 'Team Duplicate', 'Team Archive', 'Team Restore', 'Team Version Compare', 'Team Diff Viewer', 'Team Snapshots', 'Team Branches', 'Team Comments', 'Team Review', 'Team Approvals', 'Team Permissions', 'Team Sharing', 'Team Live Sync', 'Team Status Tracking', 'Team Activity Log', 'Team Notifications', 'Team Shortcuts', 'Team Command Palette', 'Team Voice Control', 'Team Keyboard Navigation', 'Team Responsive Mode', 'Team Mobile Mode', 'Team Tablet Mode', 'Team Desktop Mode', 'Team Custom Viewport', 'Team Auto Save', 'Team Recovery', 'Team Validation', 'Team Testing', 'Team Audit', 'Team Auto Fix', 'Team Optimization', 'Team Generation', 'Team Refactor', 'Team Explain', 'Team Documentation', 'Team Handoff', 'Analytics Quick Create', 'Analytics Smart Search', 'Analytics Context Memory', 'Analytics History', 'Analytics Favorites', 'Analytics Templates', 'Analytics Presets', 'Analytics Recommendations', 'Analytics Assistant', 'Analytics Inspector', 'Analytics Bulk Actions', 'Analytics Import', 'Analytics Export', 'Analytics Duplicate', 'Analytics Archive', 'Analytics Restore', 'Analytics Version Compare', 'Analytics Diff Viewer', 'Analytics Snapshots', 'Analytics Branches', 'Analytics Comments', 'Analytics Review', 'Analytics Approvals', 'Analytics Permissions', 'Analytics Sharing', 'Analytics Live Sync', 'Analytics Status Tracking', 'Analytics Activity Log', 'Analytics Notifications', 'Analytics Shortcuts', 'Analytics Command Palette', 'Analytics Voice Control', 'Analytics Keyboard Navigation', 'Analytics Responsive Mode', 'Analytics Mobile Mode', 'Analytics Tablet Mode', 'Analytics Desktop Mode', 'Analytics Custom Viewport', 'Analytics Auto Save', 'Analytics Recovery', 'Analytics Validation', 'Analytics Testing', 'Analytics Audit', 'Analytics Auto Fix', 'Analytics Optimization', 'Analytics Generation', 'Analytics Refactor', 'Analytics Explain', 'Analytics Documentation', 'Analytics Handoff', 'Security Quick Create', 'Security Smart Search', 'Security Context Memory', 'Security History', 'Security Favorites', 'Security Templates', 'Security Presets', 'Security Recommendations', 'Security Assistant', 'Security Inspector', 'Security Bulk Actions', 'Security Import', 'Security Export', 'Security Duplicate', 'Security Archive', 'Security Restore', 'Security Version Compare', 'Security Diff Viewer', 'Security Snapshots', 'Security Branches', 'Security Comments', 'Security Review', 'Security Approvals', 'Security Permissions', 'Security Sharing', 'Security Live Sync', 'Security Status Tracking', 'Security Activity Log', 'Security Notifications', 'Security Shortcuts', 'Security Command Palette', 'Security Voice Control', 'Security Keyboard Navigation', 'Security Responsive Mode', 'Security Mobile Mode', 'Security Tablet Mode', 'Security Desktop Mode', 'Security Custom Viewport', 'Security Auto Save', 'Security Recovery', 'Security Validation', 'Security Testing', 'Security Audit', 'Security Auto Fix', 'Security Optimization', 'Security Generation', 'Security Refactor', 'Security Explain', 'Security Documentation', 'Security Handoff', 'Workspace Quick Create', 'Workspace Smart Search', 'Workspace Context Memory', 'Workspace History', 'Workspace Favorites', 'Workspace Templates', 'Workspace Presets', 'Workspace Recommendations', 'Workspace Assistant', 'Workspace Inspector', 'Workspace Bulk Actions', 'Workspace Import', 'Workspace Export', 'Workspace Duplicate', 'Workspace Archive', 'Workspace Restore', 'Workspace Version Compare', 'Workspace Diff Viewer', 'Workspace Snapshots', 'Workspace Branches', 'Workspace Comments', 'Workspace Review', 'Workspace Approvals', 'Workspace Permissions', 'Workspace Sharing', 'Workspace Live Sync', 'Workspace Status Tracking', 'Workspace Activity Log', 'Workspace Notifications', 'Workspace Shortcuts', 'Workspace Command Palette', 'Workspace Voice Control', 'Workspace Keyboard Navigation', 'Workspace Responsive Mode', 'Workspace Mobile Mode', 'Workspace Tablet Mode', 'Workspace Desktop Mode', 'Workspace Custom Viewport', 'Workspace Auto Save', 'Workspace Recovery', 'Workspace Validation', 'Workspace Testing', 'Workspace Audit', 'Workspace Auto Fix', 'Workspace Optimization', 'Workspace Generation', 'Workspace Refactor', 'Workspace Explain', 'Workspace Documentation', 'Workspace Handoff']

@app.errorhandler(404)
def veyra_404(error):
    if request.path.startswith('/api/'):
        return jsonify({'ok':False,'error':'API route not found','code':'API_NOT_FOUND'}),404
    return error


@app.errorhandler(500)
def veyra_500(error):
    if request.path.startswith('/api/'):
        original=getattr(error,'original_exception',None)
        code=classify_ai_error(original) if original else 'SERVER_ERROR'
        app.logger.exception('Unhandled Veyra API error | path=%s | code=%s',request.path,code)
        return jsonify({
            'ok':False,
            'error':'Veyra hit a server error while processing that request.',
            'code':code if str(code).startswith('OPENAI_') else 'SERVER_ERROR',
        }),500
    return error


@app.route('/')
def home():
    with db() as c:
        rows=c.execute("SELECT * FROM vouches WHERE status='approved' ORDER BY created_at DESC LIMIT 6").fetchall()
    return render_template('home.html',vouches=[dict(r) for r in rows])
@app.route('/pricing')
def pricing():return render_template('pricing.html')


PUBLIC_PAGES={
 'faq':{
   'eyebrow':'HELP CENTER','title':'Questions, answered.','intro':'Straight answers about Veyra beta, credits, building, exports, support, and account access.',
   'sections':[
      ('What is Veyra?','Veyra is an AI software-building workspace that turns prompts into working front-end projects and helps you refine, inspect, test, save, and export them.'),
      ('Is Veyra still in beta?','Yes. The public beta is where we are testing the product with real builders before the full Veyra 1.0 release.'),
      ('What are credits?','Credits represent usage inside Veyra. Builds, major edits, repair actions, and agent work may use credits depending on the plan.'),
      ('Can I export my project?','Yes. Studio can export the generated HTML, CSS, and JavaScript as a ZIP so you can keep or deploy your project elsewhere.'),
      ('Does Deploy work yet?','Direct hosting integrations are still beta. Veyra clearly labels unfinished deployment integrations instead of pretending a deployment happened.'),
      ('How do I get support?','Use the support bot in the bottom-right corner, visit the Support page, or contact the Veyra team if the bot cannot solve your issue.'),
      ('Can I submit a vouch?','Signed-in beta users can submit a vouch. It remains private until a Veyra admin approves it.'),
      ('Can I cancel a paid plan?','When paid billing is enabled through Stripe, subscription management will be handled through the billing portal associated with the checkout account.')
   ]
 },
 'docs':{
   'eyebrow':'DOCUMENTATION','title':'Build with Veyra.','intro':'A simple guide to the workflow you will use most often.',
   'sections':[
      ('1. Start a project','Open Studio and describe what you want to build. Include the product type, audience, visual direction, and any must-have interactions.'),
      ('2. Watch the build','Veyra shows build stages, renders the live preview, updates files, and reports what changed.'),
      ('3. Refine with context','Ask for changes naturally. The current HTML, CSS, and JavaScript remain in project context so follow-up edits can build on the existing product.'),
      ('4. Inspect the result','Use Preview, Code, Structure, Data, responsive device modes, the Quality panel, and Auto QA.'),
      ('5. Save and export','Veyra can save projects to your account and export a project ZIP containing index.html, styles.css, and app.js.'),
      ('6. Report beta issues','If something breaks, include the prompt, what you expected, what happened, and a screenshot when possible. The support bot can help collect this information.')
   ]
 },
 'roadmap':{
   'eyebrow':'ROADMAP','title':'Where Veyra is going.','intro':'The beta roadmap focuses on making the builder more reliable before adding unnecessary noise.',
   'sections':[
      ('Now — Builder reliability','Generation quality, preview stability, project persistence, QA, repair workflows, mobile polish, and better error states.'),
      ('Next — Real deployment connections','Hosting providers, environment configuration, deployment history, rollback, and custom domains.'),
      ('Next — Billing and teams','Stripe subscriptions, credit accounting, team workspaces, permissions, invitations, and usage reporting.'),
      ('Later — Visual editing','Direct canvas selection, property editing, reusable components, design tokens, and richer visual-to-code workflows.'),
      ('Later — Agent workflows','Longer-running specialized agents for code, design, data, QA, and deployment with clearer progress reporting.')
   ]
 },
 'changelog':{
   'eyebrow':'CHANGELOG','title':'What changed in Veyra.','intro':'Major beta improvements without hiding the rough edges.',
   'sections':[
      ('V27 — Future Beta UI','New futuristic public UI, verified vouch archive, FAQ/docs/support/status/security pages, support bot, and Stripe-ready purchasing flow.'),
      ('V26 — UI Rebuild','Unified visual system across Studio, dashboard, public pages, navigation, cards, typography, and interaction states.'),
      ('V25 — Preview Repair','Added preview loading skeletons, QA progress states, fixed NaN quality output, and improved failure messaging.'),
      ('V24 — Beta Drop','Added real project saving, ZIP export, honest beta messaging, and preview focus mode.'),
      ('V23 — Launch Candidate','Added collapsible workspace panels and redesigned projects/pricing pages.')
   ]
 },
 'security':{
   'eyebrow':'TRUST & SECURITY','title':'Built to earn trust.','intro':'Veyra is still in beta, so security claims stay specific instead of exaggerated.',
   'sections':[
      ('Authentication','Email/password accounts use hashed passwords. Google and Discord OAuth can be configured through environment variables.'),
      ('Sessions','Session cookies are HTTP-only and SameSite=Lax in the current Flask application.'),
      ('Preview isolation','Generated previews run inside a sandboxed iframe with script permission instead of executing directly inside the main Veyra UI.'),
      ('Secrets','API keys and OAuth secrets belong in environment variables and should never be hard-coded into the front-end.'),
      ('Beta reporting','If you discover a security issue, contact the Veyra team privately rather than posting exploit details publicly.')
   ]
 },
 'status':{
   'eyebrow':'SYSTEM STATUS','title':'Veyra status.','intro':'Current beta systems and what each one actually means.',
   'sections':[
      ('Web application','Operational when this page is reachable.'),
      ('Veyra AI','Depends on the configured OpenAI API key and provider availability.'),
      ('Project storage','Local SQLite storage in this beta build.'),
      ('OAuth','Google/Discord availability depends on your configured OAuth applications.'),
      ('Direct deployment','Limited beta — use project export until deployment integrations are connected.')
   ]
 },
 'about':{
   'eyebrow':'ABOUT VEYRA','title':'Software building without the handoff maze.','intro':'Veyra is being built around one idea: keep product intent, design, code, QA, and iteration in the same conversation and workspace.',
   'sections':[
      ('The goal','Make it dramatically faster to move from a product idea to something real enough to test, show, and improve.'),
      ('The approach','Combine an AI builder with live preview, project memory, code access, responsive views, QA, repair, and export.'),
      ('The beta','The current release is intentionally labeled beta. Real user feedback decides what becomes Veyra 1.0.')
   ]
 },
 'contact':{
   'eyebrow':'CONTACT','title':'Talk to the Veyra team.','intro':'Use the support bot first for common issues. For account, partnership, or beta feedback questions, use your community support channel.',
   'sections':[
      ('Product support','Open the support bot and describe what you were doing, what you expected, and what happened.'),
      ('Billing support','Include the email on the purchase and the plan name. Never send card numbers or sensitive payment credentials.'),
      ('Bug reports','Include screenshots, browser, steps to reproduce, and the prompt that caused the issue when relevant.'),
      ('Feature requests','Explain the problem you want solved, not only the feature name. That helps us design the right solution.')
   ]
 },
 'terms':{
   'eyebrow':'LEGAL','title':'Terms — Beta notice.','intro':'This starter text is product copy, not legal advice. Replace it with attorney-reviewed terms before a full paid production launch.',
   'sections':[
      ('Beta service','Veyra is provided as a beta product and features may change, break, or be removed while the platform is being developed.'),
      ('User responsibility','Users are responsible for reviewing generated code and content before deploying it or using it in production.'),
      ('Acceptable use','Do not use Veyra to violate laws, abuse services, compromise accounts, or infringe the rights of others.'),
      ('Billing','Paid plan terms, refunds, renewals, and cancellation details should match the final Stripe configuration and published billing policy.')
   ]
 },
 'privacy':{
   'eyebrow':'LEGAL','title':'Privacy — Beta notice.','intro':'This starter text must be replaced with a complete attorney-reviewed privacy policy before a full production launch.',
   'sections':[
      ('Account information','The beta stores account identifiers such as name, email, provider, credits, and project records in its application database.'),
      ('Project content','Prompts and project files may be processed by configured AI services to provide generation and editing features.'),
      ('Authentication providers','Google and Discord OAuth may process information under their own privacy terms when those sign-in options are used.'),
      ('Payments','When Stripe payment links are enabled, payment information is handled by Stripe rather than being stored directly by this application.')
   ]
 }
}

@app.route('/<page>')
def public_page(page):
    if page not in PUBLIC_PAGES:return ('Not found',404)
    return render_template('public_info.html',page=PUBLIC_PAGES[page],slug=page)

@app.route('/vouches')
def vouches_page():
    with db() as c:
        rows=c.execute("SELECT * FROM vouches WHERE status='approved' ORDER BY created_at DESC").fetchall()
    return render_template('vouches.html',vouches=[dict(r) for r in rows],user=current_user())

@app.post('/api/vouches')
@login_required
def submit_vouch():
    p=request.get_json(silent=True) or request.form
    message=(p.get('message') or '').strip()
    role=(p.get('role') or '').strip()[:80]
    project=(p.get('project_name') or '').strip()[:100]
    try:rating=max(1,min(5,int(p.get('rating') or 5)))
    except Exception:rating=5
    if len(message)<20:return jsonify({'ok':False,'error':'Please write at least 20 characters.'}),400
    u=current_user()
    with db() as c:
        c.execute('INSERT INTO vouches(user_id,name,role,rating,message,project_name,status,created_at) VALUES(?,?,?,?,?,?,?,?)',(u['id'],u.get('name') or 'Veyra User',role,rating,message[:1000],project,'pending',now()))
        c.commit()
    return jsonify({'ok':True,'message':'Your vouch was submitted for review.'})

@app.route('/admin/vouches')
@login_required
def admin_vouches():
    if not is_admin():return ('Forbidden',403)
    with db() as c:rows=c.execute("SELECT * FROM vouches ORDER BY created_at DESC").fetchall()
    return render_template('admin_vouches.html',rows=[dict(r) for r in rows],user=current_user())

@app.post('/admin/vouches/<int:vid>/<action>')
@login_required
def review_vouch(vid,action):
    if not is_admin() or action not in {'approve','deny'}:return ('Forbidden',403)
    status='approved' if action=='approve' else 'denied'
    with db() as c:
        c.execute('UPDATE vouches SET status=?,reviewed_at=? WHERE id=?',(status,now(),vid));c.commit()
    return redirect('/admin/vouches')

@app.route('/checkout/<plan>')
def checkout(plan):
    plans={'pro':{'name':'Veyra Pro','price':'$19.99','credits':'3,000'},'max':{'name':'Veyra Max','price':'$34.99','credits':'7,500'}}
    if plan not in plans:return redirect('/pricing')
    return render_template('checkout.html',plan=plan,info=plans[plan],configured=bool(os.getenv(f'STRIPE_{plan.upper()}_PAYMENT_LINK','').strip()))

@app.route('/buy/<plan>')
def buy(plan):
    if plan=='free':return redirect('/signup')
    if plan not in {'pro','max'}:return redirect('/pricing')
    link=os.getenv(f'STRIPE_{plan.upper()}_PAYMENT_LINK','').strip()
    if link:return redirect(link)
    return redirect(f'/checkout/{plan}')

@app.route('/buy/credits/<int:amount>')
def buy_credits(amount):
    allowed={1000,2500,5000,10000}
    if amount not in allowed:return redirect('/pricing')
    link=os.getenv(f'STRIPE_CREDITS_{amount}_LINK','').strip()
    if link:return redirect(link)
    return redirect('/pricing#credit-packs')

SUPPORT_FAQ=[
 ('credits',['credit','credits','balance'],'Credits represent Veyra usage. Your balance appears in the app. Pro includes 3,000 monthly credits and Max includes 7,500 monthly credits. Extra credit packs are available from the Pricing page.'),
 ('export',['export','download','zip'],'Open Studio and use Export to download the current generated project as a ZIP with HTML, CSS, and JavaScript.'),
 ('deploy',['deploy','deployment','hosting'],'Direct deployment integrations are still beta. Export your project ZIP for now instead of relying on a fake success state.'),
 ('login',['login','sign in','google','discord','oauth'],'You can sign in with email/password. Google and Discord require OAuth credentials to be configured by the Veyra administrator.'),
 ('billing',['pay','payment','billing','purchase','buy','card'],'Paid checkout is designed to use Stripe Payment Links. Choose Pro, Max, or an extra credit pack on Pricing; configured purchases open Stripe secure hosted checkout.'),
 ('bug',['bug','broken','error','not working'],'Tell me what page you were on, what you clicked, what you expected, what happened instead, and any error message you saw.'),
 ('vouch',['vouch','review','testimonial'],'Approved vouches are public on the Vouches page. Signed-in users can submit a vouch and it stays private until reviewed by Veyra staff.')
]

def support_fallback(question):
    q=question.lower()
    for _,keys,answer in SUPPORT_FAQ:
        if any(k in q for k in keys):return answer
    return 'I can help with accounts, credits, billing, exports, deployment, vouches, and troubleshooting. Tell me what you were trying to do and what happened.'

@app.post('/api/support')
def support_api():
    p=request.get_json(silent=True) or {}
    question=(p.get('message') or '').strip()[:1500]
    if not question:return jsonify({'ok':False,'error':'Ask a support question.'}),400
    answer=support_fallback(question)
    key=os.getenv('OPENAI_API_KEY','').strip()
    if key:
        try:
            client=OpenAI(api_key=key)
            support_model=(os.getenv('VEYRA_SUPPORT_MODEL') or 'gpt-6-luna').strip() or 'gpt-6-luna'
            output,_=run_veyra_response(
                client,
                model=support_model,
                instructions=(
                    'You are Veyra Support. Be concise, helpful, and honest. '
                    'Veyra is in public beta. Never claim an unfinished feature works. '
                    'For payment issues never ask for full card numbers. '
                    'Explain that paid checkout uses Stripe Payment Links when configured. '
                    'If the user reports a bug, ask for reproducible steps, expected behavior, '
                    'actual behavior, browser, and screenshot if possible.'
                ),
                input_text=question,
                max_output_tokens=450,
                reasoning=None,
            )
            answer=output or answer
        except Exception as exc:
            app.logger.warning(
                'Veyra Support AI unavailable | code=%s | type=%s',
                classify_ai_error(exc),
                type(exc).__name__,
            )
    u=current_user()
    with db() as c:
        c.execute('INSERT INTO support_threads(user_id,question,answer,created_at) VALUES(?,?,?,?)',((u or {}).get('id'),question,answer,now()));c.commit()
    return jsonify({'ok':True,'answer':answer})

@app.route('/login')
def login():
    if current_user():return redirect(url_for('dashboard'))
    return render_template('auth.html',mode='login')
@app.route('/signup')
def signup():
    if current_user():return redirect(url_for('dashboard'))
    return render_template('auth.html',mode='signup')
@app.post('/signup/email')
def signup_email():
    name=(request.form.get('name') or '').strip();email=(request.form.get('email') or '').strip().lower();pw=request.form.get('password') or ''
    if len(name)<2 or '@' not in email or len(pw)<8:
        flash('Enter a name, valid email, and password with at least 8 characters.','error');return redirect(url_for('signup'))
    with db() as c:
        if c.execute("SELECT id FROM users WHERE provider='local' AND lower(email)=?",(email,)).fetchone():
            flash('An account with that email already exists.','error');return redirect(url_for('signup'))
        cur=c.execute("INSERT INTO users(provider,provider_user_id,email,name,password_hash,credits,created_at) VALUES('local',?,?,?,?,50,?)",(email,email,name,generate_password_hash(pw),now()));c.commit();uid=cur.lastrowid
    _finish_login(uid, remember=True)
    return redirect(url_for('dashboard'))
@app.post('/login/email')
def login_email():
    email=(request.form.get('email') or '').strip().lower();pw=request.form.get('password') or ''
    with db() as c:r=c.execute("SELECT * FROM users WHERE provider='local' AND lower(email)=?",(email,)).fetchone()
    if not r or not r['password_hash'] or not check_password_hash(r['password_hash'],pw):
        flash('Incorrect email or password.','error');return redirect(url_for('login'))
    remember=bool(request.form.get('remember'))
    _finish_login(r['id'], remember=remember, user=dict(r))
    return redirect(url_for('dashboard'))
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/auth/google')
def auth_google():
    if not os.getenv('GOOGLE_CLIENT_ID') or not os.getenv('GOOGLE_CLIENT_SECRET'):
        return render_template('oauth_missing.html',provider='Google'),503

    # Keep OAuth state and callback on the hostname the browser is already using.
    redirect_uri=oauth_request_url('/auth/google/callback')
    app.logger.info('Starting Google OAuth | redirect_uri=%s',redirect_uri)
    return google.authorize_redirect(redirect_uri)


@app.route('/auth/google/callback')
def google_callback():
    redirect_uri=oauth_request_url('/auth/google/callback')
    try:
        token=google.authorize_access_token(redirect_uri=redirect_uri)
        info=token.get('userinfo')
        if not info:
            info=google.get(
                'https://openidconnect.googleapis.com/v1/userinfo',
                token=token
            ).json()

        google_id=str(info.get('sub') or '').strip()
        if not google_id:
            raise ValueError('Google did not return a user ID')

        uid=upsert_oauth(
            'google',
            google_id,
            info.get('email'),
            info.get('name') or info.get('email') or 'Veyra User',
            info.get('picture')
        )
        _finish_login(uid,remember=True)
        return redirect(url_for('dashboard'))

    except Exception as exc:
        app.logger.exception(
            'Google OAuth callback failed | redirect_uri=%s | error=%s',
            redirect_uri,
            type(exc).__name__
        )
        flash('Google sign-in failed. Check the Google OAuth redirect URI and try again.','error')
        return redirect(url_for('login'))
@app.route('/auth/discord')
def auth_discord():
    client_id=(os.getenv('DISCORD_CLIENT_ID') or '').strip()
    client_secret=(os.getenv('DISCORD_CLIENT_SECRET') or '').strip()
    if not client_id or not client_secret:
        return render_template('oauth_missing.html',provider='Discord'),503

    # Build the callback once and bind the exact value into signed OAuth state.
    # That same callback is reused during the code exchange after Discord returns.
    redirect_uri=oauth_request_url('/auth/discord/callback')
    serializer=URLSafeTimedSerializer(app.secret_key, salt='veyra-discord-oauth-v1')
    state=serializer.dumps({
        'redirect_uri': redirect_uri,
        'nonce': secrets.token_urlsafe(18),
    })

    params={
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': redirect_uri,
        'scope': 'identify email',
        'state': state,
        'prompt': 'consent',
    }
    authorize_url='https://discord.com/oauth2/authorize?' + urlencode(params)

    app.logger.info(
        'Starting Discord OAuth direct flow | redirect_uri=%s | host=%s | forwarded_host=%s',
        redirect_uri,
        request.host,
        request.headers.get('X-Forwarded-Host')
    )
    return redirect(authorize_url)


@app.route('/auth/discord/callback')
def discord_callback():
    client_id=(os.getenv('DISCORD_CLIENT_ID') or '').strip()
    client_secret=(os.getenv('DISCORD_CLIENT_SECRET') or '').strip()
    code=(request.args.get('code') or '').strip()
    raw_state=(request.args.get('state') or '').strip()
    provider_error=(request.args.get('error') or '').strip()

    if provider_error:
        detail=(request.args.get('error_description') or provider_error).strip()
        app.logger.warning('Discord OAuth denied before exchange | error=%s', detail[:300])
        flash('Discord sign-in was cancelled or denied.','error')
        return redirect(url_for('login'))

    if not code or not raw_state:
        flash('Discord sign-in did not return a valid authorization code. Please try again.','error')
        return redirect(url_for('login'))

    try:
        serializer=URLSafeTimedSerializer(app.secret_key, salt='veyra-discord-oauth-v1')
        state_data=serializer.loads(raw_state, max_age=600)
        redirect_uri=str(state_data.get('redirect_uri') or '').strip()

        if redirect_uri not in {
            'https://buildveyra.xyz/auth/discord/callback',
            'https://www.buildveyra.xyz/auth/discord/callback',
        }:
            raise ValueError('Untrusted Discord callback URL in OAuth state')

        token_body=urlencode({
            'client_id': client_id,
            'client_secret': client_secret,
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': redirect_uri,
        }).encode('utf-8')

        token_req=UrlRequest(
            'https://discord.com/api/oauth2/token',
            data=token_body,
            headers={
                'Content-Type':'application/x-www-form-urlencoded',
                'Accept':'application/json',
                'User-Agent':'Veyra/1.0',
            },
            method='POST',
        )
        with urlopen(token_req, timeout=12) as token_res:
            token_payload=json.loads(token_res.read().decode('utf-8'))

        access_token=str(token_payload.get('access_token') or '').strip()
        if not access_token:
            raise RuntimeError('Discord did not return an access token')

        user_req=UrlRequest(
            'https://discord.com/api/users/@me',
            headers={
                'Authorization':f'Bearer {access_token}',
                'Accept':'application/json',
                'User-Agent':'Veyra/1.0',
            },
            method='GET',
        )
        with urlopen(user_req, timeout=12) as user_res:
            profile=json.loads(user_res.read().decode('utf-8'))

        discord_id=str(profile.get('id') or '').strip()
        if not discord_id:
            raise ValueError('Discord did not return a user ID')

        email=profile.get('email')
        name=profile.get('global_name') or profile.get('username') or 'Veyra User'
        avatar_hash=profile.get('avatar')
        avatar=(
            f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar_hash}.png"
            if avatar_hash else None
        )

        uid=upsert_oauth('discord',discord_id,email,name,avatar)
        _finish_login(uid,remember=True)

        app.logger.info('Discord OAuth login completed | user_id=%s | discord_id=%s',uid,discord_id)
        return redirect(url_for('dashboard'))

    except SignatureExpired:
        app.logger.warning('Discord OAuth state expired')
        flash('Discord sign-in took too long. Please try again.','error')
        return redirect(url_for('login'))
    except BadSignature:
        app.logger.warning('Discord OAuth state signature was invalid')
        flash('Discord sign-in session could not be verified. Please try again.','error')
        return redirect(url_for('login'))
    except HTTPError as exc:
        body=''
        try:
            body=exc.read().decode('utf-8','replace')
        except Exception:
            pass
        app.logger.exception(
            'Discord OAuth HTTP failure | status=%s | redirect_uri=%s | body=%s',
            getattr(exc,'code',None),
            locals().get('redirect_uri'),
            body[:500]
        )
        msg='Discord sign-in failed while finishing authorization.'
        if getattr(exc,'code',None)==401:
            msg='Discord rejected the configured OAuth client credentials.'
        elif 'redirect_uri' in body.lower():
            msg='Discord rejected the OAuth callback URL configured for this app.'
        flash(msg,'error')
        return redirect(url_for('login'))
    except (URLError, TimeoutError) as exc:
        app.logger.exception('Discord OAuth network failure | error=%s',type(exc).__name__)
        flash('Discord could not be reached to finish sign-in. Please try again.','error')
        return redirect(url_for('login'))
    except Exception as exc:
        app.logger.exception(
            'Discord OAuth callback failed | error=%s | detail=%s',
            type(exc).__name__,
            str(exc)[:500]
        )
        flash('Discord sign-in could not be completed. Check the Vercel function log for the exact cause.','error')
        return redirect(url_for('login'))


@app.get('/auth/status')
def oauth_status():
    return jsonify({
        'oauth_base_url':OAUTH_BASE_URL,
        'google':{
            'configured':bool(os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET')),
            'client_id':os.getenv('GOOGLE_CLIENT_ID') or None,
            'redirect_uri':oauth_request_url('/auth/google/callback'),
            'allowed_redirects':[
                'https://buildveyra.xyz/auth/google/callback',
                'https://www.buildveyra.xyz/auth/google/callback',
            ],
        },
        'discord':{
            'configured':bool(os.getenv('DISCORD_CLIENT_ID') and os.getenv('DISCORD_CLIENT_SECRET')),
            'client_id':os.getenv('DISCORD_CLIENT_ID') or None,
            'redirect_uri':oauth_request_url('/auth/discord/callback'),
            'allowed_redirects':[
                'https://buildveyra.xyz/auth/discord/callback',
                'https://www.buildveyra.xyz/auth/discord/callback',
            ],
        },
    })


@app.get('/api/account/sync')
@login_required
def account_sync_status():
    user=current_user()
    discord_id=str(
        user.get('discord_id')
        or (user.get('provider_user_id') if user.get('provider')=='discord' else '')
        or ''
    ).strip()

    return jsonify({
        'ok':True,
        'user_id':user.get('id'),
        'email':user.get('email'),
        'plan':user.get('plan') or 'free',
        'credits':int(user.get('credits') or 0),
        'discord_linked':bool(discord_id),
        'discord_id':discord_id or None,
        'website_admin':is_admin(user),
    })


@app.route('/admin')
@login_required
def admin_dashboard():
    if not is_admin():
        return ('Forbidden',403)

    with db() as c:
        raw_users=c.execute('SELECT * FROM users ORDER BY created_at DESC').fetchall()
        users=[dict(r) for r in raw_users]

        total_users=c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n']
        paid_users=c.execute("SELECT COUNT(*) AS n FROM users WHERE lower(COALESCE(plan,'free')) IN ('pro','max')").fetchone()['n']
        project_count=c.execute('SELECT COUNT(*) AS n FROM projects').fetchone()['n']
        restricted=c.execute('SELECT COUNT(*) AS n FROM users WHERE COALESCE(is_blacklisted,0)=1').fetchone()['n']

        support_threads=[
            dict(r) for r in c.execute(
                'SELECT * FROM support_threads ORDER BY created_at DESC LIMIT 8'
            ).fetchall()
        ]

        audit_raw=[
            dict(r) for r in c.execute(
                'SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 20'
            ).fetchall()
        ]

    for u in users:
        uid=u['id']
        u['plan_action']=url_for('admin_set_plan',user_id=uid)
        u['credit_action']=url_for('admin_set_credits',user_id=uid)
        u['add100_action']=url_for('admin_add_credits',user_id=uid,amount=100)
        u['add1000_action']=url_for('admin_add_credits',user_id=uid,amount=1000)
        u['restrict_action']=url_for('admin_restrict',user_id=uid)
        u['unrestrict_action']=url_for('admin_unrestrict',user_id=uid)

    audit_rows=[]
    user_lookup={int(u['id']):u for u in users}
    for row in audit_raw:
        actor=user_lookup.get(int(row['admin_user_id'])) if row.get('admin_user_id') else None
        target=user_lookup.get(int(row['target_id'])) if row.get('target_id') else None
        row['actor_name']=(actor or {}).get('name') or (actor or {}).get('email') or 'System'
        row['target_name']=(target or {}).get('name') or (target or {}).get('email') or row.get('target_id') or '—'
        row['summary']=row.get('details') or ''
        audit_rows.append(row)

    with db() as c:
        total_credits=c.execute(
            'SELECT COALESCE(SUM(credits),0) AS n FROM users'
        ).fetchone()['n']
        total_logins=c.execute(
            'SELECT COUNT(*) AS n FROM login_events'
        ).fetchone()['n']
        admin_count=c.execute(
            'SELECT COUNT(*) AS n FROM site_admins'
        ).fetchone()['n']
        discord_linked=c.execute(
            "SELECT COUNT(*) AS n FROM users WHERE COALESCE(discord_id,'')<>'' OR lower(COALESCE(provider,''))='discord'"
        ).fetchone()['n']

    stats={
        'total_users':int(total_users or 0),
        'paid_users':int(paid_users or 0),
        'projects':int(project_count or 0),
        'restricted':int(restricted or 0),
        'open_support':len(support_threads),
        'total_credits':int(total_credits or 0),
        'total_logins':int(total_logins or 0),
        'admin_count':int(admin_count or 0),
        'discord_linked':int(discord_linked or 0),
        'ai_status':'Ready' if os.getenv('OPENAI_API_KEY','').strip() else 'Local mode',
        'stripe_status':'Configured' if (
            os.getenv('STRIPE_PRO_PAYMENT_LINK','').strip()
            or os.getenv('STRIPE_MAX_PAYMENT_LINK','').strip()
        ) else 'Not configured',
    }

    return render_template(
        'admin_dashboard_v3.html',
        user=current_user(),
        users=users,
        stats=stats,
        support_threads=support_threads,
        audit_rows=audit_rows
    )

@app.post('/admin/users/<int:user_id>/plan')
@login_required
def admin_set_plan(user_id):
    if not is_admin():
        return ('Forbidden',403)
    plan=(request.form.get('plan') or '').strip().lower()
    if plan not in {'free','pro','max'}:
        return ('Invalid plan',400)
    with db() as c:
        old=c.execute('SELECT plan FROM users WHERE id=?',(user_id,)).fetchone()
        if not old:return ('User not found',404)
        c.execute('UPDATE users SET plan=? WHERE id=?',(plan,user_id))
        c.commit()
    admin_audit('set_plan',user_id,{'before':old['plan'],'after':plan})
    return redirect(url_for('admin_dashboard'))

@app.post('/admin/users/<int:user_id>/credits')
@login_required
def admin_set_credits(user_id):
    if not is_admin():
        return ('Forbidden',403)
    try:
        credits=max(0,int(request.form.get('credits') or 0))
    except (TypeError,ValueError):
        return ('Invalid credits',400)
    with db() as c:
        old=c.execute('SELECT credits FROM users WHERE id=?',(user_id,)).fetchone()
        if not old:return ('User not found',404)
        c.execute('UPDATE users SET credits=? WHERE id=?',(credits,user_id))
        c.commit()
    admin_audit('set_credits',user_id,{'before':int(old['credits'] or 0),'after':credits})
    return redirect(url_for('admin_dashboard'))

@app.post('/admin/users/<int:user_id>/credits/add/<int:amount>')
@login_required
def admin_add_credits(user_id,amount):
    if not is_admin():
        return ('Forbidden',403)
    if amount not in {100,1000}:
        return ('Invalid amount',400)
    with db() as c:
        row=c.execute('SELECT credits FROM users WHERE id=?',(user_id,)).fetchone()
        if not row:return ('User not found',404)
        before=int(row['credits'] or 0)
        after=before+amount
        c.execute('UPDATE users SET credits=? WHERE id=?',(after,user_id))
        c.commit()
    admin_audit('add_credits',user_id,{'amount':amount,'before':before,'after':after})
    return redirect(url_for('admin_dashboard'))

@app.post('/admin/users/<int:user_id>/restrict')
@login_required
def admin_restrict(user_id):
    if not is_admin():
        return ('Forbidden',403)
    reason=(request.form.get('reason') or 'Administrative action').strip()[:300]
    with db() as c:
        row=c.execute('SELECT id FROM users WHERE id=?',(user_id,)).fetchone()
        if not row:return ('User not found',404)
        c.execute(
            'UPDATE users SET is_blacklisted=1,blacklist_reason=? WHERE id=?',
            (reason,user_id)
        )
        c.commit()
    admin_audit('restrict_user',user_id,{'reason':reason})
    return redirect(url_for('admin_dashboard'))

@app.post('/admin/users/<int:user_id>/unrestrict')
@login_required
def admin_unrestrict(user_id):
    if not is_admin():
        return ('Forbidden',403)
    with db() as c:
        row=c.execute('SELECT id FROM users WHERE id=?',(user_id,)).fetchone()
        if not row:return ('User not found',404)
        c.execute(
            "UPDATE users SET is_blacklisted=0,blacklist_reason='' WHERE id=?",
            (user_id,)
        )
        c.commit()
    admin_audit('unrestrict_user',user_id,{})
    return redirect(url_for('admin_dashboard'))


@app.route('/account')
@login_required
def account():
    u=current_user()
    if not u:
        return redirect(url_for('login'))

    project_count=0
    try:
        with db() as c:
            row=c.execute(
                'SELECT COUNT(*) AS n FROM projects WHERE user_id=?',
                (u['id'],)
            ).fetchone()
            if row:
                project_count=int(row['n'] or 0)
    except Exception:
        app.logger.exception('Account project count lookup failed')

    stats={
        'projects':project_count,
        'credits':int(u.get('credits') or 0),
        'plan':(u.get('plan') or 'free').lower(),
    }

    return render_template(
        'account.html',
        user=u,
        stats=stats
    )

@app.route('/studio')
@login_required
def studio():return render_template('studio.html',user=current_user())

def _owned_projects(uid):
    with db() as c:
        return [dict(r) for r in c.execute(
            'SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC',
            (uid,)
        ).fetchall()]


def _project_for_owner(project_id, uid):
    with db() as c:
        row=c.execute('SELECT * FROM projects WHERE id=? AND user_id=?',(project_id,uid)).fetchone()
        return dict(row) if row else None


def _project_access(project_id, uid):
    with db() as c:
        project=c.execute('SELECT * FROM projects WHERE id=?',(project_id,)).fetchone()
        if not project:
            return None, None
        project=dict(project)
        if int(project['user_id'])==int(uid):
            return project, 'owner'
        membership=c.execute(
            'SELECT role FROM project_members WHERE project_id=? AND user_id=?',
            (project_id,uid)
        ).fetchone()
        if membership:
            return project, str(membership['role'] or 'viewer')
        return project, None


def _visible_projects(uid):
    with db() as c:
        rows=c.execute(
            '''SELECT p.*, 'owner' AS access_role
               FROM projects p
               WHERE p.user_id=?
               UNION ALL
               SELECT p.*, pm.role AS access_role
               FROM projects p
               JOIN project_members pm ON pm.project_id=p.id
               WHERE pm.user_id=?
               ORDER BY updated_at DESC''',
            (uid,uid)
        ).fetchall()
    return [dict(r) for r in rows]


@app.route('/dashboard')
@login_required
def dashboard():
    u=current_user(); uid=u['id']
    with db() as c:
        rows=c.execute('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 6',(uid,)).fetchall()
        project_count=c.execute('SELECT COUNT(*) AS n FROM projects WHERE user_id=?',(uid,)).fetchone()['n']
        deployment_count=c.execute('SELECT COUNT(*) AS n FROM deployments WHERE user_id=?',(uid,)).fetchone()['n']
        analytics_count=c.execute('SELECT COUNT(*) AS n FROM analytics_events WHERE user_id=?',(uid,)).fetchone()['n']
    return render_template('dashboard.html',user=u,projects=[dict(r) for r in rows],stats={
        'projects':int(project_count or 0),
        'deployments':int(deployment_count or 0),
        'analytics':int(analytics_count or 0),
        'credits':int(u.get('credits') or 0),
        'plan':(u.get('plan') or 'free').lower(),
    })


@app.route('/app/projects')
@login_required
def projects_page():
    u=current_user()
    return render_template('projects.html',user=u,projects=_visible_projects(u['id']))


@app.route('/app/templates')
@login_required
def templates_page():
    starter_templates=[
        {'name':'SaaS landing page','kind':'Marketing','description':'Hero, features, pricing and CTA sections.'},
        {'name':'Portfolio','kind':'Personal','description':'Projects, about, experience and contact sections.'},
        {'name':'Admin dashboard','kind':'App','description':'Sidebar, metrics shell, tables and settings layout.'},
        {'name':'Storefront','kind':'Commerce','description':'Product grid, product details and cart-ready layout.'},
    ]
    return render_template('templates.html',user=current_user(),templates=starter_templates)


@app.route('/app/deployments')
@login_required
def deployments_page():
    u=current_user()
    with db() as c:
        rows=c.execute("SELECT d.*,p.name AS project_name FROM deployments d JOIN projects p ON p.id=d.project_id WHERE d.user_id=? ORDER BY d.created_at DESC",(u['id'],)).fetchall()
    return render_template('deployments.html',user=u,deployments=[dict(r) for r in rows])


@app.route('/app/agents')
@login_required
def agents_page():
    u=current_user()
    with db() as c:
        rows=c.execute('SELECT * FROM agents WHERE user_id=? ORDER BY created_at DESC',(u['id'],)).fetchall()
    return render_template('agents.html',user=u,agents=[dict(r) for r in rows])


@app.post('/app/agents/create')
@login_required
def agents_create():
    u=current_user(); name=(request.form.get('name') or '').strip()[:80]
    description=(request.form.get('description') or '').strip()[:300]
    if not name:
        flash('Agent name is required.','error'); return redirect(url_for('agents_page'))
    with db() as c:
        c.execute('INSERT INTO agents(user_id,name,description,status,created_at) VALUES(?,?,?,?,?)',(u['id'],name,description,'idle',now()))
        c.commit()
    return redirect(url_for('agents_page'))


@app.route('/app/settings')
@login_required
def settings_page():
    return render_template('settings.html',user=current_user())


@app.route('/app/profile')
@login_required
def profile_page():
    return redirect(url_for('account'))


@app.route('/app/databases')
@login_required
def databases_page():
    u=current_user()
    with db() as c:
        rows=c.execute("SELECT d.*,p.name AS project_name FROM project_databases d LEFT JOIN projects p ON p.id=d.project_id WHERE d.user_id=? ORDER BY d.created_at DESC",(u['id'],)).fetchall()
    return render_template('databases.html',user=u,databases=[dict(r) for r in rows])


@app.route('/app/analytics')
@login_required
def analytics_page():
    u=current_user()
    with db() as c:
        events=c.execute("SELECT a.*,p.name AS project_name FROM analytics_events a JOIN projects p ON p.id=a.project_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 100",(u['id'],)).fetchall()
    return render_template('analytics.html',user=u,events=[dict(r) for r in events])


@app.route('/app/team')
@login_required
def team_page():
    u=current_user()
    return render_template('team.html',user=u,projects=_owned_projects(u['id']))


@app.route('/app/projects/<int:project_id>/members')
@login_required
def project_members_page(project_id):
    u=current_user(); project=_project_for_owner(project_id,u['id'])
    if not project:
        return ('Project not found',404)
    with db() as c:
        rows=c.execute("SELECT pm.*,u.name,u.email,u.avatar_url FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY pm.created_at ASC",(project_id,)).fetchall()
    return render_template('project_members.html',user=u,project=project,members=[dict(r) for r in rows])


@app.post('/app/projects/<int:project_id>/members/add')
@login_required
def project_members_add(project_id):
    u=current_user(); project=_project_for_owner(project_id,u['id'])
    if not project:
        return ('Project not found',404)
    email=(request.form.get('email') or '').strip().lower()[:240]
    role=(request.form.get('role') or 'editor').strip().lower()
    if role not in {'viewer','editor'}:
        role='editor'
    if not email:
        flash('Enter a Veyra account email.','error')
        return redirect(url_for('project_members_page',project_id=project_id))
    with db() as c:
        target=c.execute('SELECT id,email,name FROM users WHERE LOWER(email)=LOWER(?) ORDER BY id ASC LIMIT 1',(email,)).fetchone()
        if not target:
            flash('No Veyra account uses that email yet. Ask them to create an account first.','error')
            return redirect(url_for('project_members_page',project_id=project_id))
        if int(target['id'])==int(u['id']):
            flash('You already own this project.','error')
            return redirect(url_for('project_members_page',project_id=project_id))
        try:
            c.execute('INSERT INTO project_members(project_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?)',(project_id,target['id'],role,u['id'],now()))
            c.commit()
            flash('Project member added.','success')
        except Exception:
            c.rollback()
            flash('That person is already on this project.','error')
    return redirect(url_for('project_members_page',project_id=project_id))


@app.post('/app/projects/<int:project_id>/members/<int:member_id>/remove')
@login_required
def project_members_remove(project_id,member_id):
    u=current_user(); project=_project_for_owner(project_id,u['id'])
    if not project:
        return ('Project not found',404)
    with db() as c:
        c.execute('DELETE FROM project_members WHERE id=? AND project_id=?',(member_id,project_id))
        c.commit()
    flash('Project member removed.','success')
    return redirect(url_for('project_members_page',project_id=project_id))


@app.get('/api/projects/<int:project_id>')
@login_required
def get_project(project_id):
    u=current_user()
    project,role=_project_access(project_id,u['id'])
    if not project or not role:
        return jsonify({'ok':False,'error':'Project not found'}),404
    project['access_role']=role
    return jsonify({'ok':True,'project':project})


@app.post('/api/projects/publish')
@login_required
def publish_project():
    payload=request.get_json(silent=True) or {}
    project_id=payload.get('project_id')
    if not project_id:
        return jsonify({'ok':False,'error':'Save the project before publishing.'}),400

    u=current_user()
    project=_project_for_owner(project_id,u['id'])
    if not project:
        return jsonify({'ok':False,'error':'Only the project owner can publish.'}),403

    public_path=f"/p/{int(project_id)}"
    public_url=public_url(public_path)

    with db() as c:
        existing=c.execute(
            'SELECT id FROM deployments WHERE project_id=? AND user_id=? ORDER BY id DESC LIMIT 1',
            (project_id,u['id'])
        ).fetchone()
        if existing:
            c.execute(
                "UPDATE deployments SET url=?,status='ready',created_at=? WHERE id=?",
                (public_url,now(),existing['id'])
            )
        else:
            c.execute(
                'INSERT INTO deployments(user_id,project_id,url,status,created_at) VALUES(?,?,?,?,?)',
                (u['id'],project_id,public_url,'ready',now())
            )
        c.commit()

    return jsonify({'ok':True,'url':public_url,'project_id':int(project_id)})


@app.get('/p/<int:project_id>')
def public_project(project_id):
    with db() as c:
        project=c.execute('SELECT * FROM projects WHERE id=?',(project_id,)).fetchone()
        deployment=c.execute(
            "SELECT id FROM deployments WHERE project_id=? AND status='ready' ORDER BY id DESC LIMIT 1",
            (project_id,)
        ).fetchone()
        if not project or not deployment:
            return ('Project not published',404)

        project=dict(project)
        try:
            c.execute(
                'INSERT INTO analytics_events(user_id,project_id,event_type,created_at) VALUES(?,?,?,?)',
                (project['user_id'],project_id,'page_view',now())
            )
            c.commit()
        except Exception:
            c.rollback()

    safe_js=(project.get('js') or '').replace('</script>','<\\/script>')
    page='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>''' + (project.get('css') or '') + '''</style></head><body>''' + (project.get('html') or '') + '''<script>''' + safe_js + '''</script></body></html>'''
    return page


@app.get('/api/ai/status')
@login_required
def ai_status():
    key=bool(os.getenv('OPENAI_API_KEY','').strip())
    return jsonify({
        'configured':key,
        'status':'ready' if key else 'local',
        'label':'Veyra AI Ready' if key else 'Veyra Local Engine',
        'api':'responses',
        'model':veyra_model() if key else None,
        'fallback_model':veyra_fallback_model() if key else None,
        'version':'Veyra AI R3',
    })



SCHEMA={
 'type':'object','additionalProperties':False,
 'properties':{
  'assistant_message':{'type':'string'},
  'title':{'type':'string'},
  'html':{'type':'string'},
  'css':{'type':'string'},
  'js':{'type':'string'},
  'files':{'type':'array','items':{'type':'string'}},
  'changed_files':{
    'type':'array',
    'items':{
      'type':'object','additionalProperties':False,
      'properties':{
        'file':{'type':'string'},
        'action':{'type':'string'},
        'details':{'type':'string'}
      },
      'required':['file','action','details']
    }
  },
  'next_steps':{'type':'array','items':{'type':'string'}},
  'quality':{'type':'object','additionalProperties':False,'properties':{'accessibility':{'type':'integer'},'performance':{'type':'integer'},'responsive':{'type':'string'},'security':{'type':'string'}},'required':['accessibility','performance','responsive','security']}
 },
 'required':['assistant_message','title','html','css','js','files','changed_files','next_steps','quality']
}

def local_preview(prompt):
    low=prompt.lower()
    if 'dashboard' in low or 'analytics' in low:
        title='Pulse Analytics';html='''<main class="dash"><aside><div class="mark">P</div><b>Pulse</b><nav><a class="on">Overview</a><a>Analytics</a><a>Customers</a><a>Revenue</a></nav></aside><section><header><div><small>OVERVIEW</small><h1>Performance at a glance</h1></div><button>Export report</button></header><div class="stats"><article><span>Revenue</span><b>$84,290</b><em>+18.4%</em></article><article><span>Customers</span><b>12,402</b><em>+9.2%</em></article><article><span>Conversion</span><b>7.8%</b><em>+2.1%</em></article></div><div class="chart"><div><b>Revenue growth</b><small>Last 30 days</small></div><i></i></div></section></main>''';css='''*{box-sizing:border-box}body{margin:0;background:#070914;color:#f8f8ff;font-family:Inter,Arial}.dash{min-height:100vh;display:grid;grid-template-columns:190px 1fr;background:radial-gradient(circle at 80% 0,#6a35b72c,transparent 28%),#080a14}.dash aside{padding:24px 17px;border-right:1px solid #20253a;background:#0b0e1b}.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#9a4ff8,#4f86ff);display:grid;place-items:center;font-weight:900}.dash aside b{display:block;margin-top:9px}.dash nav{display:grid;gap:6px;margin-top:30px}.dash nav a{padding:10px;border-radius:10px;color:#8490aa}.dash nav .on{background:#171c36;color:#fff}.dash>section{padding:32px}.dash header{display:flex;justify-content:space-between;align-items:end}.dash header small{color:#7e88a4;letter-spacing:.17em}.dash h1{margin:6px 0 0;font-size:34px}.dash header button{height:40px;border:0;border-radius:12px;padding:0 15px;background:linear-gradient(135deg,#8249ef,#4f86ff);color:white}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px}.stats article,.chart{padding:16px;border:1px solid #222a44;border-radius:17px;background:#10152a}.stats span{color:#8792ad}.stats b{display:block;font-size:25px;margin:9px 0}.stats em{font-style:normal;color:#5fe3a6}.chart{margin-top:12px;height:300px}.chart>div{display:flex;justify-content:space-between}.chart small{color:#7c87a2}.chart i{display:block;height:220px;margin-top:14px;border-radius:13px;background:linear-gradient(180deg,#8f5cff35,transparent),repeating-linear-gradient(90deg,transparent 0 48px,#ffffff06 48px 49px);position:relative}.chart i:after{content:"";position:absolute;left:4%;right:4%;top:52%;height:4px;background:linear-gradient(90deg,#7658f0,#b45bf4,#4f87ff);transform:skewY(-8deg);border-radius:99px;box-shadow:0 0 18px #8b5cf677}@media(max-width:700px){.dash{grid-template-columns:1fr}.dash aside{display:none}.dash>section{padding:20px}.stats{grid-template-columns:1fr}}'''
    else:
        title='Veyra Launch';html='''<main class="site"><nav><b><i></i> VEYRA</b><div><a>Product</a><a>Solutions</a><a>Pricing</a><a>Resources</a></div><button>Start free</button></nav><section class="hero"><span>✦ BUILT WITH VEYRA</span><h1>Turn your idea into<br><em>working software.</em></h1><p>Describe what you want and Veyra designs, codes, tests, and previews the product while you keep refining it.</p><div><button>Build with Veyra</button><button class="ghost">Explore examples</button></div></section><section class="cards"><article><b>Design + code together</b><p>Move from visual intent to working front-end without losing context.</p></article><article><b>Auto QA</b><p>Check responsiveness, accessibility, and interaction quality before launch.</p></article><article><b>Project memory</b><p>Keep decisions, files, and earlier versions available while you iterate.</p></article></section></main>''';css='''*{box-sizing:border-box}body{margin:0;background:#070914;color:#f8f8ff;font-family:Inter,Arial}.site{min-height:100vh;padding:0 46px;background:radial-gradient(circle at 50% 28%,#7e42df35,transparent 28%),radial-gradient(circle at 85% 5%,#286cff22,transparent 25%),#070914}.site nav{height:76px;display:flex;align-items:center;border-bottom:1px solid #1d2337}.site nav b i{display:inline-block;width:10px;height:10px;border-radius:4px;background:linear-gradient(135deg,#a958fa,#4f87ff)}.site nav div{display:flex;gap:25px;margin:auto;color:#919bb4}.site nav button,.hero button{height:42px;padding:0 17px;border:0;border-radius:12px;background:linear-gradient(135deg,#8249ef,#4f86ff);color:#fff;font-weight:700}.hero{text-align:center;padding:110px 20px 85px}.hero>span{display:inline-block;padding:8px 11px;border:1px solid #313859;border-radius:999px;color:#b39af4;font-size:10px;letter-spacing:.14em}.hero h1{font-size:78px;line-height:.94;letter-spacing:-.06em;margin:20px 0}.hero h1 em{font-style:normal;background:linear-gradient(90deg,#bc61ff,#5c8cff,#58defd);-webkit-background-clip:text;color:transparent}.hero p{max-width:680px;margin:auto;color:#a0a9c0;font-size:17px;line-height:1.65}.hero>div{display:flex;justify-content:center;gap:10px;margin-top:26px}.hero .ghost{background:#14192b;border:1px solid #2b334e}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding-bottom:45px}.cards article{padding:23px;border:1px solid #222a44;border-radius:18px;background:#0f1427}.cards b{font-size:17px}.cards p{color:#8d97b0;line-height:1.55}@media(max-width:700px){.site{padding:0 20px}.site nav div{display:none}.hero h1{font-size:50px}.cards{grid-template-columns:1fr}}'''
    return {'ok':True,'title':title,'assistant_message':'Done — I created a working local preview and updated the core project files. I also refreshed the layout, styling, and responsive behavior so you can see the result immediately.','html':html,'css':css,'js':'','files':['index.html','styles.css','app.js'],'changed_files':[{'file':'index.html','action':'Updated','details':'Rebuilt the page structure and visible content for the requested design.'},{'file':'styles.css','action':'Updated','details':'Applied the visual system, spacing, colors, typography, and responsive states.'},{'file':'app.js','action':'Reviewed','details':'Kept the interaction layer browser-safe and ready for follow-up behavior.'}],'next_steps':['Ask Veyra to refine any section','Open Code to inspect the generated files','Run Auto QA before deployment'],'quality':{'accessibility':96,'performance':93,'responsive':'Ready','security':'Sandboxed'},'engine':'Veyra Local'}

@app.post('/api/build')
@login_required
def api_build():
    p=request.get_json(silent=True) or {}
    prompt=(p.get('prompt') or '').strip()
    cur=p.get('current') or {}

    if not prompt:
        return jsonify({'ok':False,'error':'Tell Veyra what you want to build.'}),400

    uid=current_user()['id']
    is_followup=bool(
        (cur.get('html') or '').strip()
        or (cur.get('css') or '').strip()
        or (cur.get('js') or '').strip()
    )
    credit_cost=10 if is_followup else 25

    # Always trust the database, never a client-side credit number.
    try:
        with db() as c:
            credit_row=c.execute(
                'SELECT credits FROM users WHERE id=?',
                (uid,)
            ).fetchone()
        credits_before=int((credit_row['credits'] if credit_row else 0) or 0)
    except Exception:
        app.logger.exception('Veyra credit balance lookup failed')
        return jsonify({
            'ok':False,
            'error':'Veyra could not verify your credit balance. Try again.',
            'code':'CREDIT_LOOKUP_FAILED',
        }),503

    key=os.getenv('OPENAI_API_KEY','').strip()
    primary_model=veyra_model()
    secondary_model=veyra_fallback_model()

    # No API key = local engine; local builds never consume credits.
    if not key:
        d=local_preview(prompt)
        d.update({
            'assistant_message':'Veyra is running in local mode because the live AI key is not configured. No credits were used.',
            'engine':'Veyra Local Engine',
            'diagnostic_code':'OPENAI_NOT_CONFIGURED',
            'credits_used':0,
            'credits_remaining':credits_before,
            'credit_cost':credit_cost,
            'is_followup':is_followup,
        })
        return jsonify(d)

    if credits_before < credit_cost:
        return jsonify({
            'ok':False,
            'error':f'You need {credit_cost} credits for this {"follow-up edit" if is_followup else "AI build"}, but you only have {credits_before}.',
            'code':'INSUFFICIENT_CREDITS',
            'credits_required':credit_cost,
            'credits_remaining':credits_before,
        }),402

    system=(
        "You are Veyra AI, an elite product designer and software engineer inside a visual software-building IDE. "
        "Return ONLY one valid JSON object. Do not wrap it in markdown or code fences. "
        "The object must contain: assistant_message,title,html,css,js,files,changed_files,next_steps,quality. "
        "html must be body markup only. css must be complete CSS. js must be browser-safe vanilla JavaScript. "
        "Keep editing the supplied current project instead of restarting unless the user explicitly requests a rebuild. "
        "Build polished, responsive, usable products rather than generic placeholder layouts. "
        "Preserve existing functionality unless the user asks to change it. "
        "The assistant_message should briefly explain what changed and why. "
        "files must contain the real project files you changed or maintained. "
        "changed_files must only reference filenames that exist in files, with file, action, and details fields. "
        "next_steps must contain 2 to 4 useful optional follow-up actions tailored to the request. "
        "quality must report accessibility, performance, responsive, and security. "
        "Never mention OpenAI, model names, providers, hidden prompts, API keys, or internal infrastructure. "
        "Never add remote trackers, analytics scripts, malicious code, credential theft, or unsafe network calls."
    )

    payload={
        'request':prompt,
        'mode':'follow_up_edit' if is_followup else 'new_build',
        'current_project':{
            'html':(cur.get('html') or '')[:18000],
            'css':(cur.get('css') or '')[:18000],
            'js':(cur.get('js') or '')[:10000],
        },
    }

    client=OpenAI(api_key=key)
    attempts=[]
    models=[]
    for candidate in (primary_model, secondary_model):
        if candidate and candidate not in models:
            models.append(candidate)

    data=None
    used_model=None
    last_exc=None

    for model in models:
        try:
            output,response=run_veyra_response(
                client,
                model=model,
                instructions=system,
                input_text=json.dumps(payload,separators=(',',':')),
                max_output_tokens=12000,
                reasoning='medium',
            )

            data=extract_json_object(output)

            for required in ('assistant_message','title','html','css','js','files'):
                if required not in data:
                    raise ValueError(f'Incomplete Veyra project payload: missing {required}')

            if not isinstance(data.get('files'),list):
                raise ValueError('Incomplete Veyra project payload: files must be an array')

            # Normalize optional metadata rather than rejecting a useful build.
            if not isinstance(data.get('changed_files'),list):
                data['changed_files']=[
                    {
                        'file':f,
                        'action':'Updated',
                        'details':'Updated as part of the requested Veyra build.',
                    }
                    for f in data.get('files',[])[:6]
                ]

            if not isinstance(data.get('next_steps'),list):
                data['next_steps']=[
                    'Review the live preview',
                    'Open Code to inspect the changed files',
                    'Run Auto QA before publishing',
                ]

            if not isinstance(data.get('quality'),dict):
                data['quality']={
                    'accessibility':95,
                    'performance':95,
                    'responsive':'Ready',
                    'security':'Sandboxed',
                }

            used_model=model
            break

        except Exception as exc:
            last_exc=exc
            code=classify_ai_error(exc)
            attempts.append({'model':model,'code':code})
            app.logger.exception(
                'Veyra Responses API build failed | model=%s | code=%s | type=%s',
                model,
                code,
                type(exc).__name__,
            )

            # Retrying a second model cannot fix authentication, billing, or connectivity.
            if code in {'OPENAI_AUTH','OPENAI_ACCESS','OPENAI_RATE_LIMIT','OPENAI_TIMEOUT','OPENAI_CONNECTION'}:
                break

    if data is None:
        code=classify_ai_error(last_exc) if last_exc else 'OPENAI_UNKNOWN'
        d=local_preview(prompt)
        d.update({
            'assistant_message':(
                'The live Veyra AI request could not complete, so I showed a local preview instead. '
                f'No credits were used. Diagnostic: {code}.'
            ),
            'engine':'Veyra Local Engine',
            'diagnostic_code':code,
            'credits_used':0,
            'credits_remaining':credits_before,
            'credit_cost':credit_cost,
            'is_followup':is_followup,
            'ai_attempts':attempts,
        })
        return jsonify(d)

    # Debit only after a valid live AI build has been produced.
    try:
        with db() as c:
            debit=c.execute(
                'UPDATE users SET credits=credits-? WHERE id=? AND credits>=?',
                (credit_cost,uid,credit_cost)
            )
            if debit.rowcount != 1:
                c.rollback()
                latest=c.execute(
                    'SELECT credits FROM users WHERE id=?',
                    (uid,)
                ).fetchone()
                remaining=int((latest['credits'] if latest else 0) or 0)
                return jsonify({
                    'ok':False,
                    'error':'Your credit balance changed before the build completed. No credits were charged.',
                    'code':'CREDIT_BALANCE_CHANGED',
                    'credits_remaining':remaining,
                }),409

            remaining_row=c.execute(
                'SELECT credits FROM users WHERE id=?',
                (uid,)
            ).fetchone()
            credits_remaining=int((remaining_row['credits'] if remaining_row else 0) or 0)
            c.commit()

    except Exception:
        app.logger.exception('Veyra credit debit failed after AI build')
        return jsonify({
            'ok':False,
            'error':'The build completed, but Veyra could not safely update your credit balance. The build was not charged.',
            'code':'CREDIT_DEBIT_FAILED',
            'credits_remaining':credits_before,
        }),503

    data.update({
        'ok':True,
        'engine':'Veyra AI',
        'credits_used':credit_cost,
        'credits_remaining':credits_remaining,
        'credit_cost':credit_cost,
        'is_followup':is_followup,
        'ai_api':'responses',
        'ai_model':used_model,
    })
    return jsonify(data)


@app.post('/api/projects/save')
@login_required
def save_project():
    p=request.get_json(silent=True) or {}
    title=(p.get('title') or 'Untitled Project').strip()[:120]
    description=(p.get('description') or 'Built with Veyra').strip()[:500]
    html=(p.get('html') or '')[:250000]
    css=(p.get('css') or '')[:250000]
    js=(p.get('js') or '')[:250000]
    project_id=p.get('project_id')
    uid=current_user()['id']
    with db() as c:
        existing=None
        access_role=None
        if project_id:
            existing=c.execute('SELECT * FROM projects WHERE id=?',(project_id,)).fetchone()
            if existing:
                if int(existing['user_id'])==int(uid):
                    access_role='owner'
                else:
                    member=c.execute(
                        'SELECT role FROM project_members WHERE project_id=? AND user_id=?',
                        (project_id,uid)
                    ).fetchone()
                    access_role=str(member['role']) if member else None

        if existing and access_role in {'owner','editor'}:
            c.execute(
                'UPDATE projects SET name=?,description=?,html=?,css=?,js=?,updated_at=? WHERE id=?',
                (title,description,html,css,js,now(),project_id)
            )
            saved_id=int(project_id)
        elif existing:
            return jsonify({'ok':False,'error':'You do not have edit access to this project.'}),403
        else:
            cur=c.execute(
                'INSERT INTO projects(user_id,name,description,html,css,js,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                (uid,title,description,html,css,js,now(),now())
            )
            saved_id=cur.lastrowid
        c.commit()
    return jsonify({'ok':True,'project_id':saved_id,'saved_at':now()})

@app.post('/api/projects/export')
@login_required
def export_project():
    p=request.get_json(silent=True) or {}
    title=(p.get('title') or 'veyra-project').strip()
    safe=re.sub(r'[^a-zA-Z0-9_-]+','-',title).strip('-').lower() or 'veyra-project'
    html=p.get('html') or ''
    css=p.get('css') or ''
    js=p.get('js') or ''
    full_html=(
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<link rel="stylesheet" href="styles.css"></head><body>'
        + html +
        '<script src="app.js"></script></body></html>'
    )
    mem=io.BytesIO()
    with zipfile.ZipFile(mem,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('index.html',full_html)
        z.writestr('styles.css',css)
        z.writestr('app.js',js)
        z.writestr('README.txt','Exported from Veyra Beta — buildveyra.xyz')
    mem.seek(0)
    return send_file(
        mem,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'{safe}.zip'
    )

@app.get('/api/veyra/features')
@login_required
def veyra_features(): return jsonify({'ok':True,'count':1000,'version':'V16','features':VEYRA_V10_FEATURES})

@app.route('/feature-lab')
@login_required
def feature_lab(): return render_template('feature_lab.html',user=current_user(),active='feature-lab',features=VEYRA_V10_FEATURES)


init_db()
if __name__=='__main__':
    from waitress import serve
    host=os.getenv('HOST','127.0.0.1');port=int(os.getenv('PORT','8765'));print(f'VEYRA ready at http://{host}:{port}');serve(app,host=host,port=port)
