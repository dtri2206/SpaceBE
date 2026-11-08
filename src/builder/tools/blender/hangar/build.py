"""Own, vertex-coloured HB3-inspired kit. Metres; authoring in game coordinates.
Rebuild: blender -b --factory-startup -P <this file> -- --out public/assets/models/builder/hangar
Only the named output directory is written. No edits to shared helpers or other models.
"""
import sys, os, math, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import common as C
import bpy, bmesh
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import detail

OUT = C.arg('--out', 'public/assets/models/builder/hangar')
ONLY=C.arg('--only',None)
PREVIOUS=json.load(open(os.path.join(OUT,'layout.json'),encoding='utf8'))['modules'] if ONLY else {}
STEEL=0x88969b; WHITE=0xd2d8d7; DARK=0x33434a; DECK=0x62747b; YELLOW=0xe4af29; RED=0xa93e32
CURRENT=''
def rgb(n):
    def lin(c): return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
    return tuple(lin(((n>>k)&255)/255) for k in (16,8,0))+(1,)

class Geo:
    def __init__(self): self.v=[]; self.f=[]; self.col=[]; self.surface=[]
    def solid(self, verts, faces, color):
        i=len(self.v); self.v.extend([C.G(v) for v in verts]); self.f.extend([tuple(i+j for j in f) for f in faces]); self.col.extend([rgb(color)]*len(faces));self.surface.extend([.6 if color in (STEEL,DECK) else .28]*len(faces))
    def box(self, size, p, col=STEEL):
        x,y,z=p; a,b,c=[n/2 for n in size]
        self.solid([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],col)
    def beam(self,a,b,w=.08,col=STEEL,depth=None):
        a,b=Vector(a),Vector(b); d=(b-a).normalized(); u=d.cross(Vector((0,1,0)))
        if u.length<.001: u=d.cross(Vector((0,0,1)))
        u.normalize(); v=d.cross(u).normalized(); u*=w/2; v*=(depth or w)/2
        self.solid([tuple(p+u*s+v*t) for p in (a,b) for s,t in ((-1,-1),(1,-1),(1,1),(-1,1))],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],col)
    def ibeam(self,a,b,w=.3,col=STEEL,lod=False):
        if lod: return self.beam(a,b,w,col)
        # Continuous W profile: visible web, flanges and tiny chamfers at outer tips.
        self.profile(a,b,[(-.5,-.48),(-.48,-.5),(.48,-.5),(.5,-.48),(.5,-.38),(.065,-.38),(.065,.38),(.5,.38),(.5,.48),(.48,.5),(-.48,.5),(-.5,.48),(-.5,.38),(-.065,.38),(-.065,-.38),(-.5,-.38)],w,col)
    def profile(self,a,b,shape,w,col=STEEL):
        a,b=Vector(a),Vector(b); d=(b-a).normalized(); u=d.cross(Vector((0,1,0)))
        if u.length<.001:u=d.cross(Vector((0,0,1)))
        u.normalize(); v=d.cross(u).normalized(); n=len(shape)
        verts=[tuple(p+u*x*w+v*y*w) for p in (a,b) for x,y in shape]
        self.solid(verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],col)
    def angle(self,a,b,w=.14,col=STEEL):
        self.profile(a,b,[(-.5,-.5),(.5,-.5),(.5,-.34),(-.34,-.34),(-.34,.5),(-.5,.5)],w,col)
    def channel(self,a,b,w=.18,col=DARK):
        self.profile(a,b,[(-.5,-.5),(.5,-.5),(.5,-.34),(-.34,-.34),(-.34,.34),(.5,.34),(.5,.5),(-.5,.5)],w,col)
    def pipe(self,a,b,r=.06,col=RED,segments=8):
        self.profile(a,b,[(math.cos(i*math.tau/segments),math.sin(i*math.tau/segments)) for i in range(segments)],r,col)
    def gusset(self,p,side=0):
        x,y,z=p
        self.box((.52,.5,.035) if side==0 else (.035,.5,.52),p,DARK)
        for dx in (-.15,.15):
            for dy in (-.15,.15):
                q=(x+dx,y+dy,z-.035) if side==0 else (x-.035,y+dy,z+dx)
                self.box((.065,.065,.05) if side==0 else (.05,.065,.065),q,WHITE)
    def grating(self,x0,x1,z0,z1,y=0,step=.18):
        for i in range(math.ceil((z1-z0)/step)+1):
            z=min(z1,z0+i*step);self.box((x1-x0,.065,.018),((x0+x1)/2,y-.035,z),STEEL)
        for i in range(math.ceil((x1-x0)/.6)+1):
            x=min(x1,x0+i*.6);self.box((.022,.035,z1-z0),(x,y-.02,(z0+z1)/2),WHITE)
    def rail(self,a,b):
        a,b=Vector(a),Vector(b); n=max(1,math.ceil((b-a).length/(3 if CURRENT.endswith('_lod') else 1.5)))
        for i in range(n+1):
            p=a.lerp(b,i/n); self.beam(p,p+Vector((0,1.1,0)),.045,WHITE)
        for h in (.55,1.1): self.beam(a+Vector((0,h,0)),b+Vector((0,h,0)),.04,WHITE)
        self.beam(a+Vector((0,.075,0)),b+Vector((0,.075,0)),.06,YELLOW,.15)
    def mesh(self,name,parent,emissive=False):
        me=bpy.data.meshes.new('m_'+name); me.from_pydata(self.v,[],self.f); me.update()
        colors=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
        surface=me.color_attributes.new(name='Surface',type='FLOAT_COLOR',domain='CORNER')
        for p,c in zip(me.polygons,self.col):
            # Subtle reproducible face grime; AO is ray baked separately, never faked by this tint.
            tint=.86+.14*(.5+.5*math.sin(p.index*12.9898))
            c=tuple(v*tint for v in c[:3])+(1,)
            for k in p.loop_indices:
                colors.data[k].color=c
                surface.data[k].color=(self.surface[p.index],.65,0,1)
        bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bmesh.ops.triangulate(bm,faces=bm.faces); bm.to_mesh(me); bm.free()
        mat=C.mat('hangar_lamp' if emissive else 'hangar_steel',(1,1,1),.35,.56,emissive=(1,.84,.57) if emissive else None)
        mat.use_backface_culling=True
        if emissive:
            mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.85,.94,1,1)
            mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=8
        if not mat.node_tree.nodes.get('Vertex paint'):
            vc=mat.node_tree.nodes.new('ShaderNodeVertexColor'); vc.name='Vertex paint'; vc.layer_name='Color'; mat.node_tree.links.new(vc.outputs['Color'],mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
        me.materials.append(mat); ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.parent=parent; return ob

def start(name):
    global CURRENT
    CURRENT=name; C.reset(); C._mats.clear(); return C.root(name)
def marker(root,name,p=(0,0,0)):
    o=C.group(name,root); o.location=C.G(p); return o
catalog={}
def save(name,root,kit=False):
    if ONLY and name not in ONLY.split(','):
        catalog[name]=PREVIOUS[name];return
    file=('kit/' if kit else '')+name+'.glb'; bpy.context.view_layer.update()
    for ob in root.children_recursive:
        if ob.type=='MESH': detail.finish(ob,name+'_'+ob.name,OUT,'--bake' in sys.argv)
    tri,lo,hi=C.stats(root); assert tri<=60000,(name,tri)
    _,size=C.export(root,os.path.join(OUT,file)); assert size<=4*1024*1024
    catalog[name]={'file':file,'triangles':tri,'bytes':size,'bounds':{'min':lo,'max':hi}}

def tower(lod=False):
    g=Geo()
    for x in (-3,3):
        for z in (-3,3):
            g.ibeam((x,0,z),(x,6,z),.32)
            if not lod:
                for y in (.12,5.88):
                    g.box((.6,.12,.6),(x,y,z),DARK)
                    for dx in (-.2,.2):
                        for dz in (-.2,.2): g.box((.065,.045,.065),(x+dx,y+.08,z+dz),WHITE)
    for y in (0,6):
        for z in (-3,3): g.ibeam((-3,y,z),(3,y,z),.27,lod=lod)
        for x in (-3,3): g.ibeam((x,y,-3),(x,y,3),.27,lod=lod)
    for z in (-3,3):
        if lod:g.beam((-3,.25,z),(3,5.75,z),.16);g.beam((3,.25,z),(-3,5.75,z),.16)
        else:
            for dz in (-.06,.06):
                g.angle((-3,.25,z+dz),(3,5.75,z+dz));g.angle((3,.25,z+dz),(-3,5.75,z+dz))
            for x in (-3,3):
                for y in (.3,5.7):g.gusset((x,y,z))
    for x in (-3,3):
        if lod:g.beam((x,.25,-3),(x,5.75,3),.16);g.beam((x,.25,3),(x,5.75,-3),.16)
        else:
            for dx in (-.06,.06):
                g.angle((x+dx,.25,-3),(x+dx,5.75,3));g.angle((x+dx,.25,3),(x+dx,5.75,-3))
            for z in (-3,3):
                for y in (.3,5.7):g.gusset((x,y,z),1)
            for y in (1.5,3,4.5):g.box((.35,.035,.35),(x,y,-3),DARK)
    return g

def wall(lod=False):
    g=Geo(); g.box((5.5,6,.14),(0,3,0),0xaab3b1)
    if lod:
        for y in (.2,3,5.8): g.box((5.5,.13,.18),(0,y,-.18),DARK)
    if not lod:
        for x in range(-10,11): g.box((.035,6,.06),(x*.25,3,-.1),0xb9c1bd)
        for y in (.2,3,5.8): g.box((5.5,.13,.18),(0,y,-.18),DARK)
        g.box((4.6,.5,.03),(0,4.7,-.11),0x526b77)
        for x in (-2,-1,0,1,2): g.box((.04,.6,.08),(x,4.7,-.15),WHITE)
    return g

def truss(lod=False):
    g=Geo()
    for y in (0,2):
        for z in (-.65,.65): g.ibeam((-3,y,z),(3,y,z),.2,lod=lod)
    if lod:
        for z in (-.65,.65): g.beam((-3,0,z),(3,2,z),.1)
        g.beam((-3,2,-.65),(3,2,.65),.07)
        return g
    for i in range(6):
        x=-3+i*(2 if lod else 1); step=2 if lod else 1
        for z in (-.65,.65): g.angle((x,0,z),(x+step,2,z),.1); g.angle((x,2,z),(x+step,0,z),.1)
        if not lod: g.beam((x,2,-.65),(x+step,2,.65),.065)
    return g

def stair():
    g=Geo()
    for i in range(18):
        y=(i+1)/6;z=-i*.25
        for dz in (-.09,0,.09):g.box((1.4,.04,.025),(0,y,z+dz),STEEL)
        g.box((1.4,.045,.03),(0,y+.01,z+.12),YELLOW)
    for x in (-.72,.72):
        g.channel((x,0,.2),(x,3,-4.5),.2); g.rail((x,0,.2),(x,3,-4.5))
    return g

def catwalk():
    g=Geo(); g.grating(-3,3,-3,3)
    g.rail((-2.9,0,-3),(-2.9,0,3)); g.rail((2.9,0,-3),(2.9,0,3))
    for z in (-2,0,2): g.ibeam((-3,-.45,z),(3,-.45,z),.28)
    for x in (-3,0,3):g.ibeam((x,-.32,-3),(x,-.32,3),.24)
    return g

if '--v5' in sys.argv:
    # v5 parts: blender -b --factory-startup -P build.py -- --v5 <decks|access|stage> [--bake] --out public/assets/models/builder/hangar/v5
    # Each part script owns its own GLBs and fragment JSON; it never writes layout.json.
    import importlib
    import detail_v4 as detail
    importlib.import_module('v5_'+sys.argv[sys.argv.index('--v5')+1]).build(globals())
    sys.exit(0)

if '--v4' in sys.argv:
    import detail_v4 as detail
    import additions_v4
    additions_v4.build(globals())
    sys.exit(0)

if '--v3' in sys.argv:
    import additions
    additions.build(globals())
    sys.exit(0)

for name,fn in [('tower_bay',tower),('wall_bay',wall),('roof_truss',truss)]:
    for low in (False,True):
        ident=name+('_lod' if low else ''); root=start(ident); fn(low).mesh('body',root); save(ident,root,True)
for name,fn in [('stair_run',stair),('catwalk',catwalk)]:
    root=start(name); fn().mesh('body',root); save(name,root,True)
root=start('caged_ladder'); g=Geo()
for x in (-.33,.33):g.channel((x,0,0),(x,6,0),.07,WHITE)
for i in range(20):g.pipe((-.33,i*.3,0),(.33,i*.3,0),.035,STEEL)
for y in (1.8,3.2,4.6,5.9):
    for i in range(12):
        a=i*math.pi/12;b=(i+1)*math.pi/12
        g.beam((.55*math.cos(a),y,-.55*math.sin(a)),(.55*math.cos(b),y,-.55*math.sin(b)),.025,WHITE)
for a in (0,math.pi/4,math.pi/2,3*math.pi/4,math.pi):g.beam((.55*math.cos(a),1.8,-.55*math.sin(a)),(.55*math.cos(a),6,-.55*math.sin(a)),.025,WHITE)
g.mesh('body',root);save('caged_ladder',root,True)
for name in ('standpipe','cable_tray','lamp','floor_tile','girder','crate','cart','scissor_lift','safety_stripe'):
    root=start(name); g=Geo()
    if name=='standpipe':
        g.pipe((0,0,0),(0,6,0),.12,RED)
        for y in (1,3,5): g.box((.26,.12,.3),(0,y,0),DARK)
        g.pipe((0,1,0),(.45,1,0),.1,RED); g.box((.07,.35,.35),(.46,1,0),RED)
    elif name=='cable_tray':
        for z in (-.35,.35): g.box((6,.18,.04),(0,0,z),WHITE)
        for i in range(20): g.box((.04,.025,.7),(-3+i*.3,-.08,0),STEEL)
        for z in (-.2,0,.2): g.box((6,.04,.06),(0,-.03,z),DARK)
    elif name=='lamp':
        g.box((1.8,.12,.5),(0,0,0),DARK);g.mesh('housing',root);g=Geo()
        for x in (-.55,0,.55):g.pipe((x,-.06,0),(x,-.09,0),.18,WHITE,12)
    elif name=='floor_tile':
        g.box((5.5,.2,5.5),(0,-.1,0),0x868b88)
        for x in (-2.74,2.74): g.box((.018,.002,5.5),(x,.002,0),DARK)
    elif name=='girder': g.ibeam((-3,0,0),(3,0,0),.45)
    elif name=='safety_stripe':
        g.box((2,.008,.25),(0,.004,0),YELLOW)
        for x in (-.8,-.4,0,.4,.8): g.box((.17,.005,.25),(x,.01,0),DARK)
    elif name in ('crate','cart'):
        g.box((1.25,.9,.8),(0,.65,0),0x67776b)
        for x in (-.5,.5): g.box((.07,1.1,.86),(x,.65,0),DARK)
        if name=='cart':
            for x in (-.5,.5):
                for z in (-.3,.3): g.box((.18,.25,.18),(x,.125,z),DARK)
            g.rail((-.6,0,.4),(.6,0,.4))
    else:
        g.box((1.4,.3,2.4),(0,.3,0),YELLOW); g.box((1.4,.15,2.4),(0,3,0),YELLOW)
        for x in (-.55,.55):
            for y in (.5,1.7):
                g.beam((x,y,-.9),(x,y+1.2,.9),.12,STEEL); g.beam((x,y,.9),(x,y+1.2,-.9),.12,STEEL)
        g.rail((-.7,3,-1.2),(-.7,3,1.2)); g.rail((.7,3,-1.2),(.7,3,1.2))
    g.mesh('body',root,name=='lamp'); save(name,root,True)

# Positive-X half; the opposite side is rotated 180 degrees about Y, never mirrored.
def platform(lod=False):
    root=start('platform_half_lod' if lod else 'platform_half'); marker(root,'attach_slide'); g=Geo()
    # Open grating follows the approved taper; no slab conceals the deep beam grid.
    for i in range(17 if lod else 65):
        z=-5.9+i*11.8/(16 if lod else 64);begin=max(2.5,2.5+(abs(z)-2.5)*11.5/3.5)
        g.box((14-begin,.075,.025),((14+begin)/2,-.045,z),STEEL)
    for x in [2.5+i*(1.5 if lod else .6) for i in range(8 if lod else 20)]:
        w=2.5+3.5*(x-2.5)/11.5;g.box((.025,.04,w*2),(x,-.025,0),WHITE)
    for s in (-1,1):
        g.rail((.1,0,s*2.5),(2.5,0,s*2.5)); g.rail((2.5,0,s*2.5),(13.9,0,s*5.95))
    for z in (-5,-2.8,2.8,5): g.ibeam((2.5,-.6,z*.4),(14,-.6,z),.45,lod=lod)
    for x in (3,6,9,12):
        w=2.4+3.4*(x-2.5)/11.5;g.ibeam((x,-.6,-w),(x,-.6,w),.3,lod=lod)
    # Curved underside ring girders and fan ribs create the vault when looking up.
    for radius in (() if lod else (3.1,4.6,6.1)):
        for i in range(20):
            a=-1.4+i*2.8/20;b=a+2.8/20
            g.ibeam((radius*math.cos(a),-.85,radius*math.sin(a)),(radius*math.cos(b),-.85,radius*math.sin(b)),.24,DARK)
    for i in range(0 if lod else 11):
        a=-1.35+i*2.7/10
        g.ibeam((2.5,-.85,2.5*math.sin(a)),(8,-1.2,5.5*math.sin(a)),.32)
        g.angle((2.5,-.65,2.5*math.sin(a)),(8,-1.4,5.5*math.sin(a)),.11)
    g.mesh('body',root)
    for key,r0 in C.RADIUS.items():
        r=r0+.25; cut=Geo(); zs=sorted(set([-2.5,2.5]+[r*math.sin(-math.pi/2+i*math.pi/32) for i in range(33)]))
        if lod:
            boundary=[(math.sqrt(max(0,r*r-z*z)) if abs(z)<r else 0,z) for z in zs]+[(2.5,2.5),(2.5,-2.5)]
            n=len(boundary);verts=[(x,y,z) for y in (-.3,0) for x,z in boundary]
            cut.solid(verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],DECK)
        for a,b in zip(zs,zs[1:]):
            xa=math.sqrt(max(0,r*r-a*a)) if abs(a)<r else 0; xb=math.sqrt(max(0,r*r-b*b)) if abs(b)<r else 0
            # Closed extruded trapezoids, consistent normals repaired before export.
            verts=[(x,y,z) for y in (-.3,0) for x,z in ((xa,a),(2.5,a),(2.5,b),(xb,b))]
            if not lod:cut.solid(verts,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],DECK)
            cut.beam((xa,.04,a),(xb,.04,b),.11,YELLOW,.12)
            if not lod:cut.beam((xa,-.18,a),(xb,-.18,b),.07,YELLOW,.35)
        for i in range(0 if lod else 9):
            a=-1.35+i*2.7/8;x=r*math.cos(a);z=r*math.sin(a)
            cut.box((.26,.035,.18),(x+.15,.025,z),YELLOW)
        cut.mesh('slot_cut__'+key,root)
    save('platform_half_lod' if lod else 'platform_half',root)

