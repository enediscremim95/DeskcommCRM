-- 0261: reconexão do WhatsApp liberada por padrão para quem administra a organização.
-- O false explícito continua prevalecendo; a auto-cura alcança apenas linhas legadas
-- sem autor e que nunca foram atualizadas desde a criação.

update public.organization_integration_permissions
set client_visible = true,
    client_can_reconnect = true,
    updated_at = now()
where integration = 'whatsapp'
  and client_can_reconnect = false
  and updated_by is null
  and updated_at = created_at;

create or replace function public.fn_configure_organization_integrations(
  p_organization_id uuid,
  p_actor uuid,
  p_permissions jsonb,
  p_workflow_ids text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_integration text;
  v_workflow_id text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  foreach v_integration in array array['whatsapp', 'n8n', 'windsor'] loop
    insert into public.organization_integration_permissions (
      organization_id, integration, client_visible, client_can_reconnect, updated_by, updated_at
    ) values (
      p_organization_id,
      v_integration,
      coalesce((p_permissions -> v_integration ->> 'client_visible')::boolean, false),
      case when v_integration = 'whatsapp'
        then coalesce((p_permissions -> v_integration ->> 'client_visible')::boolean, false)
          and coalesce((p_permissions -> v_integration ->> 'client_can_reconnect')::boolean, true)
        else false
      end,
      p_actor,
      now()
    )
    on conflict (organization_id, integration) do update set
      client_visible = excluded.client_visible,
      client_can_reconnect = excluded.client_can_reconnect,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  delete from public.n8n_workflow_bindings where organization_id = p_organization_id;
  foreach v_workflow_id in array coalesce(p_workflow_ids, array[]::text[]) loop
    v_workflow_id := btrim(v_workflow_id);
    if length(v_workflow_id) not between 1 and 200 then
      raise exception 'invalid_workflow_id' using errcode = '22023';
    end if;
    insert into public.n8n_workflow_bindings (organization_id, workflow_id, assigned_by, updated_at)
    values (p_organization_id, v_workflow_id, p_actor, now());
  end loop;
end;
$$;

revoke execute on function public.fn_configure_organization_integrations(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.fn_configure_organization_integrations(uuid, uuid, jsonb, text[]) to service_role;
