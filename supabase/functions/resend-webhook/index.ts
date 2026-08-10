import { Webhook } from "svix";
import { adminClient, json } from "../_shared/common.ts";

type ResendWebhookPayload = {
  type?: unknown;
  data?: {
    email_id?: unknown;
    id?: unknown;
  } | null;
  [key: string]: unknown;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (!secret) throw new Error("RESEND_WEBHOOK_SECRET is required");
    const rawBody = await req.text();
    const payload = new Webhook(secret).verify(rawBody, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as ResendWebhookPayload;
    const eventId = req.headers.get("svix-id") ?? crypto.randomUUID();
    const eventType = String(payload.type ?? "unknown");
    const providerId = String(payload.data?.email_id ?? payload.data?.id ?? "");
    const supabase = adminClient();
    const { error: eventError } = await supabase.from("email_events").upsert({
      event_id: eventId,
      event_type: eventType,
      provider_id: providerId || null,
      payload,
    }, { onConflict: "event_id", ignoreDuplicates: true });
    if (eventError) throw eventError;

    const statusByEvent: Record<string, string> = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained",
      "email.suppressed": "suppressed",
    };
    const status = statusByEvent[eventType];
    if (status && providerId) {
      const { data: deliveries, error } = await supabase.from("notification_deliveries")
        .update({ status }).eq("provider_id", providerId).select("subscriber_id");
      if (error) throw error;
      if (["bounced", "complained", "suppressed"].includes(status)) {
        const subscriberIds = [...new Set((deliveries ?? []).map((delivery) => delivery.subscriber_id))];
        if (subscriberIds.length > 0) {
          await supabase.from("subscribers").update({ status: "suppressed" }).in("id", subscriberIds);
        }
      }
    }
    return json(req, { ok: true });
  } catch (error) {
    console.error("resend-webhook error", error instanceof Error ? error.message : error);
    return json(req, { error: "Invalid webhook" }, 400);
  }
});
