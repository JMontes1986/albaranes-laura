begin;

alter table public.documents
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_updated_at timestamptz,
  add column if not exists processing_progress smallint not null default 0,
  add column if not exists processing_stage text;

alter table public.documents
  drop constraint if exists documents_processing_progress_check;

alter table public.documents
  add constraint documents_processing_progress_check
  check (processing_progress between 0 and 100);

create index if not exists idx_documents_processing_started
  on public.documents(processing_started_at)
  where status in ('extracting', 'analyzing', 'reconciling')
    and deleted_at is null;

comment on column public.documents.processing_started_at is
  'Start time used by the UI timer and stale-job recovery.';
comment on column public.documents.processing_updated_at is
  'Last server-side progress heartbeat.';

commit;
