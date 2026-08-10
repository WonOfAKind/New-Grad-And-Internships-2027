import { createClient } from "@supabase/supabase-js";

const encoder = new TextEncoder();

export function corsHeaders(req: Request) {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] ?? "null");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "content-type, x-ingest-secret, svix-id, svix-signature, svix-timestamp",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string) {
  const secret = Deno.env.get("MAGIC_LINK_SECRET");
  if (!secret || secret.length < 32) throw new Error("MAGIC_LINK_SECRET must contain at least 32 characters");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function subscriberToken(id: string, version: number) {
  const payload = `${id}:${version}`;
  return `${base64Url(encoder.encode(payload))}.${base64Url(await hmac(payload))}`;
}

export async function verifySubscriberToken(token: string) {
  const [encodedPayload, encodedSignature, extra] = String(token ?? "").split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid or expired preference link");
  const payload = new TextDecoder().decode(fromBase64Url(encodedPayload));
  const expected = await hmac(payload);
  const received = fromBase64Url(encodedSignature);
  if (expected.length !== received.length) throw new Error("Invalid or expired preference link");
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ received[index];
  if (mismatch !== 0) throw new Error("Invalid or expired preference link");
  const match = /^([0-9a-f-]{36}):(\d+)$/.exec(payload);
  if (!match) throw new Error("Invalid or expired preference link");
  return { id: match[1], version: Number(match[2]) };
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export function publicSiteUrl() {
  const value = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("PUBLIC_SITE_URL must be an HTTPS URL");
  return value;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and MAIL_FROM are required");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.headers ? { headers: input.headers } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Resend returned ${response.status}`);
  return payload as { id: string };
}

export async function verifyTurnstile(token: string | undefined, ip: string | null) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const payload = await response.json().catch(() => ({ success: false }));
  return Boolean(payload.success);
}

export function validateCompanyIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error("Select between 1 and 100 companies");
  const ids = [...new Set(value.map(String))];
  if (ids.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) throw new Error("Invalid company selection");
  return ids;
}

export async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
