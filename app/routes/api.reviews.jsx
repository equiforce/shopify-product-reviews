import prisma from "../db.server";
import { getShopSettings } from "../models/review.server";

// CORS headers to allow storefront requests
function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return corsResponse({});
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");

  if (!shop || !productId) {
    return corsResponse({ error: "Missing shop or productId parameter" }, 400);
  }

  // Get shop settings
  const settings = await getShopSettings(shop);

  // Fetch only approved reviews for this product
  const reviews = await prisma.review.findMany({
    where: {
      shop,
      productId: String(productId),
      status: "approved",
    },
    orderBy: { createdAt: "desc" },
  });

  const total = reviews.length;
  const sumRating = reviews.reduce((acc, r) => acc + r.rating, 0);
  const avgRating = total > 0 ? (sumRating / total).toFixed(1) : "0.0";

  return corsResponse({
    reviews,
    total,
    avgRating,
    settings: {
      accentColor: settings.accentColor,
      removeWatermark: settings.removeWatermark && settings.plan === "pro",
      plan: settings.plan,
      verifiedOnly: settings.verifiedOnly,
    },
  });
};
