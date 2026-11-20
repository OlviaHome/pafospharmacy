-- Editorial calendar: articles the editor approved and queued for automatic publication.
-- A queued article gets the post status 'scheduled'; the public site keeps reading only
-- status = 'published' (RLS and queries are unchanged), so a scheduled article stays hidden until
-- the scheduler has actually published it. Server-only tables: RLS on, no anon/authenticated access.
-- Requires 20261118120000 (it widens the same bot message purpose constraint).

-- 1. A new post status between review and published.
alter table public.blog_posts drop constraint blog_posts_status_check;
alter table public.blog_posts
  add constraint blog_posts_status_check check (
    status in ('generating', 'review', 'paused', 'scheduled', 'published', 'archived', 'failed')
  );

-- 2. Bot replies for typed dates and the daily times.
alter table public.blog_bot_messages drop constraint blog_bot_messages_purpose_check;
alter table public.blog_bot_messages
  add constraint blog_bot_messages_purpose_check
    check (purpose in ('card', 'edit_prompt', 'image_prompt', 'topic_confirm', 'images', 'import', 'schedule'));

-- 3. The daily schedule, one row. Times are Cyprus clock times (Europe/Nicosia) on the 15-minute
--    grid the scheduler runs on; the number of times is the number of publications per day.
create table public.blog_publish_settings (
  id boolean primary key default true check (id),
  slot_times text[] not null default array['10:00', '17:00'] check (
    cardinality(slot_times) between 1 and 6
    and array_to_string(slot_times, ',') ~ '^([01][0-9]|2[0-3]):(00|15|30|45)(,([01][0-9]|2[0-3]):(00|15|30|45))*$'
  ),
  updated_at timestamptz not null default now()
);

insert into public.blog_publish_settings (id) values (true) on conflict (id) do nothing;

-- 4. One row per scheduling of an article. Rows are never deleted when they leave the queue
--    (published, failed, cancelled, missed), so the history and the errors stay for diagnosis.
create table public.blog_publish_schedule (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  scheduled_at timestamptz not null,
  -- queue: the next free slot of the daily schedule; manual: a date and time the editor chose.
  mode text not null check (mode in ('queue', 'manual')),
  -- scheduled → publishing → published; or failed (checks or a technical error), cancelled (taken
  -- out of the queue, published by hand), missed (the scheduler did not run in time).
  status text not null default 'scheduled' check (
    status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled', 'missed')
  ),
  -- Fingerprint of the RU + EN texts the editor approved; a different text is never published.
  approved_hash text not null check (char_length(approved_hash) between 16 and 128),
  -- Non-blocking warnings the editor saw and accepted; a new one stops the automatic publication.
  approved_warnings text[] not null default '{}',
  approved_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  error text check (error is null or char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_publish_schedule_claimed check (status <> 'publishing' or claimed_at is not null)
);

-- One article per slot and one active entry per article.
create unique index blog_publish_schedule_active_slot
  on public.blog_publish_schedule (scheduled_at)
  where status in ('scheduled', 'publishing');
create unique index blog_publish_schedule_active_post
  on public.blog_publish_schedule (post_id)
  where status in ('scheduled', 'publishing');
create index blog_publish_schedule_status_idx on public.blog_publish_schedule (status, scheduled_at);
create index blog_publish_schedule_post_idx on public.blog_publish_schedule (post_id, created_at desc);

alter table public.blog_publish_settings enable row level security;
alter table public.blog_publish_schedule enable row level security;

revoke all on table public.blog_publish_settings from anon, authenticated;
revoke all on table public.blog_publish_schedule from anon, authenticated;

grant select, insert, update on table public.blog_publish_settings to service_role;
grant select, insert, update, delete on table public.blog_publish_schedule to service_role;

-- 5. Scheduling: the post moves to 'scheduled' and its entry is created in one transaction. Returns
--    'ok', 'status' (the post is no longer in one of p_from), 'past', 'slot_taken' or 'post_taken'.
create function public.schedule_blog_post(
  p_post_id uuid,
  p_at timestamptz,
  p_mode text,
  p_hash text,
  p_warnings text[],
  p_from text[]
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_constraint text;
begin
  if p_at <= now() then
    return 'past';
  end if;
  begin
    update public.blog_posts
    set status = 'scheduled', last_error = null, updated_at = now()
    where id = p_post_id and status = any (p_from);
    if not found then
      return 'status';
    end if;
    insert into public.blog_publish_schedule (post_id, scheduled_at, mode, approved_hash, approved_warnings)
    values (p_post_id, p_at, p_mode, p_hash, coalesce(p_warnings, '{}'));
    return 'ok';
  exception when unique_violation then
    -- The status change above is undone together with the failed insert.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'blog_publish_schedule_active_post' then
      return 'post_taken';
    end if;
    return 'slot_taken';
  end;
end;
$$;

-- 6. An entry leaves the queue: its status, the reason and the time are stored, and (when asked)
--    the article goes back to review in the same transaction. False when the entry was not in p_from.
create function public.release_blog_schedule(
  p_entry_id uuid,
  p_from text[],
  p_status text,
  p_error text,
  p_revert_post boolean,
  p_post_error text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_post uuid;
begin
  update public.blog_publish_schedule
  set status = p_status, error = left(p_error, 2000), finished_at = now(), updated_at = now()
  where id = p_entry_id and status = any (p_from)
  returning post_id into v_post;
  if not found then
    return false;
  end if;
  if p_revert_post then
    update public.blog_posts
    set status = 'review', last_error = coalesce(left(p_post_error, 1000), last_error), updated_at = now()
    where id = v_post and status = 'scheduled';
  end if;
  return true;
end;
$$;

-- 7. Moves scheduled entries to new times at once (swap two, or redistribute the queue). Each new
--    time must be free; returns 'ok', 'changed' (an entry is no longer scheduled) or 'slot_taken'.
create function public.move_blog_schedule(p_ids uuid[], p_times timestamptz[])
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  i integer;
  v_count integer;
begin
  if cardinality(p_ids) is null or cardinality(p_ids) <> cardinality(p_times) then
    return 'changed';
  end if;
  begin
    perform 1 from public.blog_publish_schedule where id = any (p_ids) and status = 'scheduled' for update;
    get diagnostics v_count = row_count;
    if v_count <> cardinality(p_ids) then
      return 'changed';
    end if;
    -- Park the entries on distinct times far in the past first, so swaps never collide midway.
    for i in 1 .. cardinality(p_ids) loop
      update public.blog_publish_schedule
      set scheduled_at = timestamptz '1900-01-01 00:00:00+00' + make_interval(mins => i)
      where id = p_ids[i];
    end loop;
    for i in 1 .. cardinality(p_ids) loop
      update public.blog_publish_schedule
      set scheduled_at = p_times[i], updated_at = now()
      where id = p_ids[i];
    end loop;
    return 'ok';
  exception when unique_violation then
    return 'slot_taken';
  end;
end;
$$;

revoke all on function public.schedule_blog_post(uuid, timestamptz, text, text, text[], text[]) from public;
revoke all on function public.release_blog_schedule(uuid, text[], text, text, boolean, text) from public;
revoke all on function public.move_blog_schedule(uuid[], timestamptz[]) from public;
grant execute on function public.schedule_blog_post(uuid, timestamptz, text, text, text[], text[]) to service_role;
grant execute on function public.release_blog_schedule(uuid, text[], text, text, boolean, text) to service_role;
grant execute on function public.move_blog_schedule(uuid[], timestamptz[]) to service_role;
