import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dns from "dns";
import { promisify } from "util";
import { rateLimit } from "express-rate-limit";


// Bypass strict SSL certificate validation for corporate/local proxies
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const dnsLookup = promisify(dns.lookup);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Railway (and most PaaS) sit behind a reverse proxy and set X-Forwarded-For.
// Without trusting the proxy, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR since it can't safely determine the
// real client IP. `1` trusts exactly one hop (the platform's proxy), which
// is correct for Railway's setup.
app.set("trust proxy", 1);

// Scope CORS origin to localhost, Vercel subdomains, and Railway subdomains.
// Using only a fixed env var here is fragile — Railway can assign/rotate
// public domains (e.g. *.up.railway.app) across redeploys or environments,
// and a mismatch here makes EVERY request fail with "Not allowed by CORS",
// breaking the whole app (not just email). We allow common platform
// wildcard domains automatically, plus anything explicitly set via
// ALLOWED_ORIGIN for a custom domain.
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];
if (process.env.ALLOWED_ORIGIN) {
  allowedOrigins.push(process.env.ALLOWED_ORIGIN);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);

    const isExplicitlyAllowed = allowedOrigins.some((allowed) => {
      if (allowed.includes("*")) {
        const regex = new RegExp("^" + allowed.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
        return regex.test(origin);
      }
      return allowed === origin;
    });

    const isKnownPlatformDomain =
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".up.railway.app") ||
      origin.endsWith(".railway.app") ||
      origin.endsWith(".railway.internal");

    if (isExplicitlyAllowed || isKnownPlatformDomain) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from unrecognized origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: "10mb" })); // support large HTML payloads for article digests

// Rate Limiters
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 API calls per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 email sends per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Email rate limit exceeded. Please try again in a few minutes." },
});

const crawlerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Limit each IP to 2000 fetches per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Crawler fetch limit exceeded. Please try again later." },
});

app.use("/api/send-email", emailLimiter);
app.use("/api/call-ai", generalApiLimiter);
app.use("/api/fetch-url", crawlerLimiter);

// Serve static assets from the Vite build directory
app.use(express.static(path.join(__dirname, "dist")));

app.post("/api/send-email", async (req, res) => {
  const {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    senderEmail,
    senderName,
    to,
    subject,
    html,
  } = req.body;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword || !to || !subject || !html) {
    return res.status(400).json({ error: "Missing required SMTP credentials or email contents." });
  }

  const logoPath = fs.existsSync(path.join(__dirname, "dist", "logo.jpg"))
    ? path.join(__dirname, "dist", "logo.jpg")
    : path.join(__dirname, "public", "logo.jpg");

  // --- Attempt 1: Resend HTTP API ---------------------------------------
  // Many hosts (Railway, Render, free tiers, etc.) block outbound SMTP
  // ports (587/465) for anti-spam reasons, causing "Connection timeout"
  // even with valid credentials. Resend sends over HTTPS (port 443),
  // which is never blocked. If RESEND_API_KEY is set, use it as the
  // primary path and only fall back to raw SMTP if it's not configured.
  if (process.env.RESEND_API_KEY) {
    try {
      const fromAddress = senderEmail || smtpUser;
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${senderName || "Insight Flow AI"} <${fromAddress}>`,
          to: [to],
          subject,
          html,
        }),
      });

      const resendData = await resendRes.json();

      if (!resendRes.ok) {
        console.error("[Email Proxy] Resend API error:", resendData);
        // fall through to SMTP attempt below instead of returning immediately
      } else {
        console.log(`[Email Proxy] Email sent via Resend to ${to}: ${resendData.id}`);
        return res.status(200).json({ success: true, messageId: resendData.id, via: "resend" });
      }
    } catch (resendErr) {
      console.error("[Email Proxy] Resend request failed:", resendErr);
      // fall through to SMTP attempt below
    }
  } else {
    console.warn("[Email Proxy] RESEND_API_KEY not set — falling back to raw SMTP (may time out on this host).");
  }

  // --- Attempt 2: Raw SMTP (Nodemailer) ----------------------------------
  try {
    const port = parseInt(smtpPort, 10);
    const isSecure = port === 465;

    // Resolve to an IPv4 address explicitly — some hosts' DNS resolver
    // hands back an IPv6 address even when family:4 is set, causing
    // ENETUNREACH. Keep the original hostname for TLS via servername/name.
    let connectHost = smtpHost;
    try {
      const resolved = await dnsLookup(smtpHost, { family: 4 });
      if (resolved?.address) {
        connectHost = resolved.address;
        console.log(`[Email Proxy] Resolved ${smtpHost} -> IPv4 ${connectHost}`);
      }
    } catch (resolveErr) {
      console.warn(`[Email Proxy] IPv4 resolution failed for ${smtpHost}, falling back to hostname:`, resolveErr.message);
    }

    const transporter = nodemailer.createTransport({
      host: connectHost,
      port,
      secure: isSecure,
      family: 4,
      name: smtpHost,
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production",
        servername: smtpHost,
      },
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const attachments = [];
    if (fs.existsSync(logoPath)) {
      console.log(`[Email Proxy] Logo file found at ${logoPath}. Attaching inline.`);
      attachments.push({
        filename: "logo.jpg",
        path: logoPath,
        cid: "logo",
        contentType: "image/jpeg"
      });
    } else {
      console.warn(`[Email Proxy] Warning: Logo file NOT found at ${logoPath}. Check the path.`);
    }

    const mailOptions = {
      from: `"${senderName || "Insight Flow AI"}" <${senderEmail || smtpUser}>`,
      to,
      subject,
      html,
      attachments
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email successfully sent to ${to}: ${info.messageId}`);
    res.status(200).json({ success: true, messageId: info.messageId, via: "smtp" });
  } catch (error) {
    console.error("Nodemailer Send Error:", error);
    const isTimeout = /timeout|ETIMEDOUT|ENETUNREACH|ECONNREFUSED/i.test(error.message || "");
    res.status(500).json({
      error: error.message || "Failed to send email via SMTP.",
      hint: isTimeout
        ? "Your host is likely blocking outbound SMTP ports (587/465). Set RESEND_API_KEY env var to send via HTTPS instead."
        : undefined,
    });
  }
});

