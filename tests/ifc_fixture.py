"""Minimal, synthetic STEP models: four separate elements and one storey."""
def rebar_bytes(partial=False):
 data=ifc_bytes().decode().replace('#32=IFCUNITASSIGNMENT((#31));','#32=IFCUNITASSIGNMENT((#31,#3012));')
 lines=["#3010=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);","#3011=IFCMEASUREWITHUNIT(IFCREAL(0.017453292519943295),#3010);","#3012=IFCCONVERSIONBASEDUNIT(#3013,.PLANEANGLEUNIT.,'DEGREE',#3011);","#3013=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);"]
 for i,pts,segments,end in [(0,'(0.,0.,0.),(1.,0.,0.)','$','0.5' if partial else '1.'),(1,'(1.,0.,0.),(0.,1.,0.),(-1.,0.,0.)','(IFCARCINDEX((1,2,3)))','90.' if partial else '180.')]:
  n=3100+i*10
  lines += [f'#{n}=IFCCARTESIANPOINTLIST3D(({pts}));',f'#{n+1}=IFCINDEXEDPOLYCURVE(#{n},{segments},.F.);',f'#{n+2}=IFCSWEPTDISKSOLID(#{n+1},0.01,$,0.,{end});',f"#{n+3}=IFCSHAPEREPRESENTATION(#30,'Body','AdvancedSweptSolid',(#{n+2}));",f'#{n+4}=IFCPRODUCTDEFINITIONSHAPE($,$,(#{n+3}));',f"#{n+5}=IFCREINFORCINGBAR('0A000000000000000000{50+i}',#5,'Varilla {i}',$,$,#14,#{n+4},'bar-{i}',$,0.02,0.000314,1.,.NOTDEFINED.,.PLAIN.);"]
 return data.replace('\nENDSEC;\nEND-ISO-10303-21;','\n'+'\n'.join(lines)+'\nENDSEC;\nEND-ISO-10303-21;').encode()

def ifc_bytes(schema='IFC4',millimeters=False,typed_material=False,offset=0,long_header=False,generic_mep=False,surfaces='normal'):
 scale=1000 if millimeters else 1
 lines=["#1=IFCPERSON($,$,'Test',$,$,$,$,$);","#2=IFCORGANIZATION($,'Fixture',$,$,$);","#3=IFCPERSONANDORGANIZATION(#1,#2,$);","#4=IFCAPPLICATION(#2,'1','Fixture','fixture');","#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);","#10=IFCCARTESIANPOINT((0.,0.,0.));","#11=IFCDIRECTION((0.,0.,1.));","#12=IFCDIRECTION((1.,0.,0.));","#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);","#14=IFCLOCALPLACEMENT($,#13);","#15=IFCCARTESIANPOINT((0.,0.));","#16=IFCAXIS2PLACEMENT2D(#15,$);",f"#17=IFCRECTANGLEPROFILEDEF(.AREA.,$,#16,{2*scale}.,{.2*scale});",f"#18=IFCEXTRUDEDAREASOLID(#17,#13,#11,{3*scale}.);","#20=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#18));","#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));","#30=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#13,$);",f"#31=IFCSIUNIT(*,.LENGTHUNIT.,{'.MILLI.' if millimeters else '$'},.METRE.);","#32=IFCUNITASSIGNMENT((#31));","#33=IFCPROJECT('0A00000000000000000001',#5,'Prueba local',$,$,$,$,(#30),#32);","#40=IFCBUILDINGSTOREY('0A00000000000000000002',#5,'Nivel 1',$,$,#14,$,$,.ELEMENT.,0.);","#41=IFCRELAGGREGATES('0A00000000000000000003',#5,$,$,#33,(#40));"]
 for i,(typ,name) in enumerate([('IFCWALL','Muro'),('IFCBEAM','Viga'),('IFCPIPESEGMENT' if schema!='IFC2X3' else 'IFCFLOWSEGMENT','Tuberia'),('IFCCOVERING','Acabado')]):
  pid=100+i*10;lines += [f'#{pid}=IFCCARTESIANPOINT(({i*4*scale+offset}.,0.,0.));',f'#{pid+1}=IFCAXIS2PLACEMENT3D(#{pid},#11,#12);',f'#{pid+2}=IFCLOCALPLACEMENT($,#{pid+1});']
  suffix=",.CLADDING." if typ=='IFCCOVERING' else ",.NOTDEFINED." if schema!='IFC2X3' else ''
  lines.append(f"#{50+i}={typ}('0A000000000000000000{10+i}',#5,'{name}',$,$,#{pid+2},#21,'tag-{i}'{suffix});")
 lines += ["#60=IFCRELCONTAINEDINSPATIALSTRUCTURE('0A00000000000000000020',#5,$,$,(#50,#51,#52,#53),#40);","#61=IFCPROPERTYSINGLEVALUE('Discipline',$,IFCLABEL('Hidrosanitaria'),$);","#62=IFCPROPERTYSET('0A00000000000000000021',#5,'Pset_Test',$,(#61));","#63=IFCRELDEFINESBYPROPERTIES('0A00000000000000000022',#5,$,$,(#52),#62);","#64=IFCMATERIAL('Ladrillo');" if schema=='IFC2X3' else "#64=IFCMATERIAL('Ladrillo',$,$);","#65=IFCRELASSOCIATESMATERIAL('0A00000000000000000023',#5,$,$,(#50),#64);"]
 if surfaces!='normal':
  lines += ["#202=IFCRECTANGLEPROFILEDEF(.AREA.,$,#16,0.,0.);","#203=IFCEXTRUDEDAREASOLID(#202,#13,#11,0.);"]
  if surfaces=='separate':
   lines += ["#210=IFCSHAPEREPRESENTATION(#30,'Body','SweptSolid',(#203));","#211=IFCPRODUCTDEFINITIONSHAPE($,$,(#210));","#212=IFCBUILDINGELEMENTPROXY('0A00000000000000000040',#5,'Sin superficie',$,$,#14,#211,'tag',.NOTDEFINED.);"]
  else:
   lines=[x.replace("'SweptSolid',(#18)","'SweptSolid',(#18,#203)" if surfaces=='mixed' else "'SweptSolid',(#203)") for x in lines]
 if generic_mep:
  lines=[x.replace('IFCPIPESEGMENT(', 'IFCSANITARYTERMINAL(') for x in lines if not x.startswith('#63=')]
 if typed_material:
  lines=[x.replace('(#50),#64','(#70),#64') for x in lines]
  lines += ["#70=IFCWALLTYPE('0A00000000000000000030',#5,'Tipo de muro',$,$,$,$,$,$,.STANDARD.);","#71=IFCRELDEFINESBYTYPE('0A00000000000000000031',#5,$,$,(#50),#70);"]
 return (f"ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('{('A'*20000) if long_header else 'Archgel synthetic fixture'}'),'2;1');\nFILE_NAME('synthetic.ifc','2026-10-26T00:00:00',('Fixture'),('Fixture'),'Archgel test','Fixture','');\nFILE_SCHEMA(('{schema}'));\nENDSEC;\nDATA;\n"+'\n'.join(lines)+'\nENDSEC;\nEND-ISO-10303-21;\n').encode()
