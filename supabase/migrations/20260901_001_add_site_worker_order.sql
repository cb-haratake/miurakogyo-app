-- 現場ごとに作業者の表示順を手動で保持するテーブル（未登録の作業者はcreated_at→氏名にフォールバック）
create table if not exists site_worker_orders (
  site_id    uuid not null references sites(id) on delete cascade,
  worker_id  uuid not null references workers(id) on delete cascade,
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  primary key (site_id, worker_id)
);
