"""Hangar-only UV/PBR bake. No shared helper mutations. One CPU bake worker process."""
import bpy, os, math
from mathutils import Vector

HERE = os.path.dirname(__file__)

def texture(nodes, links, path, uv, noncolor=False):
    t=nodes.new('ShaderNodeTexImage'); t.image=bpy.data.images.load(path,check_existing=True)
    if 'nor_gl' in path:
        t.image.scale(512,512)
        t.image.filepath_raw=path.replace('_1k.jpg','_512_v4.jpg');t.image.file_format='JPEG';t.image.save()
    if noncolor: t.image.colorspace_settings.name='Non-Color'
    links.new(uv.outputs['UV'],t.inputs['Vector']); return t

def finish(ob, ident, out, bake):
    """Bake real ray AO and tinted CC0 surface into colour and ORM atlases.
    Detail UVs retain texel density for the original 1K OpenGL normal map.
    """
    me=ob.data; concrete=ident.startswith(('floor_tile','console_island_v4')); lamp=ident.startswith('lamp')
    if lamp: return
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob
    # Box projection in metres, independent of atlas packing.
    uv=me.uv_layers.new(name='Detail')
    for p in me.polygons:
        axis=max(range(3),key=lambda i:abs(p.normal[i])); axes=[i for i in range(3) if i!=axis]
        for k in p.loop_indices:
            v=me.vertices[me.loops[k].vertex_index].co
            uv.data[k].uv=(v[axes[0]]/(5.5 if concrete else 2),v[axes[1]]/(5.5 if concrete else 2))
    me.uv_layers.new(name='Atlas'); me.uv_layers.active_index=1
    me.uv_layers['Atlas'].active_render=True
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70),island_margin=.008)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat=bpy.data.materials.new('hangar_v4_'+ident); mat.use_nodes=True;mat.use_backface_culling=True; me.materials.clear(); me.materials.append(mat)
    n=mat.node_tree.nodes; l=mat.node_tree.links; n.clear()
    output=n.new('ShaderNodeOutputMaterial'); emission=n.new('ShaderNodeEmission'); l.new(emission.outputs[0],output.inputs['Surface'])
    detail=n.new('ShaderNodeUVMap'); detail.uv_map='Detail'
    atlas=n.new('ShaderNodeUVMap'); atlas.uv_map='Atlas'
    source='hangar_concrete_floor' if concrete else 'blue_metal_plate'
    path=lambda suffix:os.path.join(HERE,'textures',source+'_'+suffix+'_1k.jpg')
    diff=texture(n,l,path('diff'),detail); rough=texture(n,l,path('rough'),detail,True)
    if '_far_' in ident:
        # Own prefiltered grating tile: averaged dark holes + galvanized bearing bars.
        # Only a faint low-frequency grid survives; it is opaque and mipmaps to its mean.
        im=bpy.data.images.get('grating_average_v4') or bpy.data.images.new('grating_average_v4',width=64,height=64,alpha=False)
        pixels=[]
        for y in range(64):
            for x in range(64):
                v=.56+.012*(math.cos(x*math.tau/16)+math.cos(y*math.tau/16))
                pixels.extend((v,v*1.025,v*1.03,1))
        im.pixels.foreach_set(pixels);im.filepath_raw=os.path.abspath(os.path.join(out,'textures','grating_average_v4.jpg'));im.file_format='JPEG';im.save()
        diff.image=im
    normal=texture(n,l,path('nor_gl'),detail,True)
    vc=n.new('ShaderNodeVertexColor'); vc.layer_name='Color'
    ao=n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value=.75; ao.samples=16
    mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
    l.new(vc.outputs['Color'],mix.inputs[1]); l.new(diff.outputs['Color'],mix.inputs[2])
    # Lift the very dark bare-metal scan for painted surfaces, keeping its scratches.
    tint=n.new('ShaderNodeMixRGB'); tint.blend_type='MIX'; tint.inputs[0].default_value=.27 if not concrete else .65
    l.new(vc.outputs['Color'],tint.inputs[1]); l.new(mix.outputs[0],tint.inputs[2])
    shaded=n.new('ShaderNodeMixRGB'); shaded.blend_type='MULTIPLY'; shaded.inputs[0].default_value=1
    l.new(tint.outputs[0],shaded.inputs[1]); l.new(ao.outputs['Color'],shaded.inputs[2])
    # Roughness .48-.80; paint metalness .28, concrete .0. ORM is linear.
    r=n.new('ShaderNodeMapRange'); r.inputs['To Min'].default_value=.48; r.inputs['To Max'].default_value=.8
    l.new(rough.outputs[0],r.inputs['Value'])
    orm=n.new('ShaderNodeCombineXYZ'); l.new(ao.outputs['AO'],orm.inputs['X']); l.new(r.outputs[0],orm.inputs['Y']); orm.inputs['Z'].default_value=0 if concrete else .28
    if not concrete:
        surface=n.new('ShaderNodeVertexColor');surface.layer_name='Surface'
        separate=n.new('ShaderNodeSeparateColor');l.new(surface.outputs['Color'],separate.inputs[0]);l.new(separate.outputs['Red'],orm.inputs['Z'])
    scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=8
    scene.render.threads_mode='FIXED'; scene.render.threads=4; scene.render.bake.margin=4
    scene.render.bake.use_clear=True
    size=1024 if ident in ('platform_half_body','tower_bay_body') else 512
    os.makedirs(os.path.join(out,'textures'),exist_ok=True)
    baked=[]
    target=n.new('ShaderNodeTexImage')
    for label,socket in [('color',shaded.outputs[0]),('orm',orm.outputs[0])]:
        file=os.path.abspath(os.path.join(out,'textures',ident+'_'+label+'.jpg'))
        if bake or not os.path.exists(file):
            im=bpy.data.images.new(ident+'_'+label,width=size,height=size,alpha=False)
            if label=='orm': im.colorspace_settings.name='Non-Color'
            target.image=im; n.active=target; l.new(socket,emission.inputs['Color'])
            bpy.ops.object.bake(type='EMIT')
            im.filepath_raw=file; im.file_format='JPEG'; im.save()
        else: im=bpy.data.images.load(file,check_existing=True)
        baked.append(im)
    n.remove(target); n.remove(emission)
    bsdf=n.new('ShaderNodeBsdfPrincipled'); l.new(bsdf.outputs[0],output.inputs['Surface'])
    color=n.new('ShaderNodeTexImage'); color.image=baked[0]; l.new(atlas.outputs[0],color.inputs['Vector']); l.new(color.outputs[0],bsdf.inputs['Base Color'])
    packed=n.new('ShaderNodeTexImage'); packed.image=baked[1]; packed.image.colorspace_settings.name='Non-Color'; l.new(atlas.outputs[0],packed.inputs['Vector'])
    split=n.new('ShaderNodeSeparateColor'); l.new(packed.outputs[0],split.inputs[0]); l.new(split.outputs['Green'],bsdf.inputs['Roughness']); l.new(split.outputs['Blue'],bsdf.inputs['Metallic'])
    # glTF exporter recognizes this official settings group as the occlusion input.
    group=bpy.data.node_groups.get('glTF Material Output') or bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
    if not list(group.interface.items_tree): group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    settings=n.new('ShaderNodeGroup'); settings.node_tree=group; l.new(split.outputs['Red'],settings.inputs['Occlusion'])
    nm=n.new('ShaderNodeNormalMap'); nm.uv_map='Detail'; nm.inputs['Strength'].default_value=.22 if not concrete else .45
    l.new(normal.outputs[0],nm.inputs['Color']); l.new(nm.outputs[0],bsdf.inputs['Normal'])
    # Colour atlas already includes colour attributes; prevent a second multiplication on export.
    me.color_attributes.remove(me.color_attributes['Color'])
    me.color_attributes.remove(me.color_attributes['Surface'])
    ob.select_set(False)
