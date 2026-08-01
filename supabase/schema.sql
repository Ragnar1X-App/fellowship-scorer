-- FellowshipScorer database schema
-- Run this in the Supabase SQL editor (or via the Supabase MCP connector) once,
-- when setting up the project.

create table if not exists base_projects (
  id bigint generated always as identity primary key,
  title text not null unique,
  description text not null,
  added_from_batch text,
  created_at timestamptz default now()
);

create table if not exists nirf_list (
  id bigint generated always as identity primary key,
  institute_name text not null,
  rank text,
  updated_at timestamptz default now()
);

create table if not exists batches (
  id text primary key,               -- e.g. "AY26-27-batch-1", or a generated UUID
  label text,
  total_students integer,
  created_at timestamptz default now()
);

create table if not exists scores (
  id bigint generated always as identity primary key,
  batch_id text references batches(id) on delete cascade,
  student_name text not null,
  institution text,
  result jsonb not null,             -- full breakdown: sub-scores, flags, justification, etc.
  status text default 'done',        -- 'pending' | 'done' | 'error' — for resumable batches
  error_message text,
  updated_at timestamptz default now(),
  unique (batch_id, student_name)
);

create index if not exists idx_scores_batch on scores(batch_id);
create index if not exists idx_scores_status on scores(batch_id, status);

-- Row Level Security: service role (used by Netlify Functions) bypasses RLS by default.
-- If you later add a frontend that reads Supabase directly with the anon key,
-- enable RLS and add read-only policies here.
