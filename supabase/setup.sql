-- Apply once to the NEW, empty Supabase project. Do not use the existing SCM project.
-- Everything is closed to direct browser access. The Edge Function uses service_role
-- after checking the cryptographically random, member-specific session token.
begin;
create table public.escape_teams (
 id uuid primary key,
 code text unique not null check (code ~ '^[A-Z2-9]{8}$'),
 solved integer not null default 0 check (solved between 0 and 5),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '7 days',
 finished_at timestamptz
);
create table public.escape_members (
 id uuid primary key,
 team_id uuid not null references public.escape_teams(id) on delete cascade,
 token_hash text unique not null check (token_hash ~ '^[a-f0-9]{64}$'),
 name text not null check (char_length(name) between 1 and 12),
 slot integer not null check (slot between 0 and 3),
 last_attempt_at timestamptz,
 created_at timestamptz not null default now(),
 unique(team_id,slot)
);
create table public.escape_rate_limits (
 bucket text not null,
 window_id bigint not null,
 count integer not null,
 created_at timestamptz not null default now(),
 primary key(bucket,window_id)
);
create index escape_teams_expiration_idx on public.escape_teams(expires_at);
alter table public.escape_teams enable row level security;
alter table public.escape_members enable row level security;
alter table public.escape_rate_limits enable row level security;
revoke all on public.escape_teams,public.escape_members,public.escape_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on public.escape_teams,public.escape_members,public.escape_rate_limits to service_role;

create function public.escape_limit(p_bucket text,p_max int,p_seconds int) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n int; w bigint;
begin
 w := floor(extract(epoch from clock_timestamp()) / p_seconds);
 insert into public.escape_rate_limits(bucket,window_id,count) values(p_bucket,w,1)
 on conflict(bucket,window_id) do update set count=public.escape_rate_limits.count+1 returning count into n;
 return n<=p_max;
end $$;

create function public.escape_state(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.escape_members; t public.escape_teams; people jsonb;
begin
 select * into m from public.escape_members where token_hash=p_token_hash;
 if m.id is null then raise exception 'invalid_session'; end if;
 select * into t from public.escape_teams where id=m.team_id;
 if t.id is null or t.expires_at<now() then raise exception 'expired_team'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'slot',slot) order by slot),'[]') into people from public.escape_members where team_id=t.id;
 return jsonb_build_object('team',jsonb_build_object('code',t.code,'solved',t.solved,'expiresAt',t.expires_at),'me',jsonb_build_object('name',m.name,'slot',m.slot),'members',people);
end $$;

create function public.escape_create(p_team_id uuid,p_member_id uuid,p_code text,p_token_hash text,p_name text,p_bucket text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 -- Lock the inexpensive global capacity check so concurrent creates cannot exceed it.
 perform pg_catalog.pg_advisory_xact_lock(831624);
 delete from public.escape_teams where expires_at<now();
 delete from public.escape_rate_limits where created_at<now()-interval '2 days';
 if not public.escape_limit('create:'||p_bucket,10,86400) then return jsonb_build_object('error','rate_limit'); end if;
 if (select count(*) from public.escape_teams)>=300 then return jsonb_build_object('error','capacity_limit'); end if;
 insert into public.escape_teams(id,code) values(p_team_id,p_code);
 insert into public.escape_members(id,team_id,token_hash,name,slot) values(p_member_id,p_team_id,p_token_hash,p_name,0);
 return public.escape_state(p_token_hash);
end $$;

create function public.escape_join(p_member_id uuid,p_code text,p_token_hash text,p_name text,p_bucket text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.escape_teams; n int;
begin
 if not public.escape_limit('join:'||p_bucket,30,600) then return jsonb_build_object('error','rate_limit'); end if;
 select * into t from public.escape_teams where code=p_code for update;
 if t.id is null or t.expires_at<now() then return jsonb_build_object('error','invalid_code'); end if;
 -- Membership is frozen before the split-recording puzzle; roles never shuffle.
 if t.solved>=2 then return jsonb_build_object('error','team_started'); end if;
 select count(*) into n from public.escape_members where team_id=t.id;
 if n>=4 then return jsonb_build_object('error','team_full'); end if;
 insert into public.escape_members(id,team_id,token_hash,name,slot) values(p_member_id,t.id,p_token_hash,p_name,n);
 return public.escape_state(p_token_hash);
end $$;

create function public.escape_submit(p_token_hash text,p_stage integer,p_answer text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.escape_members; t public.escape_teams; expected text; clean_answer text;
begin
 select * into m from public.escape_members where token_hash=p_token_hash;
 if m.id is null then raise exception 'invalid_session'; end if;
 select * into t from public.escape_teams where id=m.team_id for update;
 if t.expires_at<now() then raise exception 'expired_team'; end if;
 if p_stage is null or p_stage<0 or p_stage>4 or p_stage<>t.solved then
   return public.escape_state(p_token_hash)||jsonb_build_object('correct',false,'stale',true);
 end if;
 select * into m from public.escape_members where id=m.id;
 if m.last_attempt_at>clock_timestamp()-interval '2 seconds' then return jsonb_build_object('error','slow_down'); end if;
 update public.escape_members set last_attempt_at=clock_timestamp() where id=m.id;
 expected := (array['3142','A다리쪽','7209','A','6284'])[p_stage+1];
 clean_answer := upper(regexp_replace(trim(p_answer),'[[:space:]/·→,\-]','','g'));
 if clean_answer is null or clean_answer<>expected then
   return public.escape_state(p_token_hash)||jsonb_build_object('correct',false);
 end if;
 update public.escape_teams set solved=solved+1,finished_at=case when solved=4 then now() else null end where id=t.id;
 return public.escape_state(p_token_hash)||jsonb_build_object('correct',true);
end $$;

revoke all on function public.escape_limit(text,int,int),public.escape_state(text),public.escape_create(uuid,uuid,text,text,text,text),public.escape_join(uuid,text,text,text,text),public.escape_submit(text,int,text) from public,anon,authenticated;
grant execute on function public.escape_limit(text,int,int),public.escape_state(text),public.escape_create(uuid,uuid,text,text,text,text),public.escape_join(uuid,text,text,text,text),public.escape_submit(text,int,text) to service_role;
-- Supabase's optional automatic-RLS trigger is internal, not a public RPC.
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke all on function public.rls_auto_enable() from public,anon,authenticated';
 end if;
end $$;
commit;
