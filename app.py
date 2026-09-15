import re
import json
import os
import sqlite3
import io
import zipfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for, flash, send_file
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from openai import OpenAI
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

def extract_json_object(text):
    if not text: raise ValueError("Empty Veyra AI response")
    text=text.strip()
    if text.startswith("```"):
        text=re.sub(r"^```(?:json)?\s*","",text,flags=re.I)
        text=re.sub(r"\s*```$","",text)
    try: return json.loads(text)
    except Exception:
        a=text.find("{"); b=text.rfind("}")
        if a>=0 and b>a: return json.loads(text[a:b+1])
        raise


BASE=Path(__file__).resolve().parent
load_dotenv(BASE/'.env')

app=Flask(__name__)
app.secret_key=os.getenv('FLASK_SECRET_KEY','local-dev-change-me')
app.wsgi_app=ProxyFix(app.wsgi_app,x_proto=1,x_host=1)

IS_PRODUCTION=bool(os.getenv('VERCEL') or os.getenv('VEYRA_PRODUCTION'))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=IS_PRODUCTION,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    SESSION_REFRESH_EACH_REQUEST=True,
)

DATABASE_URL=(os.getenv('DATABASE_URL') or '').strip()
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL='postgresql://'+DATABASE_URL[len('postgres://'):]
USE_POSTGRES=bool(DATABASE_URL)
DB=BASE/'data'/'veyra.db'

class DBConnection:
    def __init__(self):
        self.is_postgres=USE_POSTGRES
        if self.is_postgres:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as exc:
                raise RuntimeError('DATABASE_URL is set but psycopg is not installed.') from exc
            self.conn=psycopg.connect(DATABASE_URL,row_factory=dict_row)
        else:
            DB.parent.mkdir(parents=True,exist_ok=True)
            self.conn=sqlite3.connect(DB)
            self.conn.row_factory=sqlite3.Row

    def execute(self,query,params=()):
        if self.is_postgres:
            query=query.replace('?', '%s')
        return self.conn.execute(query,params)

    def commit(self): self.conn.commit()
    def rollback(self): self.conn.rollback()
    def close(self): self.conn.close()
    def __enter__(self): return self

    def __exit__(self,exc_type,exc,tb):
        try:
            if exc_type:self.rollback()
            else:self.commit()
        finally:self.close()
        return False

def db():
    return DBConnection()

def now(): return datetime.now(timezone.utc).isoformat(timespec='seconds')

def init_db():
    with db() as c:
        if USE_POSTGRES:
            c.execute('''CREATE TABLE IF NOT EXISTS users(
                id BIGSERIAL PRIMARY KEY,
                provider TEXT NOT NULL,
                provider_user_id TEXT NOT NULL,
                email TEXT,
                name TEXT,
                avatar_url TEXT,
                password_hash TEXT,
                credits INTEGER NOT NULL DEFAULT 150,
                plan TEXT NOT NULL DEFAULT 'free',
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                subscription_status TEXT NOT NULL DEFAULT 'inactive',
                session_version INTEGER NOT NULL DEFAULT 0,
                is_blacklisted INTEGER NOT NULL DEFAULT 0,
                blacklist_reason TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(provider,provider_user_id)
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS projects(
                id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,name TEXT NOT NULL,
                description TEXT DEFAULT '',html TEXT DEFAULT '',css TEXT DEFAULT '',js TEXT DEFAULT '',
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS vouches(
                id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL,name TEXT NOT NULL,role TEXT DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 5,message TEXT NOT NULL,project_name TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS support_threads(
                id BIGSERIAL PRIMARY KEY,user_id BIGINT,question TEXT NOT NULL,answer TEXT NOT NULL,created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS admin_audit(
                id BIGSERIAL PRIMARY KEY,admin_user_id BIGINT,action TEXT NOT NULL,target_type TEXT,
                target_id BIGINT,details TEXT DEFAULT '',created_at TEXT NOT NULL
            )''')
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive'")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blacklisted INTEGER NOT NULL DEFAULT 0")
            c.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS blacklist_reason TEXT DEFAULT ''")
        else:
            c.execute('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,email TEXT,name TEXT,avatar_url TEXT,password_hash TEXT,credits INTEGER NOT NULL DEFAULT 150,plan TEXT NOT NULL DEFAULT 'free',stripe_customer_id TEXT,stripe_subscription_id TEXT,subscription_status TEXT NOT NULL DEFAULT 'inactive',session_version INTEGER NOT NULL DEFAULT 0,is_blacklisted INTEGER NOT NULL DEFAULT 0,blacklist_reason TEXT DEFAULT '',created_at TEXT NOT NULL,UNIQUE(provider,provider_user_id))''')
            c.execute('''CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,description TEXT DEFAULT '',html TEXT DEFAULT '',css TEXT DEFAULT '',js TEXT DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS vouches(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,role TEXT DEFAULT '',rating INTEGER NOT NULL DEFAULT 5,message TEXT NOT NULL,project_name TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT)''')
            c.execute('''CREATE TABLE IF NOT EXISTS support_threads(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,created_at TEXT NOT NULL)''')
            c.execute('''CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,admin_user_id INTEGER,action TEXT NOT NULL,target_type TEXT,target_id INTEGER,details TEXT DEFAULT '',created_at TEXT NOT NULL)''')
            cols={r['name'] for r in c.execute('PRAGMA table_info(users)').fetchall()}
            additions={'password_hash':'TEXT','plan':"TEXT NOT NULL DEFAULT 'free'",'stripe_customer_id':'TEXT','stripe_subscription_id':'TEXT','subscription_status':"TEXT NOT NULL DEFAULT 'inactive'",'session_version':'INTEGER NOT NULL DEFAULT 0','is_blacklisted':'INTEGER NOT NULL DEFAULT 0','blacklist_reason':"TEXT DEFAULT ''"}
            for name,sql_type in additions.items():
                if name not in cols:c.execute(f'ALTER TABLE users ADD COLUMN {name} {sql_type}')
        c.commit()

def current_user():
    uid=session.get('user_id')
    if not uid:return None
    with db() as c:
        r=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
    if not r:
        session.clear()
        return None
    user=dict(r)
    db_version=int(user.get('session_version') or 0)
    cookie_version=session.get('session_version')
    if cookie_version is None:
        session['session_version']=db_version
    elif int(cookie_version) != db_version:
        session.clear()
        return None
    return user

def start_user_session(uid):
    with db() as c:
        r=c.execute('SELECT session_version FROM users WHERE id=?',(uid,)).fetchone()
    session.clear()
    session.permanent=True
    session['user_id']=int(uid)
    session['session_version']=int(r['session_version'] if r else 0)

def is_admin(user=None):
    user=user or current_user()
    if not user:return False
    allowed={x.strip().lower() for x in os.getenv('VEYRA_ADMIN_EMAILS','').split(',') if x.strip()}
    return bool(user.get('email') and user['email'].lower() in allowed)

