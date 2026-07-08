package com.mct.version;

import java.util.List;
import java.util.Map;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;

public interface ItemDataAdapter {

    void appendCustomData(ItemStack stack, Map<String, Object> result);

    List<Map<String, Object>> getEnchantments(ItemStack stack);

    String statusEffectId(MobEffectInstance effect);
}
