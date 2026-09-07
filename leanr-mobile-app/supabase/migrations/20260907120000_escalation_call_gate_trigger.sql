-- Escalation call-gate — New PRD.md §6/§16 "Escalations": no state-changing
-- action (classify, add note, mark in-progress, resolve) may proceed until
-- `called_client_at` is set. Previously enforced client-side only (see
-- src/lib/data/admin-escalations.ts) — mobile writes directly to Supabase
-- with no trusted server layer in front of it (unlike the web app's server
-- actions), so a client-side-only gate is bypassable by any modified
-- client issuing a raw update/insert. This trigger makes the DB the real
-- trust boundary, matching the PRD's "rejected server-side" requirement
-- (New PRD.md §19 edge case: "test this via a direct API call, not just
-- via the UI, to confirm it's not merely a UI-hidden control").

create or replace function public.enforce_escalation_call_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Allow the confirm-call action itself (the update that sets called_client_at).
  if old.called_client_at is null and new.called_client_at is not null then
    return new;
  end if;

  if old.called_client_at is null and new.called_client_at is null then
    if new.status is distinct from old.status
      or new.admin_issue_type is distinct from old.admin_issue_type
      or new.fault is distinct from old.fault
      or new.admin_summary is distinct from old.admin_summary
      or new.resolution_notes is distinct from old.resolution_notes
    then
      raise exception 'Call the client and discuss the issue before updating this escalation.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists escalations_call_gate on public.escalations;
create trigger escalations_call_gate
  before update on public.escalations
  for each row execute function public.enforce_escalation_call_gate();

create or replace function public.enforce_escalation_note_call_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_called_at timestamptz;
begin
  select called_client_at into v_called_at from public.escalations where id = new.escalation_id;
  if v_called_at is null then
    raise exception 'Call the client and discuss the issue before updating this escalation.';
  end if;
  return new;
end;
$$;

drop trigger if exists escalation_notes_call_gate on public.escalation_notes;
create trigger escalation_notes_call_gate
  before insert on public.escalation_notes
  for each row execute function public.enforce_escalation_note_call_gate();
