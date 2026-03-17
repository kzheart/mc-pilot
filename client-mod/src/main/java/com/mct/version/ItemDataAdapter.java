package com.mct.version;

import java.util.List;
import java.util.Map;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;

public interface ItemDataAdapter {

    void appendCustomData(ItemStack stack, Map<String, Object> result);

    List<Map<String, Object>> getEnchantments(ItemStack stack);

    String statusEffectId(StatusEffectInstance effect);
}