platform(False)
platform(True)

root=start('mobile_launcher'); g=Geo()
for s in (-1,1):
    g.box((5,2,16),(s*5.5,6,0),DECK); g.box((6,2,5),(0,6,s*5.5),DECK)
    for x in (-6,6): g.ibeam((x,0,s*6),(x,5,s*6),.8); g.box((2,.4,2),(x,.2,s*6),DARK)
    for z in (-7.9,7.9):
        for x in range(-7,8,2): g.box((.08,1.8,.04),(x,6,z),WHITE)
    g.rail((-8,7,s*8),(8,7,s*8))
for x in (-8,8): g.rail((x,7,-8),(x,7,8))
for x in (-2.5,2.5):
    for z in (-2.5,2.5): g.box((.5,.6,.5),(x,7.3,z),YELLOW)
g.mesh('body',root); marker(root,'attach_deck',(0,7,0)); save('mobile_launcher',root)

root=start('elevator'); g=Geo()
for x in (-1.4,1.4):
    for z in (-1.4,1.4): g.ibeam((x,0,z),(x,74,z),.17)
for y in [0]+[11+6*i for i in range(11)]:
    for x in (-1.4,1.4): g.beam((x,y,-1.4),(x,y,1.4),.12)
    g.beam((-1.4,y,-1.4),(1.4,y,-1.4),.12)
    g.beam((-1.4,y+2.7,1.4),(1.4,y+2.7,1.4),.12,YELLOW)
    # Side returns define a 1.6 m opening onto +Z at every stop.
    for x in (-1.1,1.1): g.box((.6,1.1,.06),(x,y+.55,1.4),YELLOW)
