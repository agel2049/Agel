"""Verify the reviewed incremental SQL against a seeded local 12-migration install."""
import json,uuid
from pathlib import Path
import psycopg
from run import World,SERVER
ROOT=Path(__file__).resolve().parents[2]
DB='agel_incremental_verification'
with psycopg.connect(SERVER+' dbname=postgres',autocommit=True) as c:
 c.execute(f'drop database if exists {DB} with (force)');c.execute(f'create database {DB}')
with psycopg.connect(SERVER+' dbname='+DB,autocommit=True) as c:
 c.execute((ROOT/'supabase/tests/emulation.sql').read_text())
 c.execute((ROOT/'supabase/manual/02-despliegue-inicial-revisado.sql').read_text())
 w=World(c);org=w.org('ana');project=w.project('ana',org,'Original conservado')
 showroom={'description':'Contenido anterior','views':[{'id':'f','image':'https://example.test/f.jpg'}]}
 w.run('ana','update public.projects set showroom=%s where id=%s',(json.dumps(showroom),project),fetch='none')
 pub=w.run('ana','select public.create_publication(%s,%s,%s)',(project,'showroom','historico'),fetch='val')
 version=w.run('ana','select public.create_publication_version(%s)',(pub,),fetch='val')
 before=c.execute('select to_jsonb(p) from public.projects p where id=%s',(project,)).fetchone()[0]
 snapshot=c.execute('select snapshot from public.publication_versions where id=%s',(version,)).fetchone()[0]
 c.execute((ROOT/'supabase/manual/03-showroom-inmersivo-revisado.sql').read_text())
 assert c.execute('select to_jsonb(p) from public.projects p where id=%s',(project,)).fetchone()[0]==before
 assert c.execute('select snapshot from public.publication_versions where id=%s',(version,)).fetchone()[0]==snapshot
 assert c.execute('select count(*) from app.deployment_migrations').fetchone()[0]==16
 try:
  c.execute((ROOT/'supabase/manual/03-showroom-inmersivo-revisado.sql').read_text());raise AssertionError('Repeat incorrectly accepted')
 except psycopg.errors.RaiseException:c.execute('rollback')
 assert c.execute('select count(*) from app.deployment_migrations').fetchone()[0]==16
 print('PASS: incremental 12→16 preserves existing project/version and rejects accidental repeat')
