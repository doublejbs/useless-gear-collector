"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveProductAction(
  productId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const specs: Record<string, string> = {};
    for (const [key, value] of Array.from(formData.entries())) {
      if (key.startsWith("spec_")) {
        specs[key.slice(5)] = String(value);
      }
    }

    await prisma.product.update({
      where: { productId },
      data: {
        brandKr: String(formData.get("brandKr") ?? ""),
        brandEn: String(formData.get("brandEn") ?? ""),
        nameKr: String(formData.get("nameKr") ?? ""),
        nameEn: String(formData.get("nameEn") ?? ""),
        colorKr: String(formData.get("colorKr") ?? ""),
        colorEn: String(formData.get("colorEn") ?? ""),
        sizeKr: String(formData.get("sizeKr") ?? ""),
        sizeEn: String(formData.get("sizeEn") ?? ""),
        weight: String(formData.get("weight") ?? ""),
        salesRegion: String(formData.get("salesRegion") ?? ""),
        needsReview: formData.get("needsReview") === "true",
        ...(Object.keys(specs).length > 0 && { specs }),
      },
    });

    revalidatePath(`/products/${productId}`);
    revalidatePath("/products");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
