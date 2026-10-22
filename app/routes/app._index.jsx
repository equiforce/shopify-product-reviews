import { useEffect, useState, useMemo } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getAdminReviews,
  getShopSettings,
  updateReviewStatus,
  deleteReview,
  createReview,
  bulkCreateReviews,
} from "../models/review.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [reviews, settings] = await Promise.all([
    getAdminReviews(shop),
    getShopSettings(shop),
  ]);

  const total = reviews.length;
  const approved = reviews.filter((r) => r.status === "approved").length;
  const pending = reviews.filter((r) => r.status === "pending").length;
  const rejected = reviews.filter((r) => r.status === "rejected").length;
  const totalRating = reviews.reduce((acc, curr) => acc + curr.rating, 0);
  const avgRating = total > 0 ? (totalRating / total).toFixed(1) : "0.0";

  // Calculate star distribution
  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach((r) => {
    if (distribution[r.rating] !== undefined) {
      distribution[r.rating]++;
    }
  });

  return {
    shop,
    reviews,
    settings,
    stats: {
      total,
      approved,
      pending,
      rejected,
      avgRating,
      distribution,
    },
  };
};

// Robust CSV Line Parser that handles quotes
function parseCSV(csvText) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentStr = "";

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentStr += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(currentStr.trim());
      currentStr = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(currentStr.trim());
      if (row.length > 1 || row[0] !== "") {
        lines.push(row);
      }
      row = [];
      currentStr = "";
    } else {
      currentStr += char;
    }
  }

  if (currentStr.length > 0 || row.length > 0) {
    row.push(currentStr.trim());
    lines.push(row);
  }

  return lines;
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const reviewId = formData.get("reviewId");

  if (intent === "approve") {
    await updateReviewStatus(reviewId, "approved");
    return { success: true, message: "Review approved!" };
  }

  if (intent === "reject") {
    await updateReviewStatus(reviewId, "rejected");
    return { success: true, message: "Review rejected!" };
  }

  if (intent === "delete") {
    await deleteReview(reviewId);
    return { success: true, message: "Review deleted!" };
  }

  if (intent === "approve_all") {
    const reviews = await getAdminReviews(shop);
    const pendingReviews = reviews.filter((r) => r.status === "pending");
    await Promise.all(pendingReviews.map((r) => updateReviewStatus(r.id, "approved")));
    return { success: true, message: `Approved ${pendingReviews.length} pending reviews!` };
  }

  if (intent === "import_csv") {
    const csvContent = formData.get("csvContent");
    if (!csvContent || typeof csvContent !== "string") {
      return { success: false, message: "No CSV content provided." };
    }

    const rows = parseCSV(csvContent);
    if (rows.length < 2) {
      return { success: false, message: "CSV file is empty or missing data rows." };
    }

    const headers = rows[0].map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
    const reviewsToInsert = [];

    // Map headers to indexes
    const getIndex = (aliases) => headers.findIndex((h) => aliases.includes(h));
    const prodIdIdx = getIndex(["productid", "product", "producthandle", "handle", "id"]);
    const prodTitleIdx = getIndex(["producttitle", "title", "productname"]);
    const ratingIdx = getIndex(["rating", "stars", "starrating", "score"]);
    const nameIdx = getIndex(["customername", "author", "name", "reviewer", "reviewername"]);
    const emailIdx = getIndex(["customeremail", "email", "revieweremail"]);
    const titleIdx = getIndex(["reviewtitle", "title", "headline", "subject"]);
    const bodyIdx = getIndex(["body", "reviewbody", "content", "review", "text", "feedback"]);
    const imagesIdx = getIndex(["images", "image", "imageurl", "photo", "photos"]);
    const videoIdx = getIndex(["videourl", "video", "videolink"]);
    const verifiedIdx = getIndex(["isverified", "verified", "verifiedbuyer"]);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 2) continue;

      const rawRating = ratingIdx >= 0 ? parseInt(row[ratingIdx], 10) : 5;
      const rating = isNaN(rawRating) ? 5 : Math.max(1, Math.min(5, rawRating));
      const productId = prodIdIdx >= 0 && row[prodIdIdx] ? row[prodIdIdx] : "general-product";
      const customerName = nameIdx >= 0 && row[nameIdx] ? row[nameIdx] : "Happy Customer";
      const customerEmail = emailIdx >= 0 && row[emailIdx] ? row[emailIdx] : "customer@example.com";
      const body = bodyIdx >= 0 && row[bodyIdx] ? row[bodyIdx] : "Great quality, highly recommend!";
      const title = titleIdx >= 0 && row[titleIdx] ? row[titleIdx] : "Verified Review";
      const productTitle = prodTitleIdx >= 0 && row[prodTitleIdx] ? row[prodTitleIdx] : "Shop Product";
      const videoUrl = videoIdx >= 0 && row[videoIdx] ? row[videoIdx] : null;

      let images = null;
      if (imagesIdx >= 0 && row[imagesIdx]) {
        const imgVal = row[imagesIdx].trim();
        if (imgVal.startsWith("[") && imgVal.endsWith("]")) {
          images = imgVal;
        } else if (imgVal.length > 0) {
          images = JSON.stringify(imgVal.split(";").map((s) => s.trim()));
        }
      }

      const isVerified =
        verifiedIdx >= 0
          ? ["true", "1", "yes", "verified"].includes(String(row[verifiedIdx]).toLowerCase())
          : true;

      reviewsToInsert.push({
        shop,
        productId: String(productId),
        productTitle,
        customerName,
        customerEmail,
        rating,
        title,
        body,
        images,
        videoUrl,
        isVerified,
        status: "approved",
      });
    }

    if (reviewsToInsert.length === 0) {
      return { success: false, message: "Could not find any valid review rows to import." };
    }

    await bulkCreateReviews(reviewsToInsert);
    return {
      success: true,
      message: `Successfully imported and published ${reviewsToInsert.length} reviews from CSV! 🎉`,
    };
  }

  if (intent === "create_sample") {
    await createReview({
      shop,
      productId: "sample-product-1",
      productTitle: "Sample Product",
      customerName: "Alex Johnson",
      customerEmail: "alex@example.com",
      rating: 5,
      title: "Absolutely in love with this product!",
      body: "The quality exceeded my expectations. Fast delivery, durable material, and the customer support was very helpful. Highly recommended!",
      images: JSON.stringify([
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80",
      ]),
      videoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
      isVerified: true,
      status: "approved",
    });
    return { success: true, message: "Sample review created and published!" };
  }

  return { success: false };
};