app.post("/api/call-ai", async (req, res) => {
  const { provider, apiKey, systemPrompt, userPrompt, model } = req.body;

  if (!provider || !apiKey) {
    return res.status(400).json({ error: "Missing provider or API key." });
  }

  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : "none";
  console.log(`[AI Proxy] Calling ${provider} (model: ${model || "default"}) with key: ${maskedKey}`);

  try {
    let responseText = "";
    let remainingRequests = "N/A";
    let remainingTokens = "N/A";

    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.0-flash"}:generateContent?key=${apiKey}`;
      const apiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }]
        })
      });
      const data = await apiRes.json();
      if (data?.error) {
        const errMsg = data.error.message || "Gemini error";
        console.warn(`[AI Proxy] Gemini call failed: ${errMsg}`);
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        const errType = isQuota ? "exhausted" : "invalid";
        return res.status(apiRes.status || 500).json({ error: errMsg, errType });
      }
      responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "huggingface") {
      const apiRes = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || "meta-llama/Llama-3.2-3B-Instruct",
          max_tokens: 1000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        })
      });
      remainingRequests = apiRes.headers.get("x-rate-limit-remaining") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || data?.error || "Hugging Face error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        const errType = isQuota ? "exhausted" : "invalid";
        return res.status(apiRes.status || 500).json({ error: errMsg, errType });
      }
      responseText = data?.choices?.[0]?.message?.content || "";
    } else if (provider === "openai") {
      const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          max_tokens: 1000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        })
      });
      remainingRequests = apiRes.headers.get("x-ratelimit-remaining-requests") || "N/A";
      remainingTokens = apiRes.headers.get("x-ratelimit-remaining-tokens") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "OpenAI error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        const errType = isQuota ? "exhausted" : "invalid";
        return res.status(apiRes.status || 500).json({ error: errMsg, errType });
      }
      responseText = data?.choices?.[0]?.message?.content || "";
    } else if (provider === "groq") {
      const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || "llama-3.3-70b-versatile",
          max_tokens: 1000,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        })
      });
      remainingRequests = apiRes.headers.get("x-ratelimit-remaining-requests") || "N/A";
      remainingTokens = apiRes.headers.get("x-ratelimit-remaining-tokens") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "Groq error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        const errType = isQuota ? "exhausted" : "invalid";
        return res.status(apiRes.status || 500).json({ error: errMsg, errType });
      }
      responseText = data?.choices?.[0]?.message?.content || "";
    } else if (provider === "claude") {
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: model || "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }]
        })
      });
      remainingRequests = apiRes.headers.get("anthropic-ratelimit-requests-remaining") || "N/A";
      remainingTokens = apiRes.headers.get("anthropic-ratelimit-tokens-remaining") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "Claude error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        const errType = isQuota ? "exhausted" : "invalid";
        return res.status(apiRes.status || 500).json({ error: errMsg, errType });
      }
      responseText = data?.content?.[0]?.text || "";
    } else {
      return res.status(400).json({ error: "Unsupported provider." });
    }

    res.status(200).json({ 
      text: responseText, 
      quota: { remainingRequests, remainingTokens } 
    });
  } catch (error) {
    console.error("AI Proxy Error:", error);
    res.status(500).json({ error: error.message || "Failed to call AI provider.", errType: "invalid" });
  }
});

