export const DASHBOARD_MODELS = ["leads", "messages", "ecommerce"] as const;
export type DashboardModel = (typeof DASHBOARD_MODELS)[number];
export type AdPlatform = "meta_ads" | "google_ads";

export const CONVERSION_FIELDS = [
  "actions_lead",
  "actions_offsite_conversion_fb_pixel_lead",
  "actions_offsite_conversion_fb_pixel_custom",
  "actions_offsite_conversion_fb_pixel_contact",
  "actions_lead_formulário_obrigado",
  "actions_onsite_conversion_messaging_conversation_started_7d",
  "actions_link_click",
  "actions_initiate_checkout",
  "actions_purchase",
  "conversions",
] as const;

export interface WindsorAccount {
  id: string;
  name: string;
  platform: AdPlatform;
  currency: string;
}
export type WindsorRow = Record<string, unknown>;

export interface NormalizedFact {
  account_id: string;
  platform: AdPlatform;
  occurred_on: string;
  campaign_id: string | null;
  campaign_name: string;
  adset_id: string | null;
  adset_name: string;
  ad_id: string | null;
  ad_name: string;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  spend: number;
  conversions: Record<string, number>;
  revenue: number;
  video_views: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p95: number;
  thumbnail_url: string | null;
  story_id: string | null;
  source_key: string;
}