for y in range(0,72,3):
    g.beam((-1.4,y,-1.4),(1.4,y+3,-1.4),.07)
    g.beam((1.4,y,-1.4),(-1.4,y+3,-1.4),.07)
g.mesh('shaft',root); cab=marker(root,'pose_cab'); g=Geo(); g.box((2.4,.18,2.4),(0,-.09,0),DECK)
for x in (-1.2,1.2):
    g.rail((x,0,-1.2),(x,0,1.2)); g.beam((x,0,-1.2),(x,2.6,-1.2),.07,YELLOW); g.beam((x,0,1.2),(x,2.6,1.2),.07,YELLOW)
    for y in (.3,.6,.9,1.2,1.5,1.8,2.1,2.4): g.beam((x,y,-1.2),(x,y,1.2),.015,STEEL)
g.rail((-1.2,0,-1.2),(1.2,0,-1.2)); g.box((2.4,.1,2.4),(0,2.6,0),DECK); g.mesh('cab',cab); save('elevator',root)

root=start('crew_arm'); marker(root,'attach_root'); g=Geo()
g.box((4,.16,1.5),(2,-.08,0),DECK)
for s in (-1,1): g.rail((0,0,s*.75),(4,0,s*.75)); g.beam((0,-.5,s*.65),(4,-.2,s*.65),.14)
for s in (-1,1):
    g.channel((0,-.25,s*.65),(4,-.25,s*.65),.25)
    for i in range(4):g.angle((i,-.5,s*.65),(i+1,-.1,s*.65),.09)
