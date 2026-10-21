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
