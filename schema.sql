-- =====================================================================
-- Live quiz — database schema for Supabase
-- Run once: Supabase dashboard → SQL Editor → New query → paste → Run
-- Safe to re-run (drops and recreates the quiz objects).
-- =====================================================================

drop function if exists create_game, join_game, set_phase, submit_answer,
                        host_stats, host_reveal, get_results cascade;
drop table if exists answers, players, answer_keys, questions, games cascade;

-- ---------- Tables ---------------------------------------------------

create table games (
  id            uuid primary key default gen_random_uuid(),
  pin           text unique not null,                 -- 6 digits players type in
  host_token    uuid not null default gen_random_uuid(), -- secret, only the host knows it
  title         text,
  phase         text not null default 'lobby'
                check (phase in ('lobby','question','reveal','ended')),
  current_q     int  not null default -1,             -- 0-based question index
  q_started_at  timestamptz,                          -- server time the question opened
  created_at    timestamptz not null default now()
);

create table questions (
  game_id     uuid not null references games(id) on delete cascade,
  idx         int  not null,
  prompt      text not null,
  choices     jsonb not null,                          -- ["Bangkok","Chiang Mai","",""]
  duration_s  int  not null default 20 check (duration_s between 5 and 120),
  primary key (game_id, idx)
);

-- Correct answers live in their own table that the public can never read.
create table answer_keys (
  game_id  uuid not null references games(id) on delete cascade,
  idx      int  not null,
  correct  int  not null check (correct between 0 and 3),
  primary key (game_id, idx)
);

