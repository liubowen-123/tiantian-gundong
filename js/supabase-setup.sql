-- ============================================================
-- 天天滚动 · Supabase 建表脚本（在 SQL Editor 里执行一次即可）
-- 每个用户一行，payload 存放完整学习数据（对应前端 TTStore.exportAll()）
-- ============================================================

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- 开启行级安全：每个用户只能读写自己的那一行
alter table public.user_data enable row level security;

drop policy if exists "own_data" on public.user_data;
create policy "own_data"
  on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