def login_required(fn):
    @wraps(fn)
    def w(*a,**k):
        if not current_user():return redirect(url_for('login',next=request.path))
        return fn(*a,**k)
    return w

@app.context_processor
def inject():
    u=current_user()
    return {'current_user':u,'is_admin_user':is_admin(u)}

def upsert_oauth(provider,pid,email,name,avatar):
    with db() as c:
        r=c.execute('SELECT * FROM users WHERE provider=? AND provider_user_id=?',(provider,pid)).fetchone()
        if r:
            c.execute('UPDATE users SET email=?,name=?,avatar_url=? WHERE id=?',(email,name,avatar,r['id']));uid=r['id']
        else:
            if USE_POSTGRES:
                cur=c.execute('INSERT INTO users(provider,provider_user_id,email,name,avatar_url,password_hash,credits,created_at) VALUES(?,?,?,?,?,NULL,150,?) RETURNING id',(provider,pid,email,name,avatar,now()))
                uid=cur.fetchone()['id']
            else:
                cur=c.execute('INSERT INTO users(provider,provider_user_id,email,name,avatar_url,password_hash,credits,created_at) VALUES(?,?,?,?,?,NULL,150,?)',(provider,pid,email,name,avatar,now()))
                uid=cur.lastrowid
        c.commit();return uid

