package net.minecraft.launchwrapper;
/** Exact LaunchWrapper interface; the real dependency is verified by the ForgeGradle build. */
public interface IClassTransformer {
    byte[] transform(String name, String transformedName, byte[] bytes);
}
