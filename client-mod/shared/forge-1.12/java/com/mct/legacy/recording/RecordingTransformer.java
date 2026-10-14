package com.mct.legacy.recording;

import net.minecraft.launchwrapper.IClassTransformer;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.InsnList;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.VarInsnNode;

/** Fixed 1.12.2 MCP/SRG/obfuscated mappings, with no changes to framebuffer behavior. */
public final class RecordingTransformer implements IClassTransformer {
    private static final String TARGET = "net.minecraft.client.shader.Framebuffer";
    private static final String HOOK = "com/mct/legacy/RecordingFrames";

    @Override public byte[] transform(String name, String transformedName, byte[] bytes) {
        if (bytes == null || (!TARGET.equals(transformedName) && !TARGET.equals(name))) return bytes;
        ClassNode node = new ClassNode();
        new ClassReader(bytes).accept(node, 0);
        MethodNode present = null;
        for (MethodNode method : node.methods) {
            if (!"(II)V".equals(method.desc)) continue;
            if ("framebufferRender".equals(method.name) || "func_147615_c".equals(method.name)
                    || ("bvd".equals(node.name) && "c".equals(method.name))) {
                if (present != null) throw new IllegalStateException("Ambiguous 1.12.2 framebuffer presentation hook");
                present = method;
            }
        }
        if (present == null) throw new IllegalStateException("Missing 1.12.2 framebuffer presentation hook");
        for (AbstractInsnNode instruction = present.instructions.getFirst(); instruction != null; instruction = instruction.getNext()) {
            if (instruction instanceof MethodInsnNode) {
                MethodInsnNode call = (MethodInsnNode) instruction;
                if (HOOK.equals(call.owner) && "onPresent".equals(call.name)) return bytes;
            }
        }
        InsnList hook = new InsnList();
        hook.add(new VarInsnNode(Opcodes.ALOAD, 0));
        hook.add(new MethodInsnNode(Opcodes.INVOKESTATIC, HOOK, "onPresent", "(Ljava/lang/Object;)V", false));
        present.instructions.insert(hook);
        ClassWriter output = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        node.accept(output);
        return output.toByteArray();
    }
}
