# ArticleWatch

## Run it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (outputs to dist/)
```

## Enable real email sending (required)

A browser app has no raw socket access, so it cannot speak SMTP directly.
This app sends mail through **EmailJS** — a relay that holds your
Gmail/Outlook/SMTP connection on its side and exposes a plain HTTPS endpoint
that the browser can call. The `@emailjs/browser` SDK is already wired into
`src/App.jsx` (function `sendEmailForPlan`); you just need an account.

1. Go to **emailjs.com** and create a free account.
2. **Email Services** → Add Service → connect Gmail / Outlook / SMTP. This is
   where your real sending credentials live (note: Gmail/Outlook OAuth is far
   simpler than entering an SMTP password — recommended).
3. **Email Templates** → create a template. Set the template's **To Email**
   field to `{{to_email}}`. In the body, use the variables the app sends:
   - `{{to_email}}` — recipient address
   - `{{subject}}` — email subject
   - `{{plan_name}}` — the plan's name
   - `{{articles_count}}` — number of articles in the digest
   - `{{message}}` — pre-built HTML block listing the articles (set the
     template's content type to HTML, or it'll show raw tags)
   - `{{from_name}}` — sender display name
   - `{{reply_to}}` — reply-to address
4. **Account** → General → copy your **Public Key**.
5. In the running app: **Settings → Email Sending (EmailJS)** → paste in
   Service ID, Template ID, and Public Key → Save.

Once those three fields are filled in, both the **Send Now** button (Plan →
Email tab) and any plan with **Auto-send after crawl** turned on will deliver
real emails to the recipient groups you've added for that plan.

## What changed from the original file

- `sendEmailForPlan` was referenced in three places (manual Send Now,
  immediate auto-send after a crawl, and scheduled auto-send) but was never
  defined — so every send silently failed. It's now implemented: it builds an
  HTML digest from the plan's articles, loops over each recipient calling
  EmailJS, logs a record to the Email Sent History table, and updates the
  activity log / toasts either way.
- Settings now has a real **Email Sending (EmailJS)** section instead of the
  placeholder "SMTP (legacy)" copy that said real sending needed a Python
  backend.
- The old SMTP host/port/password fields are kept only as a label for the
  "From" name and reply-to address shown in outgoing mail — they're not used
  for actual delivery (a static frontend can't use them directly).
