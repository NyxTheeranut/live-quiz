-- =====================================================================
-- Live quiz / vote: database schema for Supabase
-- Run once: Supabase dashboard > SQL Editor > New query > paste > Run
-- Safe to re-run any time: it never deletes game data. Functions are replaced in place,
-- tables are only created if missing. You do NOT need to run it before each game;
-- only run it again when a new version of this file asks for it.
-- Two game kinds: 'quiz' (one right answer, speed points) and
-- 'vote' (many nominees in groups, no right answer, live tally).
-- =====================================================================

-- ---------- Tables ---------------------------------------------------

create table if not exists games (
  id            uuid primary key default gen_random_uuid(),
  pin           text unique not null,                 -- 6 digits players type in
  host_token    uuid not null default gen_random_uuid(), -- secret, only the host knows it
  title         text,
  kind          text not null default 'quiz' check (kind in ('quiz','vote')),
  phase         text not null default 'lobby'
                check (phase in ('lobby','question','reveal','ended')),
  current_q     int  not null default -1,             -- 0-based question index
  q_started_at  timestamptz,                          -- server time the question opened
  created_at    timestamptz not null default now()
);

create table if not exists questions (
  game_id     uuid not null references games(id) on delete cascade,
  idx         int  not null,
  prompt      text not null,
  note        text,                                    -- vote: the award's one-line definition
  choices     jsonb not null,                          -- ["Bangkok","Chiang Mai"] or nominee names
  groups      jsonb,                                   -- vote: group name per choice (array). quiz: optional {"hideText":true}
  duration_s  int  not null default 20 check (duration_s between 5 and 600),
  primary key (game_id, idx)
);

-- Correct answers (quiz only) live in a table the public can never read.
create table if not exists answer_keys (
  game_id  uuid not null references games(id) on delete cascade,
  idx      int  not null,
  correct  int  not null check (correct between 0 and 199),
  primary key (game_id, idx)
);

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),  -- acts as the player's secret
  game_id    uuid not null references games(id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  joined_at  timestamptz not null default now(),
  unique (game_id, nickname)
);

create table if not exists answers (
  player_id    uuid not null references players(id) on delete cascade,
  game_id      uuid not null references games(id) on delete cascade,
  idx          int  not null,
  choice       int  not null check (choice between 0 and 199),
  elapsed_ms   int  not null,
  is_correct   boolean,                          -- null for votes
  points       int  not null,
  answered_at  timestamptz not null default now(),
  primary key (player_id, idx)                  -- one answer (or one vote) per player per question
);
create index if not exists answers_game_idx on answers (game_id, idx);

-- Upgrade older databases in place (no-ops on a fresh install)
alter table games     add column if not exists kind text not null default 'quiz';
alter table questions add column if not exists note text;
alter table questions add column if not exists groups jsonb;
alter table answers   alter column is_correct drop not null;

-- ---------- Who can read what ----------------------------------------
-- The browser uses the public (publishable / anon) key, so lock tables down
-- and expose only safe columns. Everything else goes through functions below.

alter table games       enable row level security;
alter table questions   enable row level security;
alter table answer_keys enable row level security;
alter table players     enable row level security;
alter table answers     enable row level security;

revoke all on games, questions, answer_keys, players, answers from anon, authenticated;

grant select (id, pin, title, kind, phase, current_q, q_started_at) on games to anon, authenticated;
grant select on questions to anon, authenticated;
grant select (game_id, nickname, joined_at) on players to anon, authenticated;

drop policy if exists games_read on games;
create policy games_read   on games   for select using (true);
drop policy if exists players_read on players;
create policy players_read on players for select using (true);
-- A question becomes readable only once the host has opened it (no peeking ahead)
drop policy if exists questions_read on questions;
create policy questions_read on questions for select using (
  exists (select 1 from games g where g.id = questions.game_id and g.current_q >= questions.idx)
);
-- answer_keys and answers: no policies = no direct access at all.

-- ---------- Functions (the only way to write) ------------------------

-- Host: create a game from a JSON array of questions.
-- quiz: [{ "prompt": "...", "choices": ["A","B","C","D"], "correct": 0, "duration": 20 }, ...]
-- vote: [{ "prompt": "...", "note": "...", "choices": ["name",...], "groups": ["team",...], "duration": 90 }, ...]
create or replace function create_game(p_title text, p_questions jsonb, p_kind text default 'quiz')
returns json language plpgsql security definer set search_path = public as $$
declare
  g games; q jsonb; i int := 0; new_pin text;
