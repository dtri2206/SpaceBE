"""Additive 270-degree wrap and finished consoles. Never exports an existing module."""
import bpy,math,json,os,struct

def build(api):
    G=api['Geo'];start=api['start'];save=api['save'];marker=api['marker'];out=api['OUT'];C=api['C']
    S=api['STEEL'];W=api['WHITE'];D=api['DARK'];Y=api['YELLOW'];BLUE=0x426c8b;RED=0xa14b38
    manifest=json.load(open(os.path.join(out,'layout.json'),encoding='utf8'))
    segments=[{'id':'right','arc':[-45,45],'rotation':0,'slideAxis':[1,0,0]}, {'id':'left','arc':[135,225],'rotation':180,'slideAxis':[-1,0,0]}, {'id':'back','arc':[225,315],'rotation':270,'slideAxis':[0,0,1]}]
    def polar(r,a,y=0):return (r*math.cos(a),y,-r*math.sin(a))
    def strip(g,r0,r1,a,b,y,depth,col):
        p=[polar(r,t,h) for h in (y-depth,y) for r,t in ((r0,a),(r1,a),(r1,b),(r0,b))]
        g.solid(p,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],col)
    def deck(far):
        name='wrap_deck_v4_far' if far else 'wrap_deck_v4';root=start(name);marker(root,'attach_slide');marker(root,'segment_deck');g=G()
        for i in range(12):
            a=math.radians(-45+i*7.5);b=a+math.pi/24
            outer=lambda t:14/max(.001,abs(math.cos(t)))
            if far:
                p=[polar(r,t,h) for h in (-.18,0) for r,t in ((6,a),(outer(a),a),(outer(b),b),(6,b))]
                g.solid(p,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],0x798487)
            else:
                for j in range(5):
                    t=a+(j+.5)*(b-a)/5;r=outer(t);g.beam(polar(6,t,-.06),polar(r,t,-.06),.028,S,.10)
                t=(a+b)/2;g.ibeam(polar(6,t,-.75),polar(outer(t),t,-.75),.36,S)
            g.ibeam(polar(6,a,-.4),polar(6,b,-.4),.42,Y,lod=far)
        for a in (-math.pi/4,math.pi/4):
            if far:
                g.beam(polar(6,a,1.08),polar(19.799,a,1.08),.12,W);g.beam(polar(6,a,.08),polar(19.799,a,.08),.12,Y,.16)
            else:
                g.rail(polar(6,a),polar(19.799,a));g.ibeam(polar(6,a,-.5),polar(19.799,a,-.5),.36,Y)
        if not far:
            for x in (7,9,11,13):g.ibeam((x,-.4,-x),(x,-.4,x),.24)
            for z in (-3,3):
                for x in (10,13):g.box((.34,.28,.34),(x,-.96,z),D)
            # Fixed equipment sits at the outside edge, entirely behind the viewing slot boundary.
            g.box((1.2,1.1,.65),(12.9,.55,2),W);g.box((.035,.75,.48),(12.27,.65,2),RED)
            g.box((.65,1.5,.14),(13.6,.75,-2.5),RED)
            for yy in (.35,.65,.95):g.box((.03,.03,.11),(13.25,yy,-2.5),D)
            g.pipe((13.7,-1,5),(13.7,5,5),.085,0xaa3b2d)
            for yy in (0,2,4):g.box((.22,.10,.24),(13.7,yy,5),W)
            for z in (-.3,.3):g.box((7,.14,.04),(10,-1.05,z),D)
            for x in range(7,14):g.box((.04,.03,.6),(x,-1.10,0),S)
        g.mesh('body',root)
        marker(root,'attach_seam_start',polar(10,-math.pi/4));marker(root,'attach_seam_end',polar(10,math.pi/4))
        # Thin covers overlap only the beam seam, never the open front sector.
        for label,a in [('start',-math.pi/4),('end',math.pi/4)]:
            g=G();g.beam(polar(6,a,.035),polar(19.799,a,.035),.12,W,.035);g.mesh('seam_cover_'+label,root)
        save(name,root)
    deck(False);deck(True)
    root=start('wrap_track_v4');g=G()
    for z in (-3,3):g.ibeam((6,-.15,z),(20,-.15,z),.30,Y)
    for z in (-8,8):g.ibeam((15,-4.9,z),(15,.85,z),.36,BLUE)
    for z in (-3,0,3):g.box((1.1,.1,.65),(13,-.02,z),D)
    g.mesh('body',root);save('wrap_track_v4',root,True)
    for far in (False,True):
        name='rear_tower_v4_far' if far else 'rear_tower_v4';root=start(name);g=api['tower'](far)
        original=api['rgb'](S);blue=api['rgb'](BLUE);g.surface=[.28 if c==original else m for c,m in zip(g.col,g.surface)];g.col=[blue if c==original else c for c in g.col]
        g.mesh('body',root);save(name,root,True)
    root=start('wrap_stair_v4');g=G()
    for i in range(30):
        y=(i+1)*.2;z=-i*.25
        for dz in (-.09,0,.09):g.box((1.15,.045,.022),(0,y,z+dz),S)
        g.box((1.15,.035,.035),(0,y+.02,z+.12),Y)
    for x in (-.62,.62):g.channel((x,0,.2),(x,6,-7.5),.22);g.rail((x,0,.2),(x,6,-7.5))
    g.mesh('body',root);save('wrap_stair_v4',root,True)
    # Launcher side/rear frame: remove the front crossbar only in this new inspection module.
    root=start('launcher_slot_v4');g=G()
    for x in (-5.5,5.5):
        g.box((5,2,16),(x,6,0),api['DECK'])
        for z in (-6,6):g.ibeam((x,0,z),(x,5,z),.8);g.box((1.6,.3,1.6),(x,.15,z),D)
    g.box((6,2,5),(0,6,5.5),api['DECK'])
    for x in (-8,8):g.rail((x,7,-8),(x,7,8))
    g.rail((-8,7,8),(8,7,8));g.mesh('body',root);marker(root,'attach_deck',(0,7,0));save('launcher_slot_v4',root)
    # Console carpet/raised access floor, cable trench covers and quiet tile seams.
    root=start('console_island_v4');g=G();g.box((15,.06,8),(0,.03,-16),0x374349)
    for x in range(-7,8):g.box((.012,.002,7.8),(x,.061,-16),0x404d52)
    for z in range(-19,-12):g.box((14.8,.002,.012),(0,.061,z),0x404d52)
    g.box((13,.014,.32),(0,.066,-18.9),0x222f34)
    for x in range(-6,7):g.box((.02,.004,.3),(x,.075,-18.9),0x61717a)
    g.mesh('body',root);save('console_island_v4',root)
    console(api,manifest)
    manifest['modules'].update(api['catalog'])
    for s in segments:
        s.update({'module':'wrap_deck_v4','lod':'wrap_deck_v4_far','closed':0,'retracted':4,'slideAxisLocal':[1,0,0],'seamCoverIds':['seam_cover_start' if s['id']=='right' else 'seam_cover_end'] if s['id']!='back' else []})
    placements=[];colliders=[];levels=[]
    def place(ident,module,pos,rotation=0,**extras):placements.append({'id':ident,'module':module,'position':list(pos),'rotation':[0,rotation,0],'scale':[1,1,1],**extras})
    for l,level in enumerate(manifest['levels']):
        y=level['y'];ids=[]
        for s in segments:
            ident=f"wrap_{l:02}_{s['id']}";ids.append(ident)
            place(ident,s['module'],(0,y,0),s['rotation'],lod=s['lod'],dynamic='wrapSegment',level=l,segment=s['id'],axis=s['slideAxis'])
            place(ident+'_track','wrap_track_v4',(0,y-1,0),s['rotation'])
            # Piecewise boxes exclude the open quarter and the circular notch conservatively.
            a=math.radians(s['rotation'])
            for x,z,w,d in [(8,0,4,8),(12,0,4,16),(13.5,-10.5,1,5),(13.5,10.5,1,5)]:
                cx=x*math.cos(a)+z*math.sin(a);cz=-x*math.sin(a)+z*math.cos(a)
                sx,sz=(d,w) if s['id']=='back' else (w,d)
                colliders.append({'kind':'wrap_deck','center':[cx,y-.12,cz],'size':[sx,.24,sz],'level':l,'segment':s['id'],'dynamic':'wrapSegment'})
        if l<10:
            # Two flights on the rear-right deck; run along Z and share the next level landing.
            place(f'wrap_stair_{l}','wrap_stair_v4',(11,y,11.5))
        levels.append({'level':l,'y':y,'segments':ids})
    for x in (-12,-6,0,6,12):
        for y in range(0,72,6):place(f'rear_{x}_{y}','rear_tower_v4',(x,y,17),lod='rear_tower_v4_far')
        colliders.append({'kind':'rear_structure','center':[x,36,17],'size':[6,72,6],'level':-1,'segment':'back'})
    manifest['wrap']={'version':4,'openSector':{'center':90,'width':90,'direction':[0,0,-1]},'segments':segments,'levels':levels,'placements':placements,'colliders':colliders,'seams':[{'id':'right_back','angle':315,'width':.12,'owner':'right','node':'seam_cover_start'},{'id':'left_back','angle':225,'width':.12,'owner':'left','node':'seam_cover_end'}],'collar':{**manifest['collar'],'activePlateCount':36},'consoleModule':'engineering_consoles_v4','islandModule':'console_island_v4','launcherModule':'launcher_slot_v4'}
    with open(os.path.join(out,'layout.json'),'w',encoding='utf8') as f:json.dump(manifest,f,indent=2)
    print('[v4] Original manifest values preserved; wrap appended',len(placements),'placements')

