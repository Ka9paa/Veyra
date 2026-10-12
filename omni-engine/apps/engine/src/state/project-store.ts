import { Pool } from "pg";import { env } from "../config.js";
const pool=new Pool({connectionString:env.DATABASE_URL});
export type ProjectEvent={projectId:string;userId:string;kind:string;payload:unknown;idempotencyKey:string};
export async function ensureSchema(){await pool.query(`create table if not exists project_events(id bigserial primary key,project_id text not null,user_id text not null,kind text not null,payload jsonb not null,idempotency_key text not null unique,created_at timestamptz not null default now());create index if not exists idx_project_events_project on project_events(project_id,id);`)}
export async function appendEvent(e:ProjectEvent){await pool.query(`insert into project_events(project_id,user_id,kind,payload,idempotency_key) values($1,$2,$3,$4,$5) on conflict(idempotency_key) do nothing`,[e.projectId,e.userId,e.kind,JSON.stringify(e.payload),e.idempotencyKey])}
export async function readEvents(projectId:string){return (await pool.query(`select * from project_events where project_id=$1 order by id asc`,[projectId])).rows}
