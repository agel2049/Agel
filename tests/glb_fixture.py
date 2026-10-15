"""Small self-contained GLB with distinct architectural parts, not user assets."""
import json,struct
def glb_bytes(external=False,empty=False,nested=False):
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
 if nested:doc['nodes'][0]['children']=[1,3];doc['nodes'][1]['children']=[2]
 text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
 return struct.pack('<III',0x46546C67,2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4E4F534A)+text+struct.pack('<II',len(binary),0x004E4942)+binary