g.mesh('fixed',root); ext=marker(root,'extend',(4,0,0)); g=Geo(); g.box((4,.16,1.5),(0,-.09,0),DECK)
for s in (-1,1):
    g.rail((-2,0,s*.75),(2,0,s*.75)); g.box((1.5,2.3,.07),(1.25,1.15,s*.78),WHITE)
g.box((1.5,.08,1.65),(1.25,2.35,0),WHITE); g.mesh('white_room',ext); marker(ext,'attach_tip',(2,0,0)); save('crew_arm',root)

root=start('crane_bridge'); g=Geo()
for z in (-1.5,1.5):
    g.ibeam((-20,0,z),(20,0,z),1.1,YELLOW); g.rail((-20,.6,z),(20,.6,z))
for x in (-19,19): g.box((2,1.2,5),(x,.2,0),YELLOW)
g.mesh('bridge',root); trolley=marker(root,'pose_trolley'); g=Geo(); g.box((3,.8,4),(0,.7,0),YELLOW); g.mesh('trolley',trolley)
hook=marker(trolley,'pose_hook',(0,-5,0)); g=Geo(); g.box((.8,.8,.5),(0,0,0),YELLOW)
for a in range(0,240,30):
    a,b=math.radians(a),math.radians(a+30); g.beam((.4*math.cos(a),-.7+.4*math.sin(a),0),(.4*math.cos(b),-.7+.4*math.sin(b),0),.16,DARK)
