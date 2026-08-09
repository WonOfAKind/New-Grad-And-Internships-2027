import {
  adminClient,
  corsHeaders,
  escapeHtml,
  json,
  publicSiteUrl,
  sendEmail,
  subscriberToken,
  validateCompanyIds,
  verifySubscriberToken,
  verifyTurnstile,
} from "../_shared/common.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function validatedCompanies(supabase: ReturnType<typeof adminClient>, value: unknown) {
  const ids = validateCompanyIds(value);
  const { data, error } = await supabase.from("companies").select("id").in("id", ids);
  if (error) throw error;
  if ((data ?? []).length !== ids.length) throw new Error("One or more selected companies are unavailable");
  return ids;
}

async function preferences(supabase: ReturnType<typeof adminClient>, subscriberId: string) {
  const { data, error } = await supabase.from("subscription_companies").select("company_id").eq("subscriber_id", subscriberId);
  if (error) throw error;
  return (data ?? []).map((row) => row.company_id);
}

async function replacePreferences(supabase: ReturnType<typeof adminClient>, subscriberId: string, companyIds: string[]) {
  const { error: deleteError } = await supabase.from("subscription_companies").delete().eq("subscriber_id", subscriberId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await supabase.from("subscription_companies").insert(
    companyIds.map((companyId) => ({ subscriber_id: subscriberId, company_id: companyId })),
  );
  if (insertError) throw insertError;
}

async function subscriberFromToken(supabase: ReturnType<typeof adminClient>, rawToken: string, allowedStatuses: string[]) {
  const token = await verifySubscriberToken(rawToken);
  const { data, error } = await supabase.from("subscribers").select("*").eq("id", token.id).maybeSingle();
  if (error) throw error;
  if (!data || data.token_version !== token.version || !allowedStatuses.includes(data.status)) {
    throw new Error("Invalid or expired preference link");
  }
  return data;
}

async function sendAccessEmail(subscriber: { id: string; email: string; token_version: number; status: string }) {
  const token = await subscriberToken(subscriber.id, subscriber.token_version);
  const action = subscriber.status === "active" ? "manage" : "verify";
  const url = `${publicSiteUrl()}?action=${action}&token=${encodeURIComponent(token)}`;
  const address = escapeHtml(Deno.env.get("MAILING_ADDRESS") ?? "");
  const heading = action === "verify" ? "Verify your job alerts" : "Manage your job alerts";
  await sendEmail({
    to: subscriber.email,
    subject: heading,
    html: `<h1>${heading}</h1><p>Use the secure link below to ${action === "verify" ? "confirm" : "manage"} your company-specific role alerts.</p><p><a href="${url}">${heading}</a></p><p>If you did not request this, you can ignore this email.</p>${address ? `<p style="color:#667;font-size:12px">${address}</p>` : ""}`,
    text: `${heading}\n\n${url}\n\nIf you did not request this, you can ignore this email.${address ? `\n\n${address}` : ""}`,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const requestUrl = new URL(req.url);
    const oneClickUnsubscribe = requestUrl.searchParams.get("action") === "unsubscribe";
    const body = oneClickUnsubscribe
      ? { action: "unsubscribe", token: requestUrl.searchParams.get("token") ?? "" }
      : await req.json();
    const action = String(body.action ?? "");
    const supabase = adminClient();

    if (action === "request_subscription") {
      if (!await verifyTurnstile(body.turnstile_token, req.headers.get("cf-connecting-ip"))) {
        return json(req, { error: "Human verification failed" }, 400);
      }
      const email = String(body.email ?? "").trim().toLowerCase();
      if (email.length > 320 || !emailPattern.test(email)) return json(req, { error: "Enter a valid email address" }, 400);
      const companyIds = await validatedCompanies(supabase, body.company_ids);
      const { data: existing, error: lookupError } = await supabase.from("subscribers").select("*").eq("email", email).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing?.status === "suppressed") {
        return json(req, { message: "Check your inbox for a secure verification or management link." });
      }
      const lastAccessEmailAt = Date.parse(existing?.last_access_email_at ?? "");
      if (Number.isFinite(lastAccessEmailAt) && Date.now() - lastAccessEmailAt < 60_000) {
        return json(req, { message: "Check your inbox for a secure verification or management link." });
      }
      let subscriber = existing;
      if (!subscriber) {
        const { data, error } = await supabase.from("subscribers").insert({ email, status: "pending", consented_at: new Date().toISOString() }).select("*").single();
        if (error) throw error;
        subscriber = data;
      } else if (subscriber.status !== "active") {
        const nextVersion = subscriber.status === "pending" ? subscriber.token_version : subscriber.token_version + 1;
        const { data, error } = await supabase.from("subscribers").update({
          status: "pending",
          token_version: nextVersion,
          consented_at: new Date().toISOString(),
          unsubscribed_at: null,
        }).eq("id", subscriber.id).select("*").single();
        if (error) throw error;
        subscriber = data;
      }
      if (subscriber.status !== "active") await replacePreferences(supabase, subscriber.id, companyIds);
      const { error: accessUpdateError } = await supabase.from("subscribers")
        .update({ last_access_email_at: new Date().toISOString() }).eq("id", subscriber.id);
      if (accessUpdateError) throw accessUpdateError;
      await sendAccessEmail(subscriber);
      return json(req, { message: "Check your inbox for a secure verification or management link." });
    }

    if (action === "verify") {
      const subscriber = await subscriberFromToken(supabase, String(body.token ?? ""), ["pending", "active"]);
      const { data, error } = await supabase.from("subscribers").update({ status: "active", confirmed_at: new Date().toISOString() }).eq("id", subscriber.id).select("*").single();
      if (error) throw error;
      return json(req, { email: data.email, company_ids: await preferences(supabase, data.id) });
    }

    if (action === "get_preferences") {
      const subscriber = await subscriberFromToken(supabase, String(body.token ?? ""), ["active"]);
      return json(req, { email: subscriber.email, company_ids: await preferences(supabase, subscriber.id) });
    }

    if (action === "update_preferences") {
      const subscriber = await subscriberFromToken(supabase, String(body.token ?? ""), ["active"]);
      const companyIds = await validatedCompanies(supabase, body.company_ids);
      await replacePreferences(supabase, subscriber.id, companyIds);
      return json(req, { message: "Preferences saved", company_ids: companyIds });
    }

    if (action === "unsubscribe") {
      const subscriber = await subscriberFromToken(supabase, String(body.token ?? ""), ["pending", "active"]);
      const { error } = await supabase.from("subscribers").update({
        status: "unsubscribed",
        unsubscribed_at: new Date().toISOString(),
        token_version: subscriber.token_version + 1,
      }).eq("id", subscriber.id);
      if (error) throw error;
      return oneClickUnsubscribe
        ? new Response(null, { status: 200, headers: { ...corsHeaders(req), "Cache-Control": "no-store" } })
        : json(req, { message: "Unsubscribed" });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (error) {
    console.error("subscription-api error", error instanceof Error ? error.message : error);
    const message = error instanceof Error && /^(Invalid|Select|One or more)/.test(error.message)
      ? error.message
      : "The alert service could not complete that request";
    const status = /Invalid or expired/.test(message) ? 401 : /^(Select|One or more|Invalid company)/.test(message) ? 400 : 500;
    return json(req, { error: message }, status);
  }
});
