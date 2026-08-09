import {
  adminClient,
  corsHeaders,
  escapeHtml,
  json,
  publicSiteUrl,
  sendEmail,
  sha256,
  subscriberToken,
} from "../_shared/common.ts";

type CatalogCompany = { id: string; name: string; parent_id?: string | null; featured?: boolean; bucket?: string };
type Role = {
  role_id: string;
  company_id: string;
  company: string;
  title: string;
  location?: string;
  role_type: string;
  disciplines?: string[];
  url: string;
  posted_at?: string;
  date_seen?: string;
};

function validPayload(scanId: unknown, companies: unknown, roles: unknown): companies is CatalogCompany[] {
  return typeof scanId === "string"
    && scanId.length > 0
    && Array.isArray(companies)
    && companies.length > 0
    && companies.length <= 1000
    && Array.isArray(roles)
    && roles.length <= 500;
}

function roleListHtml(roles: Role[]) {
  return roles.map((role) => `<li style="margin-bottom:16px"><strong>${escapeHtml(role.company)} — ${escapeHtml(role.title)}</strong><br><span>${escapeHtml(role.location || "Location not listed")} · ${escapeHtml(role.role_type)}</span><br><a href="${escapeHtml(role.url)}">View official posting</a></li>`).join("");
}

function roleListText(roles: Role[]) {
  return roles.map((role) => `${role.company} — ${role.title}\n${role.location || "Location not listed"} · ${role.role_type}\n${role.url}`).join("\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  const expectedSecret = Deno.env.get("INGEST_SECRET") ?? "";
  if (!expectedSecret || req.headers.get("x-ingest-secret") !== expectedSecret) return json(req, { error: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    if (!validPayload(body.scan_id, body.companies, body.roles)) return json(req, { error: "Invalid ingestion payload" }, 400);
    const companies = body.companies as CatalogCompany[];
    const roles = body.roles as Role[];
    if (roles.some((role) => !role.role_id || !role.company_id || !role.company || !role.title || !/^https?:\/\//.test(role.url))) {
      return json(req, { error: "Invalid role record" }, 400);
    }

    const supabase = adminClient();
    const roots = companies.filter((company) => !company.parent_id);
    const children = companies.filter((company) => company.parent_id);
    for (const batch of [roots, children]) {
      if (batch.length === 0) continue;
      const { error } = await supabase.from("companies").upsert(batch.map((company) => ({
        id: company.id,
        name: company.name,
        parent_id: company.parent_id ?? null,
        featured: Boolean(company.featured),
        bucket: company.bucket ?? "",
        updated_at: new Date().toISOString(),
      })), { onConflict: "id" });
      if (error) throw error;
    }

    const { error: scanError } = await supabase.from("notification_scans").upsert({
      scan_id: body.scan_id,
      role_count: roles.length,
    }, { onConflict: "scan_id" });
    if (scanError) throw scanError;

    if (roles.length === 0) return json(req, { scan_id: body.scan_id, roles: 0, recipients: 0, sent: 0 });
    const { error: roleError } = await supabase.from("notification_roles").upsert(roles.map((role) => ({
      role_id: role.role_id,
      company_id: role.company_id,
      company: role.company,
      title: role.title,
      location: role.location ?? "",
      role_type: role.role_type,
      disciplines: role.disciplines ?? [],
      url: role.url,
      posted_at: role.posted_at || null,
      date_seen: role.date_seen || null,
      first_scan_id: body.scan_id,
    })), { onConflict: "role_id", ignoreDuplicates: true });
    if (roleError) throw roleError;

    const parentByCompany = new Map(companies.map((company) => [company.id, company.parent_id ?? null]));
    const matchCompanyIds = [...new Set(roles.flatMap((role) => [role.company_id, parentByCompany.get(role.company_id)].filter(Boolean) as string[]))];
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from("subscription_companies")
      .select("subscriber_id, company_id")
      .in("company_id", matchCompanyIds);
    if (subscriptionError) throw subscriptionError;

    const recipientRoles = new Map<string, Role[]>();
    for (const subscription of subscriptions ?? []) {
      const matching = roles.filter((role) => role.company_id === subscription.company_id
        || parentByCompany.get(role.company_id) === subscription.company_id);
      if (matching.length === 0) continue;
      const current = recipientRoles.get(subscription.subscriber_id) ?? [];
      const known = new Set(current.map((role) => role.role_id));
      current.push(...matching.filter((role) => !known.has(role.role_id)));
      recipientRoles.set(subscription.subscriber_id, current);
    }

    const subscriberIds = [...recipientRoles.keys()];
    if (subscriberIds.length === 0) return json(req, { scan_id: body.scan_id, roles: roles.length, recipients: 0, sent: 0 });
    const { data: subscribers, error: subscriberError } = await supabase
      .from("subscribers")
      .select("id, email, status, token_version")
      .in("id", subscriberIds)
      .eq("status", "active");
    if (subscriberError) throw subscriberError;

    let sent = 0;
    const failures: string[] = [];
    for (const subscriber of subscribers ?? []) {
      const matchedRoles = recipientRoles.get(subscriber.id) ?? [];
      const roleIds = matchedRoles.map((role) => role.role_id);
      const { data: existingDeliveries, error: deliveryLookupError } = await supabase
        .from("notification_deliveries")
        .select("role_id, status")
        .eq("subscriber_id", subscriber.id)
        .in("role_id", roleIds);
      if (deliveryLookupError) throw deliveryLookupError;
      const sentRoleIds = new Set((existingDeliveries ?? []).filter((delivery) => ["sent", "delivered"].includes(delivery.status)).map((delivery) => delivery.role_id));
      const deliverableRoles = matchedRoles.filter((role) => !sentRoleIds.has(role.role_id));
      if (deliverableRoles.length === 0) continue;

      const existingRoleIds = new Set((existingDeliveries ?? []).map((delivery) => delivery.role_id));
      const newDeliveryRows = deliverableRoles
        .filter((role) => !existingRoleIds.has(role.role_id))
        .map((role) => ({ subscriber_id: subscriber.id, role_id: role.role_id, scan_id: body.scan_id, status: "pending" }));
      if (newDeliveryRows.length > 0) {
        const { error } = await supabase.from("notification_deliveries").insert(newDeliveryRows);
        if (error) throw error;
      }

      try {
        const token = await subscriberToken(subscriber.id, subscriber.token_version);
        const manageUrl = `${publicSiteUrl()}?action=manage&token=${encodeURIComponent(token)}`;
        const unsubscribeUrl = `${publicSiteUrl()}?action=unsubscribe&token=${encodeURIComponent(token)}`;
        const subscriptionApiUrl = Deno.env.get("SUBSCRIPTION_API_URL") ?? "";
        if (!/^https:\/\//i.test(subscriptionApiUrl)) throw new Error("SUBSCRIPTION_API_URL must be an HTTPS URL");
        const oneClickUnsubscribeUrl = `${subscriptionApiUrl}?action=unsubscribe&token=${encodeURIComponent(token)}`;
        const address = escapeHtml(Deno.env.get("MAILING_ADDRESS") ?? "");
        const subject = deliverableRoles.length === 1
          ? `New role at ${deliverableRoles[0].company}`
          : `${deliverableRoles.length} new roles at companies you follow`;
        const idempotencyKey = `digest-${await sha256(`${body.scan_id}:${subscriber.id}:${deliverableRoles.map((role) => role.role_id).sort().join(",")}`)}`;
        const email = await sendEmail({
          to: subscriber.email,
          subject,
          html: `<h1>${escapeHtml(subject)}</h1><p>The 2027 role tracker found new matching opportunities:</p><ul>${roleListHtml(deliverableRoles)}</ul><p><a href="${manageUrl}">Manage companies</a> · <a href="${unsubscribeUrl}">Unsubscribe</a></p>${address ? `<p style="color:#667;font-size:12px">${address}</p>` : ""}`,
          text: `${subject}\n\n${roleListText(deliverableRoles)}\n\nManage: ${manageUrl}\nUnsubscribe: ${unsubscribeUrl}${address ? `\n\n${address}` : ""}`,
          idempotencyKey,
          headers: {
            "List-Unsubscribe": `<${oneClickUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        const { error: updateError } = await supabase.from("notification_deliveries").update({
          status: "sent",
          provider_id: email.id,
          sent_at: new Date().toISOString(),
          error: "",
        }).eq("subscriber_id", subscriber.id).in("role_id", deliverableRoles.map((role) => role.role_id));
        if (updateError) throw updateError;
        await supabase.from("subscribers").update({ last_notified_at: new Date().toISOString() }).eq("id", subscriber.id);
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${subscriber.id}: ${message}`);
        await supabase.from("notification_deliveries").update({ status: "failed", error: message.slice(0, 500) })
          .eq("subscriber_id", subscriber.id).in("role_id", deliverableRoles.map((role) => role.role_id));
      }
    }

    return json(req, {
      scan_id: body.scan_id,
      roles: roles.length,
      recipients: (subscribers ?? []).length,
      sent,
      failures: failures.length,
    }, failures.length > 0 && sent === 0 ? 502 : 200);
  } catch (error) {
    console.error("ingest-roles error", error instanceof Error ? error.message : error);
    return json(req, { error: "Role notification ingestion failed" }, 500);
  }
});
