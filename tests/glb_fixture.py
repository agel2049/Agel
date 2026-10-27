"""Small self-contained GLB with distinct architectural parts, not user assets."""
import json,struct
def glb_bytes(external=False,empty=False,nested=False,rebar=False):
 binary=struct.pack('<9f',-1,0,0,1,0,0,0,2,0)
 doc={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],
  'nodes':[{'name':'Edificio','children':[] if empty else [1,2,3]},
   {'name':'Muro 01','mesh':0,'translation':[-2,0,0],'extras':{'Category':'Walls','Level':'Nivel 1'}},
   {'name':'Tubería 01','mesh':1,'extras':{'Category':'Pipes','Level':'Nivel 2'}},
   {'name':'Acabados 01','mesh':2,'translation':[2,0,0],'extras':{'Category':'Acabados','Level':'Nivel 1'}}],
  'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':i}]} for i in range(3)],
  'materials':[{'name':name,'doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':0,'roughnessFactor':.8}} for name,color in [('Ladrillo',[1,.1,.1,1]),('Cobre',[.1,.1,1,1]),('Pintura',[.1,1,.1,1])]],
  'buffers':[{'byteLength':len(binary)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(binary)}],
  'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-1,0,0],'max':[1,2,0]}]}
 if external:doc['images']=[{'uri':'https://forbidden.example/private.png'}]
 if rebar:doc['nodes'][2]['extras'].update(Category='Estructura',IFCClass='IfcReinforcingBar')
 if nested:doc['nodes'][0]['children']=[1,3];doc['nodes'][1]['children']=[2]
 text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
 return struct.pack('<III',0x46546C67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4E4F534A)+text+struct.pack('<II',len(binary),0x004E4942)+binary

def maquette_building_bytes():
 """Synthetic four-storey maquette for layout inspection; no user geometry."""
 faces=[[(1,-1,-1),(1,1,-1),(1,1,1),(1,-1,1)],[(-1,-1,1),(-1,1,1),(-1,1,-1),(-1,-1,-1)],
        [(-1,1,-1),(-1,1,1),(1,1,1),(1,1,-1)],[(-1,-1,1),(-1,-1,-1),(1,-1,-1),(1,-1,1)],
        [(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)],[(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]]
 vertices=[v*.5 for face in faces for i in [0,1,2,0,2,3] for v in face[i]]
 binary=struct.pack('<%df'%len(vertices),*vertices)
 materials=[{'name':name,'pbrMetallicRoughness':{'baseColorFactor':color,'roughnessFactor':.75,'metallicFactor':0}} for name,color in [
  ('Concreto claro',[.72,.68,.58,1]),('Madera',[.23,.16,.1,1]),('Cristal',[.2,.4,.43,.55]),('Terreno',[.19,.22,.18,1]),('Instalaciones',[.55,.2,.14,1])]]
 materials[2].update(alphaMode='BLEND',doubleSided=True)
 nodes=[{'name':'Maqueta de demostración','children':[]}]
 def box(name,pos,scale,material,category,level='Conjunto'):
  nodes[0]['children'].append(len(nodes));nodes.append({'name':name,'mesh':material,'translation':pos,'scale':scale,'extras':{'Category':category,'Level':level}})
 box('Base del conjunto',[0,-.35,0],[20,.7,15],3,'Site')
 for floor in range(5):
  y=floor*2.8;level='Nivel '+str(floor)
  box('Losa '+str(floor),[0,y,0],[13,.28,9],0,'Floors',level)
  if floor==4:continue
  for x in [-5.8,0,5.8]:
   for z in [-3.8,3.8]:box('Columna',[x,y+1.4,z],[.28,2.8,.28],0,'Structural Columns',level)
  box('Muro posterior',[0,y+1.4,-3.9],[11.8,2.65,.18],0,'Walls',level)
  box('Muro lateral',[-5.9,y+1.4,0],[.18,2.65,7.8],0,'Walls',level)
  for x in [-3.8,0,3.8]:
   box('Ventanal',[x,y+1.4,3.85],[3.5,2.35,.06],2,'Windows',level)
   box('Marco de madera',[x,y+1.4,3.9],[.1,2.65,.13],1,'Acabados',level)
  box('Tubería de ejemplo',[5.35,y+1.4,-3.3],[.16,2.8,.16],4,'Pipes',level)
 doc={'asset':{'version':'2.0','generator':'AgelArq synthetic test fixture'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':nodes,
  'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':i}]} for i in range(len(materials))],'materials':materials,
  'buffers':[{'byteLength':len(binary)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(binary)}],
  'accessors':[{'bufferView':0,'componentType':5126,'count':36,'type':'VEC3','min':[-.5,-.5,-.5],'max':[.5,.5,.5]}]}
 text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
 return struct.pack('<III',0x46546C67,2,28+len(text)+len(binary))+struct.pack('<II',len(text),0x4E4F534A)+text+struct.pack('<II',len(binary),0x004E4942)+binary
