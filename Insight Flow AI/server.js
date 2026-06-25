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

app.use(cors({
  origin: true,
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

  try {
    const isSecure = parseInt(smtpPort, 10) === 465;
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort, 10),
      secure: isSecure,
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
      tls: {
        // Reject unauthorized certificates in production, allow in development
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
    });

    const logoPath = fs.existsSync(path.join(__dirname, "dist", "logo.jpg"))
      ? path.join(__dirname, "dist", "logo.jpg")
      : path.join(__dirname, "public", "logo.jpg");
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
    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error("Nodemailer Send Error:", error);
    res.status(500).json({ error: error.message || "Failed to send email via SMTP." });
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
});

