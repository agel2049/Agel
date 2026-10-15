"""Build the incremental SQL for the existing, verified 12-migration installation."""
from pathlib import Path
import hashlib
root=Path(__file__).resolve().parent.parent
files=sorted((root/'supabase/migrations').glob('*.sql'))
base=[p for p in files if p.name.startswith('20261013')]
new=[p for p in files if p.name.startswith('20261014')]
assert len(base)==12 and len(new)==4
parts=["begin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\ndo $preflight$ begin\nif (select count(*) from app.deployment_migrations)<>12 then raise exception 'Actualizar cancelado: revisa el historial; esta actualización exige exactamente las primeras 12 migraciones';end if;\n"]
for p in base:
 version=p.name.split('_',1)[0];sha=hashlib.sha256(p.read_bytes()).hexdigest()
 parts.append(f"if not exists(select 1 from app.deployment_migrations where version='{version}' and sha256='{sha}') then raise exception 'Historial distinto para {version}';end if;\n")
parts.append('end $preflight$;\n')
for p in new:
 version,name=p.stem.split('_',1);sha=hashlib.sha256(p.read_bytes()).hexdigest()
 parts.extend([f'\n-- {p.name}\n',p.read_text(),f"\ninsert into app.deployment_migrations(version,name,sha256) values('{version}','{name}','{sha}');\n"])
parts.append('commit;\n')
out=root/'supabase/manual/03-showroom-inmersivo-revisado.sql';out.write_text(''.join(parts));print(f'{out.name}: {out.stat().st_size} bytes; 4 incremental migrations')