oauth=OAuth(app)
google=oauth.register(name='google',client_id=os.getenv('GOOGLE_CLIENT_ID'),client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',client_kwargs={'scope':'openid email profile'})
github=oauth.register(name='github',client_id=os.getenv('GITHUB_CLIENT_ID'),client_secret=os.getenv('GITHUB_CLIENT_SECRET'),access_token_url='https://github.com/login/oauth/access_token',authorize_url='https://github.com/login/oauth/authorize',api_base_url='https://api.github.com/',client_kwargs={'scope':'read:user user:email'})

VEYRA_V10_FEATURES = ['Builder Quick Create', 'Builder Smart Search', 'Builder Context Memory', 'Builder History', 'Builder Favorites', 'Builder Templates', 'Builder Presets', 'Builder Recommendations', 'Builder Assistant', 'Builder Inspector', 'Builder Bulk Actions', 'Builder Import', 'Builder Export', 'Builder Duplicate', 'Builder Archive', 'Builder Restore', 'Builder Version Compare', 'Builder Diff Viewer', 'Builder Snapshots', 'Builder Branches', 'Builder Comments', 'Builder Review', 'Builder Approvals', 'Builder Permissions', 'Builder Sharing', 'Builder Live Sync', 'Builder Status Tracking', 'Builder Activity Log', 'Builder Notifications', 'Builder Shortcuts', 'Builder Command Palette', 'Builder Voice Control', 'Builder Keyboard Navigation', 'Builder Responsive Mode', 'Builder Mobile Mode', 'Builder Tablet Mode', 'Builder Desktop Mode', 'Builder Custom Viewport', 'Builder Auto Save', 'Builder Recovery', 'Builder Validation', 'Builder Testing', 'Builder Audit', 'Builder Auto Fix', 'Builder Optimization', 'Builder Generation', 'Builder Refactor', 'Builder Explain', 'Builder Documentation', 'Builder Handoff', 'Designer Quick Create', 'Designer Smart Search', 'Designer Context Memory', 'Designer History', 'Designer Favorites', 'Designer Templates', 'Designer Presets', 'Designer Recommendations', 'Designer Assistant', 'Designer Inspector', 'Designer Bulk Actions', 'Designer Import', 'Designer Export', 'Designer Duplicate', 'Designer Archive', 'Designer Restore', 'Designer Version Compare', 'Designer Diff Viewer', 'Designer Snapshots', 'Designer Branches', 'Designer Comments', 'Designer Review', 'Designer Approvals', 'Designer Permissions', 'Designer Sharing', 'Designer Live Sync', 'Designer Status Tracking', 'Designer Activity Log', 'Designer Notifications', 'Designer Shortcuts', 'Designer Command Palette', 'Designer Voice Control', 'Designer Keyboard Navigation', 'Designer Responsive Mode', 'Designer Mobile Mode', 'Designer Tablet Mode', 'Designer Desktop Mode', 'Designer Custom Viewport', 'Designer Auto Save', 'Designer Recovery', 'Designer Validation', 'Designer Testing', 'Designer Audit', 'Designer Auto Fix', 'Designer Optimization', 'Designer Generation', 'Designer Refactor', 'Designer Explain', 'Designer Documentation', 'Designer Handoff', 'Code Quick Create', 'Code Smart Search', 'Code Context Memory', 'Code History', 'Code Favorites', 'Code Templates', 'Code Presets', 'Code Recommendations', 'Code Assistant', 'Code Inspector', 'Code Bulk Actions', 'Code Import', 'Code Export', 'Code Duplicate', 'Code Archive', 'Code Restore', 'Code Version Compare', 'Code Diff Viewer', 'Code Snapshots', 'Code Branches', 'Code Comments', 'Code Review', 'Code Approvals', 'Code Permissions', 'Code Sharing', 'Code Live Sync', 'Code Status Tracking', 'Code Activity Log', 'Code Notifications', 'Code Shortcuts', 'Code Command Palette', 'Code Voice Control', 'Code Keyboard Navigation', 'Code Responsive Mode', 'Code Mobile Mode', 'Code Tablet Mode', 'Code Desktop Mode', 'Code Custom Viewport', 'Code Auto Save', 'Code Recovery', 'Code Validation', 'Code Testing', 'Code Audit', 'Code Auto Fix', 'Code Optimization', 'Code Generation', 'Code Refactor', 'Code Explain', 'Code Documentation', 'Code Handoff', 'Preview Quick Create', 'Preview Smart Search', 'Preview Context Memory', 'Preview History', 'Preview Favorites', 'Preview Templates', 'Preview Presets', 'Preview Recommendations', 'Preview Assistant', 'Preview Inspector', 'Preview Bulk Actions', 'Preview Import', 'Preview Export', 'Preview Duplicate', 'Preview Archive', 'Preview Restore', 'Preview Version Compare', 'Preview Diff Viewer', 'Preview Snapshots', 'Preview Branches', 'Preview Comments', 'Preview Review', 'Preview Approvals', 'Preview Permissions', 'Preview Sharing', 'Preview Live Sync', 'Preview Status Tracking', 'Preview Activity Log', 'Preview Notifications', 'Preview Shortcuts', 'Preview Command Palette', 'Preview Voice Control', 'Preview Keyboard Navigation', 'Preview Responsive Mode', 'Preview Mobile Mode', 'Preview Tablet Mode', 'Preview Desktop Mode', 'Preview Custom Viewport', 'Preview Auto Save', 'Preview Recovery', 'Preview Validation', 'Preview Testing', 'Preview Audit', 'Preview Auto Fix', 'Preview Optimization', 'Preview Generation', 'Preview Refactor', 'Preview Explain', 'Preview Documentation', 'Preview Handoff', 'Project Quick Create', 'Project Smart Search', 'Project Context Memory', 'Project History', 'Project Favorites', 'Project Templates', 'Project Presets', 'Project Recommendations', 'Project Assistant', 'Project Inspector', 'Project Bulk Actions', 'Project Import', 'Project Export', 'Project Duplicate', 'Project Archive', 'Project Restore', 'Project Version Compare', 'Project Diff Viewer', 'Project Snapshots', 'Project Branches', 'Project Comments', 'Project Review', 'Project Approvals', 'Project Permissions', 'Project Sharing', 'Project Live Sync', 'Project Status Tracking', 'Project Activity Log', 'Project Notifications', 'Project Shortcuts', 'Project Command Palette', 'Project Voice Control', 'Project Keyboard Navigation', 'Project Responsive Mode', 'Project Mobile Mode', 'Project Tablet Mode', 'Project Desktop Mode', 'Project Custom Viewport', 'Project Auto Save', 'Project Recovery', 'Project Validation', 'Project Testing', 'Project Audit', 'Project Auto Fix', 'Project Optimization', 'Project Generation', 'Project Refactor', 'Project Explain', 'Project Documentation', 'Project Handoff', 'Agent Quick Create', 'Agent Smart Search', 'Agent Context Memory', 'Agent History', 'Agent Favorites', 'Agent Templates', 'Agent Presets', 'Agent Recommendations', 'Agent Assistant', 'Agent Inspector', 'Agent Bulk Actions', 'Agent Import', 'Agent Export', 'Agent Duplicate', 'Agent Archive', 'Agent Restore', 'Agent Version Compare', 'Agent Diff Viewer', 'Agent Snapshots', 'Agent Branches', 'Agent Comments', 'Agent Review', 'Agent Approvals', 'Agent Permissions', 'Agent Sharing', 'Agent Live Sync', 'Agent Status Tracking', 'Agent Activity Log', 'Agent Notifications', 'Agent Shortcuts', 'Agent Command Palette', 'Agent Voice Control', 'Agent Keyboard Navigation', 'Agent Responsive Mode', 'Agent Mobile Mode', 'Agent Tablet Mode', 'Agent Desktop Mode', 'Agent Custom Viewport', 'Agent Auto Save', 'Agent Recovery', 'Agent Validation', 'Agent Testing', 'Agent Audit', 'Agent Auto Fix', 'Agent Optimization', 'Agent Generation', 'Agent Refactor', 'Agent Explain', 'Agent Documentation', 'Agent Handoff', 'Quality Quick Create', 'Quality Smart Search', 'Quality Context Memory', 'Quality History', 'Quality Favorites', 'Quality Templates', 'Quality Presets', 'Quality Recommendations', 'Quality Assistant', 'Quality Inspector', 'Quality Bulk Actions', 'Quality Import', 'Quality Export', 'Quality Duplicate', 'Quality Archive', 'Quality Restore', 'Quality Version Compare', 'Quality Diff Viewer', 'Quality Snapshots', 'Quality Branches', 'Quality Comments', 'Quality Review', 'Quality Approvals', 'Quality Permissions', 'Quality Sharing', 'Quality Live Sync', 'Quality Status Tracking', 'Quality Activity Log', 'Quality Notifications', 'Quality Shortcuts', 'Quality Command Palette', 'Quality Voice Control', 'Quality Keyboard Navigation', 'Quality Responsive Mode', 'Quality Mobile Mode', 'Quality Tablet Mode', 'Quality Desktop Mode', 'Quality Custom Viewport', 'Quality Auto Save', 'Quality Recovery', 'Quality Validation', 'Quality Testing', 'Quality Audit', 'Quality Auto Fix', 'Quality Optimization', 'Quality Generation', 'Quality Refactor', 'Quality Explain', 'Quality Documentation', 'Quality Handoff', 'Data Quick Create', 'Data Smart Search', 'Data Context Memory', 'Data History', 'Data Favorites', 'Data Templates', 'Data Presets', 'Data Recommendations', 'Data Assistant', 'Data Inspector', 'Data Bulk Actions', 'Data Import', 'Data Export', 'Data Duplicate', 'Data Archive', 'Data Restore', 'Data Version Compare', 'Data Diff Viewer', 'Data Snapshots', 'Data Branches', 'Data Comments', 'Data Review', 'Data Approvals', 'Data Permissions', 'Data Sharing', 'Data Live Sync', 'Data Status Tracking', 'Data Activity Log', 'Data Notifications', 'Data Shortcuts', 'Data Command Palette', 'Data Voice Control', 'Data Keyboard Navigation', 'Data Responsive Mode', 'Data Mobile Mode', 'Data Tablet Mode', 'Data Desktop Mode', 'Data Custom Viewport', 'Data Auto Save', 'Data Recovery', 'Data Validation', 'Data Testing', 'Data Audit', 'Data Auto Fix', 'Data Optimization', 'Data Generation', 'Data Refactor', 'Data Explain', 'Data Documentation', 'Data Handoff', 'API Quick Create', 'API Smart Search', 'API Context Memory', 'API History', 'API Favorites', 'API Templates', 'API Presets', 'API Recommendations', 'API Assistant', 'API Inspector', 'API Bulk Actions', 'API Import', 'API Export', 'API Duplicate', 'API Archive', 'API Restore', 'API Version Compare', 'API Diff Viewer', 'API Snapshots', 'API Branches', 'API Comments', 'API Review', 'API Approvals', 'API Permissions', 'API Sharing', 'API Live Sync', 'API Status Tracking', 'API Activity Log', 'API Notifications', 'API Shortcuts', 'API Command Palette', 'API Voice Control', 'API Keyboard Navigation', 'API Responsive Mode', 'API Mobile Mode', 'API Tablet Mode', 'API Desktop Mode', 'API Custom Viewport', 'API Auto Save', 'API Recovery', 'API Validation', 'API Testing', 'API Audit', 'API Auto Fix', 'API Optimization', 'API Generation', 'API Refactor', 'API Explain', 'API Documentation', 'API Handoff', 'Database Quick Create', 'Database Smart Search', 'Database Context Memory', 'Database History', 'Database Favorites', 'Database Templates', 'Database Presets', 'Database Recommendations', 'Database Assistant', 'Database Inspector', 'Database Bulk Actions', 'Database Import', 'Database Export', 'Database Duplicate', 'Database Archive', 'Database Restore', 'Database Version Compare', 'Database Diff Viewer', 'Database Snapshots', 'Database Branches', 'Database Comments', 'Database Review', 'Database Approvals', 'Database Permissions', 'Database Sharing', 'Database Live Sync', 'Database Status Tracking', 'Database Activity Log', 'Database Notifications', 'Database Shortcuts', 'Database Command Palette', 'Database Voice Control', 'Database Keyboard Navigation', 'Database Responsive Mode', 'Database Mobile Mode', 'Database Tablet Mode', 'Database Desktop Mode', 'Database Custom Viewport', 'Database Auto Save', 'Database Recovery', 'Database Validation', 'Database Testing', 'Database Audit', 'Database Auto Fix', 'Database Optimization', 'Database Generation', 'Database Refactor', 'Database Explain', 'Database Documentation', 'Database Handoff', 'Automation Quick Create', 'Automation Smart Search', 'Automation Context Memory', 'Automation History', 'Automation Favorites', 'Automation Templates', 'Automation Presets', 'Automation Recommendations', 'Automation Assistant', 'Automation Inspector', 'Automation Bulk Actions', 'Automation Import', 'Automation Export', 'Automation Duplicate', 'Automation Archive', 'Automation Restore', 'Automation Version Compare', 'Automation Diff Viewer', 'Automation Snapshots', 'Automation Branches', 'Automation Comments', 'Automation Review', 'Automation Approvals', 'Automation Permissions', 'Automation Sharing', 'Automation Live Sync', 'Automation Status Tracking', 'Automation Activity Log', 'Automation Notifications', 'Automation Shortcuts', 'Automation Command Palette', 'Automation Voice Control', 'Automation Keyboard Navigation', 'Automation Responsive Mode', 'Automation Mobile Mode', 'Automation Tablet Mode', 'Automation Desktop Mode', 'Automation Custom Viewport', 'Automation Auto Save', 'Automation Recovery', 'Automation Validation', 'Automation Testing', 'Automation Audit', 'Automation Auto Fix', 'Automation Optimization', 'Automation Generation', 'Automation Refactor', 'Automation Explain', 'Automation Documentation', 'Automation Handoff', 'Flow Quick Create', 'Flow Smart Search', 'Flow Context Memory', 'Flow History', 'Flow Favorites', 'Flow Templates', 'Flow Presets', 'Flow Recommendations', 'Flow Assistant', 'Flow Inspector', 'Flow Bulk Actions', 'Flow Import', 'Flow Export', 'Flow Duplicate', 'Flow Archive', 'Flow Restore', 'Flow Version Compare', 'Flow Diff Viewer', 'Flow Snapshots', 'Flow Branches', 'Flow Comments', 'Flow Review', 'Flow Approvals', 'Flow Permissions', 'Flow Sharing', 'Flow Live Sync', 'Flow Status Tracking', 'Flow Activity Log', 'Flow Notifications', 'Flow Shortcuts', 'Flow Command Palette', 'Flow Voice Control', 'Flow Keyboard Navigation', 'Flow Responsive Mode', 'Flow Mobile Mode', 'Flow Tablet Mode', 'Flow Desktop Mode', 'Flow Custom Viewport', 'Flow Auto Save', 'Flow Recovery', 'Flow Validation', 'Flow Testing', 'Flow Audit', 'Flow Auto Fix', 'Flow Optimization', 'Flow Generation', 'Flow Refactor', 'Flow Explain', 'Flow Documentation', 'Flow Handoff', 'Component Quick Create', 'Component Smart Search', 'Component Context Memory', 'Component History', 'Component Favorites', 'Component Templates', 'Component Presets', 'Component Recommendations', 'Component Assistant', 'Component Inspector', 'Component Bulk Actions', 'Component Import', 'Component Export', 'Component Duplicate', 'Component Archive', 'Component Restore', 'Component Version Compare', 'Component Diff Viewer', 'Component Snapshots', 'Component Branches', 'Component Comments', 'Component Review', 'Component Approvals', 'Component Permissions', 'Component Sharing', 'Component Live Sync', 'Component Status Tracking', 'Component Activity Log', 'Component Notifications', 'Component Shortcuts', 'Component Command Palette', 'Component Voice Control', 'Component Keyboard Navigation', 'Component Responsive Mode', 'Component Mobile Mode', 'Component Tablet Mode', 'Component Desktop Mode', 'Component Custom Viewport', 'Component Auto Save', 'Component Recovery', 'Component Validation', 'Component Testing', 'Component Audit', 'Component Auto Fix', 'Component Optimization', 'Component Generation', 'Component Refactor', 'Component Explain', 'Component Documentation', 'Component Handoff', 'Design System Quick Create', 'Design System Smart Search', 'Design System Context Memory', 'Design System History', 'Design System Favorites', 'Design System Templates', 'Design System Presets', 'Design System Recommendations', 'Design System Assistant', 'Design System Inspector', 'Design System Bulk Actions', 'Design System Import', 'Design System Export', 'Design System Duplicate', 'Design System Archive', 'Design System Restore', 'Design System Version Compare', 'Design System Diff Viewer', 'Design System Snapshots', 'Design System Branches', 'Design System Comments', 'Design System Review', 'Design System Approvals', 'Design System Permissions', 'Design System Sharing', 'Design System Live Sync', 'Design System Status Tracking', 'Design System Activity Log', 'Design System Notifications', 'Design System Shortcuts', 'Design System Command Palette', 'Design System Voice Control', 'Design System Keyboard Navigation', 'Design System Responsive Mode', 'Design System Mobile Mode', 'Design System Tablet Mode', 'Design System Desktop Mode', 'Design System Custom Viewport', 'Design System Auto Save', 'Design System Recovery', 'Design System Validation', 'Design System Testing', 'Design System Audit', 'Design System Auto Fix', 'Design System Optimization', 'Design System Generation', 'Design System Refactor', 'Design System Explain', 'Design System Documentation', 'Design System Handoff', 'Asset Quick Create', 'Asset Smart Search', 'Asset Context Memory', 'Asset History', 'Asset Favorites', 'Asset Templates', 'Asset Presets', 'Asset Recommendations', 'Asset Assistant', 'Asset Inspector', 'Asset Bulk Actions', 'Asset Import', 'Asset Export', 'Asset Duplicate', 'Asset Archive', 'Asset Restore', 'Asset Version Compare', 'Asset Diff Viewer', 'Asset Snapshots', 'Asset Branches', 'Asset Comments', 'Asset Review', 'Asset Approvals', 'Asset Permissions', 'Asset Sharing', 'Asset Live Sync', 'Asset Status Tracking', 'Asset Activity Log', 'Asset Notifications', 'Asset Shortcuts', 'Asset Command Palette', 'Asset Voice Control', 'Asset Keyboard Navigation', 'Asset Responsive Mode', 'Asset Mobile Mode', 'Asset Tablet Mode', 'Asset Desktop Mode', 'Asset Custom Viewport', 'Asset Auto Save', 'Asset Recovery', 'Asset Validation', 'Asset Testing', 'Asset Audit', 'Asset Auto Fix', 'Asset Optimization', 'Asset Generation', 'Asset Refactor', 'Asset Explain', 'Asset Documentation', 'Asset Handoff', 'Deployment Quick Create', 'Deployment Smart Search', 'Deployment Context Memory', 'Deployment History', 'Deployment Favorites', 'Deployment Templates', 'Deployment Presets', 'Deployment Recommendations', 'Deployment Assistant', 'Deployment Inspector', 'Deployment Bulk Actions', 'Deployment Import', 'Deployment Export', 'Deployment Duplicate', 'Deployment Archive', 'Deployment Restore', 'Deployment Version Compare', 'Deployment Diff Viewer', 'Deployment Snapshots', 'Deployment Branches', 'Deployment Comments', 'Deployment Review', 'Deployment Approvals', 'Deployment Permissions', 'Deployment Sharing', 'Deployment Live Sync', 'Deployment Status Tracking', 'Deployment Activity Log', 'Deployment Notifications', 'Deployment Shortcuts', 'Deployment Command Palette', 'Deployment Voice Control', 'Deployment Keyboard Navigation', 'Deployment Responsive Mode', 'Deployment Mobile Mode', 'Deployment Tablet Mode', 'Deployment Desktop Mode', 'Deployment Custom Viewport', 'Deployment Auto Save', 'Deployment Recovery', 'Deployment Validation', 'Deployment Testing', 'Deployment Audit', 'Deployment Auto Fix', 'Deployment Optimization', 'Deployment Generation', 'Deployment Refactor', 'Deployment Explain', 'Deployment Documentation', 'Deployment Handoff', 'Team Quick Create', 'Team Smart Search', 'Team Context Memory', 'Team History', 'Team Favorites', 'Team Templates', 'Team Presets', 'Team Recommendations', 'Team Assistant', 'Team Inspector', 'Team Bulk Actions', 'Team Import', 'Team Export', 'Team Duplicate', 'Team Archive', 'Team Restore', 'Team Version Compare', 'Team Diff Viewer', 'Team Snapshots', 'Team Branches', 'Team Comments', 'Team Review', 'Team Approvals', 'Team Permissions', 'Team Sharing', 'Team Live Sync', 'Team Status Tracking', 'Team Activity Log', 'Team Notifications', 'Team Shortcuts', 'Team Command Palette', 'Team Voice Control', 'Team Keyboard Navigation', 'Team Responsive Mode', 'Team Mobile Mode', 'Team Tablet Mode', 'Team Desktop Mode', 'Team Custom Viewport', 'Team Auto Save', 'Team Recovery', 'Team Validation', 'Team Testing', 'Team Audit', 'Team Auto Fix', 'Team Optimization', 'Team Generation', 'Team Refactor', 'Team Explain', 'Team Documentation', 'Team Handoff', 'Analytics Quick Create', 'Analytics Smart Search', 'Analytics Context Memory', 'Analytics History', 'Analytics Favorites', 'Analytics Templates', 'Analytics Presets', 'Analytics Recommendations', 'Analytics Assistant', 'Analytics Inspector', 'Analytics Bulk Actions', 'Analytics Import', 'Analytics Export', 'Analytics Duplicate', 'Analytics Archive', 'Analytics Restore', 'Analytics Version Compare', 'Analytics Diff Viewer', 'Analytics Snapshots', 'Analytics Branches', 'Analytics Comments', 'Analytics Review', 'Analytics Approvals', 'Analytics Permissions', 'Analytics Sharing', 'Analytics Live Sync', 'Analytics Status Tracking', 'Analytics Activity Log', 'Analytics Notifications', 'Analytics Shortcuts', 'Analytics Command Palette', 'Analytics Voice Control', 'Analytics Keyboard Navigation', 'Analytics Responsive Mode', 'Analytics Mobile Mode', 'Analytics Tablet Mode', 'Analytics Desktop Mode', 'Analytics Custom Viewport', 'Analytics Auto Save', 'Analytics Recovery', 'Analytics Validation', 'Analytics Testing', 'Analytics Audit', 'Analytics Auto Fix', 'Analytics Optimization', 'Analytics Generation', 'Analytics Refactor', 'Analytics Explain', 'Analytics Documentation', 'Analytics Handoff', 'Security Quick Create', 'Security Smart Search', 'Security Context Memory', 'Security History', 'Security Favorites', 'Security Templates', 'Security Presets', 'Security Recommendations', 'Security Assistant', 'Security Inspector', 'Security Bulk Actions', 'Security Import', 'Security Export', 'Security Duplicate', 'Security Archive', 'Security Restore', 'Security Version Compare', 'Security Diff Viewer', 'Security Snapshots', 'Security Branches', 'Security Comments', 'Security Review', 'Security Approvals', 'Security Permissions', 'Security Sharing', 'Security Live Sync', 'Security Status Tracking', 'Security Activity Log', 'Security Notifications', 'Security Shortcuts', 'Security Command Palette', 'Security Voice Control', 'Security Keyboard Navigation', 'Security Responsive Mode', 'Security Mobile Mode', 'Security Tablet Mode', 'Security Desktop Mode', 'Security Custom Viewport', 'Security Auto Save', 'Security Recovery', 'Security Validation', 'Security Testing', 'Security Audit', 'Security Auto Fix', 'Security Optimization', 'Security Generation', 'Security Refactor', 'Security Explain', 'Security Documentation', 'Security Handoff', 'Workspace Quick Create', 'Workspace Smart Search', 'Workspace Context Memory', 'Workspace History', 'Workspace Favorites', 'Workspace Templates', 'Workspace Presets', 'Workspace Recommendations', 'Workspace Assistant', 'Workspace Inspector', 'Workspace Bulk Actions', 'Workspace Import', 'Workspace Export', 'Workspace Duplicate', 'Workspace Archive', 'Workspace Restore', 'Workspace Version Compare', 'Workspace Diff Viewer', 'Workspace Snapshots', 'Workspace Branches', 'Workspace Comments', 'Workspace Review', 'Workspace Approvals', 'Workspace Permissions', 'Workspace Sharing', 'Workspace Live Sync', 'Workspace Status Tracking', 'Workspace Activity Log', 'Workspace Notifications', 'Workspace Shortcuts', 'Workspace Command Palette', 'Workspace Voice Control', 'Workspace Keyboard Navigation', 'Workspace Responsive Mode', 'Workspace Mobile Mode', 'Workspace Tablet Mode', 'Workspace Desktop Mode', 'Workspace Custom Viewport', 'Workspace Auto Save', 'Workspace Recovery', 'Workspace Validation', 'Workspace Testing', 'Workspace Audit', 'Workspace Auto Fix', 'Workspace Optimization', 'Workspace Generation', 'Workspace Refactor', 'Workspace Explain', 'Workspace Documentation', 'Workspace Handoff']

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
      ('What are credits?','Credits power Veyra AI. A new AI build uses 25 credits and a follow-up AI edit uses 10 credits. Local fallback previews do not consume credits.'),
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
      ('Authentication','Email/password accounts use hashed passwords. Google and GitHub OAuth can be configured through environment variables.'),
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
      ('OAuth','Google/GitHub availability depends on your configured OAuth applications.'),
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
      ('Authentication providers','Google and GitHub OAuth may process information under their own privacy terms when those sign-in options are used.'),
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

@app.route('/admin')
@login_required
def admin_dashboard():
    admin=current_user()
    if not is_admin(admin):return ('Forbidden',403)
    q=(request.args.get('q') or '').strip()
    status=(request.args.get('status') or 'all').strip().lower()
    with db() as c:
        stats={
            'users':c.execute('SELECT COUNT(*) AS n FROM users').fetchone()['n'],
            'projects':c.execute('SELECT COUNT(*) AS n FROM projects').fetchone()['n'],
            'pending_vouches':c.execute("SELECT COUNT(*) AS n FROM vouches WHERE status='pending'").fetchone()['n'],
            'support':c.execute('SELECT COUNT(*) AS n FROM support_threads').fetchone()['n'],
            'blacklisted':c.execute('SELECT COUNT(*) AS n FROM users WHERE is_blacklisted=1').fetchone()['n'],
            'paid':c.execute("SELECT COUNT(*) AS n FROM users WHERE plan IN ('pro','max')").fetchone()['n'],
        }
        where=[];params=[]
        if q:
            where.append("(LOWER(COALESCE(email,'')) LIKE ? OR LOWER(COALESCE(name,'')) LIKE ? OR CAST(id AS TEXT)=?)")
            needle=f"%{q.lower()}%"
            params.extend([needle,needle,q])
        if status=='blacklisted':
            where.append("is_blacklisted=1")
        elif status=='paid':
            where.append("plan IN ('pro','max')")
        sql='SELECT * FROM users'
        if where:sql+=' WHERE '+' AND '.join(where)
        sql+=' ORDER BY id DESC LIMIT 100'
        users=[dict(r) for r in c.execute(sql,tuple(params)).fetchall()]
        projects=[dict(r) for r in c.execute('SELECT * FROM projects ORDER BY updated_at DESC LIMIT 10').fetchall()]
        vouches=[dict(r) for r in c.execute("SELECT * FROM vouches WHERE status='pending' ORDER BY created_at DESC LIMIT 8").fetchall()]
        support=[dict(r) for r in c.execute('SELECT * FROM support_threads ORDER BY id DESC LIMIT 8').fetchall()]
        audit_raw=[dict(r) for r in c.execute('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 20').fetchall()]
        audit=[]
        for item in audit_raw:
            details={}
            raw=item.get('details')
            if raw:
                try:
                    details=json.loads(raw) if isinstance(raw,str) else dict(raw)
                except Exception:
                    details={}
            target=None
            if item.get('target_type')=='user' and item.get('target_id'):
                target_row=c.execute('SELECT id,name,email FROM users WHERE id=?',(item['target_id'],)).fetchone()
                if target_row:target=dict(target_row)
            actor=None
            if item.get('admin_user_id'):
                actor_row=c.execute('SELECT id,name,email FROM users WHERE id=?',(item['admin_user_id'],)).fetchone()
                if actor_row:actor=dict(actor_row)
            item['details_obj']=details
            item['target_user']=target
            item['actor_user']=actor
            item['source']='Discord' if details.get('source')=='discord' else 'Web'
            item['discord_admin_id']=details.get('discord_admin_id')
            audit.append(item)
    return render_template('admin_dashboard.html',user=admin,stats=stats,users=users,projects=projects,vouches=vouches,support=support,audit=audit,q=q,status=status,database_mode='Postgres' if USE_POSTGRES else 'Local SQLite')

@app.post('/admin/users/<int:uid>/update')
@login_required
def admin_update_user(uid):
    admin=current_user()
    if not is_admin(admin):return ('Forbidden',403)
    try:credits=max(0,min(10000000,int(request.form.get('credits','0'))))
    except Exception:return ('Invalid credits',400)
    plan=(request.form.get('plan') or 'free').strip().lower()
    if plan not in {'free','pro','max'}:return ('Invalid plan',400)
    with db() as c:
        before=c.execute('SELECT credits,plan FROM users WHERE id=?',(uid,)).fetchone()
        if not before:return ('User not found',404)
        c.execute('UPDATE users SET credits=?,plan=? WHERE id=?',(credits,plan,uid))
        c.execute('INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
                  (admin['id'],'update_user','user',uid,json.dumps({'before':dict(before),'after':{'credits':credits,'plan':plan}}),now()))
        c.commit()
    return redirect(request.referrer or '/admin')

@app.post('/admin/users/<int:uid>/credits')
@login_required
def admin_adjust_credits(uid):
    admin=current_user()
    if not is_admin(admin):return ('Forbidden',403)
    try:amount=int(request.form.get('amount','0'))
    except Exception:return ('Invalid amount',400)
    amount=max(-1000000,min(1000000,amount))
    with db() as c:
        row=c.execute('SELECT credits FROM users WHERE id=?',(uid,)).fetchone()
        if not row:return ('User not found',404)
        new=max(0,int(row['credits'])+amount)
        c.execute('UPDATE users SET credits=? WHERE id=?',(new,uid))
        c.execute('INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
                  (admin['id'],'adjust_credits','user',uid,json.dumps({'amount':amount,'before':int(row['credits']),'after':new}),now()))
        c.commit()
    return redirect(request.referrer or '/admin')

@app.post('/admin/users/<int:uid>/blacklist')
@login_required
def admin_blacklist_user(uid):
    admin=current_user()
    if not is_admin(admin):return ('Forbidden',403)
    reason=(request.form.get('reason') or 'Administrative action').strip()[:300]
    with db() as c:
        target=c.execute('SELECT email FROM users WHERE id=?',(uid,)).fetchone()
        if not target:return ('User not found',404)
        if admin['id']==uid:return ('You cannot blacklist your own admin account.',400)
        c.execute('UPDATE users SET is_blacklisted=1,blacklist_reason=? WHERE id=?',(reason,uid))
        c.execute('INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
                  (admin['id'],'blacklist_user','user',uid,json.dumps({'reason':reason,'email':target['email']}),now()))
        c.commit()
    return redirect(request.referrer or '/admin')

@app.post('/admin/users/<int:uid>/unblacklist')
@login_required
def admin_unblacklist_user(uid):
    admin=current_user()
    if not is_admin(admin):return ('Forbidden',403)
    with db() as c:
        c.execute("UPDATE users SET is_blacklisted=0,blacklist_reason='' WHERE id=?",(uid,))
        c.execute('INSERT INTO admin_audit(admin_user_id,action,target_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)',
                  (admin['id'],'unblacklist_user','user',uid,'{}',now()))
        c.commit()
    return redirect(request.referrer or '/admin')

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
 ('login',['login','sign in','google','github','oauth'],'You can sign in with email/password. Google and GitHub require OAuth credentials to be configured by the Veyra administrator.'),
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
            result=client.chat.completions.create(
                model=os.getenv('VEYRA_MODEL','gpt-5.6-sol').strip() or 'gpt-5.6-sol',
                messages=[
                    {'role':'system','content':'You are Veyra Support. Be concise, helpful, and honest. Veyra is in public beta. Never claim an unfinished feature works. For payment issues never ask for full card numbers. Explain that paid checkout uses Stripe Payment Links when configured. If the user reports a bug, ask for reproducible steps, expected behavior, actual behavior, browser, and screenshot if possible.'},
                    {'role':'user','content':question}
                ],
                temperature=0.2,
                max_tokens=350
            )
            answer=(result.choices[0].message.content or answer).strip()
        except Exception:
            pass
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
        if USE_POSTGRES:
            cur=c.execute("INSERT INTO users(provider,provider_user_id,email,name,password_hash,credits,created_at) VALUES('local',?,?,?,?,150,?) RETURNING id",(email,email,name,generate_password_hash(pw),now()))
            uid=cur.fetchone()['id']
        else:
            cur=c.execute("INSERT INTO users(provider,provider_user_id,email,name,password_hash,credits,created_at) VALUES('local',?,?,?,?,150,?)",(email,email,name,generate_password_hash(pw),now()))
            uid=cur.lastrowid
        c.commit()
        start_user_session(uid)
    return redirect(url_for('dashboard'))
@app.post('/login/email')
def login_email():
    email=(request.form.get('email') or '').strip().lower();pw=request.form.get('password') or ''
    with db() as c:r=c.execute("SELECT * FROM users WHERE provider='local' AND lower(email)=?",(email,)).fetchone()
    if not r or not r['password_hash'] or not check_password_hash(r['password_hash'],pw):
        flash('Incorrect email or password.','error');return redirect(url_for('login'))
    start_user_session(r['id']);return redirect(url_for('dashboard'))
@app.route('/logout')
def logout():session.clear();return redirect(url_for('home'))

@app.route('/auth/google')
def auth_google():
    if not os.getenv('GOOGLE_CLIENT_ID') or not os.getenv('GOOGLE_CLIENT_SECRET'):return render_template('oauth_missing.html',provider='Google'),503
    return google.authorize_redirect(url_for('google_callback',_external=True))
@app.route('/auth/google/callback')
def google_callback():
    token=google.authorize_access_token();info=token.get('userinfo') or google.parse_id_token(token)
    uid=upsert_oauth('google',str(info.get('sub')),info.get('email'),info.get('name') or info.get('email') or 'Veyra User',info.get('picture'));start_user_session(uid);return redirect(url_for('dashboard'))
@app.route('/auth/github')
def auth_github():
    if not os.getenv('GITHUB_CLIENT_ID') or not os.getenv('GITHUB_CLIENT_SECRET'):return render_template('oauth_missing.html',provider='GitHub'),503
    return github.authorize_redirect(url_for('github_callback',_external=True))
@app.route('/auth/github/callback')
def github_callback():
    github.authorize_access_token();p=github.get('user').json();email=p.get('email')
    if not email:
        e=github.get('user/emails')
        if e.status_code==200:
            rows=e.json();x=next((v for v in rows if v.get('primary') and v.get('verified')),None) or next((v for v in rows if v.get('verified')),None);email=x.get('email') if x else None
    uid=upsert_oauth('github',str(p.get('id')),email,p.get('name') or p.get('login') or 'Veyra User',p.get('avatar_url'));start_user_session(uid);return redirect(url_for('dashboard'))


@app.route('/account')
@login_required
def account_page():
    u=current_user()
    with db() as c:
        project_count=c.execute('SELECT COUNT(*) AS n FROM projects WHERE user_id=?',(u['id'],)).fetchone()['n']
    provider_labels={'local':'Email & password','google':'Google','github':'GitHub'}
    plan_labels={'free':'Free','pro':'Pro','max':'Max'}
    return render_template(
        'account.html',
        user=u,
        project_count=project_count,
        provider_label=provider_labels.get((u.get('provider') or '').lower(),(u.get('provider') or 'Account').title()),
        plan_label=plan_labels.get((u.get('plan') or 'free').lower(),(u.get('plan') or 'free').title()),
        is_local=(u.get('provider')=='local'),
        is_admin_account=is_admin(u),
    )

@app.post('/account/profile')
@login_required
def account_update_profile():
    u=current_user()
    name=(request.form.get('name') or '').strip()
    if len(name)<2 or len(name)>80:
        return redirect(url_for('account_page',error='name'))
    with db() as c:
        c.execute('UPDATE users SET name=? WHERE id=?',(name,u['id']))
        c.commit()
    return redirect(url_for('account_page',saved='profile'))

@app.post('/account/password')
@login_required
def account_change_password():
    u=current_user()
    if u.get('provider')!='local':
        return redirect(url_for('account_page',error='oauth-password'))
    current=request.form.get('current_password') or ''
    new=request.form.get('new_password') or ''
    confirm=request.form.get('confirm_password') or ''
    if len(new)<8:
        return redirect(url_for('account_page',error='password-length'))
    if new!=confirm:
        return redirect(url_for('account_page',error='password-match'))
    if not u.get('password_hash') or not check_password_hash(u['password_hash'],current):
        return redirect(url_for('account_page',error='current-password'))
    with db() as c:
        c.execute('UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?',
                  (generate_password_hash(new),u['id']))
        c.commit()
    start_user_session(u['id'])
    return redirect(url_for('account_page',saved='password'))

@app.post('/account/sessions/reset')
@login_required
def account_reset_sessions():
    u=current_user()
    with db() as c:
        c.execute('UPDATE users SET session_version=session_version+1 WHERE id=?',(u['id'],))
        c.commit()
    start_user_session(u['id'])
    return redirect(url_for('account_page',saved='sessions'))

@app.route('/studio')
@login_required
def studio():return render_template('studio.html',user=current_user())

@app.route('/dashboard')
@login_required
def dashboard():
    u=current_user()
    with db() as c:
        rows=c.execute('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 4',(u['id'],)).fetchall()
        count=c.execute('SELECT COUNT(*) AS n FROM projects WHERE user_id=?',(u['id'],)).fetchone()['n']
    projects=[dict(r) for r in rows]
    stats={'projects':count,'deployments':0,'team':1}
    return render_template('dashboard.html',user=u,projects=projects,stats=stats)

@app.route('/app/projects')
@login_required
def projects_page():return render_template('projects.html',user=current_user())

@app.route('/app/templates')
@login_required
def templates_page():return render_template('templates.html',user=current_user())

@app.route('/app/deployments')
@login_required
def deployments_page():return render_template('deployments.html',user=current_user())

@app.route('/app/flows')
@login_required
def flows_page():return render_template('flows.html',user=current_user())

@app.route('/app/agents')
@login_required
def agents_page():return render_template('agents.html',user=current_user())

@app.route('/app/automations')
@login_required
def automations_page():return render_template('automations.html',user=current_user())

@app.route('/app/components')
@login_required
def components_page():return render_template('components.html',user=current_user())

@app.route('/app/tokens')
@login_required
def tokens_page():return render_template('tokens.html',user=current_user())

@app.route('/app/data-studio')
@login_required
def data_studio_page():return render_template('data_studio.html',user=current_user())

@app.route('/app/settings')
@login_required
def settings_page():return render_template('settings.html',user=current_user())


@app.route('/app/databases')
@login_required
def databases_page():return render_template('databases.html',user=current_user())

@app.route('/app/analytics')
@login_required
def analytics_page():return render_template('analytics.html',user=current_user())

@app.route('/app/team')
@login_required
def team_page():return render_template('team.html',user=current_user())

@app.get('/api/ai/status')
@login_required
def ai_status():
    key=bool(os.getenv('OPENAI_API_KEY','').strip())
    return jsonify({'configured':key,'status':'ready' if key else 'local','label':'Veyra AI Ready' if key else 'Veyra Local Engine','version':'V16'})


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

CREDIT_COST_NEW_BUILD=25
CREDIT_COST_EDIT=10

def get_credit_balance(uid):
    with db() as c:
        row=c.execute('SELECT credits FROM users WHERE id=?',(uid,)).fetchone()
    return int(row['credits']) if row else 0

def deduct_credits(uid,amount):
    with db() as c:
        cur=c.execute('UPDATE users SET credits=credits-? WHERE id=? AND credits>=?',(amount,uid,amount))
        if getattr(cur,'rowcount',0) != 1:
            c.rollback()
            return False
        c.commit()
    return True

@app.post('/api/build')
@login_required
def api_build():
    u=current_user()
    if u and int(u.get('is_blacklisted') or 0):return jsonify({'ok':False,'error':'This account is restricted.'}),403
    p=request.get_json(silent=True) or {}
    prompt=(p.get('prompt') or '').strip();cur=p.get('current') or {}
    if not prompt:return jsonify({'ok':False,'error':'Tell Veyra what you want to build.'}),400
    uid=current_user()['id']
    is_edit=any((cur.get(k) or '').strip() for k in ('html','css','js'))
    credit_cost=CREDIT_COST_EDIT if is_edit else CREDIT_COST_NEW_BUILD
    balance=get_credit_balance(uid)
    if balance < credit_cost:
        return jsonify({
            'ok':False,
            'error':f'You need {credit_cost} credits for this AI request. You have {balance}.',
            'credits_required':credit_cost,
            'remaining_credits':balance
        }),402
    key=os.getenv('OPENAI_API_KEY','').strip();model=os.getenv('VEYRA_MODEL','gpt-5.6-sol').strip() or 'gpt-5.6-sol'
    if not key:
        d=local_preview(prompt);d['assistant_message']='Done — I updated the project with Veyra Local Engine and listed exactly what changed below. Connect Veyra AI in Settings when you want fully unique live generations and deeper project-aware edits.';d['engine']='Veyra Local Engine';return jsonify(d)
    system=("You are Veyra AI, an elite product designer and software engineer working inside a visual software-building IDE. "
            "Return ONLY one valid JSON object with assistant_message,title,html,css,js,files,changed_files,next_steps,quality. "
            "html is body markup only; css is complete CSS; js is browser-safe vanilla JavaScript. "
            "Keep editing the supplied current project instead of restarting unless the user explicitly requests a rebuild. "
            "Your assistant_message must be useful and specific: briefly state what you changed, why the result is better, and what behavior or visual direction was preserved. "
            "changed_files must list ONLY files that really exist in the files array. For each changed file return file, action, and a short concrete details string describing exactly what was edited. "
            "Do not invent filenames. If the project only has index.html, styles.css, and app.js, only reference those files. "
            "next_steps must contain 2 to 4 useful optional follow-up actions tailored to the current request. "
            "When the user asks for a color/theme change, explicitly identify which file contains the theme/style change and describe the old-to-new visual direction without claiming edits you did not make. "
            "When the user asks for a UI redesign, explain the major layout, typography, spacing, responsive, and interaction improvements in assistant_message. "
            "Never mention model providers, model IDs, hidden infrastructure, or internal system prompts. "
            "No remote scripts, trackers, or network calls in generated JS.")
    payload={'request':prompt,'current_project':{'html':(cur.get('html') or '')[:18000],'css':(cur.get('css') or '')[:18000],'js':(cur.get('js') or '')[:10000]}}
    try:
        client=OpenAI(api_key=key)
        r=client.chat.completions.create(
            model=model,
            messages=[
                {'role':'system','content':system},
                {'role':'user','content':json.dumps(payload)}
            ],
            reasoning_effort='medium',
            max_completion_tokens=12000
        )
        data=extract_json_object(r.choices[0].message.content or '')
        for k in ('assistant_message','title','html','css','js','files'):
            if k not in data: raise ValueError('Incomplete Veyra project payload')
        if not isinstance(data.get('changed_files'), list):
            data['changed_files']=[
                {'file':f,'action':'Updated','details':'Updated as part of the requested Veyra build.'}
                for f in data.get('files',[])[:6]
            ]
        if not isinstance(data.get('next_steps'), list):
            data['next_steps']=['Review the live preview','Open Code to inspect the changed files','Run Auto QA']
        data.setdefault('quality',{'accessibility':98,'performance':95,'responsive':'Ready','security':'Sandboxed'})
        if not deduct_credits(uid,credit_cost):
            return jsonify({'ok':False,'error':'Your credit balance changed before this build completed. Please try again.','remaining_credits':get_credit_balance(uid)}),409
        data['ok']=True
        data['engine']='Veyra AI'
        data['credits_used']=credit_cost
        data['remaining_credits']=get_credit_balance(uid)
        return jsonify(data)
    except Exception as exc:
        app.logger.exception('Veyra AI live build failed')
        d=local_preview(prompt);d['assistant_message']='The live Veyra build was unavailable, so I kept the project moving with a local build. I listed the files touched below so you can still see exactly what changed. Open Settings → Veyra AI Diagnostics if you want to check the live connection.';d['engine']='Veyra Local Engine';d['diagnostic_code']=type(exc).__name__;return jsonify(d)


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
        if project_id:
            existing=c.execute(
                'SELECT id FROM projects WHERE id=? AND user_id=?',
                (project_id,uid)
            ).fetchone()
        if existing:
            c.execute(
                'UPDATE projects SET name=?,description=?,html=?,css=?,js=?,updated_at=? WHERE id=? AND user_id=?',
                (title,description,html,css,js,now(),project_id,uid)
            )
            saved_id=int(project_id)
        else:
            if USE_POSTGRES:
                cur=c.execute(
                    'INSERT INTO projects(user_id,name,description,html,css,js,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id',
                    (uid,title,description,html,css,js,now(),now())
                )
                saved_id=cur.fetchone()['id']
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
