import { unauthenticated } from "../shopify.server";
import {
  getShopSettings,
  createReview,
  checkIfVerifiedBuyer,
} from "../models/review.server";

function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return corsResponse({});
  }
  return corsResponse({ message: "Use POST to submit reviews" }, 405);
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return corsResponse({});
  }

  try {
    let bodyData;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      bodyData = await request.json();
    } else {
      const formData = await request.formData();
      bodyData = Object.fromEntries(formData.entries());
    }

    const {
      shop,
      productId,
      productTitle,
      customerName,
      customerEmail,
      rating,
      title,
      body,
      images,
      videoUrl,
    } = bodyData;

    if (!shop || !productId || !customerName || !customerEmail || !rating || !body) {
      return corsResponse(
        { error: "Please fill in all required fields (Name, Email, Rating, and Review)." },
        400
      );
    }

    const parsedRating = parseInt(rating, 10);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return corsResponse({ error: "Rating must be between 1 and 5 stars." }, 400);
    }

    const settings = await getShopSettings(shop);

    // Verify buyer condition
    let isVerified = false;
    try {
      const { admin } = await unauthenticated.admin(shop);
      if (admin) {
        isVerified = await checkIfVerifiedBuyer(admin, customerEmail, productId);
      }
    } catch (err) {
      console.warn("Could not check verified buyer status via Admin API:", err.message);
    }

    // Condition Check: If store requires verified buyers only
    if (settings.verifiedOnly && !isVerified) {
      return corsResponse(
        {
          error:
            "Feedback restricted: Only verified buyers who purchased this product can leave a review.",
          isVerifiedOnlyError: true,
        },
        403
      );
    }

    // Determine initial status based on auto-publish setting
    const status = settings.autoPublish ? "approved" : "pending";

    // Format images as JSON string if present
    let formattedImages = null;
    if (images) {
      formattedImages = typeof images === "string" ? images : JSON.stringify(images);
    }

    const review = await createReview({
      shop,
      productId: String(productId),
      productTitle: productTitle || "Product",
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      rating: parsedRating,
      title: title?.trim() || null,
      body: body.trim(),
      images: formattedImages,
      videoUrl: videoUrl?.trim() || null,
      isVerified,
      status,
    });

    return corsResponse({
      success: true,
      message:
        status === "approved"
          ? "Thank you! Your review has been published."
          : "Thank you! Your review has been submitted and is pending moderation.",
      review,
    });
  } catch (error) {
    console.error("Error submitting review:", error);
    return corsResponse({ error: "An error occurred while submitting your review." }, 500);
  }
};
