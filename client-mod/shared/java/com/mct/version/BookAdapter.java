package com.mct.version;

import java.util.List;
import net.minecraft.item.ItemStack;

public interface BookAdapter {

    List<String> readPages(ItemStack stack);
}