create table players (
  id         uuid primary key default gen_random_uuid(),  -- acts as the player's secret
  game_id    uuid not null references games(id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  joined_at  timestamptz not null default now(),
  unique (game_id, nickname)
);

create table answers (
  player_id    uuid not null references players(id) on delete cascade,
  game_id      uuid not null references games(id) on delete cascade,
  idx          int  not null,
  choice       int  not null check (choice between 0 and 3),
  elapsed_ms   int  not null,
  is_correct   boolean not null,
  points       int  not null,
  answered_at  timestamptz not null default now(),
  primary key (player_id, idx)                  -- one answer per player per question
);
create index answers_game_idx on answers (game_id, idx);

-- ---------- Who can read what ----------------------------------------
-- The browser uses the public (publishable / anon) key, so lock tables down
-- and expose only safe columns. Everything else goes through functions below.

alter table games       enable row level security;
alter table questions   enable row level security;
alter table answer_keys enable row level security;
alter table players     enable row level security;
alter table answers     enable row level security;

revoke all on games, questions, answer_keys, players, answers from anon, authenticated;

grant select (id, pin, title, phase, current_q, q_started_at) on games to anon, authenticated;
grant select on questions to anon, authenticated;
grant select (game_id, nickname, joined_at) on players to anon, authenticated;

create policy games_read   on games   for select using (true);
create policy players_read on players for select using (true);
-- A question becomes readable only once the host has opened it (no peeking ahead)
create policy questions_read on questions for select using (
  exists (select 1 from games g where g.id = questions.game_id and g.current_q >= questions.idx)
);
-- answer_keys and answers: no policies = no direct access at all.

-- ---------- Functions (the only way to write) ------------------------

-- Host: create a game from a JSON array of questions.
-- [{ "prompt": "...", "choices": ["A","B","C","D"], "correct": 0, "duration": 20 }, ...]
create function create_game(p_title text, p_questions jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  g games; q jsonb; i int := 0; new_pin text;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'Add at least one question';
  end if;
  loop
    new_pin := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (select 1 from games where pin = new_pin);
  end loop;
  insert into games (pin, title) values (new_pin, p_title) returning * into g;
  for q in select value from jsonb_array_elements(p_questions) loop
    insert into questions (game_id, idx, prompt, choices, duration_s)
      values (g.id, i, q->>'prompt', q->'choices', coalesce((q->>'duration')::int, 20));
    insert into answer_keys (game_id, idx, correct)
      values (g.id, i, (q->>'correct')::int);
    i := i + 1;
  end loop;
  return json_build_object('game_id', g.id, 'pin', g.pin, 'host_token', g.host_token, 'count', i);
end $$;

-- Host: move the game to a new phase. Stamps server time when a question opens.
create function set_phase(p_game uuid, p_token uuid, p_phase text, p_q int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  update games
     set phase = p_phase,
         current_q = p_q,
         q_started_at = case when p_phase = 'question' then now() else q_started_at end
   where id = p_game and host_token = p_token
  returning q_started_at into ts;
  if not found then raise exception 'Not the host of this game'; end if;
  return ts;
end $$;

-- Player: join with PIN + nickname. Returns the player's id (keep it secret).
create function join_game(p_pin text, p_nick text)
returns json language plpgsql security definer set search_path = public as $$
declare g games; pid uuid;
begin
  select * into g from games where pin = p_pin;
  if not found then raise exception 'No game with that PIN'; end if;
  if g.phase = 'ended' then raise exception 'That game has ended'; end if;
  begin
    insert into players (game_id, nickname) values (g.id, trim(p_nick)) returning id into pid;
  exception when unique_violation then
    raise exception 'That nickname is taken — pick another';
  end;
  return json_build_object('player_id', pid, 'game_id', g.id);
end $$;

-- Player: answer the open question. Time and score are computed on the server,
-- so a player cannot fake speed or see the correct answer.
-- Score: correct = 500..1000 (faster = more), wrong = 0.
create function submit_answer(p_player uuid, p_idx int, p_choice int)
returns json language plpgsql security definer set search_path = public as $$
declare g games; dur int; ms int; ok boolean; pts int;
begin
  select gm.* into g from games gm join players p on p.game_id = gm.id where p.id = p_player;
  if not found then raise exception 'Unknown player'; end if;
  if g.phase <> 'question' or g.current_q <> p_idx then raise exception 'Time is up for this question'; end if;

  select duration_s into dur from questions where game_id = g.id and idx = p_idx;
  ms := (extract(epoch from (clock_timestamp() - g.q_started_at)) * 1000)::int;
  if ms > dur * 1000 + 1500 then raise exception 'Time is up for this question'; end if; -- 1.5 s network grace

  select (correct = p_choice) into ok from answer_keys where game_id = g.id and idx = p_idx;
  pts := case when ok
              then round(1000 * (1 - least(ms, dur * 1000)::numeric / (dur * 1000) / 2))::int
              else 0 end;

  insert into answers (player_id, game_id, idx, choice, elapsed_ms, is_correct, points)
  values (p_player, g.id, p_idx, p_choice, ms, ok, pts);
  return json_build_object('accepted', true);
exception when unique_violation then
  return json_build_object('accepted', false, 'reason', 'Already answered');
end $$;

-- Host: live counter while a question is open.
create function host_stats(p_game uuid, p_token uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform 1 from games where id = p_game and host_token = p_token;
  if not found then raise exception 'Not the host of this game'; end if;
  return json_build_object(
    'players',  (select count(*) from players where game_id = p_game),
    'answered', (select count(*) from answers where game_id = p_game and idx = p_idx));
end $$;

-- Host: correct answer, answer distribution and full scoreboard.
create function host_reveal(p_game uuid, p_token uuid, p_idx int)
returns json language plpgsql security definer set search_path = public as $$
declare res json;
begin
  perform 1 from games where id = p_game and host_token = p_token;
  if not found then raise exception 'Not the host of this game'; end if;
  select json_build_object(
    'correct', (select correct from answer_keys where game_id = p_game and idx = p_idx),
    'dist',    (select coalesce(json_object_agg(choice, n), '{}'::json)
                  from (select choice, count(*) as n from answers
                         where game_id = p_game and idx = p_idx group by choice) d),
    'board',   (select coalesce(json_agg(b order by b.score desc, b.nickname), '[]'::json)
                  from (select p.nickname,
                               coalesce(sum(a.points), 0)::int as score,
                               coalesce(sum(a.points) filter (where a.idx = p_idx), 0)::int as last
                          from players p left join answers a on a.player_id = p.id
                         where p.game_id = p_game
                         group by p.id, p.nickname) b)
  ) into res;
  return res;
end $$;

-- Host / Google Sheets: one row per player per answered question.
create function get_results(p_pin text, p_token uuid)
returns table (nickname text, question int, prompt text, choice text, correct text,
               is_correct boolean, elapsed_ms int, points int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare gid uuid;
begin
  select g.id into gid from games g where g.pin = p_pin and g.host_token = p_token;
  if gid is null then raise exception 'Wrong PIN or host token'; end if;
  return query
    select p.nickname, a.idx + 1, q.prompt,
           chr(65 + a.choice), chr(65 + k.correct),
           a.is_correct, a.elapsed_ms, a.points
      from answers a
      join players p     on p.id = a.player_id
      join questions q   on q.game_id = a.game_id and q.idx = a.idx
      join answer_keys k on k.game_id = a.game_id and k.idx = a.idx
     where a.game_id = gid
     order by p.nickname, a.idx;
end $$;

grant execute on function create_game, join_game, set_phase, submit_answer,
                          host_stats, host_reveal, get_results to anon, authenticated;