begin
  if p_kind not in ('quiz','vote') then raise exception 'ชนิดเกมไม่ถูกต้อง'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'ใส่คำถามหรือรางวัลอย่างน้อย 1 ข้อ';
  end if;
  loop
    new_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from games where pin = new_pin);
  end loop;
  insert into games (pin, title, kind) values (new_pin, p_title, p_kind) returning * into g;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q->'choices') <> 'array' or jsonb_array_length(q->'choices') not between 2 and 200 then
      raise exception 'แต่ละข้อต้องมีตัวเลือก 2 ถึง 200 ตัว';
    end if;
    insert into questions (game_id, idx, prompt, note, choices, groups, duration_s)
      values (g.id, i, q->>'prompt', nullif(q->>'note',''), q->'choices', q->'groups',
              coalesce((q->>'duration')::int, case when p_kind = 'vote' then 90 else 20 end));
    if p_kind = 'quiz' then
      insert into answer_keys (game_id, idx, correct)
        values (g.id, i, (q->>'correct')::int);
    end if;
    i := i + 1;
  end loop;
  return json_build_object('game_id', g.id, 'pin', g.pin, 'host_token', g.host_token, 'count', i, 'kind', g.kind);
end $$;

-- Host: move the game to a new phase. Stamps server time when a question opens.
create or replace function set_phase(p_game uuid, p_token uuid, p_phase text, p_q int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  update games
     set phase = p_phase,
         current_q = p_q,
         q_started_at = case when p_phase = 'question' then now() else q_started_at end
   where id = p_game and host_token = p_token
  returning q_started_at into ts;
  if not found then raise exception 'คุณไม่ใช่เจ้าของเกมนี้'; end if;
  return ts;
end $$;

-- Player: join with PIN + nickname. Returns the player's id (keep it secret).
create or replace function join_game(p_pin text, p_nick text)
returns json language plpgsql security definer set search_path = public as $$
declare g games; pid uuid;
begin
  select * into g from games where pin = p_pin;
  if not found then raise exception 'ไม่พบเกมที่ใช้รหัสนี้'; end if;
  if g.phase = 'ended' then raise exception 'เกมนี้จบไปแล้ว'; end if;
  if char_length(trim(coalesce(p_nick, ''))) = 0 then raise exception 'ใส่ชื่อเล่นก่อนนะ'; end if;
  begin
    insert into players (game_id, nickname) values (g.id, trim(p_nick)) returning id into pid;
  exception when unique_violation then
    raise exception 'ชื่อนี้มีคนใช้แล้ว เลือกชื่ออื่นนะ';
  end;
  return json_build_object('player_id', pid, 'game_id', g.id, 'kind', g.kind);
end $$;

-- Player: answer (quiz) or vote (vote) on the open question.
-- Quiz: time and score are computed on the server; one answer only.
--   Score: correct = 500..1000 (faster = more), wrong = 0.
-- Vote: no score; a player may change their vote while the question is open.
create or replace function submit_answer(p_player uuid, p_idx int, p_choice int)
returns json language plpgsql security definer set search_path = public as $$
declare g games; dur int; n int; ms int; ok boolean; pts int;
begin
  select gm.* into g from games gm join players p on p.game_id = gm.id where p.id = p_player;
  if not found then raise exception 'ไม่พบผู้เล่น'; end if;
  if g.phase <> 'question' or g.current_q <> p_idx then raise exception 'หมดเวลาสำหรับข้อนี้แล้ว'; end if;

  select duration_s, jsonb_array_length(choices) into dur, n
    from questions where game_id = g.id and idx = p_idx;
  if p_choice < 0 or p_choice >= n then raise exception 'ตัวเลือกไม่ถูกต้อง'; end if;
  ms := (extract(epoch from (clock_timestamp() - g.q_started_at)) * 1000)::int;
  if ms > dur * 1000 + 1500 then raise exception 'หมดเวลาสำหรับข้อนี้แล้ว'; end if; -- 1.5 s network grace

  if g.kind = 'vote' then
    insert into answers (player_id, game_id, idx, choice, elapsed_ms, is_correct, points)
    values (p_player, g.id, p_idx, p_choice, ms, null, 0)
    on conflict (player_id, idx) do update
      set choice = excluded.choice, elapsed_ms = excluded.elapsed_ms, answered_at = now();
    return json_build_object('accepted', true);
  end if;

  select (correct = p_choice) into ok from answer_keys where game_id = g.id and idx = p_idx;
  pts := case when ok
              then round(1000 * (1 - least(ms, dur * 1000)::numeric / (dur * 1000) / 2))::int
              else 0 end;

  insert into answers (player_id, game_id, idx, choice, elapsed_ms, is_correct, points)
  values (p_player, g.id, p_idx, p_choice, ms, ok, pts);
  return json_build_object('accepted', true);
exception when unique_violation then
  return json_build_object('accepted', false, 'reason', 'ตอบข้อนี้ไปแล้ว');
end $$;

-- Host: live counter and per-choice tally while a question is open.
create or replace function host_stats(p_game uuid, p_token uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game and host_token = p_token;
  if not found then raise exception 'คุณไม่ใช่เจ้าของเกมนี้'; end if;
  return json_build_object(
    'players',  (select count(*) from players where game_id = p_game),
    'answered', (select count(*) from answers where game_id = p_game and idx = p_idx),
    'dist',     (select coalesce(json_object_agg(d.choice, d.n), '{}'::json)
                   from (select a.choice, count(*) as n from answers a
                          where a.game_id = p_game and a.idx = p_idx group by a.choice) d));
end $$;

-- Host (quiz): correct answer, answer distribution and full scoreboard.
-- For a vote game the board is empty; use host_stats / host_summary instead.
create or replace function host_reveal(p_game uuid, p_token uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare res json; gk text;
begin
  select g.kind into gk from games g where g.id = p_game and g.host_token = p_token;
  if not found then raise exception 'คุณไม่ใช่เจ้าของเกมนี้'; end if;
  select json_build_object(
    'correct', (select k.correct from answer_keys k where k.game_id = p_game and k.idx = p_idx),
    'dist',    (select coalesce(json_object_agg(d.choice, d.n), '{}'::json)
                  from (select a.choice, count(*) as n from answers a
                         where a.game_id = p_game and a.idx = p_idx group by a.choice) d),
    'board',   (select coalesce(json_agg(b order by b.score desc, b.nickname), '[]'::json)
                  from (select p.nickname,
                               coalesce(sum(a.points), 0)::int as score,
                               coalesce(sum(a.points) filter (where a.idx = p_idx), 0)::int as last
                          from players p left join answers a on a.player_id = p.id
                         where p.game_id = p_game and gk = 'quiz'
                         group by p.id, p.nickname) b)
  ) into res;
  return res;
end $$;

-- Host (vote): tally for every award at once, for the final summary.
create or replace function host_summary(p_game uuid, p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game and host_token = p_token;
  if not found then raise exception 'คุณไม่ใช่เจ้าของเกมนี้'; end if;
  return (select coalesce(json_agg(json_build_object(
            'idx', q.idx,
            'dist', (select coalesce(json_object_agg(d.choice, d.n), '{}'::json)
                       from (select a.choice, count(*) as n from answers a
                              where a.game_id = p_game and a.idx = q.idx group by a.choice) d)
          ) order by q.idx), '[]'::json)
            from questions q where q.game_id = p_game);
end $$;

-- Host / Google Sheets: one row per player per answered question.
-- choice / correct are the actual option text (nominee name for votes).
create or replace function get_results(p_pin text, p_token uuid)
returns table (nickname text, question int, prompt text, choice text, correct text,
               is_correct boolean, elapsed_ms int, points int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare gid uuid;
begin
  select g.id into gid from games g where g.pin = p_pin and g.host_token = p_token;
  if gid is null then raise exception 'รหัสเกมหรือโทเคนเจ้าของเกมไม่ถูกต้อง'; end if;
  return query
    select p.nickname, a.idx + 1, q.prompt,
           q.choices->>a.choice,
           case when k.correct is null then null else q.choices->>k.correct end,
           a.is_correct, a.elapsed_ms, a.points
      from answers a
      join players p     on p.id = a.player_id
      join questions q   on q.game_id = a.game_id and q.idx = a.idx
      left join answer_keys k on k.game_id = a.game_id and k.idx = a.idx
     where a.game_id = gid
     order by p.nickname, a.idx;
end $$;

grant execute on function create_game, join_game, set_phase, submit_answer,
                          host_stats, host_reveal, host_summary, get_results to anon, authenticated;
