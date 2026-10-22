import { useLoaderData, useFetcher } from "react-router";
import { authenticate, PRO_PLAN } from "../shopify.server";
import { getShopSettings, updateShopSettings } from "../models/review.server";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);

  let hasProPayment = false;
  try {
    const billingCheck = await billing.check({
      plans: [PRO_PLAN],
      isTest: true,
    });
    hasProPayment = billingCheck.hasActivePayment;

    // Sync database with active payment status
    if (hasProPayment && settings.plan !== "pro") {
      await updateShopSettings(session.shop, { plan: "pro", removeWatermark: true });
      settings.plan = "pro";
      settings.removeWatermark = true;
    } else if (!hasProPayment && settings.plan === "pro") {
      await updateShopSettings(session.shop, { plan: "free", removeWatermark: false });
      settings.plan = "free";
      settings.removeWatermark = false;
    }
  } catch (e) {
    console.error("Billing check error:", e);
  }

  return { settings, hasProPayment };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upgrade") {
    return await billing.request({
      plan: PRO_PLAN,
      isTest: true,
      returnUrl: `https://${session.shop}/admin/apps/review-product/app/pricing`,
    });
  }

  if (intent === "dev_toggle_pro") {
    // Development mode shortcut for easy testing
    const settings = await getShopSettings(session.shop);
    const newPlan = settings.plan === "pro" ? "free" : "pro";
    await updateShopSettings(session.shop, {
      plan: newPlan,
      removeWatermark: newPlan === "pro",
    });
    return { success: true };
  }

  return null;
};

export default function Pricing() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();

  const isPro = settings.plan === "pro";

  return (
    <s-page heading="Plans & Subscription">
      <s-stack direction="block" gap="loose">
        <s-banner tone="info" heading="Simple & Transparent Pricing">
          <s-paragraph>
            Upgrade to the Pro Plan to remove the "Powered by" branding watermark from your store and unlock photo & video reviews with verified purchaser gating!
          </s-paragraph>
        </s-banner>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "16px" }}>
          
          {/* Free Plan */}
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            style={{
              backgroundColor: "#FFFFFF",
              border: isPro ? "1px solid #E5E7EB" : "2px solid #2563EB",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "22px", margin: 0 }}>Free Plan</h2>
              {!isPro && (
                <span
                  style={{
                    backgroundColor: "#DEF7EC",
                    color: "#03543F",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                >
                  CURRENT PLAN
                </span>
              )}
            </div>

            <div style={{ margin: "16px 0" }}>
              <span style={{ fontSize: "36px", fontWeight: "bold" }}>$0</span>
              <span style={{ color: "#6B7280" }}> / month</span>
            </div>

            <ul style={{ listStyleType: "none", padding: 0, margin: "20px 0", lineHeight: "2" }}>
              <li>✓ Unlimited text reviews</li>
              <li>✓ Star rating widget (1-5 stars)</li>
              <li>✓ Manual review moderation</li>
              <li style={{ color: "#DC2626" }}>✗ "Powered by" watermark shown</li>
              <li style={{ color: "#DC2626" }}>✗ Photo & video uploads disabled</li>
              <li style={{ color: "#DC2626" }}>✗ Verified buyers only condition disabled</li>
            </ul>

            <div style={{ marginTop: "24px" }}>
              <s-button disabled={!isPro} style={{ width: "100%" }}>
                {isPro ? "Downgrade to Free" : "Active Plan"}
              </s-button>
            </div>
          </s-box>

          {/* Pro Plan */}
          <s-box
            padding="loose"
            borderWidth="base"
            borderRadius="base"
            style={{
              backgroundColor: "#FFFFFF",
              border: isPro ? "2px solid #10B981" : "2px solid #F59E0B",
              position: "relative",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "22px", margin: 0, color: "#111827" }}>Pro Plan ⭐</h2>
              {isPro && (
                <span
                  style={{
                    backgroundColor: "#DEF7EC",
                    color: "#03543F",
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                >
                  ACTIVE PLAN
                </span>
              )}
            </div>

            <div style={{ margin: "16px 0" }}>
              <span style={{ fontSize: "36px", fontWeight: "bold", color: "#111827" }}>$9.99</span>
              <span style={{ color: "#6B7280" }}> / month</span>
            </div>

            <ul style={{ listStyleType: "none", padding: 0, margin: "20px 0", lineHeight: "2" }}>
              <li><strong>✓ Remove "Powered by" Watermark</strong></li>
              <li><strong>✓ Only Verified Buyers can leave feedback</strong></li>
              <li><strong>✓ Customer Photo & Video uploads</strong></li>
              <li>✓ Auto-publish reviews toggle</li>
              <li>✓ Custom star rating color</li>
              <li>✓ Priority support</li>
            </ul>

            <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {!isPro ? (
                <s-button
                  variant="primary"
                  onClick={() => {
                    fetcher.submit({ intent: "upgrade" }, { method: "POST" });
                  }}
                  {...(fetcher.state !== "idle" ? { loading: true } : {})}
                  style={{ width: "100%" }}
                >
                  Upgrade to Pro ($9.99/mo)
                </s-button>
              ) : (
                <s-button disabled style={{ width: "100%" }}>
                  Subscribed to Pro
                </s-button>
              )}

              {/* Dev mode instant toggle for testing without test charges */}
              <s-button
                variant="tertiary"
                onClick={() => {
                  fetcher.submit({ intent: "dev_toggle_pro" }, { method: "POST" });
                }}
              >
                🛠️ Dev Test: {isPro ? "Switch to Free" : "Switch to Pro (Free Test)"}
              </s-button>
            </div>
          </s-box>

        </div>
      </s-stack>
    </s-page>
  );
}
