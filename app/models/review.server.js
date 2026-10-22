import prisma from "../db.server";

// Get or initialize settings for a shop
export async function getShopSettings(shop) {
  let settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: {
        shop,
        plan: "free",
        autoPublish: false,
        verifiedOnly: false,
        removeWatermark: false,
        accentColor: "#F59E0B",
      },
    });
  }

  return settings;
}

// Update settings
export async function updateShopSettings(shop, data) {
  return prisma.appSettings.upsert({
    where: { shop },
    update: data,
    create: {
      shop,
      ...data,
    },
  });
}

// Get reviews for admin dashboard
export async function getAdminReviews(shop, filter = "all") {
  const where = { shop };
  if (filter !== "all") {
    where.status = filter;
  }

  return prisma.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

// Update review status (approve, reject, delete)
export async function updateReviewStatus(id, status) {
  return prisma.review.update({
    where: { id },
    data: { status },
  });
}

export async function deleteReview(id) {
  return prisma.review.delete({
    where: { id },
  });
}

// Create a review
export async function createReview(data) {
  return prisma.review.create({
    data,
  });
}

// Bulk create reviews from CSV import
export async function bulkCreateReviews(reviews) {
  return prisma.review.createMany({
    data: reviews,
  });
}

// Check if customer is a verified buyer of a product
export async function checkIfVerifiedBuyer(admin, customerEmail, productId) {
  try {
    const formattedEmail = customerEmail.trim().toLowerCase();
    // Query Shopify orders for this customer
    const response = await admin.graphql(
      `#graphql
      query getCustomerOrders($query: String!) {
        orders(first: 20, query: $query) {
          edges {
            node {
              id
              lineItems(first: 50) {
                edges {
                  node {
                    product {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          query: `email:${formattedEmail}`,
        },
      }
    );

    const json = await response.json();
    const orders = json.data?.orders?.edges || [];

    for (const order of orders) {
      const items = order.node.lineItems.edges;
      for (const item of items) {
        const prodId = item.node.product?.id;
        // Compare with productId (e.g. gid://shopify/Product/12345 or just the numeric id)
        if (prodId && (prodId === productId || prodId.endsWith(`/${productId}`))) {
          return true;
        }
      }
    }
  } catch (err) {
    console.error("Error checking verified buyer:", err);
  }
  return false;
}
