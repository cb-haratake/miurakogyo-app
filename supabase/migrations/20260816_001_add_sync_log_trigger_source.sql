-- sync_logs に trigger_source を追加し、CRON実行と手動実行を区別できるようにする（存在しない場合のみ）
alter table sync_logs
  add column if not exists trigger_source text not null default 'user' check (trigger_source in ('user', 'cron'));
