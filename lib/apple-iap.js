// App Store Server API client for Learnify Pro subscriptions.
//
// Signs ES256 JWTs with the App Store Connect In-App Purchase key and queries
// subscription status. Tries production first, falls back to sandbox when the
// transaction is unknown there (Apple's recommended pattern, so TestFlight and
// review purchases keep working).
//
// Env (Vercel): APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY
// (the .p8 PEM contents; literal "\n" sequences are tolerated).

import { createPrivateKey, createSign } from "node:crypto";

const BUNDLE_ID = "com.techscroll.app";
const PRO_PRODUCT_PREFIX = "com.techscroll.app.pro.";

const HOSTS = {
  production: "https://api.storekit.itunes.apple.com",
  sandbox: "https://api.storekit-sandbox.itunes.apple.com",
};

// https://developer.apple.com/documentation/appstoreserverapi/status
const STATUS = {
  1: "active",
  2: "expired",
  3: "billing_retry",
  4: "grace_period",
  5: "revoked",
};
const ENTITLED_STATUSES = new Set([1, 4]); // active or in billing grace period

const b64url = (buf) => Buffer.from(buf).toString("base64url");

let cachedToken = null; // { jwt, exp } — reused across warm invocations

export function appStoreJWT() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 120) return cachedToken.jwt;

  const keyId = process.env.APPLE_IAP_KEY_ID;
  const issuerId = process.env.APPLE_IAP_ISSUER_ID;
  const pem = (process.env.APPLE_IAP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!keyId || !issuerId || !pem) throw new Error("missing APPLE_IAP_* env");

  const exp = now + 1800;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: issuerId, iat: now, exp, aud: "appstoreconnect-v1", bid: BUNDLE_ID })
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  const jwt = `${header}.${payload}.${b64url(sig)}`;
  cachedToken = { jwt, exp };
  return jwt;
}

// Decode a JWS payload from Apple. No chain verification needed: the JWS is
// fetched directly from Apple's API over TLS, not relayed by an untrusted client.
export function decodeJWS(jws) {
  try {
    return JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function getSubscriptionStatuses(transactionId, environment) {
  const res = await fetch(
    `${HOSTS[environment]}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${appStoreJWT()}` } }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Resolve the Pro entitlement for a StoreKit transaction id.
// Returns { isPro, status, productId, expiresDate, autoRenew, environment }
// or { notFound: true } when neither environment knows the transaction.
export async function verifyProSubscription(transactionId) {
  let environment = "production";
  let { status, body } = await getSubscriptionStatuses(transactionId, environment);
  if (status === 404 && body.errorCode === 4040010) {
    environment = "sandbox";
    ({ status, body } = await getSubscriptionStatuses(transactionId, environment));
  }
  if (status === 404 && body.errorCode === 4040010) return { notFound: true };
  if (status !== 200) {
    throw new Error(`app_store_api_${status}:${body.errorCode || "unknown"}`);
  }

  // Pick the most favorable Pro transaction across the subscription group.
  let best = null;
  for (const group of body.data || []) {
    for (const last of group.lastTransactions || []) {
      const txn = decodeJWS(last.signedTransactionInfo);
      if (!txn || !txn.productId?.startsWith(PRO_PRODUCT_PREFIX)) continue;
      const renewal = decodeJWS(last.signedRenewalInfo);
      const candidate = {
        isPro: ENTITLED_STATUSES.has(last.status),
        status: STATUS[last.status] || `unknown_${last.status}`,
        productId: txn.productId,
        expiresDate: txn.expiresDate ? new Date(txn.expiresDate).toISOString() : null,
        autoRenew: renewal ? renewal.autoRenewStatus === 1 : null,
        environment,
      };
      if (!best || (candidate.isPro && !best.isPro)) best = candidate;
    }
  }
  return best || { notFound: true };
}
