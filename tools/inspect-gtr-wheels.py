import json
import struct

path = "models/GTR+35.glb"

with open(path, "rb") as f:
    magic, version, length = struct.unpack("<4sII", f.read(12))

    if magic != b"glTF":
        raise ValueError("Not a valid GLB file")

    while f.tell() < length:
        chunk_length, chunk_type = struct.unpack("<II", f.read(8))
        data = f.read(chunk_length)

        if chunk_type == 0x4E4F534A:
            gltf = json.loads(data.decode("utf-8"))
            break

nodes = gltf.get("nodes", [])
meshes = gltf.get("meshes", [])
materials = gltf.get("materials", [])

wheel_terms = (
    "wheel", "tire", "tyre", "brake", "rim"
)

def inspect_node(index, depth=0):
    node = nodes[index]
    name = node.get("name", f"Node_{index}")
    mesh_id = node.get("mesh")

    print("  " * depth + f"[NODE {index}] {name}")

    if mesh_id is not None:
        mesh = meshes[mesh_id]
        print("  " * (depth + 1) +
              f"MESH: {mesh.get('name', mesh_id)}")

        for primitive in mesh.get("primitives", []):
            material_id = primitive.get("material")

            if material_id is not None:
                material = materials[material_id]
                print("  " * (depth + 2) +
                      f"MATERIAL: {material.get('name')}")

        print("  " * (depth + 1) +
              f"PRIMITIVES: {len(mesh.get('primitives', []))}")

    print("  " * (depth + 1) +
          f"POSITION: {node.get('translation', [0,0,0])}")

    print("  " * (depth + 1) +
          f"ROTATION: {node.get('rotation', [0,0,0,1])}")

    for child in node.get("children", []):
        inspect_node(child, depth + 1)

print("\n========== GT-R WHEEL HIERARCHY ==========\n")

for i, node in enumerate(nodes):
    name = node.get("name", "").lower()

    if any(term in name for term in wheel_terms):
        print(f"\nROOT: {node.get('name')}")
        inspect_node(i)

print("\n========== ALL MODEL MATERIALS ==========\n")

for material in materials:
    print(material.get("name", "Unnamed"))

print("\n========== INSPECTION COMPLETE ==========")