g.mesh('hook',hook); save('crane_bridge',root)

root=start('high_bay_door'); door=marker(root,'pose_door'); g=Geo()
for i in range(7):
    g.box((17.8,9.9,.3),(0,5+i*10,0),0x9ea9aa)
    for x in range(-8,9,2): g.box((.07,9.8,.08),(x,5+i*10,-.2),WHITE)
    g.box((18,.15,.5),(0,i*10,-.1),DARK)
g.mesh('panels',door); save('high_bay_door',root)

root=start('console_desk'); g=Geo(); g.box((1.6,.9,.7),(0,.45,0),DARK); g.box((1.8,.08,.9),(0,.94,0),DECK)
for x in (-.43,.43):
    g.box((.72,.48,.06),(x,1.35,.2),DARK); g.box((.65,.4,.01),(x,1.35,.16),0x254d60); g.beam((x,.98,.22),(x,1.2,.22),.06)
g.mesh('body',root); save('console_desk',root)

# Every placement and integration dimension is data, not duplicated in the viewer.
layout={'version':1,'units':'metres','up':'+Y','entrance':'-Z','ML_TOP':7,'hallBounds':{'min':[-22,0,-22],'max':[22,80,22]},'consoleArea':{'min':[-10,0,-20],'max':[10,3,-12]},'playerEntry':[0,1.7,-20],'radii':C.RADIUS,'modules':catalog,'placements':[],'levels':[],'colliders':[]}
def place(module,p,rot=0,scale=(1,1,1),**extra):
    ident=module+'_'+str(len(layout['placements'])); layout['placements'].append(dict(id=ident,module=module,position=list(p),rotation=[0,rot,0],scale=list(scale),**extra)); return ident
