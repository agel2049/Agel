-- Private ephemeral signaling only. Does not upload or publish project/media data.
-- Reviewed migration 17 with existing-deployment guard and audit checksum.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from app.deployment_migrations where version='20261014001600' and sha256='98d955636acb5b7c77caaea35f3319eab0cc36e7f73dbe03f5b1768f4c55a998') then
  raise exception 'Historial previo distinto; no se modificaron permisos';
 end if;
 if exists(select 1 from app.deployment_migrations where version='20261021001700') then
  raise exception 'Esta actualización ya está registrada; no se repite';
 end if;
 if not coalesce((select relrowsecurity from pg_class where oid=to_regclass('realtime.messages')),false) then
  raise exception 'Realtime no tiene RLS activo; actualización cancelada';
 end if;
end $preflight$;
-- Temporary sharing authorizes private Broadcast only. Realtime rolls its
-- authorization probes back; no sharing rows/files/tables are created.
-- realtime.messages already has RLS enabled and is service-owned: only add
-- these two policies, leaving its ownership and existing policies untouched.
create policy agel_share_receive on realtime.messages
for select to authenticated
using (
  extension = 'broadcast'
  and case
    when (select realtime.topic()) ~ '^agel-share:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then app.can_read_project(split_part((select realtime.topic()), ':', 2)::uuid)
    else false
  end
);

create policy agel_share_send on realtime.messages
for insert to authenticated
with check (
  extension = 'broadcast'
  and case
    when (select realtime.topic()) ~ '^agel-share:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then app.can_read_project(split_part((select realtime.topic()), ':', 2)::uuid)
    else false
  end
);

insert into app.deployment_migrations(version,name,sha256) values('20261021001700','temporary_sharing','76916454754402a90f07fe24371460ca1f2f410088c72ea74552829912a31b72');
commit;
select policyname,cmd,roles from pg_policies where schemaname='realtime' and tablename='messages' and policyname in ('agel_share_send','agel_share_receive') order by policyname;
