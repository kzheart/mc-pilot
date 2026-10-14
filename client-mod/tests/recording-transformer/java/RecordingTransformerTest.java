import com.mct.legacy.RecordingFrames;
import com.mct.legacy.recording.RecordingTransformer;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;

public final class RecordingTransformerTest {
    static final String TARGET = "net.minecraft.client.shader.Framebuffer";
    static void check(boolean okay, String message) { if (!okay) throw new AssertionError(message); }
    static byte[] fixture(String owner, String name) {
        ClassWriter writer = new ClassWriter(0);
        writer.visit(Opcodes.V1_8, Opcodes.ACC_PUBLIC, owner, null, "java/lang/Object", null);
        MethodVisitor ctor = writer.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        ctor.visitCode(); ctor.visitVarInsn(Opcodes.ALOAD, 0);
        ctor.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        ctor.visitInsn(Opcodes.RETURN); ctor.visitMaxs(1, 1); ctor.visitEnd();
        for (String descriptor : new String[] {"(II)V", "(III)V"}) {
            MethodVisitor method = writer.visitMethod(Opcodes.ACC_PUBLIC, name, descriptor, null, null);
            method.visitCode(); method.visitInsn(Opcodes.RETURN);
            method.visitMaxs(0, descriptor.equals("(II)V") ? 3 : 4); method.visitEnd();
        }
        writer.visitEnd(); return writer.toByteArray();
    }
    static final class Loader extends ClassLoader {
        Class<?> define(String name, byte[] bytes) { return defineClass(name, bytes, 0, bytes.length); }
    }
    public static void main(String[] args) throws Exception {
        RecordingTransformer transformer = new RecordingTransformer();
        for (String methodName : new String[] {"framebufferRender", "func_147615_c", "c"}) {
            String owner = methodName.equals("c") ? "bvd" : TARGET.replace('.', '/');
            byte[] source = fixture(owner, methodName);
            byte[] transformed = transformer.transform(owner.replace('/', '.'), TARGET, source);
            ClassNode node = new ClassNode(); new ClassReader(transformed).accept(node, 0);
            int hooks = 0;
            for (MethodNode method : node.methods) {
                for (AbstractInsnNode instruction = method.instructions.getFirst(); instruction != null; instruction = instruction.getNext()) {
                    if (instruction instanceof MethodInsnNode) {
                        MethodInsnNode call = (MethodInsnNode) instruction;
                        if (call.owner.equals("com/mct/legacy/RecordingFrames")) {
                            hooks++; check(method.desc.equals("(II)V"), "modified a non-presentation overload");
                        }
                    }
                }
            }
            check(hooks == 1, "expected exactly one presentation hook for " + methodName);
            check(transformer.transform(owner, TARGET, transformed) == transformed, "transform not idempotent");
            Class<?> type = new Loader().define(owner.replace('/', '.'), transformed);
            Object instance = type.newInstance(); int before = RecordingFrames.calls;
            type.getMethod(methodName, int.class, int.class).invoke(instance, 1920, 1080);
            check(RecordingFrames.calls == before + 1 && RecordingFrames.last == instance, "hook did not receive framebuffer");
            type.getMethod(methodName, int.class, int.class, int.class).invoke(instance, 1, 2, 3);
            check(RecordingFrames.calls == before + 1, "other overload unexpectedly recorded");
            check(transformer.transform("other.Class", "other.Class", source) == source, "unrelated class changed");
        }
        check(transformer.transform(TARGET, TARGET, null) == null, "null input changed");
        try {
            transformer.transform(TARGET, TARGET, fixture(TARGET.replace('.', '/'), "unexpected"));
            throw new AssertionError("missing required presentation hook silently accepted");
        } catch (IllegalStateException expected) {}
        System.out.println("RecordingTransformerTest: MCP/SRG/obfuscated hooks, verifier, overload isolation and idempotence passed");
    }
}