export default function Index() {
  const { reviews, settings, stats } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvInput, setCsvInput] = useState("");
  const [previewCount, setPreviewCount] = useState(0);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
      if (fetcher.data.success && showImportModal) {
        setShowImportModal(false);
        setCsvInput("");
        setPreviewCount(0);
      }
    }
  }, [fetcher.data, shopify, showImportModal]);

  // Handle CSV file selection
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === "string") {
        setCsvInput(text);
        const parsed = parseCSV(text);
        setPreviewCount(Math.max(0, parsed.length - 1));
      }
    };
    reader.readAsText(file);
  };

  const handleCsvTextChange = (text) => {
    setCsvInput(text);
    const parsed = parseCSV(text);
    setPreviewCount(Math.max(0, parsed.length - 1));
  };

  const handleImportSubmit = () => {
    if (!csvInput.trim()) return;
    fetcher.submit(
      { intent: "import_csv", csvContent: csvInput },
      { method: "POST" }
    );
  };

  // Filter and search
  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      const matchesFilter = filter === "all" ? true : r.status === filter;
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        r.customerName.toLowerCase().includes(term) ||
        r.customerEmail.toLowerCase().includes(term) ||
        (r.title && r.title.toLowerCase().includes(term)) ||
        r.body.toLowerCase().includes(term) ||
        (r.productTitle && r.productTitle.toLowerCase().includes(term));
      return matchesFilter && matchesSearch;
    });
  }, [reviews, filter, searchTerm]);

  const sampleCSVTemplate = `product_id,product_title,rating,customer_name,customer_email,review_title,review_body,images,video_url,is_verified
sample-product-1,Classic T-Shirt,5,Emily Davis,emily@example.com,Incredible fit!,"Super soft cotton and holds up great in the wash.",https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=400,,true
sample-product-1,Classic T-Shirt,4,Michael Brown,michael@example.com,Great purchase,"Fast shipping, exactly as described.",,,,true`;

  return (
    <s-page heading="Product Reviews & Feedback Dashboard">
      <div slot="primary-action" style={{ display: "flex", gap: "8px" }}>
        <s-button
          variant="primary"
          onClick={() => setShowImportModal(!showImportModal)}
        >
          📥 Import CSV
        </s-button>
        <s-button
          onClick={() => {
            fetcher.submit({ intent: "create_sample" }, { method: "POST" });
          }}
          {...(fetcher.state !== "idle" ? { loading: true } : {})}
        >
          + Add Sample Review
        </s-button>
      </div>

      {/* CSV Import Drawer / Box */}
      {showImportModal && (
        <s-box
          padding="loose"
          borderWidth="base"
          borderRadius="base"
          style={{
            backgroundColor: "#F9FAFB",
            border: "2px dashed #3B82F6",
            marginBottom: "24px",
            animation: "fadeIn 0.2s ease-in-out",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "18px", color: "#1E3A8A" }}>📥 Import Customer Reviews from CSV</h3>
              <p style={{ margin: "4px 0 0 0", color: "#6B7280", fontSize: "14px" }}>
                Import reviews in bulk from Shopify, Judge.me, Loox, Yotpo, or custom spreadsheets.
              </p>
            </div>
            <s-button variant="tertiary" onClick={() => setShowImportModal(false)}>
              ✕ Close
            </s-button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            {/* File Upload & Input */}
            <div>
              <label style={{ display: "block", fontWeight: 600, fontSize: "14px", marginBottom: "8px" }}>
                Option 1: Upload .csv file
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #D1D5DB",
                  borderRadius: "6px",
                  backgroundColor: "#FFFFFF",
                  cursor: "pointer",
                }}
              />

              <label style={{ display: "block", fontWeight: 600, fontSize: "14px", margin: "16px 0 8px 0" }}>
                Option 2: Paste CSV raw text
              </label>
              <textarea
                rows={6}
                value={csvInput}
                onChange={(e) => handleCsvTextChange(e.target.value)}
                placeholder="product_id,product_title,rating,customer_name,customer_email,review_title,review_body..."
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "6px",
                  border: "1px solid #D1D5DB",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Template & Instructions */}
            <div style={{ backgroundColor: "#FFFFFF", padding: "16px", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
              <strong style={{ fontSize: "14px", color: "#111827" }}>Supported Column Headers:</strong>
              <p style={{ fontSize: "13px", color: "#4B5563", margin: "6px 0 12px 0", lineHeight: "1.5" }}>
                <code>product_id</code>, <code>rating</code> (1-5), <code>customer_name</code>, <code>customer_email</code>, <code>review_title</code>, <code>review_body</code>, <code>images</code>, <code>video_url</code>, <code>is_verified</code>
              </p>

              <strong style={{ fontSize: "14px", color: "#111827" }}>Sample CSV Format:</strong>
              <pre
                style={{
                  backgroundColor: "#F3F4F6",
                  padding: "10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  overflowX: "auto",
                  marginTop: "6px",
                }}
              >
                {sampleCSVTemplate}
              </pre>

              <button
                type="button"
                onClick={() => handleCsvTextChange(sampleCSVTemplate)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563EB",
                  cursor: "pointer",
                  fontSize: "12px",
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                📋 Load Sample CSV Data to Test
              </button>
            </div>
          </div>

          {/* Action Row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px" }}>
            <div>
              {previewCount > 0 && (
                <span
                  style={{
                    backgroundColor: "#DEF7EC",
                    color: "#03543F",
                    padding: "4px 12px",
                    borderRadius: "16px",
                    fontWeight: 600,
                    fontSize: "13px",
                  }}
                >
                  ✓ Ready to import {previewCount} review{previewCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <s-button onClick={() => setShowImportModal(false)}>Cancel</s-button>
              <s-button
                variant="primary"
                disabled={!csvInput.trim() || previewCount === 0}
                onClick={handleImportSubmit}
                {...(fetcher.state !== "idle" ? { loading: true } : {})}
              >
                Start Import
              </s-button>
            </div>
          </div>
        </s-box>
      )}

      {/* Plan Banner */}
      {settings.plan === "free" ? (
        <s-banner tone="info" heading="Free Plan Active">
          <s-paragraph>
            Your customer storefront shows the "Powered by" branding watermark.
            To remove the watermark, unlock video reviews, and enable verified buyer gating,{" "}
            <s-link href="/app/pricing">Upgrade to Pro ($9.99/mo)</s-link>.
          </s-paragraph>
        </s-banner>
      ) : (
        <s-banner tone="success" heading="Pro Plan Active ⭐">
          <s-paragraph>
            All Pro features unlocked: White-label branding (watermark removed), verified buyer condition, and media reviews.
          </s-paragraph>
        </s-banner>
      )}

      {/* Modern Analytics & Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", margin: "20px 0" }}>
        
        {/* Total Reviews Card */}
        <div style={{ backgroundColor: "#FFFFFF", padding: "20px", borderRadius: "12px", border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ color: "#6B7280", fontSize: "13px", fontWeight: 600, textTransform: "uppercase" }}>Total Reviews</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "8px" }}>
            <span style={{ fontSize: "32px", fontWeight: 700, color: "#111827" }}>{stats.total}</span>
            <span style={{ color: "#10B981", fontSize: "12px", fontWeight: 600 }}>{stats.approved} Published</span>
          </div>
        </div>

        {/* Average Rating Card */}
        <div style={{ backgroundColor: "#FFFFFF", padding: "20px", borderRadius: "12px", border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ color: "#6B7280", fontSize: "13px", fontWeight: 600, textTransform: "uppercase" }}>Customer Rating</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
            <span style={{ fontSize: "32px", fontWeight: 700, color: "#F59E0B" }}>★ {stats.avgRating}</span>
            <span style={{ color: "#6B7280", fontSize: "14px" }}>/ 5.0</span>
          </div>
        </div>

        {/* Pending Moderation */}
        <div style={{ backgroundColor: "#FFFFFF", padding: "20px", borderRadius: "12px", border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ color: "#6B7280", fontSize: "13px", fontWeight: 600, textTransform: "uppercase" }}>Pending Moderation</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "8px" }}>
            <span style={{ fontSize: "32px", fontWeight: 700, color: stats.pending > 0 ? "#DC2626" : "#10B981" }}>
              {stats.pending}
            </span>
            {stats.pending > 0 && (
              <button
                type="button"
                onClick={() => {
                  fetcher.submit({ intent: "approve_all" }, { method: "POST" });
                }}
                style={{
                  background: "#EEF2FF",
                  color: "#4338CA",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Approve All
              </button>
            )}
          </div>
        </div>

        {/* Star Rating Breakdown Bar */}
        <div style={{ backgroundColor: "#FFFFFF", padding: "20px", borderRadius: "12px", border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div style={{ color: "#6B7280", fontSize: "13px", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>Rating Breakdown</div>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = stats.distribution[star] || 0;
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
              <div key={star} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "3px" }}>
                <span style={{ width: "24px", color: "#6B7280" }}>{star}★</span>
                <div style={{ flex: 1, height: "6px", backgroundColor: "#F3F4F6", borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", backgroundColor: "#F59E0B" }} />
                </div>
                <span style={{ width: "28px", color: "#9CA3AF", textAlign: "right" }}>{count}</span>
              </div>
            );
          })}
        </div>

      </div>

      {/* Modern Filter, Search & Reviews Table */}
      <s-section heading="Customer Reviews List">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
          
          {/* Tabs */}
          <s-stack direction="inline" gap="tight">
            <s-button
              variant={filter === "all" ? "primary" : "secondary"}
              onClick={() => setFilter("all")}
            >
              All ({reviews.length})
            </s-button>
            <s-button
              variant={filter === "pending" ? "primary" : "secondary"}
              onClick={() => setFilter("pending")}
            >
              Pending ({stats.pending})
            </s-button>
            <s-button
              variant={filter === "approved" ? "primary" : "secondary"}
              onClick={() => setFilter("approved")}
            >
              Approved ({stats.approved})
            </s-button>
            <s-button
              variant={filter === "rejected" ? "primary" : "secondary"}
              onClick={() => setFilter("rejected")}
            >
              Rejected ({stats.rejected})
            </s-button>
          </s-stack>

          {/* Search Bar */}
          <div style={{ width: "260px" }}>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="🔍 Search name, email, text..."
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #D1D5DB",
                borderRadius: "6px",
                fontSize: "13px",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {filteredReviews.length === 0 ? (
          <s-box padding="loose" borderWidth="base" borderRadius="base" style={{ textAlign: "center", backgroundColor: "#FFFFFF" }}>
            <s-paragraph>No reviews found matching your criteria.</s-paragraph>
            <div style={{ marginTop: "12px", display: "flex", gap: "8px", justifyContent: "center" }}>
              <s-button onClick={() => setShowImportModal(true)}>Import Reviews (CSV)</s-button>
              <s-button
                onClick={() => {
                  fetcher.submit({ intent: "create_sample" }, { method: "POST" });
                }}
              >
                + Add Sample Review
              </s-button>
            </div>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {filteredReviews.map((review) => {
              let parsedImages = [];
              try {
                if (review.images) {
                  parsedImages = JSON.parse(review.images);
                }
              } catch (e) {
                parsedImages = [];
              }

              return (
                <s-box
                  key={review.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderLeft: `4px solid ${
                      review.status === "approved"
                        ? "#10B981"
                        : review.status === "pending"
                        ? "#F59E0B"
                        : "#EF4444"
                    }`,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <s-stack direction="block" gap="tight">
                    {/* Header Row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {/* Initials Avatar */}
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            backgroundColor: "#EEF2FF",
                            color: "#4338CA",
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "14px",
                          }}
                        >
                          {review.customerName ? review.customerName.charAt(0).toUpperCase() : "U"}
                        </div>

                        <div>
                          <strong style={{ fontSize: "15px" }}>{review.customerName}</strong>{" "}
                          <span style={{ color: "#6B7280", fontSize: "13px" }}>({review.customerEmail})</span>
                          {review.isVerified && (
                            <span
                              style={{
                                marginLeft: "8px",
                                backgroundColor: "#DEF7EC",
                                color: "#03543F",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                fontWeight: "bold",
                              }}
                            >
                              ✓ Verified Buyer
                            </span>
                          )}
                          {review.productTitle && (
                            <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
                              Product: <em>{review.productTitle}</em>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: "bold",
                            textTransform: "capitalize",
                            backgroundColor:
                              review.status === "approved"
                                ? "#DEF7EC"
                                : review.status === "pending"
                                ? "#FEF3C7"
                                : "#FDE8E8",
                            color:
                              review.status === "approved"
                                ? "#03543F"
                                : review.status === "pending"
                                ? "#92400E"
                                : "#9B1C1C",
                          }}
                        >
                          {review.status}
                        </span>
                      </div>
                    </div>

                    {/* Star Rating & Title */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <span style={{ color: settings.accentColor || "#F59E0B", fontSize: "18px" }}>
                        {"★".repeat(review.rating) + "☆".repeat(5 - review.rating)}
                      </span>
                      {review.title && <strong style={{ fontSize: "15px" }}>{review.title}</strong>}
                    </div>

                    {/* Review Body */}
                    <p style={{ margin: "4px 0", color: "#374151", lineHeight: 1.6, fontSize: "14px" }}>
                      {review.body}
                    </p>

                    {/* Photos Preview */}
                    {parsedImages.length > 0 && (
                      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                        {parsedImages.map((imgUrl, idx) => (
                          <img
                            key={idx}
                            src={imgUrl}
                            alt="Customer upload"
                            style={{
                              width: "70px",
                              height: "70px",
                              objectFit: "cover",
                              borderRadius: "8px",
                              border: "1px solid #E5E7EB",
                              cursor: "pointer",
                            }}
                            onClick={() => window.open(imgUrl, "_blank")}
                          />
                        ))}
                      </div>
                    )}

                    {/* Video Link */}
                    {review.videoUrl && (
                      <div style={{ marginTop: "6px" }}>
                        <s-link href={review.videoUrl} target="_blank">
                          🎥 Watch customer video review
                        </s-link>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                      {review.status !== "approved" && (
                        <s-button
                          variant="primary"
                          onClick={() => {
                            fetcher.submit(
                              { intent: "approve", reviewId: review.id },
                              { method: "POST" }
                            );
                          }}
                        >
                          Approve
                        </s-button>
                      )}

                      {review.status !== "rejected" && (
                        <s-button
                          onClick={() => {
                            fetcher.submit(
                              { intent: "reject", reviewId: review.id },
                              { method: "POST" }
                            );
                          }}
                        >
                          Reject
                        </s-button>
                      )}

                      <s-button
                        variant="tertiary"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this review?")) {
                            fetcher.submit(
                              { intent: "delete", reviewId: review.id },
                              { method: "POST" }
                            );
                          }
                        }}
                      >
                        Delete
                      </s-button>
                    </div>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
