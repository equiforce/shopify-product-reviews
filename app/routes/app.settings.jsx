import { useEffect, useState } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopSettings, updateShopSettings } from "../models/review.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const autoPublish = formData.get("autoPublish") === "true";
  const verifiedOnly = formData.get("verifiedOnly") === "true";
  const removeWatermark = formData.get("removeWatermark") === "true";
  const accentColor = formData.get("accentColor") || "#F59E0B";

  const currentSettings = await getShopSettings(session.shop);

  // If merchant is on free plan, they cannot remove watermark
  const canRemoveWatermark = currentSettings.plan === "pro" ? removeWatermark : false;

  await updateShopSettings(session.shop, {
    autoPublish,
    verifiedOnly,
    removeWatermark: canRemoveWatermark,
    accentColor,
  });

  return { success: true, message: "Settings saved successfully!" };
};

export default function Settings() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [verifiedOnly, setVerifiedOnly] = useState(settings.verifiedOnly);
  const [autoPublish, setAutoPublish] = useState(settings.autoPublish);
  const [removeWatermark, setRemoveWatermark] = useState(settings.removeWatermark);
  const [accentColor, setAccentColor] = useState(settings.accentColor);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  const handleSubmit = (e) => {
    e.preventDefault();
    fetcher.submit(
      {
        verifiedOnly: String(verifiedOnly),
        autoPublish: String(autoPublish),
        removeWatermark: String(removeWatermark),
        accentColor,
      },
      { method: "POST" }
    );
  };

  const isPro = settings.plan === "pro";

  return (
    <s-page heading="Review Settings & Conditions">
      <form onSubmit={handleSubmit}>
        <s-stack direction="block" gap="loose">

          {/* Condition: Verified Purchase Restriction */}
          <s-section heading="Feedback Conditions">
            <s-box padding="base" borderWidth="base" borderRadius="base" style={{ backgroundColor: "#FFFFFF" }}>
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: "16px" }}>Require Verified Purchase</strong>
                    <p style={{ margin: "4px 0 0 0", color: "#6B7280", fontSize: "14px" }}>
                      Only customers who have purchased this product can leave a review. Non-buyers will be blocked.
                    </p>
                  </div>
                  <div>
                    <input
                      type="checkbox"
                      id="verifiedOnly"
                      checked={verifiedOnly}
                      onChange={(e) => setVerifiedOnly(e.target.checked)}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </div>
                </div>

                <hr style={{ border: "0", borderTop: "1px solid #E5E7EB", margin: "8px 0" }} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: "16px" }}>Auto-Publish Reviews</strong>
                    <p style={{ margin: "4px 0 0 0", color: "#6B7280", fontSize: "14px" }}>
                      Automatically publish reviews without waiting for manual admin approval.
                    </p>
                  </div>
                  <div>
                    <input
                      type="checkbox"
                      id="autoPublish"
                      checked={autoPublish}
                      onChange={(e) => setAutoPublish(e.target.checked)}
                      style={{ width: "20px", height: "20px", cursor: "pointer" }}
                    />
                  </div>
                </div>
              </s-stack>
            </s-box>
          </s-section>

          {/* Branding & Watermark Setting */}
          <s-section heading="Branding & Watermark">
            <s-box padding="base" borderWidth="base" borderRadius="base" style={{ backgroundColor: "#FFFFFF" }}>
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "16px" }}>Remove "Powered by" Watermark</strong>
                      {!isPro && (
                        <span
                          style={{
                            backgroundColor: "#FEF3C7",
                            color: "#92400E",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: "bold",
                          }}
                        >
                          PRO FEATURE
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "4px 0 0 0", color: "#6B7280", fontSize: "14px" }}>
                      Hide our branding from your storefront review widgets.
                    </p>
                    {!isPro && (
                      <p style={{ margin: "4px 0 0 0", color: "#D97706", fontSize: "13px" }}>
                        🔒 Upgrade to Pro to enable watermark removal. <s-link href="/app/pricing">Upgrade Plan</s-link>
                      </p>
                    )}
                  </div>
                  <div>
                    <input
                      type="checkbox"
                      id="removeWatermark"
                      disabled={!isPro}
                      checked={isPro && removeWatermark}
                      onChange={(e) => setRemoveWatermark(e.target.checked)}
                      style={{ width: "20px", height: "20px", cursor: isPro ? "pointer" : "not-allowed" }}
                    />
                  </div>
                </div>
              </s-stack>
            </s-box>
          </s-section>

          {/* Widget Styling */}
          <s-section heading="Appearance & Star Color">
            <s-box padding="base" borderWidth="base" borderRadius="base" style={{ backgroundColor: "#FFFFFF" }}>
              <s-stack direction="block" gap="base">
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div>
                    <strong style={{ fontSize: "15px" }}>Star Rating Color:</strong>
                  </div>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{ width: "40px", height: "35px", border: "none", cursor: "pointer", borderRadius: "4px" }}
                  />
                  <span style={{ fontSize: "18px", color: accentColor }}>★★★★★</span>
                </div>
              </s-stack>
            </s-box>
          </s-section>

          {/* Save Button */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <s-button
              variant="primary"
              onClick={handleSubmit}
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              Save Settings
            </s-button>
          </div>
        </s-stack>
      </form>
    </s-page>
  );
}