def collider(kind,p,size,**extra): layout['colliders'].append(dict(kind=kind,center=list(p),size=list(size),**extra))
for x in (-17,17):
    for z in (-6,0,6):
        for y in range(0,72,6): place('tower_bay',(x,y,z),lod='tower_bay_lod')
    for z in (-9,9):
        for y in range(0,72,6): place('standpipe',(x+2.5,y,z))
for ix in range(8):
    for iz in range(8): place('floor_tile',(-19.25+ix*5.5,0,-19.25+iz*5.5))
for side in (-1,1):
    for a in range(8):
        for y in range(0,78,6): place('wall_bay',(side*22,y,-19.25+a*5.5),90 if side==1 else -90,lod='wall_bay_lod')
for x in [-19.25+i*5.5 for i in range(8)]:
    for y in range(0,78,6): place('wall_bay',(x,y,22),0,lod='wall_bay_lod')
for s in (-1,1):
    for j in range(3):
        for y in range(0,78,6): place('wall_bay',(s*(9+13/6+j*13/3),y,-22),180,(13/16.5,1,1),lod='wall_bay_lod')
for z in (-18,-9,0,9,18):
    for x in (-18,-12,-6,0,6,12,18): place('roof_truss',(x,77,z),lod='roof_truss_lod')
for i in range(11):
    y=11+i*6; halves=[]
    for s in (-1,1):
        halves.append(place('platform_half',(0,y,0),0 if s==1 else 180,dynamic='platform',level=i,side=s,lod='platform_half_lod'))
        for z in (-6,0,6): place('catwalk',(s*17,y,z))
        place('lamp',(s*8,y-.85,-4)); place('lamp',(s*8,y-.85,4)); place('cable_tray',(s*17,y-.6,0))
    layout['levels'].append({'label':f'{i+1:02d}','y':y,'halves':halves,'slideAxisLocal':[1,0,0],'closed':{'s':0,'m':0,'l':0},'retracted':4,'cutoutClearance':.25})
    place('catwalk',(-17,y,-9.5),0,(.4,1,.3))
    collider('elevator_landing',(-17,y-.12,-9.5),(2.4,.24,1.8))
    for s in (-1,1):
        for x in (3.9375,6.8125,9.6875,12.5625):
            width=2.5+3.5*(x+1.4375-2.5)/11.5
            collider('platform',(s*x,y-.15,0),(2.875,.3,width*2),level=i,side=s,dynamic='platform')
    if i<10:
        for j in (0,1): place('stair_run',(-19+j*1.6,y+j*3,-10 if j==0 else -14.5),0 if j==0 else 180)
        place('catwalk',(-18.2,y+3,-14.7),0,(.55,1,.23))
        collider('stairs',(-18.2,y+3,-12.25),(3.2,6,4.5),decorative=True)
