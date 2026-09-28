# Export de arbre.blend vers assets/arbre/arbre.glb (utilisé par ciel.js).
#
# À relancer après chaque modification de l'arbre dans Blender, depuis le
# dossier du projet :
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b arbre.blend \
#     --python assets/arbre/export_arbre.py -- "$PWD/assets/arbre/arbre.glb"
#
# Le fichier .blend n'est pas modifié. Le script :
#  - réalise les instances de feuilles (Geometry Nodes) en vrai maillage ;
#  - fait piocher à chaque feuille une case de la planche 3×3 de feuilles ;
#  - cuit une teinte d'automne par feuille dans un attribut de couleur
#    (le shader "Season" de Blender n'est pas exportable en glTF) ;
#  - exporte en .glb compressé (Draco), matériaux remplacés dans ciel.js.
import bpy, numpy as np, random, colorsys, sys
out = sys.argv[sys.argv.index("--") + 1]

o = bpy.data.objects["Tree.001"]
# Réalise les instances (feuilles) pour obtenir un vrai maillage.
tree = bpy.data.node_groups.new("RealizeAll", "GeometryNodeTree")
tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
gi = tree.nodes.new("NodeGroupInput"); go = tree.nodes.new("NodeGroupOutput")
r = tree.nodes.new("GeometryNodeRealizeInstances")
tree.links.new(gi.outputs[0], r.inputs[0]); tree.links.new(r.outputs[0], go.inputs[0])
mod = o.modifiers.new("Realize", "NODES"); mod.node_group = tree
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)

leaf_mat = [i for i, m in enumerate(me.materials) if m and "Leaves" in m.name][0]
npoly = len(me.polygons)
mat_idx = np.zeros(npoly, dtype=np.int32); me.polygons.foreach_get("material_index", mat_idx)
loop_start = np.zeros(npoly, dtype=np.int32); me.polygons.foreach_get("loop_start", loop_start)
loop_total = np.zeros(npoly, dtype=np.int32); me.polygons.foreach_get("loop_total", loop_total)
nloop = len(me.loops)
loop_vert = np.zeros(nloop, dtype=np.int32); me.loops.foreach_get("vertex_index", loop_vert)

# Regroupe les faces de feuilles par îlot connexe (une feuille = un îlot).
leaf_polys = np.nonzero(mat_idx == leaf_mat)[0]
parent = {}
def find(a):
    while parent.get(a, a) != a:
        parent[a] = parent.get(parent[a], parent[a]); a = parent[a]
    return a
for p in leaf_polys:
    vs = loop_vert[loop_start[p]:loop_start[p] + loop_total[p]]
    root = find(int(vs[0]))
    for v in vs[1:]:
        rv = find(int(v))
        if rv != root: parent[rv] = root
leaf_of_poly = {int(p): find(int(loop_vert[loop_start[p]])) for p in leaf_polys}
leaves = sorted(set(leaf_of_poly.values()))
print("LEAVES", len(leaves), "polys", len(leaf_polys))

rng = random.Random(7)
# Palette d'automne (sRGB), cohérente avec les reflets de la flaque.
palette = [(0.72, 0.30, 0.08), (0.80, 0.50, 0.12), (0.58, 0.16, 0.08), (0.85, 0.62, 0.18), (0.50, 0.24, 0.08), (0.66, 0.40, 0.10)]
cell = {}; tint = {}
for l in leaves:
    cell[l] = (rng.randrange(3), rng.randrange(3))
    c = palette[rng.randrange(len(palette))]
    k = 0.8 + rng.random() * 0.35
    tint[l] = tuple(min(1.0, x * k) for x in c)

# UV : chaque feuille pioche une case de la planche 3×3.
uv = me.uv_layers["UVMap"].data
uvs = np.zeros(nloop * 2, dtype=np.float32); uv.foreach_get("uv", uvs); uvs = uvs.reshape(-1, 2)
for p in leaf_polys:
    cx, cy = cell[leaf_of_poly[int(p)]]
    s = loop_start[p]; e = s + loop_total[p]
    uvs[s:e] = np.clip(uvs[s:e], 0.0, 1.0) / 3.0 + np.array([cx, cy], dtype=np.float32) / 3.0
uv.foreach_set("uv", uvs.ravel())
# Le calque UV doit être actif, sinon l'exporteur glTF l'ignore.
me.uv_layers.active = me.uv_layers["UVMap"]

# Couleur par feuille (blanc pour l'écorce), stockée par coin de face.
col = np.ones((nloop, 4), dtype=np.float32)
for p in leaf_polys:
    t = tint[leaf_of_poly[int(p)]]
    s = loop_start[p]; e = s + loop_total[p]
    col[s:e, :3] = t
attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
attr.data.foreach_set("color_srgb", col.ravel())
me.color_attributes.active_color = attr

# Nettoie les attributs inutiles pour alléger le fichier.
for name in ["season", "tip", "startHeight", "forward", "basePos", "height", "offsetPos"]:
    a = me.attributes.get(name)
    if a: me.attributes.remove(a)

# Matériaux simples, nommés et utilisant les UV : sans ça l'exporteur glTF
# retire les UV. Les vraies textures sont chargées par ciel.js.
tiny = bpy.data.images.new("placeholder", 4, 4)
for i, mat in enumerate(me.materials):
    name = "Leaves" if (mat and "Leaves" in mat.name) else "Bark"
    simple = bpy.data.materials.new(name)
    simple.use_nodes = True
    nt = simple.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = tiny
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    me.materials[i] = simple

obj = bpy.data.objects.new("Arbre", me)
bpy.context.scene.collection.objects.link(obj)
for ob in bpy.context.scene.objects: ob.select_set(False)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True,
    export_materials="EXPORT", export_image_format="JPEG", export_vertex_color="ACTIVE",
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_yup=True,
)
print("EXPORTED", out)

# Texture de feuilles en niveaux de gris (nervures, détails), éclaircie :
# ciel.js la teinte avec la couleur d'automne de chaque feuille.
import os
leaf_tex = next(n.image for m in bpy.data.materials if m.use_nodes and "Beech" in m.name
                for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and "_Color" in n.image.name)
w, h = leaf_tex.size
px = np.empty(w * h * 4, dtype=np.float32); leaf_tex.pixels.foreach_get(px); px = px.reshape(-1, 4)
lum = px[:, 0] * 0.299 + px[:, 1] * 0.587 + px[:, 2] * 0.114
# Normalise : les parties claires de la feuille montent vers 0.95.
lum = np.clip(lum / np.percentile(lum, 97) * 0.95, 0.0, 1.0)
gray = bpy.data.images.new("feuilles_gris", w, h)
gray.pixels.foreach_set(np.stack([lum, lum, lum, np.ones_like(lum)], axis=1).ravel())
gray.filepath_raw = os.path.join(os.path.dirname(out), "feuilles_gris.jpg")
gray.file_format = "JPEG"
gray.save()
print("GRAY", gray.filepath_raw)
