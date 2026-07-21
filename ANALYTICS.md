# Learnify product analytics

Learnify uses privacy-gated [Vercel Web Analytics](https://vercel.com/docs/analytics) for aggregate product metrics. Analytics is **off by default**, both at deployment and for each visitor. The Vercel script loads only when:

1. `LEARNIFY_ANALYTICS_ENABLED=true` is set for the deployment; and
2. the visitor chooses **Allow anonymous analytics**.

No analytics credentials belong in the repository. Enable Web Analytics for the Vercel project in the Vercel dashboard, add the environment variable, and redeploy. Local static development receives no config endpoint and therefore sends nothing.

## Privacy boundary

- Manual custom events only; no autocapture and no session replay. Automatic page views are reduced to origin + path; query strings and fragments are removed before sending.
- Never send article titles/IDs/URLs, search terms, flashcard or form contents, email addresses, account/user IDs, auth errors/messages, IP addresses as custom properties, or stack traces.
- Reading history, saved items, XP, and per-article progress remain in the app's existing stores. Analytics only receives coarse aggregate dimensions such as screen, source, category, and action.
- Consent is stored as `learnify.analytics.consent.v1` in local storage. A visitor can reopen **Analytics preferences** at any time. Declining suppresses all future custom events; the provider is never initialized for visitors who decline.
- A tab-scoped session accumulator is kept in session storage without a user or session identifier. It expires after 30 inactive minutes.

## Event dictionary

| Event | Allowed properties | Meaning |
|---|---|---|
| `analytics_consent_granted` | `policy_version` | Visitor opted in. |
| `screen_viewed` | `screen` | Core site/app screen became visible. |
| `session_started` | `screen` | New tab session, or return after 30 inactive minutes. |
| `session_minute` | `minute_bucket` | One completed minute of foreground/visible engagement. |
| `session_ended` | `duration_bucket`, `reason` | Previous session was closed after a 30-minute inactivity boundary. |
| `acquisition_cta_clicked` | `destination` | Landing-page CTA to web app or App Store. |
| `article_selected` | `surface` | A Learnify card/reel was opened. |
| `article_opened` | `source_id`, `category`, `content_kind`, `auth_state` | Article detail rendered; no article identifier is sent. |
| `article_link_out` | `surface`, `source_id` | Visitor left for the publisher. |
| `article_save_toggled` | `surface`, `action`, `auth_state` | Save/remove action. |
| `briefing_started` | `surface` | Today's briefing CTA used. |
| `brain_bank_viewed` | `items_bucket`, `auth_state` | Saved screen rendered, with coarse count only. |
| `quiz_answered` | `surface`, `correct`, `auth_state` | Quiz attempt; no answer/question text. |
| `flashcard_created` | `category` | Flashcard insert succeeded; no question/answer. |
| `filter_applied` | `filter_kind`, `surface` | Coarse filter interaction; no search term. |
| `sign_in_prompted` | `feature` | A gated feature led to sign-in. |
| `auth_mode_selected` | `mode` | Login/signup UI toggle. |
| `auth_attempted`, `auth_completed`, `auth_failed` | `mode`, `method`, optional `error_kind` | Authentication funnel without email/error text. |
| `content_load_failed` | `resource`, `fallback` | Article API/snapshot availability failure. |
| `client_error` | `screen`, `error_kind`, `source_class` | Max three coarse browser errors per page; no URL/message/stack. |

`app/analytics.js` rejects unknown events and removes all properties not explicitly listed above.

## Suggested Vercel reports

In **Vercel → Project → Analytics → Events**, create/save these views:

1. **Activation funnel:** `screen_viewed{screen=landing}` → `acquisition_cta_clicked{destination=web_app}` → `article_opened` → `article_link_out` or `article_save_toggled{action=saved}`.
2. **Learning loop:** `screen_viewed{screen=learn}` → `article_selected{surface=learn}` → `quiz_answered` → `article_save_toggled`.
3. **Auth funnel:** `sign_in_prompted` → `auth_attempted` → `auth_completed`; break down failure rate by `method` and coarse `error_kind`.
4. **Content reliability:** trend `content_load_failed` and `client_error`; alert on material week-over-week increases.
5. **Feature adoption:** unique visitors for `briefing_started`, `brain_bank_viewed`, `quiz_answered`, and `flashcard_created`, divided by opted-in app visitors.

Vercel plan capabilities vary; if funnels are unavailable, compare event counts and unique visitors over the same date range or export events to a warehouse.

## Session duration interpretation

`session_minute` is the robust primary approximation. The module accumulates only foreground time, checkpoints every 15 seconds, and emits exactly once for each completed active minute across full-page navigation in the same tab.

**Average engaged minutes per started session ≈ `session_minute` event count / `session_started` event count.**

This is a conservative lower bound with less than one minute of rounding loss per session. It excludes background-tab time. `session_ended.duration_bucket` is useful as a directional distribution, but it appears only if that tab later returns after the 30-minute inactivity boundary, so do not use it alone as the denominator.

## Verification

1. Leave `LEARNIFY_ANALYTICS_ENABLED` unset: no consent UI and no request to `/_vercel/insights/script.js` should occur.
2. Set it to `true` in a preview deployment with Vercel Web Analytics enabled.
3. Choose **No thanks**: confirm the Vercel script is not requested and events do not appear.
4. Clear `learnify.analytics.consent.v1`, reload, choose **Allow**, navigate through Latest → Article → publisher, save, and answer a quiz.
5. Confirm only allowlisted event names/properties appear in Vercel Debug/Analytics. Inspect payloads to verify that titles, URLs, search/form values, account IDs, and error messages are absent.
6. Keep the page visible for over 60 seconds and confirm one `session_minute` event.
