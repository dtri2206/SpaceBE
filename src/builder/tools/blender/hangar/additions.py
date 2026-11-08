"""Additive v3 kit. Original GLBs and placements are never overwritten."""
import os,json,math
import bpy

def build(api):
    G=api['Geo'];start=api['start'];save=api['save'];marker=api['marker'];out=api['OUT']
    steel=api['STEEL'];dark=api['DARK'];white=api['WHITE'];yellow=api['YELLOW']
    manifest=json.load(open(os.path.join(out,'layout.json'),encoding='utf8'))
    def annulus(g,r0,r1,a,b,y=0,depth=.16,col=steel):
        p=[(r*math.cos(t),h,r*math.sin(t)) for h in (y-depth,y) for r,t in ((r0,a),(r1,a),(r1,b),(r0,b))]
        g.solid(p,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],col)
    def platform(far):
        name='platform_v3_far' if far else 'platform_v3';root=start(name);marker(root,'attach_slide');g=G()
        # A 6m swept notch, with a continuous rail outside it and deep radial support.
        for i in range(24):
            a=-math.pi/2+i*math.pi/24;b=a+math.pi/24
            outer=lambda t:min(14/max(.0001,math.cos(t)),6/max(.0001,abs(math.sin(t))))
            if far:
                p=[(r*math.cos(t),h,r*math.sin(t)) for h in (-.16,0) for r,t in ((6,a),(outer(a),a),(outer(b),b),(6,b))]
                g.solid(p,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],0x737d7d)
            else:
                # Open longitudinal bearing bars, with no alpha-test or tiny texture holes.
                for j in range(3):
                    t=a+(j+.5)*(b-a)/3;r=outer(t)
                    g.beam((6*math.cos(t),-.07,6*math.sin(t)),(r*math.cos(t),-.07,r*math.sin(t)),.028,steel,.10)
            if not far or i%3==0:
                t=(a+b)/2;r=outer(t)
                g.ibeam((6*math.cos(t),-.65,6*math.sin(t)),(r*math.cos(t),-.65,r*math.sin(t)),.3,lod=far)
            g.beam((6*math.cos(a),-.5,6*math.sin(a)),(6*math.cos(b),-.5,6*math.sin(b)),.16,dark,.5)
        if not far:
            for x in range(7,15):g.ibeam((x,-.36,-5.9),(x,-.36,5.9),.22)
        # Thick upper rail and toe board in far LOD; no sub-pixel posts/mid-rails.
        if far:
            for z in (-6,6):g.beam((0,1.05,z),(14,1.05,z),.11,white);g.beam((0,.08,z),(14,.08,z),.1,yellow,.16)
        else:
            for z in (-6,6):g.rail((0,0,z),(14,0,z))
        g.mesh('body',root)
        # Compatibility nodes stay in the original GLBs; new art uses these placeholders.
        for k in ('s','m','l'):marker(root,'slot_cut__'+k)
        save(name,root)
    platform(False);platform(True)
    root=start('catwalk_far');g=G();g.box((6,.2,6),(0,-.1,0),0x737d7d)
    for x in (-3,3):g.beam((x,1.05,-3),(x,1.05,3),.11,white);g.box((.1,.16,6),(x,.08,0),yellow)
    for z in (-2,0,2):g.beam((-3,-.4,z),(3,-.4,z),.22,dark)
    g.mesh('body',root);save('catwalk_far',root,True)
    root=start('collar_plate');g=G();annulus(g,1,2,-math.pi/48,math.pi/48,0,.12,steel);g.mesh('panel',root)
    g=G();annulus(g,1,1.075,-math.pi/48,math.pi/48,.14,.2,yellow);g.mesh('edge',root);save('collar_plate',root,True)
    # One shared station chassis, copied by mesh data under the four requested nodes.
    root=start('engineering_consoles');station=marker(root,'station_window');g=G()
    g.box((2.8,.12,1.05),(0,.81,0),dark)
    for x in (-1.14,1.14):
        g.box((.38,.73,.9),(x,.38,0),steel);g.box((.45,.06,1),(x,.05,0),dark)
        for z in (-.28,.28):g.box((.08,.05,.08),(x,.015,z),dark)
    # Sloped operator apron: desk front is +Z; screens face +Z.
    g.beam((-1.4,.82,.56),(1.4,.82,.56),.16,steel,.3)
    g.box((2.2,.13,.34),(0,.82,.59),0x5b666a)
    g.channel((-1.2,.45,-.2),(1.2,.45,-.2),.13)
    for z in (-.12,.02,.16):g.pipe((-1.1,.5,z),(1.1,.5,z),.018,dark)
    for x in (-.87,0,.87):
        g.pipe((x,.88,-.27),(x,1.36,-.27),.045,dark)
        g.box((.83,.49,.07),(x,1.34,-.1),dark)
        g.box((.86,.51,.035),(x,1.34,-.14),steel)
        g.box((.65,.035,.23),(x,.90,.30),dark)
        for row in range(4):
            for col in range(12):g.box((.035,.008,.033),(x-.25+col*.045,.922,.22+row*.045),0x697477)
    # Phone, hook and a restrained three-colour status tower.
    g.box((.17,.08,.28),(-1.21,.95,.3),dark);g.pipe((-1.27,1.02,.19),(-1.27,1.02,.41),.045,dark)
    for x,c in ((-.17,yellow),(.17,0x528266)):
        g.pipe((x,.91,.60),(x,.94,.60),.045,c)
        for dx in (-.075,.075):g.beam((x+dx,.89,.53),(x+dx,1.00,.53),.018,yellow)
        g.beam((x-.075,1.00,.53),(x+.075,1.00,.53),.018,yellow)
    for i in range(12):
        a=i*math.pi/12;b=(i+1)*math.pi/12
        g.pipe((1.13+.095*math.cos(a),1.04+.095*math.sin(a),.46),(1.13+.095*math.cos(b),1.04+.095*math.sin(b),.46),.012,dark)
    for x in (1.035,1.225):g.box((.035,.06,.05),(x,1.025,.46),dark)
    g.pipe((1.27,.86,-.2),(1.27,1.65,-.2),.028,steel)
    for y,c in ((1.52,0x8f4034),(1.42,yellow),(1.32,0x528266)):g.pipe((1.27,y,-.2),(1.27,y+.08,-.2),.065,c)
    g.beam((1.1,.9,.45),(1.1,1.1,.45),.025,dark);g.beam((1.1,1.1,.45),(1.2,1.1,.45),.025,dark)
    # Chair: central lift, five spoke base and rollers, seat and back.
    g.pipe((0,.16,1.08),(0,.51,1.08),.065,dark)
    for i in range(5):
        a=i*math.tau/5;x=.38*math.cos(a);z=1.08+.38*math.sin(a)
        g.beam((0,.16,1.08),(x,.10,z),.055,dark);g.box((.09,.11,.09),(x,.055,z),dark)
    g.box((.55,.09,.5),(0,.52,1.08),0x333d40);g.box((.55,.46,.10),(0,.83,1.29),0x333d40)
    for x in (-.32,.32):g.box((.07,.04,.35),(x,.74,1.08),dark);g.beam((x,.52,1.1),(x,.74,1.1),.035,steel)
    # Freestanding overhead support and display, inside the reserved area.
    for x in (-1.35,1.35):g.ibeam((x,0,-.43),(x,2.65,-.43),.10);g.box((.3,.04,.3),(x,.02,-.43),dark)
    g.beam((-1.35,2.6,-.43),(1.35,2.6,-.43),.10,steel)
    g.box((2.25,.83,.09),(0,2.16,-.31),dark)
    g.box((1.0,.13,.02),(0,.79,.78),dark)
    chassis=g.mesh('chassis',station)
    # Bake shared chassis only once; screens keep plain UVs and separate node names.
    api['detail'].finish(chassis,'console_v3_chassis',out,'--bake' in api['sys'].argv)
    def screen(parent,name,x,y,z,w,h):
        mesh=bpy.data.meshes.new('m_'+name)
        mesh.from_pydata([api['C'].G(p) for p in ((x-w/2,y-h/2,z),(x+w/2,y-h/2,z),(x+w/2,y+h/2,z),(x-w/2,y+h/2,z))],[],[(0,1,2),(0,2,3)])
        uv=mesh.uv_layers.new(name='UVMap')
        coords=[(0,0),(1,0),(1,1),(0,1)]
        for loop in mesh.loops:uv.data[loop.index].uv=coords[loop.vertex_index]
        mat=api['C'].mat('console_screen',(.04,.12,.15),0,.7,emissive=(.03,.08,.10));mesh.materials.append(mat)
        ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.parent=parent
    ids=['station_window','station_builder','station_testfire','station_launch']
    for i,ident in enumerate(ids):
        st=station if i==0 else marker(root,ident)
        if i:
            copy=chassis.copy();copy.data=chassis.data;copy.parent=st;bpy.context.collection.objects.link(copy)
        for j,x in enumerate((-.87,0,.87)):screen(st,'screen_'+ident+'_'+str(j),x,1.34,-.059,.75,.415)
        screen(st,'screen_'+ident+'_overhead',0,2.16,-.258,2.10,.69)
        screen(st,'screen_'+ident+'_nameplate',0,.79,.795,.96,.10)
    bpy.context.view_layer.update();tri,lo,hi=api['C'].stats(root)
    file='engineering_consoles.glb';_,size=api['C'].export(root,os.path.join(out,file),max_tris=80000)
    assert tri<=80000 and size<=2000000,(tri,size)
    import struct
    data=open(os.path.join(out,file),'rb').read();gltf=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
    unique=sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])
    api['catalog']['engineering_consoles']={'file':file,'triangles':unique,'instancedTriangles':tri,'bytes':size,'bounds':{'min':lo,'max':hi}}
    manifest['modules'].update(api['catalog'])
    manifest['collar']={'notchRadius':6,'plateCount':48,'angularPitch':7.5,'plateModule':'collar_plate','clearance':.25,'slideLimits':[.35,6],'ML_TOP':7,'angleStart':-90,'platformModule':'platform_v3','farModule':'platform_v3_far'}
    manifest['consoles']=[]
    # Semicircular bank, centre on the rocket side. Chassis +Z faces its operator.
    for ident,deg in zip(ids,(-67.5,-22.5,22.5,67.5)):
        a=math.radians(deg);x=4*math.sin(a);z=-13.6-4*math.cos(a);yaw=-deg
        q=math.radians(yaw)
        manifest['consoles'].append({'id':ident,'module':'engineering_consoles','position':[round(x,4),0,round(z,4)],'rotation':[0,yaw,0],'screens':['screen_'+ident+'_'+s for s in ('0','1','2','overhead','nameplate')],'interactPoint':[x+1.42*math.sin(q),1.7,z+1.42*math.cos(q)],'lookTarget':[x-.2*math.sin(q),1.34,z-.2*math.cos(q)],'turnaroundView':{'position':[x+2*math.sin(q),1.7,z+2*math.cos(q)],'target':[0,30,0]}})
    with open(os.path.join(out,'layout.json'),'w',encoding='utf8') as f:json.dump(manifest,f,indent=2)
    print('[v3] Added modules only; old placements, colliders, GLBs intact')