def console(api,manifest):
    """Finished repeated workstation. Original source positions/UV contracts retained."""
    G=api['Geo'];C=api['C'];marker=api['marker'];out=api['OUT'];S=api['STEEL'];W=api['WHITE'];D=api['DARK'];Y=api['YELLOW']
    root=api['start']('engineering_consoles_v4');station=marker(root,'station_window')
    g=G()
    # Chamfered plan corners and a real sloping apron; bevel only the major shell.
    def shell(w,d,y0,y1,c,z=0):
        r=.06;points=[(-w/2+r,-d/2), (w/2-r,-d/2),(w/2,-d/2+r),(w/2,d/2-r),(w/2-r,d/2),(-w/2+r,d/2),(-w/2,d/2-r),(-w/2,-d/2+r)]
        verts=[(x,y,zz+z) for y in (y0,y1) for x,zz in points];n=len(points)
        g.solid(verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],c)
    shell(2.95,1.1,.78,.89,0x3d525b)
    for x in (-1.16,1.16):g.box((.4,.73,.9),(x,.39,0),0x4b626b);g.box((.42,.31,.035),(x,.27,.47),0x9ca8ac)
    g.beam((-1.45,.81,.62),(1.45,.81,.62),.2,0x5b747e,.33)
    for z in (-.51,.55):g.beam((-1.43,.9,z),(1.43,.9,z),.028,0xadb8bd)
    body=g.mesh('shell',station);C.bevel(body,.012,1)
    g=G();glow=G()
    for x in (-.87,0,.87):
        g.pipe((x,.90,-.29),(x,1.36,-.29),.035,D)
        g.box((.84,.50,.065),(x,1.34,-.095),0x142329)
        g.box((.87,.525,.025),(x,1.34,-.14),0x788b94)
        g.box((.64,.035,.235),(x,.92,.30),D)
        for row in range(5):
            for col in range(13):g.box((.031,.008,.028),(x-.255+col*.042,.944,.214+row*.037),0x7c9098)
        # Painted/baked cool spill under the monitors, not another real light.
        for i in range(8):
            c=(0x385866 if i<3 else 0x304953 if i<6 else 0x2a3d45)
            g.box((.76,.003,.045),(x,.901,-.01+i*.045),c)
    g.box((.24,.009,.33),(.5,.91,.39),0x1d2d34);g.pipe((.5,.93,.36),(.5,.96,.36),.045,0x88959a,12)
    for x in (-1.13,1.13):g.pipe((x,.88,-.35),(x,.91,-.35),.055,D,12)
    g.channel((-1.2,.49,-.15),(1.2,.49,-.15),.13)
    for z in (-.18,-.10,-.02):g.pipe((-1.15,.53,z),(1.15,.53,z),.014,D)
    g.box((.20,.07,.28),(-1.22,.94,.31),D)
    for row in range(4):
        for col in range(3):g.box((.025,.007,.025),(-1.27+col*.04,.98,.22+row*.04),W)
    for x in (-1.29,-1.17):g.pipe((x,.99,.20),(x,1.02,.40),.032,D)
    g.pipe((-1.29,1.02,.39),(-1.17,1.02,.39),.035,D)
    for x,c in ((-.17,0xb38d36),(.17,0x4a8778)):
        g.box((.115,.035,.115),(x,.94,.62),D);glow.box((.065,.018,.065),(x,.965,.62),c)
        for dx in (-.075,.075):g.beam((x+dx,.93,.55),(x+dx,1.04,.55),.018,Y)
        g.beam((x-.075,1.04,.55),(x+.075,1.04,.55),.018,Y)
    g.beam((1.10,.9,.46),(1.10,1.16,.46),.023,S);g.beam((1.10,1.16,.46),(1.22,1.16,.46),.023,S)
    for i in range(16):
        a=i*math.pi/16;b=(i+1)*math.pi/16
        g.pipe((1.16+.10*math.cos(a),1.10+.12*math.sin(a),.46),(1.16+.10*math.cos(b),1.10+.12*math.sin(b),.46),.012,D)
    for x in (1.06,1.26):g.box((.04,.07,.05),(x,1.08,.46),D)
    points=[(1.43,.9,.25),(1.43,1.14,.25),(1.43,1.40,.20),(1.36,1.49,.15)]
    for a,b in zip(points,points[1:]):g.pipe(a,b,.014,D)
    g.pipe((1.36,1.47,.15),(1.36,1.51,.15),.075,D,12);glow.pipe((1.36,1.464,.15),(1.36,1.469,.15),.060,0x7f9b9f,12)
    g.pipe((-1.37,.89,-.25),(-1.37,1.69,-.25),.023,S)
    for y,c in ((1.45,0x508471),(1.55,0x957b36),(1.65,0x8a4a3b)):glow.pipe((-1.37,y,-.25),(-1.37,y+.07,-.25),.05,c,10)
    # Curved ergonomic seat/back and five-spoke caster base.
    g.pipe((0,.16,1.10),(0,.49,1.10),.06,S)
    for i in range(5):
        a=i*math.tau/5;x=.37*math.cos(a);z=1.1+.37*math.sin(a)
        g.beam((0,.16,1.1),(x,.11,z),.045,D);g.pipe((x-.035,.075,z),(x+.035,.075,z),.052,D,10)
    g.box((.55,.09,.49),(0,.53,1.10),0x24343e)
    for i in range(12):
        a=-.65+i*1.3/12;b=a+1.3/12
        for y in (.69,.88,1.07):g.beam((.48*math.sin(a),y,1.06+.22*math.cos(a)),(.48*math.sin(b),y,1.06+.22*math.cos(b)),.10,0x2f4550,.15)
    for x in (-.32,.32):g.box((.065,.035,.34),(x,.75,1.12),D);g.beam((x,.53,1.12),(x,.75,1.12),.025,S)
    for x in (-1.35,1.35):g.ibeam((x,0,-.43),(x,2.65,-.43),.10);g.box((.28,.04,.28),(x,.02,-.43),D)
    g.beam((-1.4,2.61,-.43),(1.4,2.61,-.43),.075,S)
    for i in range(8):g.angle((-1.4+i*.35,2.55,-.43),(-1.05+i*.35,2.65,-.43),.03,S)
    g.box((2.25,.83,.08),(0,2.16,-.31),0x172a32);g.box((2.29,.87,.025),(0,2.16,-.365),0x81969f)
    g.box((1.0,.13,.02),(0,.79,.78),0x8d9ba1)
    hardware=g.mesh('hardware',station)
    lamps=glow.mesh('glow',station,True)
    # Low-emission local indicators; never use the original bright lamp material name.
    mat=lamps.data.materials[0].copy();mat.name='v4_console_glow';mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.35;lamps.data.materials[0]=mat
    for ob in (body,hardware):api['detail'].finish(ob,'console_v4_'+ob.name,out,'--bake' in api['sys'].argv)
    def screen(parent,name,x,y,z,w,h):
        me=bpy.data.meshes.new('m_'+name);me.from_pydata([C.G(p) for p in ((x-w/2,y-h/2,z),(x+w/2,y-h/2,z),(x+w/2,y+h/2,z),(x-w/2,y+h/2,z))],[],[(0,1,2),(0,2,3)])
        uv=me.uv_layers.new(name='UVMap');coords=[(0,0),(1,0),(1,1),(0,1)]
        for loop in me.loops:uv.data[loop.index].uv=coords[loop.vertex_index]
        me.materials.append(C.mat('console_screen',(.02,.04,.06),0,.8));ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.parent=parent
    for i,st in enumerate(manifest['consoles']):
        node=station if i==0 else marker(root,st['id'])
        if i:
            for original in (body,hardware,lamps):ob=original.copy();ob.data=original.data;ob.parent=node;bpy.context.collection.objects.link(ob)
        for j,x in enumerate((-.87,0,.87)):screen(node,'screen_'+st['id']+'_'+str(j),x,1.34,-.059,.75,.415)
        screen(node,'screen_'+st['id']+'_overhead',0,2.16,-.258,2.10,.69);screen(node,'screen_'+st['id']+'_nameplate',0,.79,.795,.96,.10)
    bpy.context.view_layer.update();tris,lo,hi=C.stats(root);file='engineering_consoles_v4.glb';_,size=C.export(root,os.path.join(out,file),max_tris=120000)
    assert tris<=120000 and size<=3000000,(tris,size)
    raw=open(os.path.join(out,file),'rb').read();j=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    unique=sum(j['accessors'][p['indices']]['count']//3 for m in j['meshes'] for p in m['primitives'])
    api['catalog']['engineering_consoles_v4']={'file':file,'triangles':unique,'instancedTriangles':tris,'bytes':size,'bounds':{'min':lo,'max':hi}}
