begin;

alter table public.documents
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists storage_deleted_at timestamptz;

alter table public.documents
  drop constraint if exists documents_sha256_document_type_key;

create unique index if not exists documents_active_sha256_type_unique
  on public.documents(sha256, document_type)
  where deleted_at is null;

create index if not exists idx_documents_active_created
  on public.documents(created_at desc)
  where deleted_at is null;

create or replace view public.reconciliation_summaries
with (security_invoker = true) as
select
  reconciliation_id,
  count(*) filter (where status = 'MATCH') as matches,
  count(*) filter (where status = 'CSV_ONLY') as missing,
  count(*) filter (where status not in ('MATCH', 'CSV_ONLY')) as other_differences
from public.reconciliation_items
group by reconciliation_id;

grant select on public.reconciliation_summaries to authenticated;

comment on column public.documents.deleted_at is
  'Soft-delete marker. Reconciliation history remains available after the encrypted blob is removed.';

commit;