app.post("/api/validate-key", async (req, res) => {
  const { provider, apiKey } = req.body;

  if (!provider || !apiKey) {
    return res.status(400).json({ error: "Missing provider or API key." });
  }

  try {
    let remainingRequests = "N/A";
    let remainingTokens = "N/A";

    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const apiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }]
        })
      });
      const data = await apiRes.json();
      if (data?.error) {
        const errMsg = data.error.message || "Gemini validation error";
        console.warn(`[AI Proxy] Gemini key validation failed: ${errMsg}`);
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        return res.status(200).json({ success: false, errorType: isQuota ? "exhausted" : "invalid", message: errMsg });
      }
    } else if (provider === "huggingface") {
      // Use whoami-v2 which is extremely fast and checks key validity without trigger time
      const apiRes = await fetch("https://huggingface.co/api/whoami-v2", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      });
      remainingRequests = apiRes.headers.get("x-rate-limit-remaining") || "N/A";
      const data = await apiRes.json();
      if (apiRes.status !== 200) {
        const errMsg = data?.error || "Hugging Face validation error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        return res.status(200).json({ success: false, errorType: isQuota ? "exhausted" : "invalid", message: errMsg });
      }
    } else if (provider === "openai") {
      const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      remainingRequests = apiRes.headers.get("x-ratelimit-remaining-requests") || "N/A";
      remainingTokens = apiRes.headers.get("x-ratelimit-remaining-tokens") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "OpenAI validation error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        return res.status(200).json({ success: false, errorType: isQuota ? "exhausted" : "invalid", message: errMsg });
      }
    } else if (provider === "groq") {
      const apiRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      remainingRequests = apiRes.headers.get("x-ratelimit-remaining-requests") || "N/A";
      remainingTokens = apiRes.headers.get("x-ratelimit-remaining-tokens") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "Groq validation error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        return res.status(200).json({ success: false, errorType: isQuota ? "exhausted" : "invalid", message: errMsg });
      }
    } else if (provider === "claude") {
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      remainingRequests = apiRes.headers.get("anthropic-ratelimit-requests-remaining") || "N/A";
      remainingTokens = apiRes.headers.get("anthropic-ratelimit-tokens-remaining") || "N/A";
      const data = await apiRes.json();
      if (data?.error || apiRes.status !== 200) {
        const errMsg = data?.error?.message || "Claude validation error";
        const isQuota = apiRes.status === 429 || errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit");
        return res.status(200).json({ success: false, errorType: isQuota ? "exhausted" : "invalid", message: errMsg });
      }
    } else {
      return res.status(400).json({ error: "Unsupported provider." });
    }

    res.status(200).json({ 
      success: true, 
      quota: { remainingRequests, remainingTokens } 
    });
  } catch (error) {
    res.status(200).json({ success: false, errorType: "invalid", message: error.message || "Failed to validate key" });
  }
});

function isPrivateIP(ip) {
  // IPv4 Loopback, Private, Link-Local
  if (
    /^(127\.|10\.|192\.168\.)/.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
    /^169\.254\./.test(ip)
  ) {
    return true;
  }
  // IPv6 Loopback, Link-Local, Unique Local
  if (
    ip === "::1" ||
    ip.startsWith("fe80:") ||
    ip.toLowerCase().startsWith("fc") ||
    ip.toLowerCase().startsWith("fd")
  ) {
    return true;
  }
  return false;
}

async function validateUrlForSSRF(urlStr) {
  try {
    const parsed = new URL(urlStr);
    
    // Only allow http and https protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname;
    
    // If hostname is directly an IP address
    if (/^[0-9.]+$/.test(hostname) || hostname.includes(":")) {
      if (isPrivateIP(hostname)) return false;
    }

    // Resolve DNS to verify the target IP
    const lookupResult = await dnsLookup(hostname).catch(() => null);
    if (lookupResult && lookupResult.address) {
      if (isPrivateIP(lookupResult.address)) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

app.get("/api/fetch-url", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  console.log("   [Proxy Fetch] Requesting URL:", url);

  // SSRF Protection check
  const isSafe = await validateUrlForSSRF(url);
  if (!isSafe) {
    return res.status(403).json({ error: "Access to the requested URL is forbidden (SSRF protection)." });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Server fetched with status ${response.status}` });
    }

    const html = await response.text();
    res.status(200).send(html);
  } catch (error) {
    console.error("Backend Proxy Fetch Error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch URL" });
  }
});

app.post("/api/log", (req, res) => {
  const { message } = req.body;
  console.log("[Client Console]", message);
  res.sendStatus(200);
});

// Catch-all route to serve the Vite frontend for client-side routing
app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SMTP Local API Server running on port ${PORT}`);
  console.log(`[Startup Check] RESEND_API_KEY present: ${process.env.RESEND_API_KEY ? "YES (" + process.env.RESEND_API_KEY.slice(0, 8) + "...)" : "NO — not set in this environment"}`);
});