for j in range(4):
    place('stair_run',(-19+(j%2)*1.6,j*2.75,-10 if j%2==0 else -14.5),0 if j%2==0 else 180,(1,2.75/3,1))
    if j%2==0: place('catwalk',(-18.2,(j+1)*2.75,-14.7),0,(.55,1,.23))
collider('stairs',(-18.2,5.5,-12.25),(3.2,11,4.5),decorative=True)
place('elevator',(-17,0,-11),dynamic='elevator'); layout['elevator']={'position':[-17,0,-11],'stops':[0]+[l['y'] for l in layout['levels']],'cabNode':'pose_cab','doorFaces':'+Z'}
place('mobile_launcher',(0,0,0)); place('crew_arm',(-8,35,0),dynamic='crewArm'); place('crane_bridge',(0,75,0),dynamic='crane'); place('high_bay_door',(0,0,-22),dynamic='door')
layout['crewArm']={'rootX':-8,'direction':[1,0,0],'length':6,'extensionRange':[0,2],'width':1.5,'hatchHeightIsAbsolute':True}
for x in (-5,5):
    for z in range(-21,-8,2): place('girder',(x,.02,z),90,(.34,.12,.35))
for x in (-10.5,10.5):
    for z in range(-20,-9,2): place('safety_stripe',(x,0,z),90)
for i in range(4):
    place('crate',(12+i*2,0,17)); place('cart',(-12-i*2,0,17))
place('scissor_lift',(12,0,-10))
for z in (-18,0,18):
    for x in (-12,0,12): place('lamp',(x,76,z))
collider('floor',(0,-.1,0),(44,.2,44))
for x in (-22,22): collider('wall',(x,40,0),(.3,80,44))
collider('wall',(0,40,22),(44,80,.3))
for x in (-15.5,15.5): collider('wall',(x,40,-22),(13,80,.3))
for x in (-17,17): collider('tower',(x,37,0),(6,74,18))
for s in (-1,1): collider('ml',(s*5.5,3.5,0),(5,7,16)); collider('ml',(0,3.5,s*5.5),(6,7,5))
collider('door',(0,35,-22),(18,70,.3),dynamic='door')
for y in range(0,30,6):place('caged_ladder',(20,y,8))
os.makedirs(OUT,exist_ok=True)
with open(os.path.join(OUT,'layout.json'),'w',encoding='utf8') as f: json.dump(layout,f,indent=2)
print('[hangar] DONE',len(catalog),'models',len(layout['placements']),'placements')
