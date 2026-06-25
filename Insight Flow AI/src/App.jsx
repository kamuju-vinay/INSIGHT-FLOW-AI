import { useState, useRef, useEffect, useCallback, useReducer, useMemo } from "react";
import {
  RadarIcon, Activity, ListChecks, BarChart3, Settings,
  Plus, Play, Pause, ChevronRight, Pencil, Trash2, Send, Globe, Brain,
  Bell, Mail, FileText, Link2, GripVertical, Search, Eye, Upload,
  UserCog, UserPlus, Download, Clock, CalendarDays, CalendarRange, Bolt,
  Sun, CalendarCheck, CheckCircle2, XCircle, AlertTriangle, MessageSquareText,
  RotateCcw, Save, FlaskConical, SlidersHorizontal, X, Layers, History,
  Timer, Repeat2, CalendarPlus, RefreshCw, BarChart2,
} from "lucide-react";
const LogoImg = "/logo.jpg";

const C = {
  ink:"#0f0e0d",ink2:"#44433f",ink3:"#888780",
  paper:"#fafaf8",surface:"#f3f2ee",surface2:"#eae9e3",
  line:"rgba(0,0,0,.08)",line2:"rgba(0,0,0,.14)",
  accent:"#2f54eb",accentBg:"#eef2ff",accentDark:"#1939b7",
  green:"#16a34a",greenBg:"#f0fdf4",
  amber:"#b45309",amberBg:"#fffbeb",
  red:"#dc2626",redBg:"#fef2f2",
  purple:"#7c3aed",purpleBg:"#f5f3ff",
};

// ── Storage ──────────────────────────────────────────────
const STORE_KEY="articlewatch_v1";
function loadStore(){try{return JSON.parse(localStorage.getItem(STORE_KEY)||"null");}catch{return null;}}
function saveStore(data){try{localStorage.setItem(STORE_KEY,JSON.stringify(data));}catch{}}
function initStore(){
  const s=loadStore();
  if(s) {
    if(!s.config) s.config = {};
    if(s.config.gemini_api_key_secondary === undefined) s.config.gemini_api_key_secondary = "";
    if(s.config.gemini_api_key_backup === undefined) s.config.gemini_api_key_backup = "";
    if(s.config.no_api_key_mode === undefined) s.config.no_api_key_mode = false;
    s.config.huggingface_api_key = "";
    s.config.huggingface_api_key_secondary = "";
    s.config.huggingface_api_key_backup = "";
    s.config.groq_api_key = "";
    s.config.groq_api_key_secondary = "";
    s.config.groq_api_key_backup = "";
    s.config.openai_api_key = "";
    s.config.openai_api_key_secondary = "";
    s.config.openai_api_key_backup = "";
    s.config.anthropic_api_key = "";
    s.config.anthropic_api_key_secondary = "";
    s.config.anthropic_api_key_backup = "";
    s.config.ai_provider = "gemini";
    if(s.keyStatuses === undefined) s.keyStatuses = {};
    if(s.keyLogs === undefined) s.keyLogs = [];
    if(s.metrics === undefined) {
      s.metrics = {
        totalUrlsProcessed: 0,
        articlesSelected: 0,
        articlesRejected: 0,
        totalProcessingTime: 0,
        apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
      };
    }
    if(s.notifications === undefined) s.notifications = [];
    if(s.config && s.config.openai_api_key === undefined) {
      s.config.openai_api_key = "";
    }
    if(s.config && s.config.emailjs_service_id === undefined) {
      s.config.emailjs_service_id = "";
      s.config.emailjs_template_id = "";
      s.config.emailjs_public_key = "";
    }
    if(s.plans) {
      s.plans = s.plans.map(p => ({
        ...p,
        keywords: p.keywords !== undefined ? p.keywords : "",
        continuousRun: p.continuousRun !== undefined ? p.continuousRun : false,
        relevanceThreshold: p.relevanceThreshold !== undefined ? p.relevanceThreshold : 70,
        searchBodyKeywords: p.searchBodyKeywords !== undefined ? p.searchBodyKeywords : false,
        enableAIKeywords: p.enableAIKeywords !== undefined ? p.enableAIKeywords : true,
        stage: ["crawling", "analyzing", "summarizing", "sending", "paused_key_required"].includes(p.stage) ? "idle" : p.stage
      }));
    }
    return s;
  }
  return{
    config:{
      gemini_api_key:"", gemini_api_key_secondary:"", gemini_api_key_backup:"",
      huggingface_api_key:"", huggingface_api_key_secondary:"", huggingface_api_key_backup:"",
      groq_api_key:"", groq_api_key_secondary:"", groq_api_key_backup:"",
      openai_api_key:"", openai_api_key_secondary:"", openai_api_key_backup:"",
      anthropic_api_key:"", anthropic_api_key_secondary:"", anthropic_api_key_backup:"",
      anthropic_model:"claude-3-5-sonnet-20241022",
      huggingface_model:"meta-llama/Llama-3.2-3B-Instruct",
      ai_provider:"auto",
      smtp_host:"smtp.office365.com",smtp_port:"587",smtp_user:"",smtp_password:"",sender_email:"",sender_name:"Insight Flow AI",
      emailjs_service_id:"",emailjs_template_id:"",emailjs_public_key:"",
      no_api_key_mode:false
    },
    plans:[],
    articles:[],
    emailLog:[],
    activityLog:[],
    keyStatuses:{},
    keyLogs:[],
    metrics: {
      totalUrlsProcessed: 0,
      articlesSelected: 0,
      articlesRejected: 0,
      totalProcessingTime: 0,
      apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
    },
    notifications: []
  };
}

// ── AI Providers (Claude / Gemini / Groq / OpenAI / Hugging Face — failover flow) ──
let _CFG_REF={};
let _DISPATCH_REF=null;
let _KEY_STATUSES_REF={};
function setAIConfig(cfg, dispatch, keyStatuses){
  _CFG_REF=cfg||_CFG_REF;
  if(dispatch) _DISPATCH_REF=dispatch;
  if(keyStatuses) _KEY_STATUSES_REF=keyStatuses;
}

function getOrderedKeys(cfg, keyStatuses = {}) {
  const providers = ["gemini"];
  const tiers = [
    { name: "primary", suffix: "" },
    { name: "secondary", suffix: "_secondary" },
    { name: "backup", suffix: "_backup" }
  ];

  const ordered = [];
  for (const provider of providers) {
    for (const tier of tiers) {
      let keyVal = "";
      let keyId = "";
      if (provider === "claude") {
        if (tier.name === "primary") {
          keyVal = cfg.anthropic_api_key;
          keyId = "claude_primary";
        } else {
          keyVal = cfg[`anthropic_api_key${tier.suffix}`];
          keyId = `claude_${tier.name}`;
        }
      } else {
        if (tier.name === "primary") {
          keyVal = cfg[`${provider}_api_key`] || cfg[`${provider}_api_key_primary`];
          keyId = `${provider}_primary`;
        } else {
          keyVal = cfg[`${provider}_api_key${tier.suffix}`];
          keyId = `${provider}_${tier.name}`;
        }
      }

      if (keyVal && keyVal.trim()) {
        const statusObj = keyStatuses[keyId] || {};
        ordered.push({
          provider,
          tier: tier.name,
          keyId,
          keyValue: keyVal.trim(),
          status: statusObj.status || "unverified"
        });
      }
    }
  }
  return ordered;
}

async function validateKeysBeforeCrawl(cfg, keyStatuses, dispatch, addLog, isInitial = true) {
  if (cfg && cfg.no_api_key_mode) {
    addLog("ℹ️ Running in Local NLP Mode (no API keys required).", "info");
    return;
  }
  let activeStatuses = keyStatuses;
  if (isInitial) {
    let resetAny = false;
    const nextStatuses = { ...keyStatuses };
    Object.keys(nextStatuses).forEach(k => {
      if (nextStatuses[k] && (nextStatuses[k].status === "exhausted" || nextStatuses[k].status === "invalid")) {
        nextStatuses[k] = {
          ...nextStatuses[k],
          status: "unverified",
          remainingRequests: "N/A",
          remainingTokens: "N/A",
          lastError: "",
          lastChecked: null
        };
        resetAny = true;
        if (dispatch) {
          dispatch({
            type: "UPDATE_KEY_STATUS",
            keyId: k,
            status: nextStatuses[k]
          });
        }
      }
    });
    if (resetAny) {
      activeStatuses = nextStatuses;
    }
  }

  const orderedKeys = getOrderedKeys(cfg, activeStatuses);
  if (orderedKeys.length === 0) {
    addLog("⚠️ Gemini API key is missing. Running crawl in keyword-only mode without AI.", "warn");
    return;
  }

  const candidates = orderedKeys.filter(k => k.status !== "invalid" && k.status !== "exhausted");
  if (candidates.length === 0) {
    addLog("⚠️ All configured API keys are exhausted or invalid. Running crawl with AI features disabled.", "warn");
    return;
  }

  const first = candidates[0];
  addLog(`🤖 Validating active key: ${first.provider} (${first.tier}) before crawling…`, "info");
  
  try {
    const res = await fetch("/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: first.provider, apiKey: first.keyValue })
    });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();
    if (data.success) {
      addLog(`✅ API key for ${first.provider} (${first.tier}) verified successfully.`, "info");
      dispatch({
        type: "UPDATE_KEY_STATUS",
        keyId: first.keyId,
        status: {
          status: "active",
          remainingRequests: data.quota?.remainingRequests || "N/A",
          remainingTokens: data.quota?.remainingTokens || "N/A",
          lastUsed: new Date().toISOString(),
          lastError: ""
        }
      });
    } else {
      const errType = data.errorType || "invalid";
      addLog(`⚠️ Validation failed for ${first.provider} (${first.tier}): ${data.message}. Marking as ${errType}.`, "warn");
      dispatch({
        type: "UPDATE_KEY_STATUS",
        keyId: first.keyId,
        status: { status: errType, lastUsed: new Date().toISOString(), lastError: data.message }
      });

      if (first.provider === "groq") {
        const geminiExists = !!(cfg.gemini_api_key?.trim() || cfg.gemini_api_key_secondary?.trim() || cfg.gemini_api_key_backup?.trim());
        if (geminiExists) {
          addLog("⚠️ Groq validation failed. Gemini key exists, checking starting from Gemini again.", "warn");
          const geminiKeys = ["gemini_primary", "gemini_secondary", "gemini_backup"];
          const updatedStatuses = { ...keyStatuses };
          geminiKeys.forEach(gkId => {
            updatedStatuses[gkId] = {
              status: "unverified",
              remainingRequests: "N/A",
              remainingTokens: "N/A",
              lastError: "",
              lastChecked: null
            };
            dispatch({
              type: "UPDATE_KEY_STATUS",
              keyId: gkId,
              status: updatedStatuses[gkId]
            });
          });

          updatedStatuses[first.keyId] = { status: errType };
          return await validateKeysBeforeCrawl(cfg, updatedStatuses, dispatch, addLog, false);
        }
      }

      return await validateKeysBeforeCrawl(cfg, { ...keyStatuses, [first.keyId]: { status: errType } }, dispatch, addLog, false);
    }
  } catch (err) {
    addLog(`⚠️ Network/validation error for ${first.provider}: ${err.message}. Proceeding anyway.`, "warn");
  }
}

async function callAIProxy(provider, apiKey, systemPrompt, userPrompt, model) {
  const res = await fetch("/api/call-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      apiKey,
      systemPrompt,
      userPrompt,
      model,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP error! status: ${res.status}`);
  }
  return await res.json();
}

async function callAIProxyWithRetry(provider, apiKey, systemPrompt, userPrompt, model, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await callAIProxy(provider, apiKey, systemPrompt, userPrompt, model);
    } catch (err) {
      const isRateLimit = err.message.toLowerCase().includes("rate limit") || err.message.includes("429") || err.message.toLowerCase().includes("too many requests");
      const isQuota = (err.message.toLowerCase().includes("exhausted") || err.message.toLowerCase().includes("quota")) && !isRateLimit;
      const isTransient = err.message.toLowerCase().includes("network") || err.message.toLowerCase().includes("fetch") || err.message.includes("502") || err.message.includes("503") || err.message.includes("504") || err.message.toLowerCase().includes("timeout") || err.message.toLowerCase().includes("failed to fetch") || isRateLimit;
      
      if (isQuota || !isTransient || i === retries - 1) throw err;
      
      const waitTime = isRateLimit ? 3000 * Math.pow(2, i) : delay * Math.pow(2, i);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

async function callAI(systemPrompt, userPrompt, attemptedKeys = new Set()) {
  const cfg = _CFG_REF || {};
  const keyStatuses = _KEY_STATUSES_REF || {};
  const orderedKeys = getOrderedKeys(cfg, keyStatuses);

  if (orderedKeys.length === 0) {
    if (_DISPATCH_REF) {
      _DISPATCH_REF({
        type: "ADD_LOG",
        entry: { type: "error", event: `❌ Crawl failed: API key is missing`, plan: "" }
      });
    }
    throw new Error("API_KEY_MISSING");
  }

  let candidates = orderedKeys.filter(k => k.status !== "invalid" && k.status !== "exhausted" && !attemptedKeys.has(k.keyId));
  if (candidates.length === 0) {
    candidates = orderedKeys.filter(k => !attemptedKeys.has(k.keyId));
  }

  if (candidates.length === 0) {
    throw new Error("ALL_KEYS_EXHAUSTED");
  }

  const candidate = candidates[0];
  const { provider, tier, keyId, keyValue } = candidate;

  try {
    if (_DISPATCH_REF) {
      _DISPATCH_REF({
        type: "ADD_KEY_LOG",
        entry: { provider, tier, action: "use_key", message: `Calling ${provider} (${tier} key)` }
      });
    }

    let model = "";
    if (provider === "gemini") model = "gemini-2.0-flash";
    else if (provider === "huggingface") model = cfg.huggingface_model || "meta-llama/Llama-3.2-3B-Instruct";
    else if (provider === "groq") model = "llama-3.3-70b-versatile";
    else if (provider === "openai") model = "gpt-4o-mini";
    else if (provider === "claude") model = cfg.anthropic_model || "claude-3-5-sonnet-20241022";

    const result = await callAIProxyWithRetry(provider, keyValue, systemPrompt, userPrompt, model);

    if (_DISPATCH_REF) {
      _DISPATCH_REF({ type: "RECORD_API_CALL", provider });
      _DISPATCH_REF({
        type: "UPDATE_KEY_STATUS",
        keyId,
        status: {
          status: "active",
          remainingRequests: result.quota?.remainingRequests || "N/A",
          remainingTokens: result.quota?.remainingTokens || "N/A",
          lastUsed: new Date().toISOString(),
          lastError: ""
        }
      });
      _DISPATCH_REF({
        type: "ADD_KEY_LOG",
        entry: { provider, tier, action: "verified_active", message: `Key verified active. Remaining: ${result.quota?.remainingRequests || "N/A"} reqs` }
      });

      // Reset all "exhausted" keys back to "unverified" so the next call starts from the first order
      orderedKeys.forEach(k => {
        if (k.status === "exhausted") {
          _DISPATCH_REF({
            type: "UPDATE_KEY_STATUS",
            keyId: k.keyId,
            status: {
              status: "unverified",
              remainingRequests: "N/A",
              remainingTokens: "N/A",
              lastError: "",
              lastChecked: null
            }
          });
        }
      });
    }

    return result.text;
  } catch (err) {
    console.error(`Error with ${provider} (${tier} key):`, err);
    attemptedKeys.add(keyId);

    const errMsg = err.message || "";
    const isQuota = errMsg.toLowerCase().includes("exhausted") || errMsg.toLowerCase().includes("quota") || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("429");
    const errType = isQuota ? "exhausted" : "invalid";

    if (_DISPATCH_REF) {
      _DISPATCH_REF({
        type: "UPDATE_KEY_STATUS",
        keyId,
        status: {
          status: errType,
          lastUsed: new Date().toISOString(),
          lastError: errMsg
        }
      });
      _DISPATCH_REF({
        type: "ADD_KEY_LOG",
        entry: { provider, tier, action: `marked_${errType}`, message: `Key failed (${errType}): ${errMsg}` }
      });
      _DISPATCH_REF({
        type: "ADD_LOG",
        entry: { type: "error", event: `⚠️ ${provider} (${tier} key) failed: ${errMsg}. Failover logic triggered.`, plan: "" }
      });
    }

    if (provider === "groq") {
      const geminiExists = !!(cfg.gemini_api_key?.trim() || cfg.gemini_api_key_secondary?.trim() || cfg.gemini_api_key_backup?.trim());
      if (geminiExists) {
        if (_DISPATCH_REF) {
          _DISPATCH_REF({
            type: "ADD_LOG",
            entry: { type: "warn", event: "⚠️ Groq failed. Gemini key exists. Checking Gemini keys again.", plan: "" }
          });
        }

        const geminiKeys = ["gemini_primary", "gemini_secondary", "gemini_backup"];
        geminiKeys.forEach(gkId => {
          attemptedKeys.delete(gkId);
          if (_DISPATCH_REF) {
            _DISPATCH_REF({
              type: "UPDATE_KEY_STATUS",
              keyId: gkId,
              status: {
                status: "unverified",
                remainingRequests: "N/A",
                remainingTokens: "N/A",
                lastError: "",
                lastChecked: null
              }
            });
          }
        });

        return await callAI(systemPrompt, userPrompt, attemptedKeys);
      }
    }

    return await callAI(systemPrompt, userPrompt, attemptedKeys);
  }
}

function activeProvider(cfg, keyStatuses = {}) {
  const ordered = getOrderedKeys(cfg, keyStatuses).filter(k => k.status !== "invalid" && k.status !== "exhausted");
  if (ordered.length > 0) {
    const first = ordered[0];
    const provNames = {
      gemini: "Gemini",
      huggingface: "Hugging Face",
      groq: "Groq",
      openai: "OpenAI / ChatGPT",
      claude: "Claude"
    };
    return `${provNames[first.provider]} (${first.tier})`;
  }
  return "None active / Claude (built-in)";
}

async function sendEmailViaSMTP(smtpSettings, to, subject, html) {
  const res = await fetch("/api/send-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      smtpHost: smtpSettings.smtpHost,
      smtpPort: smtpSettings.smtpPort,
      smtpUser: smtpSettings.smtpUser,
      smtpPassword: smtpSettings.smtpPassword,
      senderEmail: smtpSettings.senderEmail,
      senderName: smtpSettings.senderName,
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP error! status: ${res.status}`);
  }
  return await res.json();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatMarkdown(text) {
  if (!text) return "";
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <strong key={index}>{part}</strong>;
    }
    return part;
  });
}

function getArticleCategory(title, summary) {
  const text = ((title || "") + " " + (summary || "")).toLowerCase();
  if (/\b(climate|carbon|emission|emissions|energy|renewable|solar|wind|water|waste|sustainability|eco|nature|warming|environment|environmental|green|forest|biodiversity|pollution|recycle|recycling|net-zero|net zero|esg|conservation|circular economy)\b/.test(text)) {
    return { name: "Environmental", icon: "🌱", color: "#10b981", bg: "#ecfdf5" };
  }
  if (/\b(nurse|dies|mishap|accident|community|employee|labor|human rights|safety|health|education|diversity|inclusion|social|public|people|society|worker|workers|humanitarian|welfare|charity|labor rights|workplace|fair wage|philanthropy)\b/.test(text)) {
    return { name: "Social", icon: "🤝", color: "#3b82f6", bg: "#eff6ff" };
  }
  if (/\b(board|executive|audit|ethics|compliance|regulatory|law|policy|governance|shareholder|rights|corruption|bribery|tax|management|corporate|sec|ftc|lawsuit|fines|prosecute|shareholders|transparency|anti-corruption|insider trading|whistleblower)\b/.test(text)) {
    return { name: "Governance", icon: "⚖️", color: "#8b5cf6", bg: "#f5f3ff" };
  }
  return { name: "General", icon: "📊", color: "#6b7280", bg: "#f3f4f6" };
}

function compileEmailHtml(plan, articles, isPreview = false) {
  const planName = plan.name || "ESG Application";
  const dateStr = new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  const logoSrc = isPreview ? LogoImg : "cid:logo";

  // 1. Build Articles List (Single column layout)
  let articlesListHtml = "";
  const articlesToRender = articles;

  articlesToRender.forEach((a, index) => {
    if (!a) return;
    const formattedTitle = escapeHtml(a.title || "").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const formattedSummary = escapeHtml(a.summary || "").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const cat = getArticleCategory(a.title, a.summary);

    articlesListHtml += `
      <table cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; box-shadow: 0 1px 3px rgba(0,0,0,0.01);">
        <tr>
          <td style="padding: 16px; font-family: 'Outfit', 'Inter', sans-serif;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <!-- Icon/Number column -->
                <td width="48" valign="top" style="padding-right: 12px;">
                  <table cellpadding="0" cellspacing="0" width="44" height="44" style="background-color: ${cat.bg}; border-radius: 10px; text-align: center; border-collapse: separate;">
                    <tr>
                      <td align="center" valign="middle" style="font-family: 'Outfit', 'Inter', sans-serif; font-size: 16px; font-weight: 800; color: ${cat.color}; line-height: 44px;">
                        ${index + 1}
                      </td>
                    </tr>
                  </table>
                </td>
                
                <!-- Content column -->
                <td class="article-content" valign="top" style="font-family: 'Outfit', 'Inter', sans-serif;">
                  <div style="font-weight: 700; font-size: 14px; line-height: 1.4; margin-bottom: 3px;">
                    <a href="${a.url}" target="_blank" style="color: #0f172a; text-decoration: none;">${formattedTitle}</a>
                  </div>
                  <div style="font-size: 11px; color: #64748b; font-weight: 500; margin-bottom: 6px;">
                    ${escapeHtml(a.company || "")} &nbsp;•&nbsp; ${escapeHtml(a.publish_date || "")}
                  </div>
                  <div style="font-size: 12px; color: #475569; line-height: 1.5; font-family: 'Inter', sans-serif; margin-bottom: 6px;">
                    ${formattedSummary}
                  </div>
                  <div style="font-size: 11px; font-family: 'Inter', sans-serif; word-break: break-all;">
                    <a href="${a.url}" target="_blank" style="color: #2563eb; text-decoration: none;">${a.url}</a>
                  </div>
                </td>
                
                <!-- Button column -->
                <td class="article-btn-col" width="130" align="right" valign="middle" style="padding-left: 12px;">
                  <a href="${a.url}" target="_blank" style="display: inline-block; background-color: #ffffff; border: 1px solid #cbd5e1; color: #2563eb; padding: 8px 14px; text-decoration: none; font-size: 11px; font-weight: 700; border-radius: 8px; font-family: 'Outfit', 'Inter', sans-serif; white-space: nowrap;">
                    View Full Article &nbsp;<span style="font-size: 12px; line-height: 10px;">&rsaquo;</span>
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
  });

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${planName} Digest</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
        margin-top: 0 !important;
        margin-bottom: 0 !important;
        border-radius: 0 !important;
        border: none !important;
      }
      .email-content {
        padding-right: 16px !important;
        padding-left: 16px !important;
      }
      .header-left {
        display: block !important;
        width: 100% !important;
        text-align: center !important;
        padding-bottom: 16px !important;
      }
      .header-left table {
        margin: 0 auto !important;
      }
      .header-right {
        display: block !important;
        width: 100% !important;
        text-align: center !important;
      }
      .header-right table {
        margin: 0 auto !important;
        width: 100% !important;
      }
      .summary-card {
        width: 100% !important;
      }
      .article-btn-col {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        padding-left: 60px !important;
        padding-top: 12px !important;
        box-sizing: border-box !important;
      }
      .footer-col {
        display: inline-block !important;
        width: 48% !important;
        margin-bottom: 16px !important;
        border-right: none !important;
        vertical-align: top !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc;">
  <table class="email-container" align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="border-collapse: collapse; background-color: #ffffff; margin-top: 20px; margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
    
    <!-- HEADER SECTION -->
    <tr>
      <td class="email-content" style="padding: 24px 24px 20px 24px; border-bottom: 1px solid #f1f5f9;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td class="header-left" valign="middle">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle" style="padding-right: 10px;">
                    <img src="${logoSrc}" alt="InsightFlow" style="display: block; border: 0; width: 36px; height: 36px; border-radius: 8px;" width="36" height="36" />
                  </td>
                  <td valign="middle" style="font-family: 'Outfit', 'Inter', sans-serif; font-size: 24px; font-weight: 800; line-height: 1;">
                    <span style="color: #0f172a;">Insight</span><span style="color: #2563eb;">Flow</span> <span style="font-size: 20px; font-weight: 700; color: #4f46e5;">AI</span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="font-size: 11px; color: #64748b; padding-top: 6px; font-family: 'Outfit', 'Inter', sans-serif; font-weight: 600; letter-spacing: 0.02em;">
                    Smart AI Responses. On Schedule. In Your Inbox.
                  </td>
                </tr>
              </table>
            </td>
            <td class="header-right" align="right" valign="middle">
              <!-- Summary Card -->
              <table class="summary-card" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; width: 230px; border-collapse: separate;">
                <tr>
                  <td valign="middle" style="font-family: 'Outfit', 'Inter', sans-serif;">
                    <div style="font-size: 10px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(planName)}</div>
                    <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px;">${articles.length} New Article${articles.length === 1 ? "" : "s"}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px; font-weight: 500;">📅 ${dateStr}</div>
                  </td>
                  <td width="10">&nbsp;</td>
                  <td width="60" valign="middle" align="right">
                    <!-- Mini Chart Graphic -->
                    <table cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; width: 60px; height: 50px; text-align: center; border-collapse: separate;">
                      <tr>
                        <td valign="bottom" align="center" style="height: 34px; padding-bottom: 2px;">
                          <div style="display: inline-block; width: 6px; height: 16px; background-color: #cbd5e1; border-radius: 2px; margin-right: 2px;"></div>
                          <div style="display: inline-block; width: 6px; height: 24px; background-color: #6366f1; border-radius: 2px; margin-right: 2px;"></div>
                          <div style="display: inline-block; width: 6px; height: 32px; background-color: #4f46e5; border-radius: 2px;"></div>
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 8px; color: #10b981; font-weight: bold; font-family: sans-serif;">ESG</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- GREETING SECTION -->
    <tr>
      <td class="email-content" style="padding: 20px 24px 10px 24px;">
        <table cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0f6ff; border-radius: 12px; border-collapse: separate; border: 1px solid #dbeafe;">
          <tr>
            <td style="padding: 16px 20px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="42" valign="middle">
                    <table cellpadding="0" cellspacing="0" style="background-color: #3b82f6; border-radius: 50%; width: 36px; height: 36px; text-align: center; border-collapse: separate;">
                      <tr>
                        <td style="font-size: 18px; color: #ffffff; text-align: center; vertical-align: middle;">✨</td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle" style="font-family: 'Outfit', 'Inter', sans-serif; padding-left: 12px;">
                    <div style="font-size: 14px; font-weight: 700; color: #1e3a8a;">Hello,</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 2px; font-weight: 500; line-height: 1.4;">Here is your scheduled ESG update with the latest AI-generated summaries.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ARTICLES LIST -->
    <tr>
      <td class="email-content" style="padding: 10px 24px 10px 24px;">
        ${articlesListHtml}
      </td>
    </tr>

    <!-- FOOTER FEATURE BAR -->
    <tr>
      <td class="email-content" style="padding: 0 24px 24px 24px;">
        <table cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; border-collapse: separate; padding: 16px 8px;">
          <tr>
            <!-- SCRAPE -->
            <td class="footer-col" width="25%" align="center" style="font-family: 'Outfit', 'Inter', sans-serif; border-right: 1px solid #e2e8f0; vertical-align: top;">
              <div style="font-size: 18px; margin-bottom: 4px;">🌐</div>
              <div style="font-size: 10px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Scrape</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; padding: 0 4px;">We monitor trusted sources</div>
            </td>
            <!-- GENERATE -->
            <td class="footer-col" width="25%" align="center" style="font-family: 'Outfit', 'Inter', sans-serif; border-right: 1px solid #e2e8f0; padding: 0 4px; vertical-align: top;">
              <div style="font-size: 18px; margin-bottom: 4px;">🧠</div>
              <div style="font-size: 10px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Generate</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; padding: 0 4px;">AI creates accurate summaries</div>
            </td>
            <!-- SCHEDULE -->
            <td class="footer-col" width="25%" align="center" style="font-family: 'Outfit', 'Inter', sans-serif; border-right: 1px solid #e2e8f0; padding: 0 4px; vertical-align: top;">
              <div style="font-size: 18px; margin-bottom: 4px;">⏱️</div>
              <div style="font-size: 10px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Schedule</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; padding: 0 4px;">Delivered to your schedule</div>
            </td>
            <!-- SEND -->
            <td class="footer-col" width="25%" align="center" style="font-family: 'Outfit', 'Inter', sans-serif; padding: 0 4px; vertical-align: top;">
              <div style="font-size: 18px; margin-bottom: 4px;">✉️</div>
              <div style="font-size: 10px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Send</div>
              <div style="font-size: 9px; color: #64748b; margin-top: 2px; padding: 0 4px;">Straight to your inbox</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- FOOTER LINKS SECTION -->
    <tr>
      <td style="padding: 24px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; font-family: 'Outfit', 'Inter', sans-serif;">
        <div style="font-size: 11px; color: #94a3b8; line-height: 1.5; margin-bottom: 12px;">
          You are receiving this email because you are subscribed to <strong>${escapeHtml(planName)}</strong> updates.
        </div>
        <div style="font-size: 11px; color: #94a3b8; font-weight: 600;">
          <a href="#" style="color: #2563eb; text-decoration: none;">Unsubscribe</a> &nbsp;·&nbsp; 
          <a href="#" style="color: #2563eb; text-decoration: none;">Manage Preferences</a>
        </div>
      </td>
    </tr>

  </table>
</body>
</html>
  `;
}

// ── Email sending ────────────────────────────────────────
// Browsers cannot speak raw SMTP (no socket access), so real sends go through
// a local SMTP relay backend server that uses nodemailer.
// Configure Host / Port / Username / Password in Settings.
// One call is made per recipient so each email is addressed individually.
// async function sendEmailForPlan(plan, store, dispatch, showToast, articles, emails, addLogLocal) {
async function sendEmailForPlan(plan, store, dispatch, showToast, articles, emails, addLogLocal) {
  const addLog = (msg, type = "info") => {
    if (addLogLocal) addLogLocal(msg, type);
    dispatch({ type: "ADD_LOG", entry: { type: type === "error" ? "error" : "email", event: msg, plan: plan.name } });
  };
  const pushStage = (s) => dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { stage: s, stageAt: new Date().toISOString() } });

  if (!emails || emails.length === 0) {
    addLog("⚠️ No recipients to send to", "warn");
    return { sent: 0, failed: 0 };
  }

  const cfg = store.config || {};
  const activeSmtp = cfg.active_smtp_provider || "outlook";
  const smtpHost = activeSmtp === "gmail" ? (cfg.gmail_smtp_host || cfg.smtp_host) : (cfg.outlook_smtp_host || cfg.smtp_host);
  const smtpPort = activeSmtp === "gmail" ? (cfg.gmail_smtp_port || cfg.smtp_port) : (cfg.outlook_smtp_port || cfg.smtp_port);
  const smtpUser = activeSmtp === "gmail" ? (cfg.gmail_smtp_user || cfg.smtp_user) : (cfg.outlook_smtp_user || cfg.smtp_user);
  const smtpPassword = activeSmtp === "gmail" ? (cfg.gmail_smtp_password || cfg.smtp_password) : (cfg.outlook_smtp_password || cfg.smtp_password);
  const senderEmail = activeSmtp === "gmail" ? (cfg.gmail_sender_email || cfg.sender_email || smtpUser) : (cfg.outlook_sender_email || cfg.sender_email || smtpUser);
  const senderName = activeSmtp === "gmail" ? (cfg.gmail_sender_name || cfg.sender_name || "Insight Flow AI") : (cfg.outlook_sender_name || cfg.sender_name || "Insight Flow AI");

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
    addLog("❌ SMTP is not configured — add Host, Port, Username & Password in Settings", "error");
    if (showToast) showToast("Email sending not configured", "error", { sub: "Set up SMTP in Settings first" });
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "error",
        title: "Email Delivery Failed",
        message: `Failed to send email digest for "${plan.name}". SMTP is not configured.`,
        plan: plan.name
      }
    });
    pushStage("error");
    return { sent: 0, failed: emails.length };
  }

  pushStage("sending");
  addLog(`📧 Sending digest to ${emails.length} recipient(s)…`);

  const subject = `${plan.name} — ${articles.length} new article${articles.length === 1 ? "" : "s"}`;
  const articlesHtml = compileEmailHtml(plan, articles);

  let sentCount = 0, failedCount = 0;
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    try {
      const smtpSettings = {
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPassword,
        senderEmail,
        senderName,
      };
      await sendEmailViaSMTP(smtpSettings, email, subject, articlesHtml);
      sentCount++;
    } catch (e) {
      failedCount++;
      addLog(`❌ Failed to send to ${email}: ${e?.message || "Unknown error"}`, "error");
    }
    // Small stagger between sends to stay under SMTP rate limits
    if (i < emails.length - 1) await new Promise(r => setTimeout(r, 350));
  }

  const record = {
    id: `mail_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    plan_id: plan.id,
    sent_at: new Date().toISOString(),
    to: emails,
    articles_count: articles.length,
    status: failedCount === 0 ? "sent" : sentCount > 0 ? "partial" : "failed",
    sent_count: sentCount,
    failed_count: failedCount,
  };
  dispatch({ type: "ADD_EMAIL", record });
  dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { emailsCount: (plan.emailsCount || 0) + sentCount, stage: failedCount > 0 && sentCount === 0 ? "error" : "done", stageAt: new Date().toISOString() } });

  if (sentCount > 0) {
    addLog(`✅ Email sent to ${sentCount}/${emails.length} recipient(s)`);
    if (showToast) showToast(`Email sent to ${sentCount} recipient(s)`, "success", { sub: plan.name });
  }
  if (failedCount > 0 && sentCount === 0) {
    addLog(`❌ Email failed for all ${failedCount} recipient(s)`, "error");
    if (showToast) showToast("Email sending failed", "error", { sub: `Check SMTP config for ${plan.name}` });
  } else if (failedCount > 0) {
    addLog(`⚠️ ${failedCount} recipient(s) failed`, "warn");
  }

  if (sentCount > 0 && failedCount === 0) {
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "success",
        title: "Email Delivered",
        message: `Successfully sent digest to ${sentCount}/${emails.length} recipients for plan "${plan.name}".`,
        plan: plan.name
      }
    });
  } else if (failedCount > 0 && sentCount === 0) {
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "error",
        title: "Email Delivery Failed",
        message: `Failed to send email digest for "${plan.name}" to all recipients. Check SMTP config.`,
        plan: plan.name
      }
    });
  } else if (failedCount > 0 && sentCount > 0) {
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "warn",
        title: "Partial Email Delivery",
        message: `Email digest for plan "${plan.name}" sent to ${sentCount} recipients, but failed for ${failedCount} recipients.`,
        plan: plan.name
      }
    });
  }

  return { sent: sentCount, failed: failedCount };
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "arent", "as", "at", 
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "cant", "cannot", "could", 
  "couldnt", "did", "didnt", "do", "does", "doesnt", "doing", "dont", "down", "during", "each", "few", "for", 
  "from", "further", "had", "hadnt", "has", "hasnt", "have", "havent", "having", "he", "hed", "hell", "hes", 
  "her", "here", "heres", "hers", "herself", "him", "himself", "his", "how", "hows", "i", "id", "ill", "im", 
  "ive", "if", "in", "into", "is", "isnt", "it", "its", "itself", "lets", "me", "more", "most", "mustnt", 
  "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our", 
  "ours", "ourselves", "out", "over", "own", "same", "shant", "she", "shed", "shell", "shes", "should", 
  "shouldnt", "so", "some", "such", "than", "that", "thats", "the", "their", "theirs", "them", "themselves", 
  "then", "there", "theres", "these", "they", "theyd", "theyll", "theyre", "theyve", "this", "those", 
  "through", "to", "too", "under", "until", "up", "very", "was", "wasnt", "we", "wed", "well", "were", 
  "weve", "werent", "what", "whats", "when", "whens", "where", "wheres", "which", "while", "who", "whos", 
  "whom", "why", "whys", "with", "wont", "would", "wouldnt", "you", "youd", "youll", "youre", "youve", 
  "your", "yours", "yourself", "yourselves", "find", "article", "articles", "focus", "related"
]);

function getStem(word) {
  if (word.length <= 3) return word;
  let stem = word.toLowerCase();
  if (stem.endsWith("ies")) stem = stem.slice(0, -3) + "y";
  else if (stem.endsWith("ying")) stem = stem.slice(0, -4) + "y";
  else if (stem.endsWith("ing")) stem = stem.slice(0, -3);
  else if (stem.endsWith("ed")) stem = stem.slice(0, -2);
  else if (stem.endsWith("es")) stem = stem.slice(0, -2);
  else if (stem.endsWith("s")) stem = stem.slice(0, -1);
  
  if (stem.endsWith("ational")) stem = stem.slice(0, -7) + "ate";
  if (stem.endsWith("tional")) stem = stem.slice(0, -6) + "tion";
  if (stem.endsWith("al")) stem = stem.slice(0, -2);
  if (stem.endsWith("ment")) stem = stem.slice(0, -4);
  if (stem.endsWith("ity")) stem = stem.slice(0, -3);
  if (stem.endsWith("ive")) stem = stem.slice(0, -3);
  if (stem.endsWith("tory")) stem = stem.slice(0, -4);
  if (stem.endsWith("tion")) stem = stem.slice(0, -4);
  
  return stem.length > 3 ? stem.slice(0, 5) : stem;
}

function getCleanKeywords(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function calculateLocalRelevanceScore(queryText, title, text) {
  const combinedText = `${title} ${text}`;
  const queryWords = Array.from(new Set(getCleanKeywords(queryText)));
  if (queryWords.length === 0) return { score: 70, matchedList: [], totalQueryTerms: 0, matchesCount: 0 };

  const queryStems = Array.from(new Set(queryWords.map(getStem)));
  const docStems = new Set(getCleanKeywords(combinedText).map(getStem));
  
  let matches = 0;
  const matchedList = [];
  queryStems.forEach((stem, idx) => {
    if (docStems.has(stem)) {
      matches++;
      matchedList.push(queryWords[idx]);
    }
  });

  const uniqueQueryTermsCount = queryStems.length;
  let score = 0;
  if (matches > 0) {
    const targetMatches = Math.max(1, Math.min(uniqueQueryTermsCount, 3));
    if (matches >= targetMatches) {
      score = 100;
    } else {
      const ratio = matches / targetMatches;
      score = Math.round(70 + ratio * 20);
    }
  } else {
    score = 0;
  }

  return { score, matchedList, totalQueryTerms: queryStems.length, matchesCount: matches };
}

function summarizeTextLocal(text) {
  if (!text) return "";
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (cleanText.length === 0) return "";

  const sentences = cleanText.split(/(?<=[.!?])\s+/);
  let summary = [];
  
  // Try to find sentences > 40 chars
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (s.length > 40) {
      summary.push(s);
    }
    if (summary.length >= 2) {
      break;
    }
  }

  // Fallback 1: If we have fewer than 2 sentences, try to add shorter sentences
  if (summary.length < 2) {
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].trim();
      if (s.length > 0 && !summary.includes(s)) {
        summary.push(s);
      }
      if (summary.length >= 2) {
        break;
      }
    }
  }

  // Fallback 2: If we still don't have enough, just use a prefix of the text
  if (summary.length === 0) {
    return cleanText.slice(0, 150) + (cleanText.length > 150 ? "..." : "");
  }

  return summary.join(" ");
}


async function isContentRelated(title, text, customPrompt, threshold = 70) {
  if (_CFG_REF && _CFG_REF.no_api_key_mode) {
    const promptText = customPrompt || "ESG and sustainability topics";
    const { score, matchedList, totalQueryTerms, matchesCount } = calculateLocalRelevanceScore(promptText, title, text);
    const reason = `Local NLP: matched ${matchesCount}/${totalQueryTerms} query terms. Matches: [${matchedList.join(", ")}].`;
    return { score, reason, related: score >= threshold };
  }

  const systemPrompt = `You are a content filtering assistant.
Analyze the article based on the following monitoring scope prompt:
"${customPrompt || "ESG and sustainability topics"}"

Evaluate:
1. Topic relevance: Does the article cover the requested topic?
2. Context relevance: Is the context matching the user's requirements?
3. User prompt alignment: How well does it align with the instructions?

Provide a relevance score from 0 to 100, where:
- 0-39: Not relevant at all
- 40-69: Partially relevant or matching some keywords but context/domain differs
- 70-100: Highly relevant and directly aligns with the monitoring scope

Respond with ONLY a JSON object in this format:
{
  "score": <number from 0 to 100>,
  "reason": "<short 1-sentence explanation of topic/context relevance and user alignment>"
}
Do not include any other text, markdown blocks, or styling.`;

  try {
    const limit = (_CFG_REF && _CFG_REF.token_saving_mode) ? 1000 : 3000;
    const r = await callAI(systemPrompt, `Title: ${title}\n\nContent:\n${text.slice(0, limit)}`);
    const clean = r.replace(/```json|```/g, "").trim();
    const data = JSON.parse(clean);
    const score = (data && typeof data.score === "number") ? data.score : 70;
    const reason = (data && data.reason) ? data.reason : "Matched monitoring scope";
    return { score, reason, related: score >= threshold };
  } catch (e) {
    if (e.message === "ALL_KEYS_EXHAUSTED" || e.message === "API_KEY_MISSING") {
      throw e;
    }
    console.error("AI content relevance check failed, using fallback:", e);
    return { score: 70, reason: `AI check failed: ${e.message}`, related: true };
  }
}

async function generateSummary(title,text){
  if (_CFG_REF && _CFG_REF.no_api_key_mode) {
    return summarizeTextLocal(text) || "No substantial content found to summarize locally.";
  }

  const limit = (_CFG_REF && _CFG_REF.token_saving_mode) ? 2500 : 6000;
  const system=`You are an ESG analyst. Write a concise summary of the article in exactly 1 to 2 sentences. Do not include key points or lists.`;
  try {
    return await callAI(system,`Title: ${title}\n\nArticle:\n${text.slice(0, limit)}`);
  } catch (e) {
    if (e.message === "ALL_KEYS_EXHAUSTED" || e.message === "API_KEY_MISSING") {
      throw e;
    }
    return "AI summary unavailable — check your API key in Settings.";
  }
}

// ── Crawler ──────────────────────────────────────────────
// ── Crawler ──────────────────────────────────────────────
// Fetch HTML via CORS proxy with multiple fallbacks
async function fetchHtml(url, addLog) {
  const proxies = [
    async (u) => {
      const r = await fetch(`/api/fetch-url?url=${encodeURIComponent(u)}`, {signal: AbortSignal.timeout(15000)});
      if (!r.ok) throw new Error(`local-proxy ${r.status}`);
      const t = await r.text();
      if (!t || t.length < 200) throw new Error("local-proxy empty/blocked");
      return t;
    },
    async (u) => {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, {signal: AbortSignal.timeout(14000)});
      if (!r.ok) throw new Error(`allorigins ${r.status}`);
      const j = await r.json();
      if (!j || !j.contents || j.contents.length < 200) throw new Error("allorigins empty/blocked");
      return j.contents;
    },
    async (u) => {
      const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(u)}`, {signal: AbortSignal.timeout(14000)});
      if (!r.ok) throw new Error(`corsproxy ${r.status}`);
      const t = await r.text();
      if (!t || t.length < 200) throw new Error("corsproxy empty");
      return t;
    },
    async (u) => {
      const r = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, {signal: AbortSignal.timeout(14000)});
      if (!r.ok) throw new Error(`codetabs ${r.status}`);
      const t = await r.text();
      if (!t || t.length < 200) throw new Error("codetabs empty");
      return t;
    },
  ];
  for (let pIdx = 0; pIdx < proxies.length; pIdx++) {
    const proxy = proxies[pIdx];
    const proxyNames = ["local-proxy", "allorigins", "corsproxy", "codetabs"];
    const pName = proxyNames[pIdx];
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        return await proxy(url);
      } catch (e) {
        if (addLog) addLog(`   ⚠️ Fetch attempt ${i + 1}/${attempts} failed via proxy ${pName}: ${e.message}`, "warn");
        if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  return "";
}

function extractLinks(html, baseUrl) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const linksMap = new Map();
    doc.querySelectorAll("a[href]").forEach(a => {
      try {
        const urlObj = new URL(a.getAttribute("href"), baseUrl);
        const h = urlObj.href;
        if (h.startsWith("http")) {
          const txt = a.textContent?.trim() || a.getAttribute("title")?.trim() || "";
          if (!linksMap.has(h) || txt.length > linksMap.get(h).text.length) {
            linksMap.set(h, { url: h, text: txt });
          }
        }
      } catch {}
    });
    return [...linksMap.values()];
  } catch { return []; }
}

function detectPublicationDate(doc, url) {
  const dateMetaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[property="og:published_time"]',
    'meta[name="sailthru.date"]',
    'meta[property="og:article:published_time"]'
  ];
  
  let rawDateStr = "";
  for (const selector of dateMetaSelectors) {
    const meta = doc.querySelector(selector);
    if (meta) {
      rawDateStr = meta.getAttribute("content") || meta.getAttribute("value") || "";
      if (rawDateStr) break;
    }
  }
  
  if (!rawDateStr) {
    const timeElem = doc.querySelector("time[datetime]");
    if (timeElem) {
      rawDateStr = timeElem.getAttribute("datetime") || "";
    }
  }
  
  if (!rawDateStr) {
    const dateElem = doc.querySelector('[class*="date"i], [id*="date"i], [class*="time"i], [id*="time"i], [class*="published"i]');
    if (dateElem) {
      rawDateStr = dateElem.textContent?.trim() || "";
    }
  }
  
  if (rawDateStr) {
    const parsed = Date.parse(rawDateStr);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      // Allow timezone differences up to 24 hours in the future
      if (d.getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
        return d;
      }
    }
  }
  return null;
}

function isCategoryOrParentPage(doc, url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    // 1. Homepage
    const homepagePatterns = ["/", "/index.html", "/index.htm", "/index.php", ""];
    if (homepagePatterns.includes(pathname) || urlObj.pathname === "/") {
      return { isExcluded: true, reason: "Homepage" };
    }
    
    // 2. URL exclusions (category, tags, feed, search, etc.)
    const pathExclusions = [
      { pattern: /\/(category|categories|tag|tags|archive|archives|sitemap|search|feed|rss)\b/i, reason: "Category/Tag/Archive/Search/Sitemap page" },
      { pattern: /\/(wp-login|wp-admin|login|signup|support|contact|privacy|terms|faq|jobs|careers|about-us|contact-us)\b/i, reason: "Navigation/Utility page" }
    ];
    for (const { pattern, reason } of pathExclusions) {
      if (pattern.test(pathname)) {
        return { isExcluded: true, reason };
      }
    }
    
    // 3. Link ratio check
    if (doc.body) {
      const clone = doc.cloneNode(true);
      const unwanted = clone.querySelectorAll("script, style, iframe, nav, footer, header, noscript, aside, form");
      unwanted.forEach(el => el.remove());
      
      const totalText = clone.body?.textContent || "";
      const totalTextLen = totalText.replace(/\s+/g, "").length;
      
      let linkTextLen = 0;
      const links = clone.body?.querySelectorAll("a") || [];
      links.forEach(a => {
        linkTextLen += (a.textContent || "").replace(/\s+/g, "").length;
      });
      
      if (totalTextLen > 0) {
        const linkRatio = linkTextLen / totalTextLen;
        if (linkRatio > 0.65) {
          return { isExcluded: true, reason: "Contains mostly links and navigation elements" };
        }
      }
    }
    
    return { isExcluded: false };
  } catch (e) {
    return { isExcluded: false };
  }
}

function extractArticle(html, url) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // --- 1. TITLE EXTRACTION ---
    let title = "";
    
    // Check Open Graph / Twitter Meta tags
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
    const twTitle = doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content");
    if (ogTitle) title = ogTitle.trim();
    else if (twTitle) title = twTitle.trim();
    
    // Fallback to first h1
    if (!title) {
      const h1 = doc.querySelector("h1");
      if (h1) title = h1.textContent?.trim();
    }
    
    // Fallback to <title> tag
    if (!title) {
      const docTitle = doc.querySelector("title");
      if (docTitle) {
        title = docTitle.textContent?.trim();
        // Clean up common suffixes like " | Site Name" or " - Site Name"
        if (title) {
          title = title.replace(/\s+[-|]\s+.*$/, "");
        }
      }
    }
    
    if (!title) {
      title = "Untitled Article";
    }

    // --- 2. DATE EXTRACTION ---
    let dateObj = detectPublicationDate(doc, url);

    // --- 3. TEXT CONTENT EXTRACTION ---
    // Remove unwanted elements first
    const unwanted = doc.querySelectorAll("script, style, iframe, nav, footer, header, noscript, aside, form, .comment, #comment, .comments, #comments, .sidebar, #sidebar, .nav, #nav, .menu, #menu, .ads, .ad, .footer, #footer, .header, #header, .share, .social");
    unwanted.forEach(el => el.remove());

    let textContent = "";
    
    // Look for article container
    const articleContainerSelectors = [
      "article",
      "main",
      '[itemprop="articleBody"]',
      ".post-content",
      ".entry-content",
      ".article-content",
      ".story-content",
      ".body-content",
      ".content-body",
      "#content-body",
      "#article-body"
    ];
    
    let container = null;
    for (const selector of articleContainerSelectors) {
      container = doc.querySelector(selector);
      if (container) break;
    }
    
    if (container) {
      // Extract paragraphs/lists from the found container
      const blocks = container.querySelectorAll("p, li, h2, h3, h4, h5, h6");
      const texts = [];
      blocks.forEach(b => {
        const text = b.textContent?.trim();
        if (text && text.length > 10) {
          texts.push(text);
        }
      });
      textContent = texts.join("\n\n");
    }
    
    // Fallback: extract all p tags from the entire document if container didn't give enough text
    if (textContent.length < 150) {
      const allPs = doc.querySelectorAll("p");
      const texts = [];
      allPs.forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 15) {
          texts.push(text);
        }
      });
      textContent = texts.join("\n\n");
    }
    
    // Last fallback: use textContent of body if still empty
    if (textContent.length < 80) {
      textContent = doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
    }

    // --- 4. IMAGE EXTRACTION ---
    let imageUrl = "";
    try {
      const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
      const twImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
      if (ogImage) imageUrl = ogImage.trim();
      else if (twImage) imageUrl = twImage.trim();

      if (!imageUrl) {
        const imgs = Array.from(doc.querySelectorAll("img"));
        const bodyImg = imgs.find(img => {
          const src = img.getAttribute("src");
          if (!src) return false;
          const w = img.getAttribute("width");
          const h = img.getAttribute("height");
          if (w && parseInt(w, 10) < 150) return false;
          if (h && parseInt(h, 10) < 150) return false;
          return src.startsWith("http");
        });
        if (bodyImg) imageUrl = bodyImg.getAttribute("src");
      }
    } catch (imgErr) {
      console.error("Error extracting image:", imgErr);
    }

    return {
      title,
      text: textContent,
      date: dateObj,
      imageUrl
    };
  } catch (e) {
    console.error("Error in extractArticle:", e);
    return {
      title: "Error Parsing Article",
      text: "",
      date: null
    };
  }
}

async function extractKeywordsFromPrompt(prompt) {
  if (!prompt) return [];
  if (_CFG_REF && _CFG_REF.no_api_key_mode) {
    return prompt
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 4 && !["about", "these", "their", "there", "would", "should", "could", "under", "which", "after", "before"].includes(w));
  }
  const systemPrompt = `You are a search query optimizer. Given a user's content monitoring/crawling prompt, extract a list of 5 to 10 specific, relevant keyword search terms (single words or short 2-3 word phrases) that would likely appear in the URL path or the link text of relevant articles.
Examples:
"Climate change and carbon emissions regulation" -> ["climate", "carbon", "emissions", "regulation", "co2", "greenhouse"]
"ESG sustainability reporting" -> ["esg", "sustainability", "reporting", "environment", "social", "governance"]

Return ONLY a JSON array of strings. Do not include markdown formatting or json backticks.`;

  try {
    const resText = await callAI(systemPrompt, `Prompt: "${prompt}"`);
    const cleanText = resText.replace(/```json|```/g, "").trim();
    const keywords = JSON.parse(cleanText);
    if (Array.isArray(keywords)) {
      return keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
    }
  } catch (e) {
    console.error("AI keyword extraction failed, using fallback:", e);
  }
  
  // Basic fallback: extract words longer than 4 chars from the prompt
  return prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 4 && !["about", "these", "their", "there", "would", "should", "could", "under", "which", "after", "before"].includes(w));
}

function filterLinksByKeywords(links, keywords) {
  if (!keywords || keywords.length === 0) return links;
  
  const scoredLinks = links.map(link => {
    const text = (link.text || "").toLowerCase();
    const url = (link.url || "").toLowerCase();
    
    // We only search the path/query of the URL to avoid matching domain name parts
    let urlToCheck = url;
    try {
      const parsed = new URL(url);
      urlToCheck = parsed.pathname + parsed.search;
    } catch {}

    let matchesText = false;
    let matchesUrl = false;

    keywords.forEach(kw => {
      const kwLower = kw.toLowerCase().trim();
      if (!kwLower) return;
      
      // If keyword is very short, check with word boundaries to avoid false positives
      if (kwLower.length <= 3) {
        const escaped = kwLower.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const pattern = new RegExp(`(^|[^a-zA-Z0-9])` + escaped + `([^a-zA-Z0-9]|$)`, "i");
        if (pattern.test(text)) matchesText = true;
        if (pattern.test(urlToCheck)) matchesUrl = true;
      } else {
        if (text.includes(kwLower)) matchesText = true;
        if (urlToCheck.includes(kwLower)) matchesUrl = true;
      }
    });

    const score = matchesText ? 2 : (matchesUrl ? 1 : 0);
    return { link, score };
  });

  return scoredLinks
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.link);
}

async function filterUrlsWithAI(links, prompt) {
  if (links.length === 0) return [];
  
  // Batch up to 150 links to avoid context limits, though 150 is small enough for modern LLMs
  const listText = links.map((l, i) => `ID ${i}: URL: ${l.url} | Title: ${l.text}`).join("\n");
  
  const systemPrompt = `You are an expert web crawler. Filter the following list of links based on the user's relevance prompt:
"${prompt}"

Identify which links are highly likely to be relevant articles that should be fetched and read.
Return ONLY a valid JSON array of the matching ID numbers. Example: [0, 3, 14, 22]
Do not include any markdown styling, "json" wrappers, or other text.`;

  try {
    const resText = await callAI(systemPrompt, listText);
    const cleanText = resText.replace(/```json|```/g, "").trim();
    const ids = JSON.parse(cleanText);
    if (Array.isArray(ids)) {
      return ids.map(id => links[id]).filter(Boolean);
    }
  } catch (e) {
    console.error("AI URL filtering failed, falling back to all links:", e);
  }
  return links;
}

// Crawl seed URL then fetch all article-like links found on it
async function deepCrawlUrl(seedUrl, _d=2, maxLinks=9999, progressCb=null, planPrompt="", userKeywordsStr="", searchBodyKeywords=false, enableAIKeywords=true) {
  const results = [];
  const visited = new Set([seedUrl]);

  if (progressCb) progressCb(`🌐 Fetching seed page…`);
  const seedHtml = await fetchHtml(seedUrl, progressCb);

  if (!seedHtml) {
    if (progressCb) progressCb(`⚠️ Proxy could not fetch ${seedUrl.slice(0,50)} — try a different URL or check the proxy`);
    return { results: [], combinedKeywords: [] };
  }
  if (progressCb) progressCb(`✅ Seed page fetched (${Math.round(seedHtml.length/1024)}KB)`);

  // Always include seed page itself
  results.push({ html: seedHtml, url: seedUrl });

  // Extract all links from seed
  const allLinks = extractLinks(seedHtml, seedUrl);
  if (progressCb) progressCb(`🔗 Found ${allLinks.length} links on page`);

  let base;
  try { base = new URL(seedUrl); } catch { return { results, combinedKeywords: [] }; }

  const isSameDomain = (h1, h2) => {
    const clean = h => h.replace(/^www\./i, "");
    return clean(h1) === clean(h2);
  };

  // Skip listing, utility pages, and static assets, but allow category subpaths for articles
  const SKIP = /\/(search|feed|rss|sitemap|author|wp-login|wp-admin|page\/\d|#|contact|privacy|terms|login|signup|support|advertise|subscribe|cookies|cart|checkout|account|profile|help|faq|jobs|careers|about-us|contact-us)/i;
  const ASSETS = /\.(xml|json|pdf|jpg|jpeg|png|gif|css|js|ico|svg)$/i;

  let candidateLinks = allLinks.filter(l => {
    try {
      const u = new URL(l.url);
      if (!isSameDomain(u.hostname, base.hostname)) return false;
      const p = u.pathname;
      if (p === "/" || p === "" || p === "/index.html") return false;
      if (ASSETS.test(p)) return false;
      if (SKIP.test(p)) return false;
      if (/^\/(category|tag|tags|categories)\/[^/]+\/?$/i.test(p)) return false;
      return true;
    } catch { return false; }
  });

  // 1. Combine AI-generated keywords and user-defined keywords (Step 1 & Step 2)
  let combinedKeywords = [];
  
  // Extract user-defined keywords if provided
  const userKeywords = (userKeywordsStr || "")
    .split(",")
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  // Generate AI keywords from the prompt scope
  let aiKeywords = [];
  if (enableAIKeywords && planPrompt && candidateLinks.length > 0) {
    if (progressCb) progressCb(`🔍 [AI] Extracting search keywords from prompt...`);
    aiKeywords = await extractKeywordsFromPrompt(planPrompt);
    if (progressCb) progressCb(`🔍 [AI] Extracted AI keywords: ${aiKeywords.join(", ")}`);
  }

  // Merge: user-defined keywords have higher priority (placed first)
  combinedKeywords = [...userKeywords];
  aiKeywords.forEach(k => {
    const kl = k.toLowerCase().trim();
    if (kl && !combinedKeywords.includes(kl)) {
      combinedKeywords.push(kl);
    }
  });

  // 2. Initial Relevance Check: filter candidate links based on the combined keywords (Step 3)
  if (!searchBodyKeywords && combinedKeywords.length > 0 && candidateLinks.length > 0) {
    if (progressCb) progressCb(`🔍 [Keywords] Running initial relevance check on titles against combined keywords...`);
    const beforeKeywordCount = candidateLinks.length;
    candidateLinks = filterLinksByKeywords(candidateLinks, combinedKeywords);
    const skippedByKeywords = beforeKeywordCount - candidateLinks.length;
    if (progressCb) {
      progressCb(`🔍 [Keywords] Initial Relevance Check: Filtered out ${skippedByKeywords} link(s) (${Math.round((skippedByKeywords / beforeKeywordCount) * 100)}% skipped). Reason: Article title is not relevant to monitoring scope.`);
    }
  } else if (searchBodyKeywords && combinedKeywords.length > 0) {
    if (progressCb) progressCb(`🔍 [Keywords] Body matching scope active: fetching articles first, will scan entire text later.`);
  } else if (!planPrompt && !userKeywordsStr) {
    if (progressCb) progressCb(`📋 ${candidateLinks.length} article-like links found — fetching up to ${maxLinks}`);
  }

  // 3. Fetch all final selected links (without limit of 25)
  const totalToFetch = Math.min(candidateLinks.length, maxLinks);
  if (progressCb) progressCb(`📋 Fetching content for ${totalToFetch} relevant pages...`);

  for (let i = 0; i < totalToFetch; i++) {
    const link = candidateLinks[i];
    if (visited.has(link.url)) continue;
    visited.add(link.url);
    if (progressCb) progressCb(`🌐 [${i+1}/${totalToFetch}] ${link.url.replace(base.origin,"").slice(0,55)}…`);
    const html = await fetchHtml(link.url, progressCb);
    if (html && html.length > 500) results.push({ html, url: link.url });
    else if (progressCb) progressCb(`   ⤷ Empty response — skipped`);
    // 250ms between requests to respect proxy rate limits
    await new Promise(r => setTimeout(r, 250));
  }

  if (progressCb) progressCb(`✅ Fetched ${results.length} pages total`);
  return { results, combinedKeywords };
}

const _crawlingPlans = new Set();

async function runCrawlForPlan(plan, store, dispatch, showToast, onProgress, addLogLocal, getLatestPlan) {
  if (_crawlingPlans.has(plan.id)) {
    if (addLogLocal) addLogLocal("⚠️ Already crawling this plan — please wait", "warn");
    return;
  }
  _crawlingPlans.add(plan.id);

  const pushStage = (s) => dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{stage:s,stageAt:new Date().toISOString()}});
  
  const found = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  
  try {
    const existing = (store.articles || []).filter(a => a.plan_id === plan.id);
    existing.forEach(a => {
      const cleanTitle = (a.title || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
      if (cleanTitle) seenTitles.add(cleanTitle);
    });
  } catch (e) {
    console.error("Error populating seenTitles:", e);
  }

  let startUrlIndex = 0;
  let completedUrls = [];
  let failedUrls = [];

  if (plan.crawlState) {
    startUrlIndex = plan.crawlState.urlIndex || 0;
    completedUrls = plan.crawlState.completedUrls || [];
    failedUrls = plan.crawlState.failedUrls || [];
    if (plan.crawlState.seenUrls) {
      plan.crawlState.seenUrls.forEach(url => seenUrls.add(url));
    }
  }

  const updateProgressState = (stepText, progressPct, currentUrlIndex) => {
    dispatch({
      type: "UPDATE_PLAN",
      id: plan.id,
      changes: {
        crawlState: {
          urlIndex: currentUrlIndex !== undefined ? currentUrlIndex : (plan.crawlState?.urlIndex || 0),
          completedUrls,
          failedUrls,
          seenUrls: Array.from(seenUrls),
          step: stepText,
          progress: progressPct,
          isActive: true
        }
      }
    });
  };

  const addLog = (msg, type="info") => {
    if (addLogLocal) addLogLocal(msg, type);
    dispatch({type:"ADD_LOG",entry:{type:type==="error"?"error":"crawl",event:msg,plan:plan.name}});
    
    // Relay logs to backend console for easy debugging
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `[Plan: ${plan.name}] [${type.toUpperCase()}] ${msg}` })
    }).catch(() => {});

    // update step text if it looks like a progress message
    if (msg.startsWith("━━━") || msg.startsWith("   🤖") || msg.startsWith("   📄") || msg.startsWith("   ⤷")) {
      updateProgressState(msg, plan.crawlState?.progress !== undefined ? plan.crawlState.progress : 0);
    }
  };

  const handleOnProgress = (step, pct) => {
    if (onProgress) onProgress(step, pct);
    updateProgressState(step || plan.crawlState?.step || "Processing...", pct);
  };

  const crawlStartTime = Date.now();
  if (startUrlIndex === 0) {
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "info",
        title: "Crawl Started",
        message: `Crawl process started for plan "${plan.name}"`,
        plan: plan.name
      }
    });
  }

  if (startUrlIndex > 0) {
    addLog(`🔄 Resuming crawl from URL index ${startUrlIndex + 1}/${(plan.urls || []).length}`, "info");
  }

  pushStage("crawling");

  try {
    try {
      await validateKeysBeforeCrawl(store.config, store.keyStatuses || {}, dispatch, addLog);
    } catch (e) {
      addLog(`⚠️ Key validation warning: ${e.message}. Crawling will proceed with AI features disabled.`, "warn");
    }

    const urls = plan.urls || [];
    if (urls.length === 0) {
      addLog("⚠️ No URLs configured — add URLs in the URLs tab first", "warn");
      pushStage("done");
      _crawlingPlans.delete(plan.id);
      return;
    }

    for (let ui = startUrlIndex; ui < urls.length; ui++) {
      const u = urls[ui];
      dispatch({ type: "INCREMENT_METRIC", metric: "totalUrlsProcessed" });

      // Cancellation check before starting this URL
      if (getLatestPlan) {
        const latest = getLatestPlan();
        if (latest && (latest.status === "cancelled" || latest.stage === "cancelled" || latest.status === "paused" || latest.status === "idle")) {
          addLog(`🛑 Crawl cancelled/stopped by user at URL index ${ui + 1}`, "warn");
          dispatch({
            type: "ADD_NOTIFICATION",
            entry: {
              type: "warn",
              title: "Crawl Cancelled",
              message: `Crawl process for "${plan.name}" was cancelled by the user.`,
              plan: plan.name
            }
          });
          _crawlingPlans.delete(plan.id);
          return;
        }
      }

      // Update persistent crawlState index before starting
      updateProgressState(`Crawling: ${u.label || u.url}`, Math.floor((ui / urls.length) * 100), ui);

      try {
        addLog(`━━━ Crawling [${ui+1}/${urls.length}]: ${u.label || u.url}`);
        if (onProgress) onProgress(`Crawling: ${u.label||u.url}`, Math.floor((ui/urls.length)*100));

        const { results: pages, combinedKeywords } = await deepCrawlUrl(
          u.url,
          2,
          9999,
          (msg) => addLog(msg),
          plan.prompt,
          plan.keywords,
          plan.searchBodyKeywords,
          plan.enableAIKeywords
        );
        addLog(`   📄 Got ${pages.length} pages from this URL`);

        for (let i = 0; i < pages.length; i++) {
          try {
            // Cancellation check before each page
            if (getLatestPlan) {
              const latest = getLatestPlan();
              if (latest && (latest.status === "cancelled" || latest.stage === "cancelled" || latest.status === "paused" || latest.status === "idle")) {
                addLog(`🛑 Crawl cancelled/stopped by user during page download`, "warn");
                _crawlingPlans.delete(plan.id);
                return;
              }
            }

            // Cancellation check before each page
            if (getLatestPlan) {
              const latest = getLatestPlan();
              if (latest && (latest.status === "cancelled" || latest.stage === "cancelled" || latest.status === "paused" || latest.status === "idle")) {
                addLog(`🛑 Crawl cancelled/stopped by user during page download`, "warn");
                _crawlingPlans.delete(plan.id);
                return;
              }
            }

            if (seenUrls.has(pages[i].url)) continue;
            seenUrls.add(pages[i].url);
            if (onProgress) onProgress(null, Math.floor(((ui + (i + 1) / pages.length) / urls.length) * 100));

            // Helper to log rejected article details
            const logRejection = (pubDate, reason) => {
              const formattedDate = pubDate ? (pubDate instanceof Date ? pubDate.toISOString().slice(0, 10) : String(pubDate)) : "N/A";
              addLog(`   ⤷ [${i+1}] STATUS: REJECTED`);
              if (pubDate) {
                addLog(`   ⤷ [${i+1}] Publication Date: ${formattedDate}`);
              }
              addLog(`   ⤷ [${i+1}] Date Validation Status = FAILED`);
              addLog(`   ⤷ [${i+1}] Rejection Reason: ${reason}`);
              addLog(`   ⤷ [${i+1}] URL: ${pages[i].url}`);
              dispatch({ type: "INCREMENT_METRIC", metric: "articlesRejected" });
            };

            // 1. Publication Date Detection
            const doc = new DOMParser().parseFromString(pages[i].html, "text/html");
            const artDate = detectPublicationDate(doc, pages[i].url);

            // 2. Date Range Validation
            if (!artDate) {
              logRejection(null, "Publication date not found");
              continue;
            }

            const fp = plan.fetchPeriod || "month";
            const fpd = plan.fetchPeriodDays || 30;
            let isWithinRange = true;
            const now = Date.now();
            if (fp === "day") {
              const cutoff = now - 24 * 60 * 60 * 1000;
              isWithinRange = artDate.getTime() >= cutoff;
            } else if (fp === "week") {
              const cutoff = now - 7 * 24 * 60 * 60 * 1000;
              isWithinRange = artDate.getTime() >= cutoff;
            } else if (fp === "month") {
              const cutoff = now - 30 * 24 * 60 * 60 * 1000;
              isWithinRange = artDate.getTime() >= cutoff;
            } else if (fp === "custom") {
              if (plan.customStartDate || plan.customEndDate) {
                if (plan.customStartDate) {
                  const start = new Date(plan.customStartDate).getTime();
                  if (!isNaN(start) && artDate.getTime() < start) isWithinRange = false;
                }
                if (plan.customEndDate) {
                  const end = new Date(plan.customEndDate).getTime();
                  if (!isNaN(end) && artDate.getTime() > end) isWithinRange = false;
                }
              } else {
                const cutoff = now - (Number(fpd) || 30) * 24 * 60 * 60 * 1000;
                isWithinRange = artDate.getTime() >= cutoff;
              }
            }

            if (!isWithinRange) {
              logRejection(artDate, "Published outside date range");
              continue;
            }

            // 3. Category/Parent Page Exclusion
            const exclusion = isCategoryOrParentPage(doc, pages[i].url);
            if (exclusion.isExcluded) {
              logRejection(artDate, exclusion.reason);
              continue;
            }

            // 4. Content Extraction
            const art = extractArticle(pages[i].html, pages[i].url);
            
            if (!art.text || art.text.length < 80) {
              logRejection(artDate, "No readable content");
              continue;
            }

            // 5. Word Count Check (At least 200 words of relevant content)
            const wordCount = (art.text || "").trim().split(/\s+/).filter(w => w.length > 0).length;
            if (wordCount < 200) {
              logRejection(artDate, `Less than 200 words (${wordCount} words found)`);
              continue;
            }

            // 6. Duplicate Content Check (By clean title)
            const cleanTitle = (art.title || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
            if (seenTitles.has(cleanTitle)) {
              logRejection(artDate, "Duplicate article content");
              continue;
            }
            seenTitles.add(cleanTitle);

            // 7. Keyword Filtering
            if (plan.searchBodyKeywords && combinedKeywords && combinedKeywords.length > 0) {
              const textToSearch = `${art.title} ${art.text} ${pages[i].url}`.toLowerCase();
              const match = combinedKeywords.some(kw => textToSearch.includes(kw));
              if (!match) {
                logRejection(artDate, `Keyword mismatch (none of: ${combinedKeywords.join(", ")})`);
                continue;
              }
            }

            // 8. Semantic Similarity / Relevance Check
            pushStage("analyzing");
            addLog(`   🤖 [AI] Checking relevance: "${art.title.slice(0,50)}"`);
            let relResult = { score: 70, reason: "AI check failed", related: true };
            try {
              // Pacing delay of 1.5 seconds to respect API rate limits
              await new Promise(r => setTimeout(r, 1500));
              relResult = await isContentRelated(
                art.title,
                art.text,
                plan.prompt,
                plan.relevanceThreshold !== undefined ? plan.relevanceThreshold : 70
              );
              addLog(`   🤖 [AI] Result: score=${relResult.score} (${relResult.related ? "✅ RELEVANT" : "❌ not relevant"}) - ${relResult.reason}`);
            } catch (e) {
              addLog(`   ⚠️ AI unavailable (${e.message}) — including article by default`);
              relResult = { score: 70, reason: `AI check failed: ${e.message}`, related: true };
            }

            if (!relResult.related) {
              logRejection(artDate, `Article content is not relevant to monitoring scope (Score: ${relResult.score}% < ${plan.relevanceThreshold || 70}%)`);
              pushStage("crawling");
              continue;
            }

            // 9. Summary Generation
            pushStage("summarizing");
            addLog(`   🤖 [AI] Summarizing: "${art.title.slice(0,40)}…"`);
            let summary = "";
            try {
              // Pacing delay of 1.5 seconds to respect API rate limits
              await new Promise(r => setTimeout(r, 1500));
              summary = await generateSummary(art.title, art.text);
              addLog(`   🤖 [AI] Summary generated (${summary.length} chars)`);
            } catch (e) {
              summary = art.text.slice(0, 150) + "…";
              addLog(`   ⚠️ AI summary unavailable — using excerpt`);
            }

            // 10. Saving accepted article
            const r = {
              id: `art_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              plan_id: plan.id,
              plan_name: plan.name,
              company: u.label || u.url,
              title: art.title,
              publish_date: artDate.toISOString().slice(0, 10),
              date_validation_status: "PASSED",
              url: pages[i].url,
              summary,
              relevance_score: relResult.score,
              relevance_reason: relResult.reason,
              key_points: [],
              image_url: art.imageUrl || "",
              crawled_at: new Date().toISOString()
            };
            dispatch({ type: "INCREMENT_METRIC", metric: "articlesSelected" });
            found.push(r);
            dispatch({type:"ADD_ARTICLE", article:r});
            addLog(`   📰 Saved: ${art.title.slice(0,55)}`);
            pushStage("crawling");
          } catch (innerErr) {
            addLog(`   ⚠️ Error processing article page ${pages[i]?.url || ""}: ${innerErr.message}`, "warn");
          }
        }
        completedUrls.push(u.url);
      } catch (urlErr) {
        addLog(`❌ Failed to crawl URL ${u.url}: ${urlErr.message}`, "error");
        failedUrls.push(u.url);
      }

      // Update progress on index increment
      updateProgressState(`Finished crawling: ${u.label || u.url}`, Math.floor(((ui + 1) / urls.length) * 100), ui + 1);
    }

    if (onProgress) onProgress("Done!", 100);
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "success",
        title: "Crawl Completed",
        message: `Crawl completed for plan "${plan.name}". Found ${found.length} articles.`,
        plan: plan.name
      }
    });
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{lastRun:new Date().toISOString(),articlesCount:(plan.articlesCount||0)+found.length,crawlState:null}});
    dispatch({type:"ADD_LOG",entry:{type:"crawl",event:`Crawl complete — ${found.length} article(s) saved`,plan:plan.name}});
    addLog(`━━━ Done! ${found.length} article(s) saved from ${seenUrls.size} pages checked`);

    if (found.length === 0) {
      pushStage("done");
      if (showToast) showToast("Crawl complete", "crawl", {sub:"0 articles found — check logs for details"});
    } else {
      if (showToast) showToast(`${found.length} article(s) found!`, "crawl", {sub:`Plan: ${plan.name}`, duration:6000});
      const ag = (plan.recipientGroups||[]).filter(g=>g.active);
      const allEmails = [...new Set(ag.flatMap(g=>g.emails||[]))];
      const mode = plan.sendMode || "immediate";
      const autoMail = plan.autoMail || false;
      if (autoMail && allEmails.length > 0 && mode === "immediate") {
        addLog(`📧 Sending email to ${allEmails.length} recipient(s)…`);
        await sendEmailForPlan(plan, store, dispatch, showToast, found, allEmails, addLogLocal);
      } else if (autoMail && allEmails.length > 0 && mode === "scheduled") {
        pushStage("done");
        if (showToast) showToast("Articles queued", "email", {sub:`Will send at ${plan.sendTime||"09:00"}`});
      } else if (autoMail && allEmails.length === 0) {
        pushStage("done");
        addLog("⚠️ Auto-mail ON but no recipients — add emails in the Email tab", "warn");
      } else {
        pushStage("done");
      }
    }
  } catch(e) {
    addLog(`❌ Crawl failed: ${e.message}`, "error");
    if (showToast) showToast("Crawl error", "error", {sub:e.message});
    dispatch({
      type: "UPDATE_PLAN",
      id: plan.id,
      changes: {
        stage: "error",
        stageAt: new Date().toISOString(),
        crawlState: null
      }
    });
    dispatch({
      type: "ADD_NOTIFICATION",
      entry: {
        type: "error",
        title: "Crawl Failed",
        message: `Crawl failed for plan "${plan.name}": ${e.message}`,
        plan: plan.name
      }
    });
  } finally {
    const elapsedSeconds = Math.floor((Date.now() - crawlStartTime) / 1000);
    dispatch({ type: "ADD_PROCESSING_TIME", time: elapsedSeconds });
    _crawlingPlans.delete(plan.id);
  }
}

// ── Scheduler ────────────────────────────────────────────
// Uses setTimeout chains so it fires EXACTLY at the right time,
// not a polling loop that misses minutes.
class Scheduler {
  constructor() { this.jobs = {}; }

  // Register a daily/weekly/monthly job that fires at HH:MM
  register(planId, period, time, cb, weekDays) {
    const id = `${planId}__${period}`;
    this.clear(id);
    const scheduleNext = () => {
      const now = new Date();
      const [hh, mm] = (time || "08:00").split(":").map(Number);
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      // If time already passed today, schedule for tomorrow
      if (next <= now) next.setDate(next.getDate() + 1);
      // For weekly: advance to the next day that is selected in weekDays
      if (period === "week") {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const targetDays = weekDays && weekDays.length > 0 ? weekDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];
        while (!targetDays.includes(dayNames[next.getDay()])) {
          next.setDate(next.getDate() + 1);
        }
      }
      // For monthly: advance to 1st of next month if needed
      if (period === "month") { next.setDate(1); if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(1); } }
      const delay = next.getTime() - Date.now();
      if (this.jobs[id]) this.jobs[id].nextRun = next.toISOString();
      const h = setTimeout(() => {
        if (!this.jobs[id]) return; // was cleared
        cb();
        this.jobs[id].nextRun = this.calcNext(period, time, weekDays);
        // Re-schedule for the next occurrence
        scheduleNext();
      }, delay);
      if (this.jobs[id]) {
        clearTimeout(this.jobs[id].handle);
        this.jobs[id].handle = h;
        this.jobs[id].isTimeout = true;
      }
    };
    this.jobs[id] = { handle: null, planId, period, time, nextRun: this.calcNext(period, time, weekDays), isTimeout: true };
    scheduleNext();
  }

  // Register a repeating interval job (minutes)
  registerInterval(planId, jobKey, minutes, cb) {
    const id = `${planId}__${jobKey}`;
    this.clear(id);
    const ms = Math.max(1, Number(minutes)) * 60000;
    const h = setInterval(() => {
      if (!this.jobs[id]) return;
      cb();
      if (this.jobs[id]) this.jobs[id].nextRun = new Date(Date.now() + ms).toISOString();
    }, ms);
    this.jobs[id] = { handle: h, planId, period: `every ${minutes}m`, time: null, nextRun: new Date(Date.now() + ms).toISOString(), kind: "interval" };
  }

  // Register a one-time job
  registerOnce(planId, jobKey, whenIso, cb) {
    const id = `${planId}__${jobKey}`;
    this.clear(id);
    const delay = Math.max(0, new Date(whenIso).getTime() - Date.now());
    const h = setTimeout(() => { cb(); this.clear(id); }, delay);
    this.jobs[id] = { handle: h, planId, period: "once", time: null, nextRun: whenIso, kind: "once", isTimeout: true };
  }

  clear(id) {
    if (!this.jobs[id]) return;
    if (this.jobs[id].isTimeout || this.jobs[id].kind === "once") clearTimeout(this.jobs[id].handle);
    else clearInterval(this.jobs[id].handle);
    delete this.jobs[id];
  }

  clearPlan(planId) {
    Object.keys(this.jobs).filter(k => k.startsWith(`${planId}__`)).forEach(k => this.clear(k));
  }

  calcNext(period, time, weekDays) {
    const n = new Date();
    const [h, m] = (time || "08:00").split(":").map(Number);
    const nx = new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m, 0, 0);
    if (nx <= n) nx.setDate(nx.getDate() + 1);
    if (period === "week") {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const targetDays = weekDays && weekDays.length > 0 ? weekDays : ["Mon", "Tue", "Wed", "Thu", "Fri"];
      while (!targetDays.includes(dayNames[nx.getDay()])) {
        nx.setDate(nx.getDate() + 1);
      }
    }
    if (period === "month") { nx.setDate(1); if (nx <= n) { nx.setMonth(nx.getMonth() + 1); nx.setDate(1); } }
    return nx.toISOString();
  }

  getJobs() { return Object.values(this.jobs); }
}
const SCH = new Scheduler();

// ── Atoms ────────────────────────────────────────────────
function Btn({primary,danger,sm,xs,icon:Icon,iconColor,onClick,children,title,disabled,style}){
  const isIconOnly = !children && Icon;
  const b={
    display:"inline-flex",
    alignItems:"center",
    gap:6,
    padding:isIconOnly ? "0" : (sm ? "6px 13px" : xs ? "4px 9px" : "7px 16px"),
    borderRadius:8,
    fontSize:sm||xs?12:13,
    cursor:disabled?"not-allowed":"pointer",
    border:`1px solid ${danger?"rgba(220,38,38,.2)":C.line2}`,
    fontWeight:500,
    transition:"all .12s",
    outline:"none",
    whiteSpace:"nowrap",
    fontFamily:"inherit",
    opacity:disabled?.5:1
  };
  const t=primary?{background:C.accent,color:"#fff",borderColor:C.accent}:danger?{background:C.redBg,color:C.red}:{background:C.paper,color:Icon&&!children?(iconColor||C.ink3):C.ink};
  const w = isIconOnly ? (sm ? 30 : xs ? 24 : 34) : undefined;
  const h = isIconOnly ? (sm ? 30 : xs ? 24 : 34) : undefined;
  return <button onClick={disabled?undefined:onClick} title={title} style={{...b,...t,width:w,height:h,justifyContent:isIconOnly?"center":undefined,...style}}>{Icon&&<Icon size={sm||xs?14:16}/>}{children}</button>;
}
function Badge({variant="gray",children,Icon}){const colors={green:[C.greenBg,C.green],blue:[C.accentBg,C.accent],amber:[C.amberBg,C.amber],red:[C.redBg,C.red],purple:[C.purpleBg,C.purple],gray:[C.surface2,C.ink3]};const[bg,color]=colors[variant]||colors.gray;return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:700,background:bg,color}}>{Icon&&<Icon size={12}/>}{children}</span>;}
function Card({children,style,p=16}){return <div style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:12,padding:p,...style}}>{children}</div>;}
function StatBox({value,label,delta,deltaUp,color}){return <div style={{background:C.surface,borderRadius:8,padding:"11px 13px"}}><div style={{fontSize:20,fontWeight:700,color:color||C.ink,marginBottom:2}}>{value}</div><div style={{fontSize:11,color:C.ink3}}>{label}</div>{delta&&<div style={{fontSize:10,marginTop:2,color:deltaUp?C.green:C.red}}>{delta}</div>}</div>;}
function Toggle({checked,onChange}){return <label style={{position:"relative",display:"inline-block",width:34,height:18,flexShrink:0,cursor:"pointer"}}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{opacity:0,width:0,height:0,position:"absolute"}}/><span style={{position:"absolute",inset:0,background:checked?C.accent:C.surface2,borderRadius:9,transition:".18s"}}><span style={{position:"absolute",height:12,width:12,left:checked?19:3,bottom:3,background:"#fff",borderRadius:"50%",transition:".18s",boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/></span></label>;}

// ── Stage Pipeline ───────────────────────────────────────
const STAGES=[
  {key:"idle",label:"Idle",Icon:Clock},
  {key:"crawling",label:"Crawling",Icon:Globe},
  {key:"analyzing",label:"Analyzing",Icon:Brain},
  {key:"summarizing",label:"Summarizing",Icon:FileText},
  {key:"sending",label:"Sending",Icon:Send},
  {key:"done",label:"Done",Icon:CheckCircle2},
];
function StagePipeline({stage="idle",compact}){
  const idx=stage==="error"?-1:STAGES.findIndex(s=>s.key===stage);
  return <div style={{display:"flex",alignItems:"center",gap:compact?2:4}}>
    {STAGES.map((s,i)=>{
      const active=i===idx;const done=idx>i&&stage!=="error";const err=stage==="error"&&i===0;
      const color=err?C.red:active?C.accent:done?C.green:C.ink3;
      const bg=err?C.redBg:active?C.accentBg:done?C.greenBg:C.surface;
      return <div key={s.key} style={{display:"flex",alignItems:"center",gap:compact?2:4}}>
        <div title={s.label} style={{display:"flex",alignItems:"center",gap:5,padding:compact?"3px 7px":"5px 10px",borderRadius:20,background:bg,color,fontSize:compact?10:11,fontWeight:700,border:active?`1px solid ${color}`:"1px solid transparent",transition:"all .15s"}}>
          <s.Icon size={compact?12:14} strokeWidth={2}/>{!compact&&s.label}
        </div>
        {i !== STAGES.length - 1&&<ChevronRight size={compact?11:13} color={C.line2}/>}
      </div>;
    })}
    {stage==="error"&&<Badge variant="red" Icon={AlertTriangle}>Error</Badge>}
  </div>;
}
function Modal({open,onClose,title,children,width=480}){if(!open)return null;return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(2px)"}}><div style={{background:"#fff",borderRadius:16,padding:22,width,maxWidth:"94vw",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${C.line}`}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><span style={{fontSize:14,fontWeight:700}}>{title}</span><Btn icon={X} onClick={onClose} sm/></div>{children}</div></div>;}
function FormRow({label,help,children}){return <div style={{marginBottom:12}}><label style={{fontSize:11,fontWeight:600,color:C.ink2,marginBottom:4,display:"block"}}>{label}</label>{children}{help&&<div style={{fontSize:10,color:C.ink3,marginTop:3}}>{help}</div>}</div>;}
function Inp({value,onChange,placeholder,type="text",style,rows}){const b={width:"100%",padding:"7px 10px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:12,background:"#fff",color:C.ink,outline:"none",fontFamily:"inherit",...style};if(rows)return <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{...b,resize:"vertical"}}/>;return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} type={type} style={b}/>;}
function Sel({value,onChange,options,style}){return <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"7px 10px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:12,background:"#fff",color:C.ink,outline:"none",fontFamily:"inherit",cursor:"pointer",...style}}>{options.map(o=>typeof o==="string"?<option key={o}>{o}</option>:<option key={o.v} value={o.v}>{o.l}</option>)}</select>;}
function ProgBar({pct,color=C.accent}){return <div style={{height:5,background:C.surface2,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3,transition:"width .3s"}}/></div>;}
function useToast(){
  const[toasts,setToasts]=useState([]);
  const timerRef=useRef({});
  const show=(msg,type="",opts={})=>{
    const id=`toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const duration=opts.duration||4200;
    setToasts(prev=>[...prev,{id,msg,type,icon:opts.icon,sub:opts.sub,ts:Date.now()}]);
    timerRef.current[id]=setTimeout(()=>{
      setToasts(prev=>prev.filter(t=>t.id!==id));
      delete timerRef.current[id];
    },duration);
    return id;
  };
  const dismiss=(id)=>{
    clearTimeout(timerRef.current[id]);
    delete timerRef.current[id];
    setToasts(prev=>prev.filter(t=>t.id!==id));
  };
  // Backward-compat: return array [toasts, show] where show works as before
  return[toasts,show,dismiss];
}

function Toast({toasts,dismiss}){
  if(!toasts||toasts.length===0)return null;
  const cfg={
    success:{bg:"#0f0e0d",bar:"#22c55e",Icon:CheckCircle2,iconColor:"#22c55e"},
    error:  {bg:"#1a0505",bar:"#ef4444",Icon:XCircle,      iconColor:"#ef4444"},
    warn:   {bg:"#1a1000",bar:"#f59e0b",Icon:AlertTriangle, iconColor:"#f59e0b"},
    crawl:  {bg:"#071428",bar:"#2f54eb",Icon:Globe,         iconColor:"#60a5fa"},
    email:  {bg:"#031410",bar:"#10b981",Icon:Mail,          iconColor:"#34d399"},
    sched:  {bg:"#0d0a1f",bar:"#8b5cf6",Icon:Clock,         iconColor:"#a78bfa"},
    "":     {bg:"#0f0e0d",bar:"#888780",Icon:Bell,          iconColor:"#888780"},
  };
  return <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end",pointerEvents:"none"}}>
    {toasts.slice(-5).map((t,idx)=>{
      const{bg,bar,Icon,iconColor}=cfg[t.type]||cfg[""];
      return(
        <div key={t.id} style={{
          pointerEvents:"all",
          background:bg,
          border:`1px solid rgba(255,255,255,.1)`,
          borderLeft:`3px solid ${bar}`,
          borderRadius:12,
          padding:"12px 14px 12px 12px",
          minWidth:280,
          maxWidth:380,
          boxShadow:"0 8px 32px rgba(0,0,0,.45)",
          display:"flex",
          alignItems:"flex-start",
          gap:10,
          animation:"toastIn .22s cubic-bezier(.34,1.56,.64,1)",
          cursor:"pointer",
        }} onClick={()=>dismiss(t.id)}>
          <div style={{width:30,height:30,borderRadius:8,background:`${bar}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <Icon size={15} color={iconColor}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:"#fff",lineHeight:1.4,marginBottom:t.sub?3:0}}>{t.msg}</div>
            {t.sub&&<div style={{fontSize:11,color:"rgba(255,255,255,.55)",lineHeight:1.4}}>{t.sub}</div>}
          </div>
          <button onClick={e=>{e.stopPropagation();dismiss(t.id);}} style={{background:"none",border:"none",color:"rgba(255,255,255,.35)",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 0 0 4px",flexShrink:0,marginTop:-1}}>×</button>
        </div>
      );
    })}
  </div>;
}

// ── Rail ─────────────────────────────────────────────────
const NAV=[{id:"plans",Icon:Layers,label:"Plans"},{id:"monitoring",Icon:Activity,label:"Monitor"},{id:"logs",Icon:ListChecks,label:"Logs"},{id:"dashboard",Icon:BarChart3,label:"Stats"}];
function Rail({page,setPage,hasErrors}){return <nav style={{width:64,background:"#0f0e0d",display:"flex",flexDirection:"column",alignItems:"center",padding:"12px 0",gap:4,flexShrink:0,zIndex:10}}><div style={{width:36,height:36,borderRadius:10,overflow:"hidden",marginBottom:8,border:`1px solid rgba(255,255,255,.1)`}}><img src={LogoImg} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="Logo" /></div>{NAV.map(({id,Icon,label})=><button key={id} onClick={()=>setPage(id)} title={label} style={{width:48,height:48,borderRadius:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",border:"none",background:page===id?"rgba(255,255,255,.12)":"transparent",color:page===id?"#fff":"#888",transition:"all .14s",position:"relative"}}><Icon size={20}/><span style={{fontSize:9,fontWeight:500}}>{label}</span>{id==="monitoring"&&hasErrors&&<span style={{position:"absolute",top:6,right:6,width:7,height:7,background:C.red,borderRadius:"50%",border:"1.5px solid #0f0e0d"}}/>}</button>)}<div style={{width:28,height:0.5,background:"rgba(255,255,255,.1)",margin:"4px 0"}}/><button onClick={()=>setPage("settings")} title="Settings" style={{width:48,height:48,borderRadius:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",border:"none",background:page==="settings"?"rgba(255,255,255,.12)":"transparent",color:page==="settings"?"#fff":"#888",transition:"all .14s"}}><Settings size={20}/><span style={{fontSize:9,fontWeight:500}}>Settings</span></button><div style={{marginTop:"auto"}}><div style={{width:32,height:32,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>A</div></div></nav>;}
function NotificationCenter({ store, dispatch }) {
  const [open, setOpen] = useState(false);
  const notifications = store.notifications || [];
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    dispatch({ type: "MARK_ALL_NOTIFICATIONS_READ" });
  };

  const clearAll = () => {
    dispatch({ type: "CLEAR_NOTIFICATIONS" });
  };

  const formatTime = (ts) => {
    const elapsed = Date.now() - new Date(ts).getTime();
    if (elapsed < 60000) return "just now";
    const mins = Math.floor(elapsed / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const colors = {
    success: { bg: C.greenBg, text: C.green, border: C.green },
    error: { bg: C.redBg, text: C.red, border: C.red },
    warn: { bg: C.amberBg, text: C.amber, border: C.amber },
    info: { bg: C.accentBg, text: C.accent, border: C.accent }
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          position: "relative",
          width: 34,
          height: 34,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .15s",
          backgroundColor: open ? C.surface2 : "transparent"
        }}
        title="Notifications"
      >
        <Bell size={18} color={C.ink2} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              backgroundColor: C.red,
              color: "#fff",
              fontSize: 8,
              fontWeight: 800,
              borderRadius: "50%",
              width: 13,
              height: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1.5px solid ${C.paper}`
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 998
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 42,
              right: 0,
              width: 320,
              background: "#fff",
              border: `1px solid ${C.line2}`,
              borderRadius: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,.12)",
              zIndex: 999,
              display: "flex",
              flexDirection: "column",
              maxHeight: 400
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderBottom: `1px solid ${C.line}`
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 12 }}>Notifications</span>
              <div style={{ display: "flex", gap: 8 }}>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.accent,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit"
                    }}
                  >
                    Mark read
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.ink3,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit"
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 10px", color: C.ink3, fontSize: 11 }}>
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => {
                  const cfg = colors[n.type] || colors.info;
                  return (
                    <div
                      key={n.id}
                      style={{
                        padding: "10px 14px",
                        borderBottom: `1px solid ${C.line}`,
                        backgroundColor: n.read ? "transparent" : "rgba(47, 84, 235, 0.03)",
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        transition: "background .15s"
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: cfg.text,
                          marginTop: 4,
                          flexShrink: 0
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: n.read ? 600 : 700,
                            color: C.ink,
                            marginBottom: 2
                          }}
                        >
                          {n.title}
                        </div>
                        <div style={{ fontSize: 10, color: C.ink2, lineHeight: 1.3 }}>
                          {n.message}
                        </div>
                        <div style={{ fontSize: 9, color: C.ink3, marginTop: 4 }}>
                          {formatTime(n.ts)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Topbar({crumbs,actions}){
  return <div style={{height:56,background:C.paper,borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",padding:"0 20px",gap:12,flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8,marginRight:12}}>
      <img src={LogoImg} style={{width:30,height:30,borderRadius:6,objectFit:"cover",border:`1px solid ${C.line2}`}} alt="Logo" />
      <span style={{fontWeight:800,fontSize:15,color:C.ink,letterSpacing:"-0.2px",background:`linear-gradient(135deg, ${C.ink} 0%, #3b82f6 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>InsightFlow AI</span>
    </div>
    <div style={{width:1,height:18,background:C.line2,marginRight:4}}/>
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:C.ink2}}>
      {crumbs.map((c,i)=><span key={i} style={{display:"inline-flex",alignItems:"center",gap:5}}>{i>0&&<ChevronRight size={12} color={C.ink3}/>}<span style={i===crumbs.length-1?{color:C.ink,fontWeight:600}:{cursor:"pointer",color:C.ink3}} onClick={c.onClick}>{c.label}</span></span>)}
    </div>
    <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>{actions}</div>
  </div>;
}

// ── DEFAULT PROMPT ───────────────────────────────────────
const DEF_PROMPT=`You are an ESG and sustainability intelligence analyst. For each article:
1. Determine if the article is related to the topics covered by the source URL — if yes process it; if unrelated, skip it.
2. Summarize the key points in 3–5 sentences.
3. Extract 5–8 relevant keywords.
4. Classify: ESG / Climate Change / Carbon Emissions / Renewable Energy / Government Regulations / Financial News / Technology / Supply Chain / Risk Management / Other.
5. Identify regulatory compliance implications (yes/no).
6. Write a 2-sentence executive summary.
Respond in structured JSON format.`;

// ── PERIOD CONFIG ────────────────────────────────────────
const PERIODS=[
  {key:"hour",label:"Hourly",sub:"Every hour",Icon:Bolt,bg:"#fff8f0",color:C.amber,desc:"Runs every hour starting at:"},
  {key:"day",label:"Previous Day",sub:"Yesterday's articles",Icon:Sun,bg:"#eff6ff",color:C.accent,desc:"Fetch yesterday's data at:"},
  {key:"week",label:"This Week",sub:"Mon – today",Icon:CalendarDays,bg:"#f0fdf4",color:C.green,desc:"Compile weekly digest at:"},
  {key:"month",label:"This Month",sub:"1st – today",Icon:CalendarRange,bg:"#fdf4ff",color:C.purple,desc:"Compile monthly digest at:"},
];

// ── STATE REDUCER ────────────────────────────────────────
function reducer(state,action){
  let next;
  switch(action.type){
    case"ADD_PLAN":next={...state,plans:[...state.plans,action.plan]};break;
    case"UPDATE_PLAN":next={...state,plans:state.plans.map(p=>p.id===action.id?{...p,...action.changes}:p)};break;
    case"DEL_PLAN":next={...state,plans:state.plans.filter(p=>p.id!==action.id)};break;
    case"ADD_ARTICLE":next={...state,articles:[...state.articles,action.article]};break;
    case"DEL_ARTICLE":next={...state,articles:state.articles.filter(a=>a.id!==action.id)};break;
    case"CLEAR_ARTICLES_FOR_PLAN":next={...state,articles:state.articles.filter(a=>a.plan_id!==action.planId),plans:state.plans.map(p=>p.id===action.planId?{...p,articlesCount:0}:p)};break;
    case"ADD_EMAIL":next={...state,emailLog:[...state.emailLog,action.record]};break;
    case"CLEAR_EMAIL_LOG":next={...state,emailLog:state.emailLog.filter(e=>e.plan_id!==action.planId)};break;
    case"ADD_LOG":next={...state,activityLog:[...state.activityLog,{id:`log_${Date.now()}`,ts:new Date().toISOString(),...action.entry}]};break;
    case"UPD_CFG":next={...state,config:{...state.config,...action.changes}};break;
    case"CLEAR":next={...state,plans:[],articles:[],emailLog:[],activityLog:[]};break;
    case"CLEAR_LOGS":next={...state,activityLog:[]};break;
    case "UPDATE_KEY_STATUS":
      next = {
        ...state,
        keyStatuses: {
          ...state.keyStatuses,
          [action.keyId]: {
            ...(state.keyStatuses?.[action.keyId] || {}),
            ...action.status
          }
        }
      };
      break;
    case "RESET_ALL_KEY_STATUSES":
      next = {
        ...state,
        keyStatuses: {}
      };
      break;
    case "ADD_KEY_LOG":
      next = {
        ...state,
        keyLogs: [
          { id: `klog_${Date.now()}_${Math.random()}`, ts: new Date().toISOString(), ...action.entry },
          ...(state.keyLogs || [])
        ].slice(0, 100)
      };
      break;
    case "CLEAR_KEY_LOGS":
      next = { ...state, keyLogs: [] };
      break;
    case "INCREMENT_METRIC": {
      const currentMetrics = state.metrics || {
        totalUrlsProcessed: 0,
        articlesSelected: 0,
        articlesRejected: 0,
        totalProcessingTime: 0,
        apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
      };
      next = {
        ...state,
        metrics: {
          ...currentMetrics,
          [action.metric]: (currentMetrics[action.metric] || 0) + (action.amount || 1)
        }
      };
      break;
    }
    case "ADD_PROCESSING_TIME": {
      const currentMetrics = state.metrics || {
        totalUrlsProcessed: 0,
        articlesSelected: 0,
        articlesRejected: 0,
        totalProcessingTime: 0,
        apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
      };
      next = {
        ...state,
        metrics: {
          ...currentMetrics,
          totalProcessingTime: (currentMetrics.totalProcessingTime || 0) + action.time
        }
      };
      break;
    }
    case "RECORD_API_CALL": {
      const currentMetrics = state.metrics || {
        totalUrlsProcessed: 0,
        articlesSelected: 0,
        articlesRejected: 0,
        totalProcessingTime: 0,
        apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
      };
      const apiUsage = currentMetrics.apiUsage || { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 };
      next = {
        ...state,
        metrics: {
          ...currentMetrics,
          apiUsage: {
            ...apiUsage,
            [action.provider]: (apiUsage[action.provider] || 0) + 1
          }
        }
      };
      break;
    }
    case "RESET_METRICS": {
      next = {
        ...state,
        metrics: {
          totalUrlsProcessed: 0,
          articlesSelected: 0,
          articlesRejected: 0,
          totalProcessingTime: 0,
          apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
        }
      };
      break;
    }
    case "ADD_NOTIFICATION": {
      const list = state.notifications || [];
      const newNotif = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        ts: new Date().toISOString(),
        read: false,
        ...action.entry
      };
      next = {
        ...state,
        notifications: [newNotif, ...list].slice(0, 100)
      };
      break;
    }
    case "MARK_ALL_NOTIFICATIONS_READ": {
      const list = state.notifications || [];
      next = {
        ...state,
        notifications: list.map(n => ({ ...n, read: true }))
      };
      break;
    }
    case "CLEAR_NOTIFICATIONS": {
      next = {
        ...state,
        notifications: []
      };
      break;
    }
    default:return state;
  }
  saveStore(next);
  return next;
}

// ══════════════════════════════════════════════════════════
function PlansPage({store,dispatch,onOpen,showToast}){
  const{plans,articles,emailLog,activityLog,config}=store;
  const[modal,setModal]=useState(false);
  const[nName,setNName]=useState("");const[nEmoji,setNEmoji]=useState("🌿");

  const create=()=>{
    const n=nName.trim()||"New Plan";
    const bgs=["#e8f5e9","#e3f2fd","#fff8e1","#f3e5f5","#fce4ec","#e8eaf6"];
    const plan={id:`plan_${Date.now()}`,name:n,icon:nEmoji,bg:bgs[plans.length%bgs.length],status:"paused",urls:[],recipientGroups:[],periods:["day"],triggerTimes:{day:"06:30"},prompt:DEF_PROMPT,keywords:"",articlesCount:0,emailsCount:0,lastRun:null,createdAt:new Date().toISOString(),continuousRun:false,relevanceThreshold:70,searchBodyKeywords:false,enableAIKeywords:true};
    dispatch({type:"ADD_PLAN",plan});
    dispatch({type:"ADD_LOG",entry:{type:"plan",event:`Plan "${n}" created`,plan:n}});
    setModal(false);setNName("");showToast(`Plan "${n}" created`,"success");
  };

  const recentLog=[...activityLog].reverse().slice(0,5);
  const todayStr=new Date().toISOString().slice(0,10);

  return <>
    <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16}}>
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div><div style={{fontSize:14,fontWeight:700}}>Plans</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>Each plan monitors URLs with its own AI prompt, schedule & email config</div></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {plans.map(p=>{
            const cnt=articles.filter(a=>a.plan_id===p.id).length;
            return <div key={p.id} onClick={()=>onOpen({ id: p.id, autoRun: false })} style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:12,padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"all .14s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.boxShadow=`0 0 0 3px ${C.accentBg}`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.boxShadow="none";}}>
              <div style={{width:44,height:44,borderRadius:11,background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{p.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                <div style={{fontSize:12,color:C.ink3,display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Link2 size={13}/>{(p.urls||[]).length} URLs</span>
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}><FileText size={13}/>{cnt} articles</span>
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Clock size={13}/>{p.lastRun?new Date(p.lastRun).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"Never"}</span>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                <span style={{width:9,height:9,borderRadius:"50%",background:p.status==="running"?C.green:C.amber,animation:p.status==="running"?"pulse 1.8s infinite":"none",display:"inline-block"}}/>
                <span style={{fontSize:12,color:p.status==="running"?C.green:C.amber,fontWeight:600}}>{p.status==="running"?"Running":"Paused"}</span>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>{onOpen({ id: p.id, autoRun: true });}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:`1px solid ${C.line2}`,background:C.greenBg,color:C.green,fontFamily:"inherit"}}><Play size={14}/> Run</button>
                <button onClick={()=>onOpen({ id: p.id, autoRun: false })} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:`1px solid ${C.line2}`,background:C.surface,color:C.ink2,fontFamily:"inherit"}}><Settings size={14}/> Open</button>
                <button onClick={()=>{if(confirm(`Delete plan "${p.name}"? This removes all its articles and logs.`)){if(confirm(`Are you absolutely sure you want to permanently delete "${p.name}"? This action cannot be undone.`)){dispatch({type:"DEL_PLAN",id:p.id});showToast(`Plan "${p.name}" deleted`,"success");}}}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:`1px solid rgba(220,38,38,.2)`,background:C.redBg,color:C.red,fontFamily:"inherit"}}><Trash2 size={14}/> Delete</button>
              </div>
              <ChevronRight size={18} color={C.ink3}/>
            </div>;
          })}
        </div>
        <div onClick={()=>setModal(true)} style={{border:`1.5px dashed ${C.line2}`,background:C.surface,borderRadius:12,padding:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8,cursor:"pointer",marginTop:10,color:C.ink3,fontSize:13,fontWeight:600,transition:"all .14s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.color=C.accent;e.currentTarget.style.background=C.accentBg;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line2;e.currentTarget.style.color=C.ink3;e.currentTarget.style.background=C.surface;}}>
          <Plus size={16}/> Add new plan
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <Card>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><span style={{fontSize:13,fontWeight:700}}>Overview</span><Badge variant="green" Icon={Activity}>Live</Badge></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <StatBox value={plans.filter(p=>p.status==="running").length} label="Running Plans"/>
            <StatBox value={articles.filter(a=>a.publish_date===todayStr).length} label="Articles Today"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <StatBox value={emailLog.length} label="Emails Sent"/>
            <StatBox value={activityLog.filter(l=>l.type==="error").length} label="Errors" color={C.red}/>
          </div>
        </Card>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Recent Activity</div>
          {recentLog.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"16px 0"}}>No activity yet</div>}
          {recentLog.map((a,i)=>{
            const ic={crawl:{I:Globe,c:C.accent,bg:C.accentBg},ai:{I:Brain,c:C.purple,bg:C.purpleBg},email:{I:Mail,c:C.green,bg:C.greenBg},error:{I:AlertTriangle,c:C.red,bg:C.redBg},plan:{I:CheckCircle2,c:C.green,bg:C.greenBg}};
            const{I,c,bg}=ic[a.type]||{I:Activity,c:C.ink3,bg:C.surface};
            return <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 0",borderBottom:i !== recentLog.length - 1?`1px solid ${C.line}`:"none"}}>
              <span style={{fontSize:10,color:C.ink3,minWidth:44,paddingTop:4}}>{new Date(a.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
              <div style={{width:26,height:26,borderRadius:7,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><I size={14} color={c}/></div>
              <div><div style={{fontSize:12,fontWeight:600}}>{a.event}</div><div style={{fontSize:10,color:C.ink3}}>{a.plan||""}</div></div>
            </div>;
          })}
        </Card>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>System Status</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[["AI Provider",activeProvider(config),C.green],["SMTP",config.smtp_user?"OK ✅":"Not set ⚠️",config.smtp_user?C.green:C.amber],["Scheduler",SCH.getJobs().length>0?`${SCH.getJobs().length} jobs`:"Idle",SCH.getJobs().length>0?C.green:C.ink3],["Plans",`${plans.length} total`,C.accent]].map(([l,v,c])=>(
              <div key={l} style={{background:C.surface,borderRadius:8,padding:"10px 12px",display:"flex",alignItems:"center",gap:8}}><span style={{width:7,height:7,borderRadius:"50%",background:c,flexShrink:0}}/><span style={{fontSize:11,fontWeight:600,flex:1}}>{l}</span><span style={{fontSize:11,fontWeight:700,color:c}}>{v}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
    <Modal open={modal} onClose={()=>setModal(false)} title="Create New Plan">
      <FormRow label="Plan Name"><Inp value={nName} onChange={setNName} placeholder="e.g. ESG Monitor Plan"/></FormRow>
      <FormRow label="Icon"><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{["🌿","💹","⚡","🔗","⚠️","🏭","📊","🌍","🔬","📰"].map(e=><span key={e} onClick={()=>setNEmoji(e)} style={{fontSize:22,cursor:"pointer",outline:nEmoji===e?`2px solid ${C.accent}`:"none",borderRadius:4,padding:2}}>{e}</span>)}</div></FormRow>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16,paddingTop:14,borderTop:`1px solid ${C.line}`}}><Btn onClick={()=>setModal(false)}>Cancel</Btn><Btn primary icon={Plus} onClick={create}>Create Plan</Btn></div>
    </Modal>
  </>;
}

// ══════════════════════════════════════════════════════════
//  PLAN DETAIL
// ══════════════════════════════════════════════════════════
const TABS=[{id:"prompt",icon:MessageSquareText,label:"Prompt"},{id:"urls",icon:Link2,label:"URLs"},{id:"scheduler",icon:CalendarDays,label:"Scheduler"},{id:"email",icon:Mail,label:"Email"},{id:"articles",icon:FileText,label:"Articles"},{id:"chatbot",icon:Brain,label:"Chatbot"},{id:"sent",icon:Send,label:"Sent"}];

function PlanDetail({plan:init,store,dispatch,onBack,showToast,autoRun}){
  const plan=store.plans.find(p=>p.id===init.id)||init;
  const planArts=store.articles.filter(a=>a.plan_id===plan.id);
  const planEmails=store.emailLog.filter(e=>e.plan_id===plan.id);

  const[tab,setTab]=useState("prompt");
  const isActiveCrawl = ["crawling", "analyzing", "summarizing", "sending"].includes(plan.stage);
  const[crawling,setCrawling]=useState(isActiveCrawl);
  const[prog,setProg]=useState({step:"",pct:0,log:[],stage:"idle"});
  const stage = plan.stage || "idle";

  useEffect(() => {
    setCrawling(isActiveCrawl);
  }, [isActiveCrawl]);

  const stepLabel = (plan.crawlState && plan.crawlState.step) ? plan.crawlState.step : (
    plan.stage === "crawling" ? "🌐 Crawling URLs…" :
    plan.stage === "analyzing" ? "🤖 Analyzing articles…" :
    plan.stage === "summarizing" ? "📝 Summarizing articles…" :
    plan.stage === "sending" ? "📧 Sending emails…" : "Running…"
  );

  const pct = (plan.crawlState && plan.crawlState.progress !== undefined) ? plan.crawlState.progress : (
    plan.stage === "crawling" ? 25 :
    plan.stage === "analyzing" ? 50 :
    plan.stage === "summarizing" ? 75 :
    plan.stage === "sending" ? 90 : 0
  );

  const planLogs = store.activityLog
    .filter(l => l.plan === plan.name)
    .slice(-100)
    .map(l => ({
      msg: l.event,
      type: l.type === "error" ? "error" : l.type === "email" ? "email" : "info",
      ts: l.ts
    }));

  const logEntries = planLogs;
  const[addUrlM,setAddUrlM]=useState(false);
  const[nUrl,setNUrl]=useState("");const[nLabel,setNLabel]=useState("");
  const[editingUrlId,setEditingUrlId]=useState(null);
  const[chatMsgs,setChatMsgs]=useState([{role:"bot",text:`Hello! I'm your AI assistant for the "${plan.name}" plan. Ask me anything about the monitored articles.`}]);
  const[chatIn,setChatIn]=useState("");
  const chatRef=useRef();

  const [localPrompt, setLocalPrompt] = useState(plan.prompt || DEF_PROMPT);
  const [localKeywords, setLocalKeywords] = useState(plan.keywords || "");
  const [localRelevanceThreshold, setLocalRelevanceThreshold] = useState(plan.relevanceThreshold !== undefined ? plan.relevanceThreshold : 70);
  const [localSearchBodyKeywords, setLocalSearchBodyKeywords] = useState(plan.searchBodyKeywords !== undefined ? plan.searchBodyKeywords : false);
  const [localEnableAIKeywords, setLocalEnableAIKeywords] = useState(plan.enableAIKeywords !== undefined ? plan.enableAIKeywords : true);
  const [isPromptEditing, setIsPromptEditing] = useState(false);

  useEffect(() => {
    setLocalPrompt(plan.prompt || DEF_PROMPT);
  }, [plan.prompt]);

  useEffect(() => {
    setLocalKeywords(plan.keywords || "");
  }, [plan.keywords]);

  useEffect(() => {
    setLocalRelevanceThreshold(plan.relevanceThreshold !== undefined ? plan.relevanceThreshold : 70);
  }, [plan.relevanceThreshold]);

  useEffect(() => {
    setLocalSearchBodyKeywords(plan.searchBodyKeywords !== undefined ? plan.searchBodyKeywords : false);
  }, [plan.searchBodyKeywords]);

  useEffect(() => {
    setLocalEnableAIKeywords(plan.enableAIKeywords !== undefined ? plan.enableAIKeywords : true);
  }, [plan.enableAIKeywords]);

  const pushStage=(s)=>{
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{stage:s,stageAt:new Date().toISOString()}});
  };

  const addLog=(msg,type="info")=>{
    setProg(p=>{const l=[...p.log,{msg,type,ts:new Date().toISOString()}];return{...p,log:l};});
    dispatch({type:"ADD_LOG",entry:{type:type==="error"?"error":"crawl",event:msg,plan:plan.name}});
  };

  // Keep a ref to store so runCrawl always uses fresh data
  const storeRef = useRef(store);
  storeRef.current = store;

  // Keep a ref to latest plan too
  const planRef = useRef(plan);
  planRef.current = plan;

  const runCrawl = async () => {
    if (crawling) return;
    setCrawling(true);
    setProg({ step: "🚀 Starting crawl…", pct: 0, log: [], stage: "crawling" });

    // Set status to running on manual run so it can execute and bypass cancelled status, and reset crawlState
    dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { status: "running", stage: "crawling", crawlState: null } });

    const localAddLog = (msg, type = "info") => {
      // Also update stage from log message keywords so stage bar is always accurate
      let newStage = null;
      if (msg.includes("Checking") || msg.includes("Analyzing") || msg.includes("🤖")) newStage = "analyzing";
      else if (msg.includes("Summariz") || msg.includes("✅ Relevant")) newStage = "summarizing";
      else if (msg.includes("Sending") || msg.includes("📧")) newStage = "sending";
      else if (msg.includes("Done!") || msg.includes("━━━ Done")) newStage = "done";
      else if (msg.includes("Crawling") || msg.includes("🌐") || msg.includes("Fetching")) newStage = "crawling";
      setProg(p => ({
        ...p,
        ...(newStage ? {stage: newStage} : {}),
        log: [...p.log, { msg, type, ts: new Date().toISOString() }]
      }));
    };

    const localOnProgress = (step, pct) => {
      setProg(p => ({
        ...p,
        step: step !== null && step !== undefined ? step : p.step,
        pct: pct !== null && pct !== undefined ? pct : p.pct
      }));
    };

    try {
      const freshPlan = storeRef.current.plans.find(p => p.id === planRef.current.id) || planRef.current;
      const planToRun = { ...freshPlan, crawlState: null };
      await runCrawlForPlan(
        planToRun,
        storeRef.current,
        dispatch,
        showToast,
        localOnProgress,
        localAddLog,
        () => storeRef.current.plans.find(p => p.id === planRef.current.id)
      );
      const currentPlan = storeRef.current.plans.find(p => p.id === planRef.current.id) || planRef.current;
      if (currentPlan.status === "cancelled" || currentPlan.stage === "idle" || currentPlan.stage === "paused_key_required" || currentPlan.stage === "error") {
        return;
      }
      localAddLog("✅ Crawl complete!", "info");
      localOnProgress("Done!", 100);
      setProg(p => ({...p, stage: "done"}));
      showToast("Crawl finished", "success", {sub:plan.name});
    } catch (e) {
      console.error("runCrawl error:", e);
      localAddLog(`❌ Error: ${e.message}`, "error");
      dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { stage: "error", stageAt: new Date().toISOString(), crawlState: null } });
      showToast(`Crawl error: ${e.message}`, "error");
    } finally {
      setCrawling(false);
    }
  };

  const handleCancelCrawl = () => {
    if (confirm("Are you sure you want to cancel the current crawling process? All remaining URLs will stop processing.")) {
      dispatch({
        type: "UPDATE_PLAN",
        id: plan.id,
        changes: {
          status: "cancelled",
          stage: "idle",
          crawlState: null
        }
      });
      const timestamp = new Date().toLocaleString();
      dispatch({
        type: "ADD_LOG",
        entry: {
          type: "warn",
          event: `🛑 Crawl process cancelled by user on ${timestamp}. Reason: Manual cancellation.`,
          plan: plan.name
        }
      });
      showToast("Crawl cancelled by user", "warn");
    }
  };

  useEffect(() => {
    if (autoRun) {
      showToast("Crawl starting…", "crawl", { sub: plan.name });
      runCrawl();
    }
  }, [autoRun]);

  const doSendEmail = async (arts, emails) => {
    const freshPlan = storeRef.current.plans.find(p => p.id === planRef.current.id) || planRef.current;
    await sendEmailForPlan(freshPlan, storeRef.current, dispatch, showToast, arts, emails, addLog);
  };

  const toggleStatus = () => {
    const next = plan.status === "running" ? "paused" : "running";
    dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { status: next } });
    if (next === "running") {
      showToast("Scheduler started", "sched", {sub:`${plan.name} · crawling will begin shortly`});
    } else {
      showToast("Scheduler paused", "warn", {sub:plan.name});
    }
  };

  const closeUrlModal = () => {
    setNUrl("");
    setNLabel("");
    setEditingUrlId(null);
    setAddUrlM(false);
  };

  const addUrl=()=>{
    if(!nUrl.trim())return;
    const e={id:`url_${Date.now()}`,url:nUrl.trim(),label:nLabel.trim()||nUrl.trim(),status:"active",added_at:new Date().toISOString()};
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{urls:[...(plan.urls||[]),e]}});
    closeUrlModal();
    showToast("URL added","success");
  };

  const saveUrl = () => {
    if (!nUrl.trim()) return;
    const updatedUrls = (plan.urls || []).map(u =>
      u.id === editingUrlId ? { ...u, url: nUrl.trim(), label: nLabel.trim() || nUrl.trim() } : u
    );
    dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { urls: updatedUrls } });
    closeUrlModal();
    showToast("URL updated", "success");
  };

  const uploadCsv=async(e)=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      const txt=await f.text();const lines=txt.split("\n").filter(l=>l.trim());
      const hdr=lines[0].toLowerCase();const cols=hdr.split(",");
      const ui=cols.findIndex(c=>c.includes("url"));const li=cols.findIndex(c=>c.includes("authority")||c.includes("label")||c.includes("name"));
      const nu=[];
      for(let i=1;i<lines.length;i++){const c=lines[i].split(",").map(x=>x.trim().replace(/^"|"$/g,""));const url=c[ui>=0?ui:0];if(!url||!url.startsWith("http"))continue;const label=li>=0?c[li]:url;nu.push({id:`url_${Date.now()}_${i}`,url,label,status:"active",added_at:new Date().toISOString()});}
      dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{urls:[...(plan.urls||[]),...nu]}});
      showToast(`${nu.length} URLs imported`,"success");
    }catch{showToast("Could not parse file","error");}
  };

  const saveSchedule=(periods,triggerTimes,extra={})=>{
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{periods,triggerTimes,status:"running",...extra}});
    showToast("Schedule saved & activated","success");
  };

  const sendChat = async (directMsg) => {
    const msg = (typeof directMsg === "string" ? directMsg : chatIn).trim();
    if (!msg) return;
    const msgs = [...chatMsgs, { role: "user", text: msg }];
    setChatMsgs(msgs);
    setChatIn("");
    setChatMsgs([...msgs, { role: "bot", text: "Thinking…", loading: true }]);

    // Check if we should use local NLP mode (no API key available or configured)
    const hasKeys = getOrderedKeys(_CFG_REF || {}, _KEY_STATUSES_REF || {}).filter(k => k.status !== "invalid" && k.status !== "exhausted").length > 0;
    const isOffline = (_CFG_REF && _CFG_REF.no_api_key_mode) || !hasKeys;

    if (isOffline) {
      // Local RAG/Semantic Search over planArts
      try {
        await new Promise(r => setTimeout(r, 600)); // simulate database retrieval latency
        const queryWords = Array.from(new Set(getCleanKeywords(msg)));
        if (queryWords.length === 0) {
          if (planArts.length === 0) {
            setChatMsgs([...msgs, { role: "bot", text: "No articles have been crawled yet for this plan. Please add URLs and run a crawl first." }]);
          } else {
            const count = planArts.length;
            const topTitles = planArts.slice(-3).map(a => `• ${a.title}`).reverse().join("\n");
            setChatMsgs([...msgs, {
              role: "bot",
              text: `I am currently running in **Local NLP Mode** (offline RAG-style semantic search). I have analyzed **${count} article(s)** in your knowledge base.\n\nHere are some of the latest articles indexed:\n${topTitles}\n\nAsk me a specific question (e.g. about *carbon, regulations, targets*) to search across article content!`
            }]);
          }
          return;
        }

        const queryStems = queryWords.map(getStem);
        const matchedSentences = [];

        (planArts || []).forEach(art => {
          const fullText = `${art.title}. ${art.summary}`;
          const sentences = fullText.split(/(?<=[.!?])\s+/);
          
          sentences.forEach(s => {
            const trimmed = s.trim();
            if (trimmed.length < 15) return;
            const stems = getCleanKeywords(trimmed).map(getStem);
            
            let matches = 0;
            queryStems.forEach(qs => {
              if (stems.includes(qs)) matches++;
            });
            
            if (matches > 0) {
              const score = matches / Math.max(1, Math.min(queryStems.length, 3));
              matchedSentences.push({
                sentence: trimmed,
                title: art.title,
                url: art.url,
                score
              });
            }
          });
        });

        matchedSentences.sort((a, b) => b.score - a.score);
        
        const uniqueMatches = [];
        const seenTexts = new Set();
        for (const item of matchedSentences) {
          const norm = item.sentence.toLowerCase().replace(/[^\w]/g, "");
          if (!seenTexts.has(norm)) {
            seenTexts.add(norm);
            uniqueMatches.push(item);
          }
          if (uniqueMatches.length >= 3) break;
        }

        if (uniqueMatches.length === 0) {
          setChatMsgs([...msgs, {
            role: "bot",
            text: `No direct matches found in your stored articles for this question.\n\n*Suggestions: Try using different keywords, or enable LLM mode in Settings to generate a smart conceptual response.*`
          }]);
        } else {
          let responseText = `**[Local RAG Search Results]**\nI found the following matching statements inside the indexed articles:\n\n`;
          uniqueMatches.forEach((m, idx) => {
            responseText += `${idx + 1}. **"${m.sentence}"**\n   *(Source: [${m.title}](${m.url}))*\n\n`;
          });
          responseText += `\n*Note: Configure a valid Google Gemini API key in Settings to upgrade to full conversational AI synthesis.*`;
          setChatMsgs([...msgs, { role: "bot", text: responseText }]);
        }
      } catch (err) {
        console.error("Local RAG Chat error:", err);
        setChatMsgs([...msgs, { role: "bot", text: `Local RAG search failed: ${err.message}` }]);
      }
      return;
    }

    const ctx = planArts.slice(0, 15).map(a => `Title: ${a.title}\nDate: ${a.publish_date}\nSummary: ${a.summary || ""}\nURL: ${a.url}`).join("\n\n---\n\n");
    const sys = `You are an AI assistant for InsightFlow AI with access to articles from the "${plan.name}" plan:\n\n${ctx || "No articles yet."}\n\nAnswer questions about these articles concisely.`;
    try {
      const r = await callAI(sys, msg);
      setChatMsgs([...msgs, { role: "bot", text: r || "No response." }]);
    } catch (err) {
      console.error("Chatbot error:", err);
      setChatMsgs([...msgs, { role: "bot", text: `AI response failed: ${err.message || "Unknown error"}. Please check your API key settings.` }]);
    }
  };

  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=9999;},[chatMsgs]);

  return <>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
      <div style={{width:40,height:40,borderRadius:10,background:plan.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{plan.icon}</div>
      <div style={{flex:1}}><div style={{fontSize:16,fontWeight:700}}>{plan.name}</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{(plan.urls||[]).length} URLs · {(plan.periods||[]).join(", ")} · Last run: {plan.lastRun?new Date(plan.lastRun).toLocaleString():"Never"}</div></div>
      <Btn icon={plan.status==="running"?Pause:Play} onClick={toggleStatus}>{plan.status==="running"?"Pause":"Start"}</Btn>
      <Btn primary icon={props => <RefreshCw {...props} style={isActiveCrawl ? { animation: "spin 1s linear infinite" } : {}}/>} onClick={runCrawl} disabled={isActiveCrawl}>{isActiveCrawl?"Running…":"Run Now"}</Btn>
    </div>
    <div style={{marginBottom:16,padding:"10px 14px",background:C.surface,borderRadius:10,display:"flex",alignItems:"center",gap:12,overflowX:"auto"}}>
      <span style={{fontSize:11,fontWeight:700,color:C.ink3,flexShrink:0}}>STAGE</span>
      <StagePipeline stage={stage}/>
      {plan.stageAt&&<span style={{fontSize:10,color:C.ink3,marginLeft:"auto",flexShrink:0}}>Updated {new Date(plan.stageAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>}
    </div>



    {isActiveCrawl && <Card style={{marginBottom:14,border:`1.5px solid ${C.accent}`,background:"#fafbff"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
        <RefreshCw size={15} color={C.accent} style={{animation:"spin 1s linear infinite",flexShrink:0}}/>
        <span style={{fontSize:13,fontWeight:700,color:C.accent,flex:1}}>{stepLabel}</span>
        <span style={{fontSize:11,fontWeight:700,color:C.accent,background:C.accentBg,padding:"2px 8px",borderRadius:20,marginRight:8}}>{pct}%</span>
        <button
          onClick={handleCancelCrawl}
          style={{
            display:"inline-flex",
            alignItems:"center",
            gap:4,
            padding:"4px 10px",
            borderRadius:6,
            fontSize:11,
            fontWeight:600,
            cursor:"pointer",
            border:`1px solid ${C.redBg}`,
            background:C.redBg,
            color:C.red,
            transition:"all 0.15s"
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = C.red;
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = C.redBg;
            e.currentTarget.style.color = C.red;
          }}
        >
          <X size={12}/> Cancel Process
        </button>
      </div>
      <ProgBar pct={pct}/>
      <div
        ref={el => { if(el) el.scrollTop = el.scrollHeight; }}
        style={{maxHeight:160,overflowY:"auto",marginTop:10,background:"#0f0e0d",borderRadius:8,padding:"10px 12px",fontFamily:"'Courier New',monospace",fontSize:11,lineHeight:1.8}}
      >
        {logEntries.length === 0 && <div style={{color:"#888"}}>Initializing…</div>}
        {logEntries.map((l,i)=>(
          <div key={i} style={{color:l.type==="error"?"#ff6b6b":l.type==="warn"?"#ffd93d":"#a8d8a8",display:"flex",gap:8}}>
            <span style={{color:"#555",flexShrink:0}}>{new Date(l.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
            <span>{l.msg}</span>
          </div>
        ))}
      </div>
    </Card>}

    <div style={{display:"flex",borderBottom:`1px solid ${C.line}`,marginBottom:14}}>
      {TABS.map(({id,icon:I,label})=><button key={id} onClick={()=>setTab(id)} style={{padding:"8px 16px",fontSize:12,fontWeight:600,color:tab===id?C.accent:C.ink3,borderBottom:`2px solid ${tab===id?C.accent:"transparent"}`,marginBottom:-1,cursor:"pointer",border:"none",background:"none",display:"flex",alignItems:"center",gap:5,transition:"all .12s"}}><I size={13}/> {label}</button>)}
    </div>

    {/* PROMPT */}
    {tab==="prompt"&&(() => {
      const templates = {
        "ESG & Sustainability": {
          prompt: `You are an ESG and sustainability intelligence analyst. For each article:\n1. Determine if the article is related to the topics covered by the source URL — if yes process it; if unrelated, skip it.\n2. Summarize the key points in 3–5 sentences.\n3. Extract 5–8 relevant keywords.\n4. Classify: ESG / Climate Change / Carbon Emissions / Renewable Energy / Government Regulations / Financial News / Technology / Supply Chain / Risk Management / Other.\n5. Identify regulatory compliance implications (yes/no).\n6. Write a 2-sentence executive summary.\nRespond in structured JSON format.`,
          keywords: "esg, sustainability, environment, climate, renewable, carbon, green"
        },
        "Financial News": {
          prompt: `You are a financial news analyst. For each article:\n1. Determine if the article is related to financial performance, markets, economy, or business earnings — if yes, process it; if unrelated, skip it.\n2. Summarize the key findings in 3–5 sentences.\n3. Extract 5–8 relevant keywords.\n4. Classify: Earnings / Mergers / Markets / Economy / Regulation / Other.\n5. Note market impact.\n6. Write a 2-sentence executive summary.\nRespond in structured JSON format.`,
          keywords: "finance, revenue, profit, earnings, market, stock, economy, merger"
        },
        "Tech Trends": {
          prompt: `You are a technology analyst. For each article:\n1. Determine if the article is related to technology innovation, software, AI, or digital transformation — if yes, process it; if unrelated, skip it.\n2. Summarize the key trends in 3–5 sentences.\n3. Extract 5–8 relevant keywords.\n4. Classify: AI / Software / Hardware / Cybersecurity / Cloud / Other.\n5. Note tech adoption impact.\n6. Write a 2-sentence executive summary.\nRespond in structured JSON format.`,
          keywords: "technology, ai, artificial intelligence, software, cybersecurity, cloud, digital"
        },
        "Risk & Compliance": {
          prompt: `You are a risk and compliance analyst. For each article:\n1. Determine if the article is related to regulatory compliance, audit, legal risk, or security standards — if yes, process it; if unrelated, skip it.\n2. Summarize the key issues in 3–5 sentences.\n3. Extract 5–8 relevant keywords.\n4. Classify: Regulation / Audit / Legal / Security / Compliance / Other.\n5. Note compliance risk.\n6. Write a 2-sentence executive summary.\nRespond in structured JSON format.`,
          keywords: "risk, compliance, regulation, legal, audit, policy, standard, law"
        },
        "Supply Chain": {
          prompt: `You are a supply chain analyst. For each article:\n1. Determine if the article is related to logistics, shipping, supply chain disruptions, or inventory management — if yes, process it; if unrelated, skip it.\n2. Summarize the key points in 3–5 sentences.\n3. Extract 5–8 relevant keywords.\n4. Classify: Logistics / Shipment / Inventory / Disruption / Vendor / Other.\n5. Note supply chain impact.\n6. Write a 2-sentence executive summary.\nRespond in structured JSON format.`,
          keywords: "supply chain, logistics, shipping, inventory, vendor, supplier, transit"
        }
      };
      return <div style={{display:"grid",gridTemplateColumns:"1fr 240px",gap:14}}>
        <div>
          {/* User Defined Keywords Card */}
          <Card p={0} style={{marginBottom:14}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>User Defined Keywords (Optional)</div>
                <div style={{fontSize:10,color:C.ink3,marginTop:1}}>Provide keywords to filter article titles first (e.g. green, climate, carbon)</div>
              </div>
              {!isPromptEditing ? (
                <Btn sm icon={Pencil} onClick={()=>setIsPromptEditing(true)}>Edit Settings</Btn>
              ) : (
                <Badge variant="purple">Editing Mode</Badge>
              )}
            </div>
            <div style={{padding:"12px 16px",background:isPromptEditing?"#fff":"#fbfbfa"}}>
              <input
                type="text"
                value={localKeywords}
                onChange={e=>setLocalKeywords(e.target.value)}
                disabled={!isPromptEditing}
                placeholder="Enter comma-separated keywords..."
                style={{
                  width:"100%",
                  padding:"10px 12px",
                  border:`1.5px solid ${isPromptEditing?C.accent:C.line}`,
                  borderRadius:8,
                  fontSize:12,
                  fontFamily:"inherit",
                  background:isPromptEditing?"#fff":"#fbfbfa",
                  color:C.ink,
                  outline:"none",
                  transition:"border-color .15s"
                }}
              />
            </div>
          </Card>

          {/* Intelligent Filtering Settings Card */}
          <Card p={0} style={{marginBottom:14}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700}}>Intelligent Filtering Settings</div>
                <div style={{fontSize:10,color:C.ink3,marginTop:1}}>Configure AI relevance scoring thresholds and keyword matching scope</div>
              </div>
              {isPromptEditing && <Badge variant="purple">Editing Mode</Badge>}
            </div>
            <div style={{padding:"14px 16px",background:isPromptEditing?"#fff":"#fbfbfa",display:"flex",flexDirection:"column",gap:16}}>
              {/* Relevance Threshold Slider */}
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:600,color:C.ink}}>Relevance Threshold Score</div>
                  <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{localRelevanceThreshold}%</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={localRelevanceThreshold}
                    onChange={e=>setLocalRelevanceThreshold(Number(e.target.value))}
                    disabled={!isPromptEditing}
                    style={{
                      flex:1,
                      accentColor:C.accent,
                      cursor:isPromptEditing?"pointer":"not-allowed",
                      height:4,
                      borderRadius:2,
                      background:C.line,
                      outline:"none"
                    }}
                  />
                </div>
                <div style={{fontSize:10,color:C.ink3,marginTop:5}}>
                  Articles must score at or above this threshold (0-100) to be saved. A higher threshold makes filtering stricter.
                </div>
              </div>

              <div style={{height:1,background:C.line}}/>

              {/* Keyword Scope Selector & AI Auto Keywords Toggle */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
                {/* Search Scope Selector */}
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:C.ink,marginBottom:6}}>Keyword Search Scope</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:isPromptEditing?"pointer":"not-allowed",color:C.ink2}}>
                      <input
                        type="radio"
                        name="keywordScope"
                        checked={!localSearchBodyKeywords}
                        onChange={()=>setLocalSearchBodyKeywords(false)}
                        disabled={!isPromptEditing}
                        style={{accentColor:C.accent}}
                      />
                      <span>Title & URL Only <span style={{fontSize:10,color:C.ink3}}>(Fast)</span></span>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,cursor:isPromptEditing?"pointer":"not-allowed",color:C.ink2}}>
                      <input
                        type="radio"
                        name="keywordScope"
                        checked={localSearchBodyKeywords}
                        onChange={()=>setLocalSearchBodyKeywords(true)}
                        disabled={!isPromptEditing}
                        style={{accentColor:C.accent}}
                      />
                      <span>Entire Article Body <span style={{fontSize:10,color:C.ink3}}>(Thorough)</span></span>
                    </label>
                  </div>
                  <div style={{fontSize:10,color:C.ink3,marginTop:6}}>
                    Determines where to look for matching keywords before running AI checks.
                  </div>
                </div>

                {/* AI Generated Keywords Toggle */}
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.ink}}>AI-Generated Keywords</div>
                    <Toggle
                      checked={localEnableAIKeywords}
                      onChange={v => { if (isPromptEditing) setLocalEnableAIKeywords(v); }}
                    />
                  </div>
                  <div style={{fontSize:10,color:C.ink3}}>
                    Automatically extract keywords and intent from the prompt to expand search coverage beyond user-defined keywords.
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Classification & Summary Prompt Card */}
          <Card p={0}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:700}}>Classification & Summary Prompt</div><div style={{fontSize:10,color:C.ink3,marginTop:1}}>AI uses this to decide which articles are relevant and to summarize them</div></div>
              {isPromptEditing && <Badge variant="purple">Editing Mode</Badge>}
            </div>
            <textarea value={localPrompt} onChange={e=>setLocalPrompt(e.target.value)} disabled={!isPromptEditing} style={{width:"100%",minHeight:220,padding:"12px 14px",border:"none",outline:"none",fontSize:13,fontFamily:"inherit",resize:"vertical",lineHeight:1.6,background:isPromptEditing?"#fff":"#fbfbfa",color:C.ink}}/>
            <div style={{padding:"10px 14px",borderTop:`1px solid ${C.line}`,background:C.surface,display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
              {isPromptEditing ? (
                <>
                  <SlidersHorizontal size={13} color={C.ink3} style={{marginRight:"auto"}}/>
                  <span style={{fontSize:11,color:C.ink3,marginRight:"auto"}}>Click save to apply changes</span>
                  <Btn sm onClick={()=>{
                    setLocalPrompt(plan.prompt||DEF_PROMPT);
                    setLocalKeywords(plan.keywords||"");
                    setLocalRelevanceThreshold(plan.relevanceThreshold !== undefined ? plan.relevanceThreshold : 70);
                    setLocalSearchBodyKeywords(plan.searchBodyKeywords !== undefined ? plan.searchBodyKeywords : false);
                    setLocalEnableAIKeywords(plan.enableAIKeywords !== undefined ? plan.enableAIKeywords : true);
                    setIsPromptEditing(false);
                  }}>Cancel</Btn>
                  <Btn primary sm icon={Save} onClick={()=>{
                    dispatch({
                      type:"UPDATE_PLAN",
                      id:plan.id,
                      changes:{
                        prompt:localPrompt,
                        keywords:localKeywords,
                        relevanceThreshold:localRelevanceThreshold,
                        searchBodyKeywords:localSearchBodyKeywords,
                        enableAIKeywords:localEnableAIKeywords
                      }
                    });
                    setIsPromptEditing(false);
                    showToast("Plan filtering settings saved","success");
                  }}>Save Changes</Btn>
                </>
              ) : (
                <>
                  <SlidersHorizontal size={13} color={C.ink3} style={{marginRight:8}}/>
                  <span style={{fontSize:11,color:C.ink3,marginRight:"auto"}}>Prompt is sent to your active AI provider with each article</span>
                </>
              )}
            </div>
          </Card>
          <div style={{marginTop:12}}>
            <div style={{fontSize:11,fontWeight:600,color:C.ink3,marginBottom:8,textTransform:"uppercase",letterSpacing:".05em"}}>Quick Templates</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[["🌿","ESG & Sustainability"],["💹","Financial News"],["⚡","Tech Trends"],["⚠️","Risk & Compliance"],["🔗","Supply Chain"]].map(([em,l])=>(
                <button key={l} onClick={()=>{
                  const item = templates[l];
                  setLocalPrompt(item.prompt);
                  setLocalKeywords(item.keywords);
                  setIsPromptEditing(true);
                  showToast(`${l} template applied — click Save to store`,"success");
                }} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",background:C.surface,border:`1px solid ${C.line}`,borderRadius:20,fontSize:11,cursor:"pointer",color:C.ink2}}>{em} {l}</button>
              ))}
            </div>
          </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Card><div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Plan Stats</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}><StatBox value={(plan.urls||[]).length} label="URLs"/><StatBox value={planArts.length} label="Articles"/><StatBox value={planEmails.length} label="Emails"/><StatBox value={(plan.recipientGroups||[]).reduce((s,g)=>s+g.emails.length,0)} label="Recipients"/></div></Card>
        <Card><div style={{fontSize:12,fontWeight:700,marginBottom:8}}>AI Config</div><div style={{fontSize:12,color:C.ink2,marginBottom:5}}>Provider: <strong>{activeProvider(store.config)}</strong></div><div style={{fontSize:12,color:(store.config.gemini_api_key||store.config.groq_api_key||store.config.openai_api_key)?C.green:C.ink2,fontWeight:600}}>{store.config.gemini_api_key||store.config.groq_api_key||store.config.openai_api_key?"✅ API Key configured":"ℹ️ Using built-in Claude (no key needed)"}</div></Card>
      </div>
    </div>;
    })()}

    {/* URLs */}
    {tab==="urls"&&<>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div><div style={{fontSize:13,fontWeight:700}}>Monitored URLs</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{(plan.urls||[]).length} URLs · Crawled per schedule</div></div>
        <div style={{display:"flex",gap:6}}>
          <label style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 13px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:`1px solid ${C.line2}`,background:C.paper,color:C.ink}}><Upload size={15}/> Import CSV<input type="file" accept=".csv,.xlsx,.xls" onChange={uploadCsv} style={{display:"none"}}/></label>
          <Btn primary sm icon={Plus} onClick={()=>setAddUrlM(true)}>Add URL</Btn>
        </div>
      </div>
      {(plan.urls||[]).length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:C.ink3}}><Globe size={36} style={{opacity:.3,marginBottom:8}}/><div style={{fontSize:13,fontWeight:600}}>No URLs yet</div><div style={{fontSize:12,marginTop:4}}>Add URLs or import a CSV file. Format: columns "url" and "authority" (label)</div></div>}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {(plan.urls||[]).map(u=><div key={u.id} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:8,background:C.surface,fontSize:12}}>
          <GripVertical size={16} color={C.ink3} style={{cursor:"grab",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.label}</div><div style={{fontSize:10,color:C.ink3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.url}</div></div>
          <Badge variant="green" Icon={CheckCircle2}>Active</Badge>
          <a href={u.url} target="_blank" rel="noopener noreferrer" style={{color:C.accent,display:"flex",alignItems:"center",marginRight:4}} onClick={e=>e.stopPropagation()}><Globe size={14}/></a>
          <Btn xs icon={Pencil} onClick={()=>{setNUrl(u.url);setNLabel(u.label);setEditingUrlId(u.id);setAddUrlM(true);}} title="Edit URL" style={{marginRight:4}}/>
          <Btn danger xs icon={Trash2} onClick={()=>{dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{urls:(plan.urls||[]).filter(x=>x.id!==u.id)}});showToast("URL removed","success");}} title="Remove URL"/>
        </div>)}
      </div>
      <Modal open={addUrlM} onClose={closeUrlModal} title={editingUrlId ? "Edit URL" : "Add URL"}>
        <FormRow label="URL"><Inp value={nUrl} onChange={setNUrl} placeholder="https://example.com/news"/></FormRow>
        <FormRow label="Label / Company Name"><Inp value={nLabel} onChange={setNLabel} placeholder="Reuters Sustainability Desk"/></FormRow>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16,paddingTop:14,borderTop:`1px solid ${C.line}`}}><Btn onClick={closeUrlModal}>Cancel</Btn><Btn primary icon={Save} onClick={editingUrlId ? saveUrl : addUrl}>Save</Btn></div>
      </Modal>
    </>}

    {/* SCHEDULER */}
    {tab==="scheduler"&&<SchedTab plan={plan} dispatch={dispatch} showToast={showToast} saveSchedule={saveSchedule} runCrawl={runCrawl} crawling={isActiveCrawl}/>}

    {/* EMAIL */}
    {tab==="email"&&<EmailTab plan={plan} store={store} dispatch={dispatch} showToast={showToast} planArticles={planArts} doSendEmail={doSendEmail}/>}

    {/* ARTICLES */}
    {tab==="articles"&&<>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div><div style={{fontSize:13,fontWeight:700}}>Crawled Articles</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{planArts.length} articles found</div></div>
        <div style={{display:"flex",gap:6}}>
          {planArts.length > 0 && (
            <Btn danger sm icon={Trash2} onClick={()=>{
              if(confirm(`Delete all ${planArts.length} articles from this plan?`)){
                dispatch({type:"CLEAR_ARTICLES_FOR_PLAN", planId:plan.id});
                showToast("All articles deleted","success");
              }
            }}>Delete All</Btn>
          )}
          <Btn sm icon={props => <RefreshCw {...props} style={isActiveCrawl ? { animation: "spin 1s linear infinite" } : {}}/>} onClick={runCrawl} disabled={isActiveCrawl}>{isActiveCrawl?"Running…":"Run Crawl"}</Btn>
        </div>
      </div>
      {planArts.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:C.ink3}}><FileText size={40} style={{opacity:.3,marginBottom:10}}/><div style={{fontSize:14,fontWeight:600}}>No articles yet</div><div style={{fontSize:12,marginTop:4}}>Add URLs and click "Run Now" to crawl. Claude AI will classify and summarize relevant articles.</div></div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {[...planArts].reverse().map(a=><Card key={a.id} style={{padding:"12px 16px"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{a.title}</div>
              <div style={{fontSize:11,color:C.ink3,marginBottom:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span>{a.company}</span>
                <span>·</span>
                <span>{a.publish_date}</span>
                {a.relevance_score !== undefined && (
                  <>
                    <span>·</span>
                    <Badge variant={a.relevance_score >= 80 ? "green" : a.relevance_score >= 70 ? "blue" : "amber"}>
                      Relevance: {a.relevance_score}%
                    </Badge>
                  </>
                )}
              </div>
              <div style={{fontSize:12,color:C.ink2,lineHeight:1.6}}>{formatMarkdown(a.summary)}</div>
              {a.relevance_reason && (
                <div style={{
                  fontSize:11,
                  color:C.ink2,
                  fontStyle:"italic",
                  marginTop:8,
                  background:C.surface,
                  padding:"6px 10px",
                  borderRadius:6,
                  borderLeft:`3px solid ${a.relevance_score >= 80 ? C.green : a.relevance_score >= 70 ? C.accent : C.amber}`
                }}>
                  <strong>AI Relevance Reason:</strong> {a.relevance_reason}
                </div>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,padding:"5px 10px",borderRadius:7,background:C.accentBg,color:C.accent,fontSize:11,fontWeight:600,textDecoration:"none"}}><Globe size={12}/> Open</a>
              <Btn danger xs icon={Trash2} onClick={()=>{if(confirm("Delete this article?")){dispatch({type:"DEL_ARTICLE",id:a.id});showToast("Article deleted","success");}}} title="Delete Article">Delete</Btn>
            </div>
          </div>
        </Card>)}
      </div>
    </>}

    {/* CHATBOT */}
    {tab==="chatbot"&&<div style={{display:"grid",gridTemplateColumns:"1fr 240px",gap:14}}>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:700}}>AI Chatbot</span>
          <Badge variant="purple" Icon={Brain}>{activeProvider(store.config)}</Badge>
          <span style={{fontSize:10,color:C.ink3,marginRight:"auto"}}>Knows {planArts.length} articles</span>
          <Btn danger xs icon={RotateCcw} onClick={()=>{setChatMsgs([{role:"bot",text:`Hello! I'm your AI assistant for the "${plan.name}" plan. I currently have access to ${planArts.length} article(s). Ask me to summarize findings, list sources, highlight trends, or answer any questions about the monitored content.`}]);showToast("Chat history cleared","success");}}>Clear Chat</Btn>
        </div>
        <div style={{background:"#fff",border:`1px solid ${C.line}`,borderRadius:12,display:"flex",flexDirection:"column",height:380}}>
          <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:12,display:"flex",flexDirection:"column",gap:8}}>
            {chatMsgs.map((m,i)=><div key={i} style={{alignSelf:m.role==="user"?"flex-end":"flex-start",background:m.role==="user"?C.accent:m.loading?"rgba(47,84,235,.06)":C.surface,color:m.role==="user"?"#fff":C.ink,padding:"9px 13px",borderRadius:m.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px",fontSize:12,maxWidth:"85%",lineHeight:1.6,border:m.role==="bot"?`1px solid ${m.loading?C.accent:C.line}`:"none",whiteSpace:"pre-wrap",fontStyle:m.loading?"italic":"normal",opacity:m.loading?.7:1}}>{m.loading?<span style={{display:"flex",alignItems:"center",gap:6}}><RefreshCw size={12} color={C.accent} style={{animation:"spin 1s linear infinite",flexShrink:0}}/>{m.text}</span>:formatMarkdown(m.text)}</div>)}
          </div>
          <div style={{padding:"6px 12px",display:"flex",flexWrap:"wrap",gap:4,borderTop:`1px solid ${C.line}`,background:C.surface}}>
            {["Show all articles","What topics were covered?","Summarize key findings","Any regulatory news?"].map(s=><button key={s} onClick={()=>sendChat(s)} style={{padding:"2px 8px",background:"#fff",border:`1px solid ${C.line}`,borderRadius:12,fontSize:10,cursor:"pointer",color:C.ink2}}>{s}</button>)}
          </div>
          <div style={{padding:"10px 12px",borderTop:`1px solid ${C.line}`,display:"flex",gap:6,background:C.surface,borderRadius:"0 0 12px 12px"}}>
            <div style={{position:"relative",flex:1}}>
              <Search size={14} color={C.ink3} style={{position:"absolute",left:12,top:10}}/>
              <input value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Ask about this plan's articles…" style={{width:"100%",padding:"7px 12px 7px 32px",border:`1px solid ${C.line2}`,borderRadius:20,fontSize:12,outline:"none",fontFamily:"inherit",background:"#fff",color:C.ink}}/>
            </div>
            <Btn primary icon={Send} onClick={()=>sendChat()} title="Ask AI">Ask AI</Btn>
          </div>
        </div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Card><div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Knowledge Base</div>{[["Total articles",planArts.length],["Sources",[...new Set(planArts.map(a=>a.company))].length],["Date range",planArts.length>0?`${[...planArts].sort((a,b)=>a.publish_date>b.publish_date?1:-1)[0]?.publish_date} – ${[...planArts].sort((a,b)=>a.publish_date>b.publish_date?-1:1)[0]?.publish_date}`:"—"]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}><span style={{color:C.ink3}}>{l}</span><strong>{v}</strong></div>)}</Card>
        
      </div>
    </div>}

    {/* SENT */}
    {tab==="sent"&&<>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div><div style={{fontSize:13,fontWeight:700}}>Email Sent History</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{planEmails.length} emails sent</div></div>
        <div style={{display:"flex",gap:6}}>
          {planEmails.length>0&&<Btn danger sm icon={Trash2} onClick={()=>{if(confirm("Clear email sent history for this plan?")){dispatch({type:"CLEAR_EMAIL_LOG",planId:plan.id});showToast("Sent history cleared","success");}}}>Clear History</Btn>}
          <Btn primary sm icon={Send} onClick={()=>{if(planArts.length===0){showToast("No articles yet — run crawl first","");return;}const ag=(plan.recipientGroups||[]).filter(g=>g.active);if(ag.length===0){showToast("No active recipients — add in Email tab","");return;}doSendEmail(planArts,[...new Set(ag.flatMap(g=>g.emails))]);}}>Send Now</Btn>
        </div>
      </div>
      {planEmails.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:C.ink3}}><Mail size={36} style={{opacity:.3,marginBottom:8}}/><div>No emails sent yet</div></div>}
      <Card p={0}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr>{["Sent At","Recipients","Articles","Status"].map(h=><th key={h} style={{textAlign:"left",padding:"7px 12px",fontSize:11,fontWeight:600,color:C.ink3,borderBottom:`1px solid ${C.line}`,background:C.surface}}>{h}</th>)}</tr></thead>
        <tbody>{[...planEmails].reverse().map((r,i)=><tr key={r.id} style={{borderBottom:i !== planEmails.length - 1?`1px solid ${C.line}`:"none"}}>
          <td style={{padding:"8px 12px",fontSize:11,color:C.ink3}}>{new Date(r.sent_at).toLocaleString()}</td>
          <td style={{padding:"8px 12px",fontSize:11}}>{r.to.slice(0,2).join(", ")}{r.to.length>2?` +${r.to.length-2} more`:""}</td>
          <td style={{padding:"8px 12px"}}>{r.articles_count}</td>
          <td style={{padding:"8px 12px"}}>
            {r.status === "sent" ? (
              <Badge variant="green" Icon={CheckCircle2}>Success</Badge>
            ) : r.status === "partial" ? (
              <Badge variant="amber" Icon={AlertTriangle} title={`${r.failed_count || 0} failed`}>Partial ({r.sent_count || 0}/{r.to.length})</Badge>
            ) : (
              <Badge variant="red" Icon={XCircle}>Failed</Badge>
            )}
          </td>
        </tr>)}</tbody>
      </table></Card>
    </>}
  </>;
}

// ── SCHEDULER TAB ────────────────────────────────────────
// ── SCHEDULER TAB (redesigned) ───────────────────────────
const FREQ_OPTIONS=[
  {key:"daily",  label:"Daily",   Icon:Sun,        color:C.accent,  bg:C.accentBg},
  {key:"weekly", label:"Weekly",  Icon:CalendarDays,color:C.green,  bg:C.greenBg},
  {key:"monthly",label:"Monthly", Icon:CalendarRange,color:C.purple,bg:C.purpleBg},
  {key:"custom", label:"Custom",  Icon:Repeat2,    color:C.amber,   bg:C.amberBg},
];
const WEEK_DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TZ_OPTIONS=["Asia/Kolkata (IST, UTC+5:30)","UTC (UTC+0)","America/New_York (EST, UTC−5)","Europe/London (GMT, UTC+0)","Asia/Singapore (SGT, UTC+8)","Asia/Tokyo (JST, UTC+9)","America/Los_Angeles (PST, UTC−8)"];

function fmtTime(val){
  if(!val)return"—";
  const[hh,mm]=val.split(":");
  const h=parseInt(hh);
  return`${h%12||12}:${mm} ${h>=12?"PM":"AM"}`;
}
function nextRunLabel(freq,time,weekDays,monthDay,tz){
  const now=new Date();
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const[hh,mm]=(time||"06:30").split(":").map(Number);
  const candidate=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm);
  if(freq==="daily"){if(candidate<=now)candidate.setDate(candidate.getDate()+1);}
  else if(freq==="weekly"){let d=candidate;const dayNames=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];while(!weekDays.includes(dayNames[d.getDay()])||d<=now)d.setDate(d.getDate()+1);return`${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${fmtTime(time)}`;}
  else if(freq==="monthly"){candidate.setDate(monthDay||1);if(candidate<=now)candidate.setMonth(candidate.getMonth()+1);}
  else return"Runs on interval";
  return`${candidate.getDate()} ${months[candidate.getMonth()]} ${candidate.getFullYear()}, ${fmtTime(time)}`;
}

function SchedTab({plan,dispatch,showToast,saveSchedule,runCrawl,crawling}){
  // All values read directly from plan store — never stale
  const freq         = plan.schedFreq       || "daily";
  const time         = plan.schedTime       || "06:30";
  const weekDays     = plan.schedWeekDays   || ["Mon","Tue","Wed","Thu","Fri"];
  const monthDay     = plan.schedMonthDay   || 1;
  const customVal    = plan.intervalMinutes || 30;
  const customUnit   = plan.schedCustomUnit || "minutes";
  const tz           = plan.schedTz         || TZ_OPTIONS[0];
  const fetchPeriod     = plan.fetchPeriod     || "week";
  const fetchPeriodDays = plan.fetchPeriodDays || 7;

  const patch = (changes) => dispatch({type:"UPDATE_PLAN", id:plan.id, changes});
  const setFreq          = (v) => patch({schedFreq:v});
  const setTime          = (v) => patch({schedTime:v, triggerTimes:{day:v,week:v,month:v,hour:v}});
  const setMonthDay      = (v) => patch({schedMonthDay:v});
  const setCustomVal     = (v) => patch({intervalMinutes:Number(v)||1});
  const setCustomUnit    = (v) => patch({schedCustomUnit:v});
  const setTz            = (v) => patch({schedTz:v});
  const setFetchPeriod   = (v) => patch({fetchPeriod:v});
  const setFetchPeriodDays = (v) => patch({fetchPeriodDays:Number(v)||1});
  const togDay = (d) => patch({schedWeekDays: weekDays.includes(d) ? weekDays.filter(x=>x!==d) : [...weekDays,d]});

  const jobs = SCH.getJobs().filter(j=>j.planId===plan.id);
  const recipients = (plan.recipientGroups||[]).reduce((s,g)=>s+g.emails.length,0);
  const isPaused = plan.status!=="running";

  const handleSave = () => {
    saveSchedule(
      freq==="daily"?["day"]:freq==="weekly"?["week"]:freq==="monthly"?["month"]:["hour"],
      {day:time,week:time,month:time,hour:time},
      {schedFreq:freq,schedTime:time,schedWeekDays:weekDays,schedMonthDay:monthDay,
       intervalMinutes:Number(customVal)||30,schedCustomUnit:customUnit,schedTz:tz,
       fetchPeriod,fetchPeriodDays:Number(fetchPeriodDays)||7}
    );
  };

  const togglePause = () => {
    const next = plan.status==="running" ? "paused" : "running";
    dispatch({type:"UPDATE_PLAN", id:plan.id, changes:{status:next}});
    if(next==="running") showToast("Scheduler started","sched",{sub:plan.name});
    else { SCH.clearPlan(plan.id); showToast("Scheduler paused","warn",{sub:plan.name}); }
  };

  const handleRunNow = () => {
    if(crawling){ showToast("Crawl already running","warn",{sub:"Please wait"}); return; }
    showToast("Crawl starting…","crawl",{sub:plan.name});
    runCrawl();
  };

  const freqLabel = FREQ_OPTIONS.find(f=>f.key===freq)?.label||"Daily";
  const nextRun   = nextRunLabel(freq,time,weekDays,monthDay,tz);
  const lastRun   = plan.lastRun ? new Date(plan.lastRun).toLocaleString([],{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "Never";

  const S = {
    sectionLabel:{fontSize:11,fontWeight:700,color:C.ink3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10},
    fieldLabel:{fontSize:11,fontWeight:600,color:C.ink2,marginBottom:5,display:"block"},
    timeInput:{padding:"7px 10px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:12,background:"#fff",color:C.ink,outline:"none",fontFamily:"inherit",width:160},
    numInput:{padding:"7px 10px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:12,background:"#fff",color:C.ink,outline:"none",fontFamily:"inherit",width:90},
  };

  // Date range options
  const DATE_OPTS = [
    {v:"day",   l:"Day",   d:"Fetch articles from the last 1 day"},
    {v:"week",  l:"Week",  d:"Fetch articles from the last 7 days"},
    {v:"month", l:"Month", d:"Fetch articles from the last 30 days"},
    {v:"custom",l:"Custom",d:"User enters number of days"},
  ];

  return <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:14,alignItems:"start"}}>
    {/* ── Left column ── */}
    <div>
      {/* Schedule frequency */}
      <div style={{marginBottom:8,...S.sectionLabel}}>Schedule Settings</div>
      <Card style={{marginBottom:12}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:18}}>
          {FREQ_OPTIONS.map(({key,label,Icon,color,bg})=>(
            <div key={key} onClick={()=>setFreq(key)} style={{background:freq===key?bg:C.surface,border:`2px solid ${freq===key?color:C.line}`,borderRadius:10,padding:"11px 0",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:"all .13s",position:"relative"}}>
              <Icon size={18} color={freq===key?color:C.ink3}/>
              <span style={{fontSize:12,fontWeight:700,color:freq===key?color:C.ink3}}>{label}</span>
              {freq===key&&<CheckCircle2 size={14} color={color} style={{position:"absolute",top:7,right:7}}/>}
            </div>
          ))}
        </div>

        {freq==="daily"&&<div>
          <label style={S.fieldLabel}><Clock size={13} style={{verticalAlign:-2,marginRight:4}}/> Run time</label>
          <input type="time" value={time} onChange={e=>setTime(e.target.value)} style={S.timeInput}/>
        </div>}

        {freq==="weekly"&&<div>
          <label style={{...S.fieldLabel,marginBottom:8}}>Days of the week</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
            {WEEK_DAYS.map(d=><button key={d} onClick={()=>togDay(d)} style={{padding:"5px 10px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",border:`1px solid ${weekDays.includes(d)?C.green:C.line2}`,background:weekDays.includes(d)?C.greenBg:"#fff",color:weekDays.includes(d)?C.green:C.ink3,fontFamily:"inherit",transition:"all .12s"}}>{d}</button>)}
          </div>
          <label style={S.fieldLabel}><Clock size={13} style={{verticalAlign:-2,marginRight:4}}/> Run time</label>
          <input type="time" value={time} onChange={e=>setTime(e.target.value)} style={S.timeInput}/>
        </div>}

        {freq==="monthly"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={S.fieldLabel}>Day of month</label>
            <input type="number" min={1} max={31} value={monthDay} onChange={e=>setMonthDay(Number(e.target.value))} style={S.numInput}/>
          </div>
          <div>
            <label style={S.fieldLabel}><Clock size={13} style={{verticalAlign:-2,marginRight:4}}/> Run time</label>
            <input type="time" value={time} onChange={e=>setTime(e.target.value)} style={S.timeInput}/>
          </div>
        </div>}

        {freq==="custom"&&<div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
            <div>
              <label style={S.fieldLabel}>Run every</label>
              <input type="number" min={1} value={customVal} onChange={e=>setCustomVal(e.target.value)} style={S.numInput}/>
            </div>
            <div>
              <label style={S.fieldLabel}>Unit</label>
              <select value={customUnit} onChange={e=>setCustomUnit(e.target.value)} style={{...S.timeInput,width:"100%"}}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </div>
        </div>}

        <div style={{borderTop:`1px solid ${C.line}`,marginTop:14,paddingTop:12,display:"flex",alignItems:"center",gap:10}}>
          <Globe size={13} color={C.ink3} style={{flexShrink:0}}/>
          <label style={{fontSize:11,color:C.ink3,flexShrink:0}}>Timezone</label>
          <select value={tz} onChange={e=>setTz(e.target.value)} style={{flex:1,padding:"6px 9px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:11,background:"#fff",color:C.ink,outline:"none",fontFamily:"inherit"}}>
            {TZ_OPTIONS.map(t=><option key={t}>{t}</option>)}
          </select>
        </div>
      </Card>

      {/* Fetch Period — how far back to extract */}
      <div style={{marginBottom:8,...S.sectionLabel}}>Fetch Period</div>
      <Card style={{marginBottom:12}}>
        <div style={{fontSize:11,color:C.ink3,marginBottom:12,lineHeight:1.5}}>
          Select how much historical data should be collected during each execution.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:fetchPeriod==="custom"?12:0}}>
          {DATE_OPTS.map(({v,l,d})=>(
            <div key={v} onClick={()=>setFetchPeriod(v)} style={{padding:"10px 12px",borderRadius:9,border:`2px solid ${fetchPeriod===v?C.accent:C.line}`,background:fetchPeriod===v?C.accentBg:C.surface,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all .12s"}}>
              <div style={{width:14,height:14,borderRadius:"50%",border:`2px solid ${fetchPeriod===v?C.accent:C.ink3}`,background:fetchPeriod===v?C.accent:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {fetchPeriod===v&&<div style={{width:5,height:5,borderRadius:"50%",background:"#fff"}}/>}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:fetchPeriod===v?C.accent:C.ink2}}>{l}</div>
                <div style={{fontSize:10,color:C.ink3}}>{d}</div>
              </div>
            </div>
          ))}
        </div>
        {fetchPeriod==="custom"&&<div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
          <label style={{fontSize:12,color:C.ink2,whiteSpace:"nowrap"}}>Number of days:</label>
          <input type="number" min={1} max={365} value={fetchPeriodDays} onChange={e=>setFetchPeriodDays(e.target.value)} style={{...S.numInput,width:80}}/>
          <span style={{fontSize:11,color:C.ink3}}>day(s) back</span>
        </div>}
        <div style={{marginTop:12,padding:"8px 12px",background:C.accentBg,borderRadius:8,fontSize:11,color:C.accent}}>
          📅 Currently fetching articles from the <strong>
            {fetchPeriod==="day"?"last 1 day":fetchPeriod==="week"?"last 7 days":fetchPeriod==="month"?"last 30 days":`last ${fetchPeriodDays} day(s)`}
          </strong>
        </div>
      </Card>

      {/* Action buttons */}
      <div style={{display:"flex",gap:8}}>
        <button onClick={handleSave} style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 0",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",border:"none",background:C.accent,color:"#fff",fontFamily:"inherit"}}>
          <Save size={15}/>Save schedule
        </button>
        <button onClick={handleRunNow} disabled={crawling} style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 0",borderRadius:9,fontSize:13,fontWeight:700,cursor:crawling?"not-allowed":"pointer",border:`1px solid ${C.line2}`,background:crawling?C.surface:C.paper,color:crawling?C.ink3:C.ink,fontFamily:"inherit",opacity:crawling?.6:1}}>
          <RefreshCw size={15} style={{animation:crawling?"spin 1s linear infinite":"none"}}/>
          {crawling?"Running…":"Run now"}
        </button>
        <button onClick={togglePause} style={{flex:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 0",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",border:`1px solid ${isPaused?C.green:C.amber}`,background:isPaused?C.greenBg:C.amberBg,color:isPaused?C.green:C.amber,fontFamily:"inherit"}}>
          {isPaused?<><Play size={15}/>Start scheduler</>:<><Pause size={15}/>Pause scheduler</>}
        </button>
      </div>
    </div>

    {/* ── Right: status ── */}
    <div>
      <div style={{marginBottom:8,...S.sectionLabel}}>Scheduler status</div>
      <Card style={{marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:C.ink}}>{plan.name}</div>
            <div style={{fontSize:11,color:C.ink3,marginTop:2}}>Current configuration</div>
          </div>
          <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,background:isPaused?C.amberBg:C.greenBg,color:isPaused?C.amber:C.green}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:isPaused?C.amber:C.green,animation:!isPaused?"pulse 1.8s infinite":"none",display:"inline-block"}}/>
            {isPaused?"Paused":"Active"}
          </span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {[["Frequency",freqLabel],["Run time",freq==="custom"?`Every ${customVal} ${customUnit}`:fmtTime(time)],["URLs",(plan.urls||[]).length],["Recipients",recipients]].map(([l,v])=>(
            <div key={l} style={{background:C.surface,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:C.ink3,marginBottom:3}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,color:C.ink}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{background:C.surface,borderRadius:8,padding:"10px 12px",fontSize:11}}>
          {[
            ["Status",isPaused?"Paused":"Active"],
            ["Next run",isPaused?"—":nextRun],
            ["Last run",lastRun],
            ["Fetch period",fetchPeriod==="custom"?`Last ${fetchPeriodDays}d`:fetchPeriod==="day"?"1d":fetchPeriod==="week"?"7d":"30d"],
            ["Timezone",tz.split(" ")[0]]
          ].map(([l,v],i,arr)=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:i !== arr.length - 1?`1px solid ${C.line}`:"none"}}>
              <span style={{color:C.ink3}}>{l}</span>
              <span style={{fontWeight:700,color:C.ink,textAlign:"right",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{marginBottom:8,...S.sectionLabel}}>Active jobs</div>
      <Card>
        {jobs.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"14px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}><Clock size={22} style={{opacity:.3}}/><span>No active jobs — click Start scheduler</span></div>}
        {jobs.map(j=>(
          <div key={j.planId+"__"+j.period} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.line}`}}>
            <div style={{width:30,height:30,borderRadius:8,background:C.greenBg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Clock size={14} color={C.green}/></div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:C.ink}}>{j.period} trigger</div>
              <div style={{fontSize:10,color:C.ink3}}>Next: {j.nextRun?new Date(j.nextRun).toLocaleString([],{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"calculating…"}</div>
            </div>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:C.greenBg,color:C.green,flexShrink:0}}>Running</span>
          </div>
        ))}
      </Card>

      {/* AI info box */}
      <Card style={{marginTop:10,background:C.accentBg,border:`1px solid ${C.accent}33`}}>
        <div style={{fontSize:12,fontWeight:700,marginBottom:6,display:"flex",alignItems:"center",gap:6,color:C.accent}}><Brain size={13}/> AI Involvement</div>
        <div style={{fontSize:11,color:C.ink2,lineHeight:1.7}}>
          During each crawl, AI is used for:<br/>
          <strong>① Relevance check</strong> — Is this article related to your prompt?<br/>
          <strong>② Summarization</strong> — Generates a concise AI summary.<br/>
          <span style={{color:C.ink3}}>Provider: {plan.name ? "Claude (built-in)" : "—"}</span>
        </div>
      </Card>
    </div>
  </div>;
}

// ── EMAIL TAB ────────────────────────────────────────────
function EmailTab({plan,store,dispatch,showToast,planArticles,doSendEmail}){
  const[prevM,setPrevM]=useState(false);const[addGM,setAddGM]=useState(false);
  const[gName,setGName]=useState("");const[gEmails,setGEmails]=useState("");const[gFreq,setGFreq]=useState("Daily");
  const[quickEmails,setQuickEmails]=useState("");const[quickFreq,setQuickFreq]=useState("Daily");
  const[dOpts,setDOpts]=useState({"Include AI summary":true,"Attach source URL":true,"Alert on content match":true,"Skip duplicates":true});
  const[sendMode,setSendMode]=useState(plan.sendMode||"immediate");
  const[sendTime,setSendTime]=useState(plan.sendTime||"09:00");
  const[autoMail,setAutoMail]=useState(plan.autoMail||false);
  const DAYS=[{k:"mon",l:"Mon"},{k:"tue",l:"Tue"},{k:"wed",l:"Wed"},{k:"thu",l:"Thu"},{k:"fri",l:"Fri"},{k:"sat",l:"Sat"},{k:"sun",l:"Sun"}];
  const[autoMailDays,setAutoMailDays]=useState(plan.autoMailDays||["mon","tue","wed","thu","fri"]);
  const togDay=(d)=>setAutoMailDays(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d]);
  const groups=plan.recipientGroups||[];
  const totalRec=[...new Set(groups.flatMap(g=>g.emails))].length;

  const saveSendMode=()=>{
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{sendMode,sendTime,autoMail,autoMailTime:sendTime,autoMailDays}});
    showToast("Email settings saved","success");
  };
  const addGroup=()=>{
    if(!gName.trim())return;
    const em=gEmails.split(/[\n,]/).map(e=>e.trim()).filter(e=>e.includes("@"));
    const g={id:`grp_${Date.now()}`,name:gName.trim(),emails:em,freq:gFreq,active:true};
    dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{recipientGroups:[...groups,g]}});
    setGName("");setGEmails("");setAddGM(false);showToast(`Group "${g.name}" added with ${em.length} recipients`,"success");
  };
  const sendNow=()=>{
    if(planArticles.length===0){showToast("No articles yet — run crawl first","");return;}
    const ag=groups.filter(g=>g.active);if(ag.length===0){showToast("No active recipient groups","");return;}
    doSendEmail(planArticles,[...new Set(ag.flatMap(g=>g.emails))]);
  };

  return <>
    <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14}}>
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div><div style={{fontSize:13,fontWeight:700}}>Email Recipients</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{groups.length} groups · {totalRec} recipients</div></div>
          <div style={{display:"flex",gap:6}}>
            <Btn sm icon={Eye} onClick={()=>setPrevM(true)}>Preview</Btn>
            <Btn sm icon={Send} onClick={sendNow}>Send Now</Btn>
            <Btn primary sm icon={UserPlus} onClick={()=>setAddGM(true)}>Add Group</Btn>
          </div>
        </div>
        {groups.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:C.ink3}}><UserPlus size={36} style={{opacity:.3,marginBottom:8}}/><div style={{fontSize:13,fontWeight:600}}>No recipient groups yet</div><div style={{fontSize:12,marginTop:4}}>Add groups to receive email digests</div></div>}
        {groups.map((r)=><div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:C.surface,borderRadius:10,marginBottom:8}}>
          <div style={{width:40,height:40,borderRadius:"50%",background:C.accentBg,color:C.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,flexShrink:0}}>{r.name[0].toUpperCase()}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{r.name}</div><div style={{fontSize:11,color:C.ink3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.emails.join(", ")}</div></div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <Badge variant="blue" Icon={Mail}>{r.freq}</Badge>
            <Badge variant={r.active?"green":"amber"} Icon={r.active?CheckCircle2:Clock}>{r.active?"Active":"Paused"}</Badge>
            <Toggle checked={r.active} onChange={v=>dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{recipientGroups:groups.map(g=>g.id===r.id?{...g,active:v}:g)}})}/>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <button onClick={()=>{dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{recipientGroups:groups.filter(g=>g.id!==r.id)}});showToast("Group removed","");}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:7,border:`1px solid rgba(220,38,38,.2)`,background:C.redBg,color:C.red,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}><Trash2 size={14}/> Remove</button>
          </div>
        </div>)}
        <Card style={{marginTop:12}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Quick Add Recipients</div>
          <FormRow label="Emails (one per line or comma-separated)"><Inp value={quickEmails} onChange={setQuickEmails} placeholder={"email1@company.com\nemail2@company.com"} rows={3}/></FormRow>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <Sel value={quickFreq} onChange={setQuickFreq} options={["Daily","Weekly","Monthly","Instant"]} style={{flex:1}}/>
            <Btn primary sm icon={Plus} onClick={()=>{if(!quickEmails.trim()){showToast("Enter at least one email","");return;}const em=quickEmails.split(/[\n,]/).map(e=>e.trim()).filter(e=>e.includes("@"));const g={id:`grp_${Date.now()}`,name:`Group ${groups.length+1}`,emails:em,freq:quickFreq,active:true};dispatch({type:"UPDATE_PLAN",id:plan.id,changes:{recipientGroups:[...groups,g]}});showToast(`${em.length} recipient(s) added`,"success");setQuickEmails("");}}>Add</Btn>
          </div>
        </Card>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* ── Auto-Mail Settings (Merged) ── */}
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:8,display:"flex",alignItems:"center",gap:6}}><Bell size={14} color={C.green}/> Auto-Mail (This Plan)</div>
          
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:autoMail?C.greenBg:C.surface,borderRadius:9,border:`1px solid ${autoMail?C.green:C.line}`,marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Bell size={13} color={autoMail?C.green:C.ink3}/>
              <div><div style={{fontSize:12,fontWeight:700,color:autoMail?C.green:C.ink}}>Auto-send after crawl</div><div style={{fontSize:10,color:C.ink3}}>Sends digest when articles are found</div></div>
            </div>
            <Toggle checked={autoMail} onChange={setAutoMail}/>
          </div>

          {autoMail && (
            <>
              <div style={{fontSize:11,fontWeight:600,color:C.ink3,marginBottom:8,textTransform:"uppercase",letterSpacing:".05em"}}>Send Mode</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
                <label style={{display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:8,background:sendMode==="immediate"?C.accentBg:C.surface,border:`1px solid ${sendMode==="immediate"?C.accent:C.line}`,cursor:"pointer",fontSize:12}}>
                  <input type="radio" checked={sendMode==="immediate"} onChange={()=>setSendMode("immediate")}/>
                  <Bolt size={14} color={sendMode==="immediate"?C.accent:C.ink3}/>
                  <div><div style={{fontWeight:700}}>Send immediately</div><div style={{fontSize:10,color:C.ink3}}>Email goes out as soon as crawl finds articles</div></div>
                </label>
                <label style={{display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:8,background:sendMode==="scheduled"?C.accentBg:C.surface,border:`1px solid ${sendMode==="scheduled"?C.accent:C.line}`,cursor:"pointer",fontSize:12}}>
                  <input type="radio" checked={sendMode==="scheduled"} onChange={()=>setSendMode("scheduled")}/>
                  <Clock size={14} color={sendMode==="scheduled"?C.accent:C.ink3}/>
                  <div><div style={{fontWeight:700}}>Send at scheduled time</div><div style={{fontSize:10,color:C.ink3}}>Hold articles and send once daily at a fixed time</div></div>
                </label>
              </div>

              {sendMode === "scheduled" && (
                <>
                  <FormRow label="Daily send time" help="Email sent at this time on selected days">
                    <Inp type="time" value={sendTime} onChange={setSendTime}/>
                  </FormRow>
                  <FormRow label="Active days">
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                      {DAYS.map(({k,l})=><button key={k} onClick={()=>togDay(k)} style={{padding:"3px 8px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",border:`1px solid ${autoMailDays.includes(k)?C.green:C.line2}`,background:autoMailDays.includes(k)?C.greenBg:"#fff",color:autoMailDays.includes(k)?C.green:C.ink3,fontFamily:"inherit"}}>{l}</button>)}
                    </div>
                  </FormRow>
                  <div style={{padding:"8px 10px",background:C.greenBg,borderRadius:7,fontSize:11,color:C.green,marginBottom:8}}>
                    🟢 Active · sends at <strong>{sendTime}</strong> on <strong>{autoMailDays.map(d=>d.charAt(0).toUpperCase()+d.slice(1)).join(", ")||"no days"}</strong>
                  </div>
                </>
              )}
            </>
          )}

          <Btn primary sm icon={Save} onClick={saveSendMode}>Save Auto-Mail Settings</Btn>
        </Card>

        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:6}}><SlidersHorizontal size={15} color={C.accent}/> Delivery Options</div>
          {Object.entries(dOpts).map(([l,v])=><div key={l} style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:12,color:C.ink2}}>{l}</span><Toggle checked={v} onChange={vv=>setDOpts(o=>({...o,[l]:vv}))}/></div>)}
        </Card>
      </div>
    </div>
    <Modal open={prevM} onClose={()=>setPrevM(false)} title="Email Preview" width={660}>
      {planArticles.length === 0 ? (
        <div style={{textAlign:"center",padding:"40px 20px",color:C.ink3}}>
          <Mail size={40} style={{opacity:.3,marginBottom:10}}/>
          <div style={{fontSize:14,fontWeight:600}}>No articles to preview</div>
          <div style={{fontSize:12,marginTop:4}}>Run a crawl first to find articles for this plan.</div>
        </div>
      ) : (
        <iframe
          srcDoc={compileEmailHtml(plan, planArticles, true)}
          title="Email Digest Preview"
          style={{
            width: "100%",
            height: "580px",
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            backgroundColor: "#f3f4f6"
          }}
        />
      )}
      <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}><Btn onClick={()=>setPrevM(false)}>Close</Btn></div>
    </Modal>
    <Modal open={addGM} onClose={()=>setAddGM(false)} title="Add Recipient Group">
      <FormRow label="Group Name"><Inp value={gName} onChange={setGName} placeholder="e.g. Leadership Team"/></FormRow>
      <FormRow label="Emails (one per line or comma-separated)"><Inp value={gEmails} onChange={setGEmails} rows={4} placeholder={"name@company.com\nname2@company.com"}/></FormRow>
      <FormRow label="Frequency"><Sel value={gFreq} onChange={setGFreq} options={["Daily","Weekly","Monthly","Instant"]}/></FormRow>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16,paddingTop:14,borderTop:`1px solid ${C.line}`}}>
        <Btn onClick={()=>setAddGM(false)}>Cancel</Btn>
        <Btn primary icon={UserPlus} onClick={addGroup}>Add Group</Btn>
      </div>
    </Modal>
  </>;
}
// ══════════════════════════════════════════════════════════
//  MONITORING PAGE
// ══════════════════════════════════════════════════════════
function MonitoringPage({store, dispatch, showToast}){
  const{plans,articles}=store;
  const errs=store.activityLog.filter(l=>l.type==="error").slice(-20).reverse();
  return <>
    <div style={{marginBottom:16}}><div style={{fontSize:14,fontWeight:700}}>Monitor</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>Live pipeline stage for every plan</div></div>
    <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
      {plans.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:C.ink3}}><Activity size={36} style={{opacity:.3,marginBottom:8}}/><div style={{fontSize:13,fontWeight:600}}>No plans yet</div></div>}
      {plans.map(p=>{
        const cnt=articles.filter(a=>a.plan_id===p.id).length;
        return <Card key={p.id}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:34,height:34,borderRadius:9,background:p.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{p.icon}</div>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{p.name}</div><div style={{fontSize:10,color:C.ink3}}>{cnt} articles · last run {p.lastRun?new Date(p.lastRun).toLocaleString():"never"}</div></div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Badge variant={p.status==="running"?"green":"amber"} Icon={p.status==="running"?CheckCircle2:Clock}>{p.status==="running"?"Running":"Paused"}</Badge>
              <button 
                onClick={() => {
                  if (confirm(`Delete plan "${p.name}"? This removes all its articles and logs.`)) {
                    if (confirm(`Are you absolutely sure you want to permanently delete "${p.name}"? This action cannot be undone.`)) {
                      dispatch({type:"DEL_PLAN",id:p.id});
                      if (showToast) showToast(`Plan "${p.name}" deleted`,"success");
                    }
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.ink3,
                  transition: "background .15s, color .15s"
                }}
                onMouseOver={e => { e.currentTarget.style.background = C.redBg; e.currentTarget.style.color = C.red; }}
                onMouseOut={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.ink3; }}
                title="Delete Plan"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <StagePipeline stage={p.stage||"idle"} compact/>
        </Card>;
      })}
    </div>
    <Card>
      <div style={{fontSize:13,fontWeight:700,marginBottom:10,display:"flex",alignItems:"center",gap:6}}><AlertTriangle size={15} color={C.red}/> Recent Errors</div>
      {errs.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"14px 0"}}>No errors logged</div>}
      {errs.map(e=><div key={e.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.line}`,fontSize:12}}>
        <span style={{color:C.ink3,minWidth:80}}>{new Date(e.ts).toLocaleString([],{hour:"2-digit",minute:"2-digit"})}</span>
        <span style={{flex:1}}>{e.event}</span>
        <span style={{color:C.ink3}}>{e.plan}</span>
      </div>)}
    </Card>
  </>;
}

// ══════════════════════════════════════════════════════════
//  LOGS PAGE
// ══════════════════════════════════════════════════════════
function LogsPage({store,dispatch,showToast}){
  const[filter,setFilter]=useState("all");
  const[search,setSearch]=useState("");
  const types=["all","crawl","ai","email","plan","error"];
  const logs=[...store.activityLog].reverse().filter(l=>{
    const matchType=filter==="all"||l.type===filter;
    const matchSearch=!search.trim()||l.event?.toLowerCase().includes(search.toLowerCase())||l.plan?.toLowerCase().includes(search.toLowerCase());
    return matchType&&matchSearch;
  });
  const ic={crawl:{I:Globe,c:C.accent,bg:C.accentBg},ai:{I:Brain,c:C.purple,bg:C.purpleBg},email:{I:Mail,c:C.green,bg:C.greenBg},error:{I:AlertTriangle,c:C.red,bg:C.redBg},plan:{I:CheckCircle2,c:C.green,bg:C.greenBg}};
  const clearLogs=()=>{if(confirm("Clear all activity logs? This cannot be undone.")){dispatch({type:"CLEAR_LOGS"});showToast("Logs cleared","success");}};
  const downloadLogs=()=>{
    const rows=[["Timestamp","Type","Event","Plan"],...[...store.activityLog].reverse().map(l=>[new Date(l.ts).toLocaleString(),l.type||"",l.event||"",l.plan||""])];
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download=`insightflow-logs-${new Date().toISOString().slice(0,10)}.csv`;a.click();
  };
  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <div><div style={{fontSize:14,fontWeight:700}}>Activity Logs</div><div style={{fontSize:11,color:C.ink3,marginTop:2}}>{store.activityLog.length} total entries · {logs.length} shown</div></div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={downloadLogs} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:`1px solid ${C.line2}`,background:C.accentBg,color:C.accent,fontFamily:"inherit"}}><Download size={14}/> Export CSV</button>
        <button onClick={clearLogs} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:`1px solid rgba(220,38,38,.2)`,background:C.redBg,color:C.red,fontFamily:"inherit"}}><Trash2 size={14}/> Clear Logs</button>
      </div>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {types.map(t=><button key={t} onClick={()=>setFilter(t)} style={{padding:"4px 11px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",border:`1px solid ${filter===t?C.accent:C.line}`,background:filter===t?C.accentBg:"#fff",color:filter===t?C.accent:C.ink2,fontFamily:"inherit",textTransform:"capitalize"}}>{t}{t==="error"&&store.activityLog.filter(l=>l.type==="error").length>0?` (${store.activityLog.filter(l=>l.type==="error").length})`:""}</button>)}
      </div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search logs…" style={{marginLeft:"auto",padding:"5px 10px",border:`1px solid ${C.line2}`,borderRadius:8,fontSize:12,width:180,outline:"none",fontFamily:"inherit"}}/>
    </div>
    <Card p={0}>
      {logs.length===0&&<div style={{textAlign:"center",padding:"48px 20px",color:C.ink3,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}><History size={36} style={{opacity:.3}}/><div style={{fontSize:13,fontWeight:600}}>No log entries</div><div style={{fontSize:11}}>{search?"Try a different search term":"Run a crawl to start seeing activity here"}</div></div>}
      {logs.map((l,i)=>{
        const{I,c,bg}=ic[l.type]||{I:Activity,c:C.ink3,bg:C.surface};
        const isErr=l.type==="error";
        return <div key={l.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 16px",borderBottom:i !== logs.length - 1?`1px solid ${C.line}`:"none",background:isErr?"rgba(220,38,38,.02)":"transparent"}}>
          <span style={{fontSize:10,color:C.ink3,minWidth:135,paddingTop:2,flexShrink:0}}>{new Date(l.ts).toLocaleString([],{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
          <div style={{width:24,height:24,borderRadius:6,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><I size={13} color={c}/></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,color:isErr?C.red:C.ink,lineHeight:1.4}}>{l.event}</div>
            {l.plan&&<div style={{fontSize:10,color:C.ink3,marginTop:1}}>{l.plan}</div>}
          </div>
          <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:bg,color:c,flexShrink:0,textTransform:"capitalize"}}>{l.type}</span>
        </div>;
      })}
    </Card>
  </>;
}

// ══════════════════════════════════════════════════════════
//  DASHBOARD PAGE
// ══════════════════════════════════════════════════════════
function DashboardPage({store, dispatch}){
  const {plans, articles, emailLog, activityLog} = store;
  const metrics = store.metrics || {
    totalUrlsProcessed: 0,
    articlesSelected: 0,
    articlesRejected: 0,
    totalProcessingTime: 0,
    apiUsage: { gemini: 0, huggingface: 0, openai: 0, groq: 0, claude: 0 }
  };

  const [selectedPlanId, setSelectedPlanId] = useState("all");
  const [urlFilter, setUrlFilter] = useState("");

  // Reset URL filter when plan changes
  useEffect(() => {
    setUrlFilter("");
  }, [selectedPlanId]);

  const pFresh = plans.find(p => p.id === selectedPlanId) || null;

  // Filter options for URL filter dropdown
  const dropdownUrls = useMemo(() => {
    if (selectedPlanId === "all") {
      const all = [];
      const seen = new Set();
      plans.forEach(p => {
        (p.urls || []).forEach(u => {
          if (!seen.has(u.url)) {
            seen.add(u.url);
            all.push(u);
          }
        });
      });
      return all;
    } else {
      const pFresh = plans.find(p => p.id === selectedPlanId);
      return pFresh ? (pFresh.urls || []) : [];
    }
  }, [plans, selectedPlanId]);

  const selectedUrlObj = useMemo(() => {
    if (!urlFilter) return null;
    return plans.flatMap(p => p.urls || []).find(u => u.url === urlFilter) || null;
  }, [plans, urlFilter]);

  const urlLabel = selectedUrlObj ? selectedUrlObj.label : "";

  // Format processing time: e.g. "1h 12m 45s", or "45s", or "0s"
  const formatProcessingTime = (totalSeconds) => {
    if (!totalSeconds) return "0s";
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    let parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    return parts.join(" ");
  };

  // Helper selectors to compute stats dynamically based on plan & url filters
  const getUrlsProcessed = () => {
    if (!urlFilter && selectedPlanId === "all") {
      return metrics.totalUrlsProcessed;
    }
    const filteredLogs = activityLog.filter(l => {
      const matchesPlan = selectedPlanId === "all" || (pFresh && l.plan === pFresh.name);
      const isCrawlLog = l.event && (
        l.event.includes("━━━ Crawling [") || 
        l.event.includes("??? Crawling [") || 
        l.event.includes("Failed to crawl URL")
      );
      const matchesUrl = !urlFilter || (l.event && (
        l.event.toLowerCase().includes(urlFilter.toLowerCase()) ||
        (urlLabel && l.event.toLowerCase().includes(urlLabel.toLowerCase()))
      ));
      return matchesPlan && isCrawlLog && matchesUrl;
    });
    return filteredLogs.length;
  };

  const getArticlesSelected = () => {
    const filtered = articles.filter(a => {
      const matchesPlan = selectedPlanId === "all" || a.plan_id === selectedPlanId;
      const matchesUrl = !urlFilter || 
        a.url.toLowerCase().includes(urlFilter.toLowerCase()) || 
        a.company.toLowerCase().includes(urlFilter.toLowerCase()) ||
        (urlLabel && a.company.toLowerCase().includes(urlLabel.toLowerCase()));
      return matchesPlan && matchesUrl;
    });
    return filtered.length;
  };

  const getArticlesRejected = () => {
    if (!urlFilter && selectedPlanId === "all") {
      return metrics.articlesRejected;
    }
    const filteredLogs = activityLog.filter(l => {
      const matchesPlan = selectedPlanId === "all" || (pFresh && l.plan === pFresh.name);
      const isRejectionLog = l.event && l.event.includes("Skip — Article content is not relevant");
      return matchesPlan && isRejectionLog;
    });
    const planSelectedCount = articles.filter(a => selectedPlanId === "all" || a.plan_id === selectedPlanId).length;
    const urlSelectedCount = articles.filter(a => 
      (selectedPlanId === "all" || a.plan_id === selectedPlanId) && 
      (!urlFilter || 
        a.url.toLowerCase().includes(urlFilter.toLowerCase()) || 
        a.company.toLowerCase().includes(urlFilter.toLowerCase()) || 
        (urlLabel && a.company.toLowerCase().includes(urlLabel.toLowerCase()))
      )
    ).length;
    
    const rawRejections = filteredLogs.length;
    if (urlFilter && planSelectedCount > 0) {
      return Math.round(rawRejections * (urlSelectedCount / planSelectedCount));
    }
    return rawRejections;
  };

  const getProcessingTime = () => {
    if (!urlFilter && selectedPlanId === "all") {
      return metrics.totalProcessingTime;
    }
    const totalProcessed = metrics.totalUrlsProcessed || 1;
    const planProcessed = getUrlsProcessed();
    return Math.round(metrics.totalProcessingTime * (planProcessed / totalProcessed));
  };

  const urlsProcessedCount = getUrlsProcessed();
  const articlesSelectedCount = getArticlesSelected();
  const articlesRejectedCount = getArticlesRejected();
  const processingTimeCount = getProcessingTime();
  const formattedTime = formatProcessingTime(processingTimeCount);

  // Donut chart logic
  const totalArticles = articlesSelectedCount + articlesRejectedCount;
  const selPct = totalArticles !== 0 ? Math.round((articlesSelectedCount / totalArticles) * 100) : 0;
  const rejPct = totalArticles !== 0 ? Math.round((articlesRejectedCount / totalArticles) * 100) : 0;
  
  const R = 35;
  const circumference = 2 * Math.PI * R; // ~219.91
  const selDash = totalArticles !== 0 ? (articlesSelectedCount / totalArticles) * circumference : 0;
  const rejDash = totalArticles !== 0 ? (articlesRejectedCount / totalArticles) * circumference : 0;
  const selLinecap = (selDash > 0 && circumference > selDash) ? "round" : "butt";
  const rejLinecap = (rejDash > 0 && circumference > rejDash) ? "round" : "butt";

  // Bar chart logic
  const getApiUsage = (providerKey) => {
    const globalVal = metrics.apiUsage?.[providerKey] || 0;
    if (!urlFilter && selectedPlanId === "all") {
      return globalVal;
    }
    const globalSelected = metrics.articlesSelected || 1;
    return Math.round(globalVal * (articlesSelectedCount / globalSelected));
  };

  const usages = [
    { label: "Gemini", color: "#4f46e5", val: getApiUsage("gemini") },
    { label: "HuggingFace", color: "#7c3aed", val: getApiUsage("huggingface") },
    { label: "OpenAI", color: "#16a34a", val: getApiUsage("openai") },
    { label: "Groq", color: "#2563eb", val: getApiUsage("groq") },
    { label: "Claude", color: "#b45309", val: getApiUsage("claude") }
  ];
  const maxVal = Math.max(1, ...usages.map(u => u.val));

  // Filter plan lists
  const byPlan = plans.map(p => ({
    name: p.name,
    icon: p.icon,
    bg: p.bg,
    articles: articles.filter(a => a.plan_id === p.id && (!urlFilter || a.url.toLowerCase().includes(urlFilter.toLowerCase()) || a.company.toLowerCase().includes(urlFilter.toLowerCase()) || (urlLabel && a.company.toLowerCase().includes(urlLabel.toLowerCase())))).length,
    emails: emailLog.filter(e => e.plan_id === p.id).length,
    status: p.status,
    lastRun: p.lastRun
  }));

  const displayedPlanStatus = byPlan.filter(b => selectedPlanId === "all" || plans.find(p => p.name === b.name)?.id === selectedPlanId);
  const maxA = Math.max(1, ...byPlan.map(b => b.articles));

  const recentArts = [...articles]
    .filter(a => (selectedPlanId === "all" || a.plan_id === selectedPlanId) && (!urlFilter || a.url.toLowerCase().includes(urlFilter.toLowerCase()) || a.company.toLowerCase().includes(urlFilter.toLowerCase()) || (urlLabel && a.company.toLowerCase().includes(urlLabel.toLowerCase()))))
    .reverse()
    .slice(0, 5);

  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <div style={{fontSize:14,fontWeight:700}}>Dashboard</div>
        <div style={{fontSize:11,color:C.ink3,marginTop:2}}>Cross-plan performance overview</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:11,color:C.ink3}}>{new Date().toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span>
        <button
          onClick={() => {
            if (window.confirm("Are you sure you want to reset all dashboard metrics? This will set all processed, selected, and rejected counters back to zero.")) {
              dispatch({ type: "RESET_METRICS" });
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.line}`,
            background: "#fff",
            color: C.ink2,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            transition: "background .15s, border-color .15s"
          }}
          onMouseOver={e => { e.currentTarget.style.background = C.surface; }}
          onMouseOut={e => { e.currentTarget.style.background = "#fff"; }}
        >
          <RotateCcw size={13} />
          Reset Stats
        </button>
      </div>
    </div>

    {/* Filter controls row */}
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap",background:"#fff",padding:"10px 14px",borderRadius:12,border:`1px solid ${C.line}`}}>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,color:C.ink2}}>
        <span>Plan Filter:</span>
        <select 
          value={selectedPlanId} 
          onChange={e => setSelectedPlanId(e.target.value)}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${C.line}`,
            background: "#fff",
            color: C.ink,
            fontSize: 12,
            fontWeight: 600,
            outline: "none",
            cursor: "pointer"
          }}
        >
          <option value="all">All Plans</option>
          {plans.map(p => (
            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
          ))}
        </select>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:600,color:C.ink2}}>
        <span>URL / Source Filter:</span>
        <select 
          value={urlFilter} 
          onChange={e => setUrlFilter(e.target.value)}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${C.line}`,
            background: "#fff",
            color: C.ink,
            fontSize: 12,
            fontWeight: 600,
            outline: "none",
            cursor: "pointer",
            minWidth: 180
          }}
        >
          <option value="">All Sources</option>
          {dropdownUrls.map(u => (
            <option key={u.id || u.url} value={u.url}>{u.label || u.url}</option>
          ))}
        </select>
      </div>
    </div>

    {/* Top stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
      <Card style={{display:"flex",alignItems:"center",gap:12,background:"#fff"}}>
        <div style={{width:38,height:38,borderRadius:8,background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"center",color:C.accent,flexShrink:0}}>
          <Link2 size={20}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,color:C.ink3}}>URLs Processed</div>
          <div style={{fontSize:18,fontWeight:700,color:C.ink}}>{urlsProcessedCount}</div>
        </div>
      </Card>

      <Card style={{display:"flex",alignItems:"center",gap:12,background:"#fff"}}>
        <div style={{width:38,height:38,borderRadius:8,background:C.greenBg,display:"flex",alignItems:"center",justifyContent:"center",color:C.green,flexShrink:0}}>
          <CheckCircle2 size={20}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,color:C.ink3}}>Articles Selected</div>
          <div style={{fontSize:18,fontWeight:700,color:C.green}}>{articlesSelectedCount}</div>
        </div>
      </Card>

      <Card style={{display:"flex",alignItems:"center",gap:12,background:"#fff"}}>
        <div style={{width:38,height:38,borderRadius:8,background:C.redBg,display:"flex",alignItems:"center",justifyContent:"center",color:C.red,flexShrink:0}}>
          <XCircle size={20}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,color:C.ink3}}>Articles Rejected</div>
          <div style={{fontSize:18,fontWeight:700,color:C.red}}>{articlesRejectedCount}</div>
        </div>
      </Card>

      <Card style={{display:"flex",alignItems:"center",gap:12,background:"#fff"}}>
        <div style={{width:38,height:38,borderRadius:8,background:C.purpleBg,display:"flex",alignItems:"center",justifyContent:"center",color:C.purple,flexShrink:0}}>
          <Clock size={20}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,color:C.ink3}}>Processing Time</div>
          <div style={{fontSize:18,fontWeight:700,color:C.purple}}>{formattedTime}</div>
        </div>
      </Card>
    </div>

    {/* Visualizations (Donut + API usage columns) */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
      {/* Donut Chart Card */}
      <Card style={{display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
          <Activity size={15} color={C.green}/> Selection vs Rejection Rate
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-around",flex:1,padding:"10px 0"}}>
          <div style={{position:"relative",width:130,height:130,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="130" height="130" viewBox="0 0 100 100" style={{transform:"rotate(-90deg)"}}>
              <circle cx="50" cy="50" r={R} fill="transparent" stroke={C.surface2} strokeWidth="10" />
              {totalArticles !== 0 && (
                <circle cx="50" cy="50" r={R} fill="transparent" stroke={C.green} strokeWidth="10" strokeDasharray={selDash + " " + circumference} strokeDashoffset="0" strokeLinecap={selLinecap} />
              )}
              {totalArticles !== 0 && (
                <circle cx="50" cy="50" r={R} fill="transparent" stroke={C.red} strokeWidth="10" strokeDasharray={rejDash + " " + circumference} strokeDashoffset={-selDash} strokeLinecap={rejLinecap} />
              )}
            </svg>
            <div style={{position:"absolute",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:16,fontWeight:800,color:C.ink}}>{totalArticles !== 0 ? selPct + "%" : "0%"}</span>
              <span style={{fontSize:9,fontWeight:600,color:C.ink3,textTransform:"uppercase",marginTop:1}}>Selected</span>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontWeight:600,color:C.ink2}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:C.green,display:"inline-block"}}/>
                <span>Selected</span>
              </div>
              <div style={{fontSize:15,fontWeight:700,color:C.green,marginLeft:14}}>{articlesSelectedCount} <span style={{fontSize:10,color:C.ink3,fontWeight:400}}>({selPct}%)</span></div>
            </div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontWeight:600,color:C.ink2}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:C.red,display:"inline-block"}}/>
                <span>Rejected</span>
              </div>
              <div style={{fontSize:15,fontWeight:700,color:C.red,marginLeft:14}}>{articlesRejectedCount} <span style={{fontSize:10,color:C.ink3,fontWeight:400}}>({rejPct}%)</span></div>
            </div>
          </div>
        </div>
      </Card>
      <Card style={{display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
          <BarChart3 size={15} color={C.accent}/> API Calls by LLM Provider
        </div>
        <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",flex:1,paddingBottom:5}}>
          <svg width="280" height="135" viewBox="0 0 280 135">
            <line x1="12" y1="110" x2="268" y2="110" stroke={C.line2} strokeWidth="1" />
            {usages.map((u, idx) => {
              const x = 24 + idx * 50;
              const h = maxVal !== 0 ? (u.val / maxVal) * 80 : 0;
              return <g key={u.label}>
                <rect x={x} y={110 - h} width="22" height={Math.max(2, h)} rx="3" ry="3" fill={u.color} style={{ transition: "all .3s ease" }} />
                <text x={x + 11} y={110 - h - 5} textAnchor="middle" style={{ fontSize: "9px", fontWeight: "700", fill: C.ink }}>{u.val}</text>
                <text x={x + 11} y="124" textAnchor="middle" style={{ fontSize: "9px", fontWeight: "600", fill: C.ink3 }}>{u.label}</text>
              </g>;
            })}
          </svg>
        </div>
      </Card>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><BarChart2 size={15} color={C.accent}/> Articles per plan</div>
        {byPlan.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"20px 0"}}>No plans yet</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {byPlan.map(b=><div key={b.name}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4,alignItems:"center"}}>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:14}}>{b.icon}</span><span style={{fontWeight:600}}>{b.name}</span></span>
              <span style={{color:C.ink3}}>{b.articles} articles</span>
            </div>
            <ProgBar pct={(b.articles/maxA)*100}/>
          </div>)}
        </div>
      </Card>
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:14,display:"flex",alignItems:"center",gap:6}}><Activity size={15} color={C.green}/> Plan status</div>
        {displayedPlanStatus.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"20px 0"}}>No plans match current filters</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {displayedPlanStatus.map(b=><div key={b.name} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.surface,borderRadius:8}}>
            <div style={{width:32,height:32,borderRadius:8,background:b.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{b.icon}</div>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.name}</div><div style={{fontSize:10,color:C.ink3}}>Last run: {b.lastRun?new Date(b.lastRun).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"Never"}</div></div>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,background:b.status==="running"?C.greenBg:C.amberBg,color:b.status==="running"?C.green:C.amber,flexShrink:0}}>{b.status==="running"?"Running":"Paused"}</span>
          </div>)}
        </div>
      </Card>
    </div>
    <Card>
      <div style={{fontSize:13,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:6}}><FileText size={15} color={C.purple}/> Recent articles</div>
      {recentArts.length===0&&<div style={{fontSize:12,color:C.ink3,textAlign:"center",padding:"20px 0"}}>No articles crawled yet — run a plan to see results here</div>}
      {recentArts.map((a,i)=><div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 0",borderBottom:i !== recentArts.length - 1?`1px solid ${C.line}`:"none"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>{a.title}</div>
          <div style={{fontSize:10,color:C.ink3,display:"flex",alignItems:"center",gap:6}}>
            <span>{a.company}</span>
            <span>·</span>
            <span>{a.publish_date}</span>
            {a.relevance_score !== undefined && (
              <>
                <span>·</span>
                <span style={{
                  color: a.relevance_score >= 80 ? C.green : a.relevance_score >= 70 ? C.accent : C.amber,
                  fontWeight: 600
                }}>
                  {a.relevance_score}% Rel
                </span>
              </>
            )}
          </div>
        </div>
        <a href={a.url} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,background:C.accentBg,color:C.accent,fontSize:10,fontWeight:600,textDecoration:"none",flexShrink:0}}><Globe size={11}/> Open</a>
      </div>)}
    </Card>
  </>;
}

// ══════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ══════════════════════════════════════════════════════════
function SettingsPage({store,dispatch,showToast}){
  const cfg=store.config;
  
  // API Keys state
  const[geminiKey,setGeminiKey]=useState(cfg.gemini_api_key||"");
  const[geminiKeySec,setGeminiKeySec]=useState(cfg.gemini_api_key_secondary||"");
  const[geminiKeyBak,setGeminiKeyBak]=useState(cfg.gemini_api_key_backup||"");
  const[tokenSavingMode,setTokenSavingMode]=useState(cfg.token_saving_mode||false);
  const[noApiKeyMode,setNoApiKeyMode]=useState(cfg.no_api_key_mode||false);

  const[hfKey,setHfKey]=useState(cfg.huggingface_api_key||"");
  const[hfKeySec,setHfKeySec]=useState(cfg.huggingface_api_key_secondary||"");
  const[hfKeyBak,setHfKeyBak]=useState(cfg.huggingface_api_key_backup||"");
  const[hfModel,setHfModel]=useState(cfg.huggingface_model||"meta-llama/Llama-3.2-3B-Instruct");

  const[groqKey,setGroqKey]=useState(cfg.groq_api_key||"");
  const[groqKeySec,setGroqKeySec]=useState(cfg.groq_api_key_secondary||"");
  const[groqKeyBak,setGroqKeyBak]=useState(cfg.groq_api_key_backup||"");

  const[openaiKey,setOpenaiKey]=useState(cfg.openai_api_key||"");
  const[openaiKeySec,setOpenaiKeySec]=useState(cfg.openai_api_key_secondary||"");
  const[openaiKeyBak,setOpenaiKeyBak]=useState(cfg.openai_api_key_backup||"");

  const[claudeKey,setClaudeKey]=useState(cfg.anthropic_api_key||"");
  const[claudeKeySec,setClaudeKeySec]=useState(cfg.anthropic_api_key_secondary||"");
  const[claudeKeyBak,setClaudeKeyBak]=useState(cfg.anthropic_api_key_backup||"");
  const[claudeModel,setClaudeModel]=useState(cfg.anthropic_model||"claude-3-5-sonnet-20241022");

  const[provider,setProvider]=useState(cfg.ai_provider||"auto");
  const[senderName,setSenderName]=useState(cfg.sender_name||"Insight Flow AI");
  
  // Accordion active group
  const [activeGroup, setActiveGroup] = useState("gemini");
  
  // Collapsible Key Failover & Usage Logs state
  const [keyLogsExpanded, setKeyLogsExpanded] = useState(false);

  // SMTP
  const [activeSmtp, setActiveSmtp] = useState(cfg.active_smtp_provider || "outlook");
  
  // Outlook fields
  const [outlookHost, setOutlookHost] = useState(cfg.outlook_smtp_host || cfg.smtp_host || "smtp.office365.com");
  const [outlookPort, setOutlookPort] = useState(cfg.outlook_smtp_port || cfg.smtp_port || "587");
  const [outlookUser, setOutlookUser] = useState(cfg.outlook_smtp_user || (cfg.active_smtp_provider !== "gmail" ? cfg.smtp_user : "") || "");
  const [outlookPass, setOutlookPass] = useState(cfg.outlook_smtp_password || (cfg.active_smtp_provider !== "gmail" ? cfg.smtp_password : "") || "");
  const [outlookFrom, setOutlookFrom] = useState(cfg.outlook_sender_email || (cfg.active_smtp_provider !== "gmail" ? cfg.sender_email : "") || "");
  const [outlookName, setOutlookName] = useState(cfg.outlook_sender_name || (cfg.active_smtp_provider !== "gmail" ? cfg.sender_name : "") || "Insight Flow AI");

  // Gmail fields
  const [gmailHost, setGmailHost] = useState(cfg.gmail_smtp_host || "smtp.gmail.com");
  const [gmailPort, setGmailPort] = useState(cfg.gmail_smtp_port || "587");
  const [gmailUser, setGmailUser] = useState(cfg.gmail_smtp_user || (cfg.active_smtp_provider === "gmail" ? cfg.smtp_user : "") || "");
  const [gmailPass, setGmailPass] = useState(cfg.gmail_smtp_password || (cfg.active_smtp_provider === "gmail" ? cfg.smtp_password : "") || "");
  const [gmailFrom, setGmailFrom] = useState(cfg.gmail_sender_email || (cfg.active_smtp_provider === "gmail" ? cfg.sender_email : "") || "");
  const [gmailName, setGmailName] = useState(cfg.gmail_sender_name || (cfg.active_smtp_provider === "gmail" ? cfg.sender_name : "") || "Insight Flow AI");

  // Global auto-email schedule
  const[autoEmail,setAutoEmail]=useState(cfg.auto_email||false);
  const[autoEmailTime,setAutoEmailTime]=useState(cfg.auto_email_time||"08:00");
  const[autoEmailDays,setAutoEmailDays]=useState(cfg.auto_email_days||["mon","tue","wed","thu","fri"]);
  const DAYS=[{k:"mon",l:"Mon"},{k:"tue",l:"Tue"},{k:"wed",l:"Wed"},{k:"thu",l:"Thu"},{k:"fri",l:"Fri"},{k:"sat",l:"Sat"},{k:"sun",l:"Sun"}];
  const togDay=(d)=>setAutoEmailDays(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d]);

  const saveAI=()=>{
    const keyMappings = [
      { keyId: "gemini_primary", oldVal: cfg.gemini_api_key, newVal: geminiKey },
      { keyId: "gemini_secondary", oldVal: cfg.gemini_api_key_secondary, newVal: geminiKeySec },
      { keyId: "gemini_backup", oldVal: cfg.gemini_api_key_backup, newVal: geminiKeyBak },
      
      { keyId: "huggingface_primary", oldVal: cfg.huggingface_api_key, newVal: hfKey },
      { keyId: "huggingface_secondary", oldVal: cfg.huggingface_api_key_secondary, newVal: hfKeySec },
      { keyId: "huggingface_backup", oldVal: cfg.huggingface_api_key_backup, newVal: hfKeyBak },
      
      { keyId: "groq_primary", oldVal: cfg.groq_api_key, newVal: groqKey },
      { keyId: "groq_secondary", oldVal: cfg.groq_api_key_secondary, newVal: groqKeySec },
      { keyId: "groq_backup", oldVal: cfg.groq_api_key_backup, newVal: groqKeyBak },
      
      { keyId: "openai_primary", oldVal: cfg.openai_api_key, newVal: openaiKey },
      { keyId: "openai_secondary", oldVal: cfg.openai_api_key_secondary, newVal: openaiKeySec },
      { keyId: "openai_backup", oldVal: cfg.openai_api_key_backup, newVal: openaiKeyBak },
      
      { keyId: "claude_primary", oldVal: cfg.anthropic_api_key, newVal: claudeKey },
      { keyId: "claude_secondary", oldVal: cfg.anthropic_api_key_secondary, newVal: claudeKeySec },
      { keyId: "claude_backup", oldVal: cfg.anthropic_api_key_backup, newVal: claudeKeyBak }
    ];

    keyMappings.forEach(({ keyId, newVal }) => {
      if (newVal && newVal.trim()) {
        dispatch({
          type: "UPDATE_KEY_STATUS",
          keyId,
          status: {
            status: "unverified",
            remainingRequests: "N/A",
            remainingTokens: "N/A",
            lastError: "",
            lastChecked: null
          }
        });
      }
    });

    dispatch({
      type:"UPD_CFG",
      changes:{
        gemini_api_key:geminiKey, gemini_api_key_secondary:geminiKeySec, gemini_api_key_backup:geminiKeyBak,
        huggingface_api_key:"", huggingface_api_key_secondary:"", huggingface_api_key_backup:"",
        groq_api_key:"", groq_api_key_secondary:"", groq_api_key_backup:"",
        openai_api_key:"", openai_api_key_secondary:"", openai_api_key_backup:"",
        anthropic_api_key:"", anthropic_api_key_secondary:"", anthropic_api_key_backup:"",
        huggingface_model:hfModel, anthropic_model:claudeModel,
        ai_provider:"gemini",
        token_saving_mode:tokenSavingMode,
        no_api_key_mode:noApiKeyMode
      }
    });
    showToast("AI settings saved","success");
  };

  const saveSMTP=()=>{
    const currentHost = activeSmtp === "gmail" ? gmailHost : outlookHost;
    const currentPort = activeSmtp === "gmail" ? gmailPort : outlookPort;
    const currentUser = activeSmtp === "gmail" ? gmailUser : outlookUser;
    const currentPass = activeSmtp === "gmail" ? gmailPass : outlookPass;
    const currentFrom = activeSmtp === "gmail" ? gmailFrom : outlookFrom;
    const currentName = activeSmtp === "gmail" ? gmailName : outlookName;

    dispatch({
      type:"UPD_CFG",
      changes:{
        smtp_host: currentHost,
        smtp_port: currentPort,
        smtp_user: currentUser,
        smtp_password: currentPass,
        sender_email: currentFrom,
        sender_name: currentName,
        
        active_smtp_provider: activeSmtp,
        
        outlook_smtp_host: outlookHost,
        outlook_smtp_port: outlookPort,
        outlook_smtp_user: outlookUser,
        outlook_smtp_password: outlookPass,
        outlook_sender_email: outlookFrom,
        outlook_sender_name: outlookName,

        gmail_smtp_host: gmailHost,
        gmail_smtp_port: gmailPort,
        gmail_smtp_user: gmailUser,
        gmail_smtp_password: gmailPass,
        gmail_sender_email: gmailFrom,
        gmail_sender_name: gmailName
      }
    });
    showToast("SMTP settings saved","success");
  };
  const saveAutoEmail=()=>{dispatch({type:"UPD_CFG",changes:{auto_email:autoEmail,auto_email_time:autoEmailTime,auto_email_days:autoEmailDays}});showToast("Auto-mail schedule saved","success");};
  const clearAll=()=>{if(confirm("This will delete all plans, articles and logs. Continue?")){dispatch({type:"CLEAR"});showToast("All data cleared","success");}};

  const active=activeProvider({
    gemini_api_key: geminiKey, gemini_api_key_secondary: geminiKeySec, gemini_api_key_backup: geminiKeyBak,
    huggingface_api_key: hfKey, huggingface_api_key_secondary: hfKeySec, huggingface_api_key_backup: hfKeyBak,
    groq_api_key: groqKey, groq_api_key_secondary: groqKeySec, groq_api_key_backup: groqKeyBak,
    openai_api_key: openaiKey, openai_api_key_secondary: openaiKeySec, openai_api_key_backup: openaiKeyBak,
    anthropic_api_key: claudeKey, anthropic_api_key_secondary: claudeKeySec, anthropic_api_key_backup: claudeKeyBak,
    huggingface_model: hfModel, anthropic_model: claudeModel,
    ai_provider: provider
  }, store.keyStatuses);
  return <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16}}>
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {(() => {
        const keyStatuses = store.keyStatuses || {};
        const keyLogs = store.keyLogs || [];
        const ordered = getOrderedKeys(store.config, keyStatuses);
        const noKeys = ordered.length === 0;

        const hasInvalid = Object.values(keyStatuses).some(s => s.status === "invalid");
        const hasExhausted = Object.values(keyStatuses).some(s => s.status === "exhausted");
        
        let headerColor = C.purple;
        let headerBg = "transparent";
        if (noKeys) {
          headerColor = C.amber;
          headerBg = "rgba(245, 158, 11, 0.02)";
        } else if (hasInvalid) {
          headerColor = C.red;
          headerBg = "rgba(220, 38, 38, 0.02)";
        } else if (hasExhausted) {
          headerColor = C.amber;
          headerBg = "rgba(180, 83, 9, 0.02)";
        }

        return (
          <Card style={{ 
            padding: 0, 
            overflow: "hidden", 
            border: `1px solid ${headerColor === C.purple ? C.line : headerColor}`,
            transition: "border-color 0.2s"
          }}>
            <div 
              onClick={() => setKeyLogsExpanded(!keyLogsExpanded)}
              style={{ 
                fontSize: 13, 
                fontWeight: 700, 
                padding: "12px 16px",
                display: "flex", 
                alignItems: "center", 
                justifyContent: "space-between",
                cursor: "pointer",
                background: headerBg,
                userSelect: "none"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: headerColor }}>
                {noKeys ? (
                  <AlertTriangle size={15} color={C.amber} />
                ) : hasInvalid ? (
                  <AlertTriangle size={15} color={C.red} />
                ) : hasExhausted ? (
                  <AlertTriangle size={15} color={C.amber} />
                ) : (
                  <History size={15} color={C.purple} />
                )}
                <span style={{ fontWeight: 700 }}>Key Failover & Usage Logs</span>
                {noKeys ? (
                  <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: C.amberBg, color: C.amber }}>
                    No API Keys Configured
                  </span>
                ) : (hasInvalid || hasExhausted) ? (
                  <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: hasInvalid ? C.redBg : C.amberBg, color: hasInvalid ? C.red : C.amber }}>
                    {hasInvalid ? "Invalid Key Detected" : "Quota Exhausted"}
                  </span>
                ) : null}
              </div>
              <ChevronRight 
                size={16} 
                color={headerColor} 
                style={{ transform: keyLogsExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} 
              />
            </div>
            
            {keyLogsExpanded && (
              <div style={{ padding: "0 16px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ maxHeight: 150, overflowY: "auto", background: "#0f0e0d", borderRadius: 8, padding: "10px 12px", fontFamily: "'Courier New',monospace", fontSize: 11, lineHeight: 1.6 }}>
                  {noKeys ? (
                    <div style={{ color: "#ffd93d", fontStyle: "italic" }}>
                      ⚠️ No API keys configured. Please configure at least one API key in the sections below to enable failover and logs.
                    </div>
                  ) : keyLogs.length === 0 ? (
                    <div style={{ color: "#888", fontStyle: "italic" }}>
                      No failover or usage events logged yet. Keys will be monitored and logs populated during crawl runs.
                    </div>
                  ) : (
                    keyLogs.map((l, i) => {
                      const colors = {
                        verified_active: "#a8d8a8",
                        marked_invalid: "#ff6b6b",
                        marked_exhausted: "#ffd93d",
                        use_key: "#80d0ff"
                      };
                      const c = colors[l.action] || "#ffffff";
                      return <div key={l.id} style={{ color: c, display: "flex", gap: 8 }}>
                        <span style={{ color: "#555", flexShrink: 0 }}>{new Date(l.ts).toLocaleTimeString()}</span>
                        <span><strong>[{l.provider} {l.tier}]</strong> {l.message}</span>
                      </div>;
                    })
                  )}
                </div>
                {!noKeys && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <Btn sm icon={RefreshCw} onClick={() => {
                      dispatch({ type: "RESET_ALL_KEY_STATUSES" });
                      showToast("API key statuses reset to unverified", "success");
                    }}>Reset API Key Statuses</Btn>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })()}

      {/* ── Configure Gemini API Keys ── */}
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><Brain size={15} color={C.accent}/> Configure Gemini API Keys</div>
        <div style={{fontSize:11,color:C.ink3,marginBottom:12}}>Enter your Primary, Secondary, and Backup Google Gemini API keys to enable failover.</div>
        
        <div style={{display:"flex", flexDirection:"column", gap:10, marginBottom:12}}>
          <FormRow label="Primary Key">
            <Inp value={geminiKey} onChange={setGeminiKey} type="password" placeholder="Enter API Key..."/>
          </FormRow>
          <FormRow label="Secondary Key">
            <Inp value={geminiKeySec} onChange={setGeminiKeySec} type="password" placeholder="Enter API Key..."/>
          </FormRow>
          <FormRow label="Backup Key">
            <Inp value={geminiKeyBak} onChange={setGeminiKeyBak} type="password" placeholder="Enter API Key..."/>
          </FormRow>
        </div>
        <div style={{ marginBottom: 12 }}>
          <FormRow label="Token Saving Mode" help="Reduces Gemini API token usage by shortening the text sent (relevance limit: 1,000 chars, summary limit: 2,500 chars).">
            <Toggle checked={tokenSavingMode} onChange={setTokenSavingMode}/>
          </FormRow>
        </div>
        <div style={{ marginBottom: 12 }}>
          <FormRow label="Without API Key Option" help="Runs relevance checking and summarization locally in JavaScript using standard similarity search, bypassing the Google Gemini API.">
            <Toggle checked={noApiKeyMode} onChange={setNoApiKeyMode}/>
          </FormRow>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 10px",background:C.greenBg,borderRadius:8}}>
          <CheckCircle2 size={14} color={C.green}/><span style={{fontSize:11,color:C.green,fontWeight:600}}>Currently active: {active}</span>
        </div>
        <Btn primary sm icon={Save} onClick={saveAI}>Save AI Settings</Btn>
      </Card>

      {/* ── Auto-Mail moved to Plans ── */}
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><Bell size={15} color={C.green}/> Auto-Mail</div>
        <div style={{padding:"12px 14px",background:C.greenBg,border:`1px solid ${C.green}`,borderRadius:9,display:"flex",alignItems:"flex-start",gap:10}}>
          <CheckCircle2 size={16} color={C.green} style={{flexShrink:0,marginTop:1}}/>
          <div><div style={{fontSize:12,fontWeight:700,color:C.green,marginBottom:3}}>Auto-Mail is configured per Plan</div><div style={{fontSize:11,color:C.ink2,lineHeight:1.6}}>Go to <strong>Plans → (select a plan) → Email tab</strong> to set the schedule, days and time, and add recipients. Email sends are processed using the SMTP server configuration below.</div></div>
        </div>
      </Card>

      {/* ── SMTP Config ── */}
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><Send size={15} color={C.accent}/> Email Sending (SMTP)</div>
        <div style={{fontSize:11,color:C.ink3,marginBottom:12}}>Configure your SMTP email server details below. You can configure and save settings for both Office 365 / Outlook and Gmail profiles simultaneously and toggle the active profile.</div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <span style={{fontSize:11,color:C.ink3,fontWeight:600}}>Active Provider Profile:</span>
          <button type="button" onClick={()=>{setActiveSmtp("outlook")}} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:`1px solid ${activeSmtp==="outlook"?C.accent:C.line}`,background:activeSmtp==="outlook"?C.accentBg:"#fff",color:activeSmtp==="outlook"?C.accent:C.ink2,fontFamily:"inherit",transition:"all 0.15s"}}>Office 365 / Outlook</button>
          <button type="button" onClick={()=>{setActiveSmtp("gmail")}} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:`1px solid ${activeSmtp==="gmail"?C.accent:C.line}`,background:activeSmtp==="gmail"?C.accentBg:"#fff",color:activeSmtp==="gmail"?C.accent:C.ink2,fontFamily:"inherit",transition:"all 0.15s"}}>Gmail</button>
        </div>

        {activeSmtp === "outlook" ? (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <FormRow label="SMTP Host"><Inp value={outlookHost} onChange={setOutlookHost} placeholder="smtp.office365.com"/></FormRow>
              <FormRow label="Port"><Inp value={outlookPort} onChange={setOutlookPort} type="number" placeholder="587"/></FormRow>
            </div>
            <FormRow label="Username / Email"><Inp value={outlookUser} onChange={setOutlookUser} placeholder="you@outlook.com"/></FormRow>
            <FormRow label="Password / App Password" help="Enter your SMTP email account password or an app-specific password."><Inp value={outlookPass} onChange={setOutlookPass} type="password" placeholder="••••••••••••"/></FormRow>
            <FormRow label="Reply-To / From Email Address"><Inp value={outlookFrom} onChange={setOutlookFrom} placeholder="you@outlook.com"/></FormRow>
            <FormRow label="Sender Display Name"><Inp value={outlookName} onChange={setOutlookName} placeholder="InsightFlow AI"/></FormRow>
          </>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <FormRow label="SMTP Host"><Inp value={gmailHost} onChange={setGmailHost} placeholder="smtp.gmail.com"/></FormRow>
              <FormRow label="Port"><Inp value={gmailPort} onChange={setGmailPort} type="number" placeholder="587"/></FormRow>
            </div>
            <FormRow label="Username / Email"><Inp value={gmailUser} onChange={setGmailUser} placeholder="you@gmail.com"/></FormRow>
            <FormRow label="Password / App Password" help="Enter your Google App Password."><Inp value={gmailPass} onChange={setGmailPass} type="password" placeholder="••••••••••••"/></FormRow>
            <FormRow label="Reply-To / From Email Address"><Inp value={gmailFrom} onChange={setGmailFrom} placeholder="you@gmail.com"/></FormRow>
            <FormRow label="Sender Display Name"><Inp value={gmailName} onChange={setGmailName} placeholder="InsightFlow AI"/></FormRow>
          </>
        )}

        {(() => {
          const currentHost = activeSmtp === "gmail" ? gmailHost : outlookHost;
          const currentPort = activeSmtp === "gmail" ? gmailPort : outlookPort;
          const currentUser = activeSmtp === "gmail" ? gmailUser : outlookUser;
          const currentPass = activeSmtp === "gmail" ? gmailPass : outlookPass;
          const isConfigured = currentHost && currentPort && currentUser && currentPass;
          
          return <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 10px",background:isConfigured?C.greenBg:C.amberBg,borderRadius:8}}>
            {isConfigured
              ?<><CheckCircle2 size={14} color={C.green}/><span style={{fontSize:11,color:C.green,fontWeight:600}}>Configured — Send Now / auto-send will deliver real emails via {activeSmtp === "gmail" ? "Gmail" : "Outlook"}</span></>
              :<><AlertTriangle size={14} color={C.amber}/><span style={{fontSize:11,color:C.amber,fontWeight:600}}>Fill in Host, Port, Username and Password to enable sending</span></>}
          </div>;
        })()}
        
        <Btn primary sm icon={Save} onClick={saveSMTP}>Save SMTP Settings</Btn>
      </Card>

      {/* ── Danger Zone ── */}
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:12,display:"flex",alignItems:"center",gap:6}}><AlertTriangle size={15} color={C.red}/> Danger Zone</div>
        <div style={{fontSize:12,color:C.ink3,marginBottom:10}}>Permanently delete all plans, articles, email logs and activity history.</div>
        <Btn danger sm icon={Trash2} onClick={clearAll}>Clear All Data</Btn>
      </Card>
    </div>

    {/* ── Status sidebar ── */}
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <Card>
        <div style={{fontSize:12,fontWeight:700,marginBottom:10}}>System Status</div>
        {[
          ["AI Provider",active,C.green],
          ["Gemini Key",cfg.gemini_api_key?"Set ✓":"Not set",cfg.gemini_api_key?C.green:C.ink3],
          ["Groq Key",cfg.groq_api_key?"Set ✓":"Not set",cfg.groq_api_key?C.green:C.ink3],
          ["Email Sending",(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?"Configured ✓":"Not set",(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?C.green:C.amber],
          ["Plans",`${store.plans.length} total`,C.accent],
          ["Articles",`${store.articles.length} total`,C.accent],
          ["Emails Sent",`${store.emailLog.length} total`,C.green],
          ["Scheduler",`${SCH.getJobs().length} active jobs`,SCH.getJobs().length>0?C.green:C.ink3],
          ["Errors",`${store.activityLog.filter(l=>l.type==="error").length} logged`,store.activityLog.filter(l=>l.type==="error").length>0?C.red:C.green],
        ].map(([l,v,c])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:`1px solid ${C.line}`}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:c,flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:600,flex:1}}>{l}</span>
            <span style={{fontSize:11,fontWeight:700,color:c,textAlign:"right",maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
          </div>
        ))}
      </Card>
      <Card>
        <div style={{fontSize:12,fontWeight:700,marginBottom:8,display:"flex",alignItems:"center",gap:6}}><Mail size={13} color={C.green}/> Email Status</div>
        <div style={{padding:"10px 12px",background:(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?C.greenBg:C.surface,borderRadius:8,border:`1px solid ${(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?C.green:C.line}`}}>
          <div style={{fontSize:12,fontWeight:700,color:(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?C.green:C.ink3,marginBottom:4}}>{(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)?"✅ SMTP sending active":"⚪ SMTP not configured"}</div>
          {cfg.smtp_user&&<div style={{fontSize:11,color:C.ink2}}>From: <strong>{senderName}</strong> ({cfg.smtp_user})</div>}
          {!(cfg.smtp_host&&cfg.smtp_port&&cfg.smtp_user&&cfg.smtp_password)&&<div style={{fontSize:11,color:C.ink3}}>Configure SMTP settings below to enable sending.</div>}
        </div>
      </Card>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════════
//  APP ROOT
// ══════════════════════════════════════════════════════════
export default function InsightFlowApp(){
  const[store,dispatchRaw]=useReducer(reducer,null,initStore);
  const[page,setPage]=useState("plans");
  const[openPlan,setOpenPlan]=useState(null);
  const[toasts,showToast,dismissToast]=useToast();

  const dispatch=useCallback((action)=>dispatchRaw(action),[]);

  useEffect(() => {
    setAIConfig(store.config, dispatch, store.keyStatuses);
  }, [store.config, dispatch, store.keyStatuses]);

  // Auto-resume any interrupted crawls on mount/load (only if they were actively running)
  useEffect(() => {
    const timer = setTimeout(() => {
      storeRef.current.plans.forEach(async (p) => {
        if (p.crawlState && p.crawlState.isActive && ["crawling", "analyzing", "summarizing", "sending"].includes(p.stage)) {
          if (!_crawlingPlans.has(p.id)) {
            dispatch({
              type: "ADD_LOG",
              entry: {
                type: "crawl",
                event: `🔄 Resuming crawl for "${p.name}" after page reload (URL index ${p.crawlState.urlIndex + 1}/${(p.urls || []).length})`,
                plan: p.name
              }
            });
            try {
              await runCrawlForPlan(
                p,
                storeRef.current,
                dispatch,
                null,
                null,
                null,
                () => storeRef.current.plans.find(x => x.id === p.id)
              );
            } catch (err) {
              console.error("Auto-resume failed:", err);
            }
          }
        }
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [dispatch]);

  // Listen for scheduler notifications posted outside React (from setTimeout/setInterval callbacks)
  useEffect(()=>{
    const handler=(e)=>showToast(e.detail.msg, e.detail.type||"sched", {sub:e.detail.sub, duration:5000});
    window.addEventListener("if:notify", handler);
    return ()=>window.removeEventListener("if:notify", handler);
  },[showToast]);

  const storeRef = useRef(store);
  storeRef.current = store;

  const runBackgroundCrawl = useCallback(async (planId) => {
    const currentStore = storeRef.current;
    const plan = currentStore.plans.find(p => p.id === planId);
    if (!plan || plan.status !== "running") return;

    // Don't start if already in progress
    if (["crawling", "analyzing", "summarizing", "sending"].includes(plan.stage)) {
      return;
    }

    // Clear crawlState to start fresh
    dispatch({ type: "UPDATE_PLAN", id: plan.id, changes: { crawlState: null } });
    dispatch({ type: "ADD_LOG", entry: { type: "crawl", event: `🚀 Crawl starting for "${plan.name}"`, plan: plan.name } });
    try {
      const planToRun = { ...plan, crawlState: null };
      await runCrawlForPlan(planToRun, currentStore, dispatch, null, null, null, () => storeRef.current.plans.find(p => p.id === planId));
    } catch (e) {
      console.error("Background crawl error:", e);
      dispatch({ type: "ADD_LOG", entry: { type: "error", event: `Crawl error: ${e.message}`, plan: plan.name } });
    }
    // Scheduler handles next trigger — no recursive restart here
  }, [dispatch]);

  const runScheduledSend = useCallback(async (planId) => {
    const currentStore = storeRef.current;
    const plan = currentStore.plans.find(p => p.id === planId);
    if (!plan || plan.status !== "running") return;
    
    const pending = currentStore.articles.filter(
      a => a.plan_id === plan.id && 
      !currentStore.emailLog.some(e => e.plan_id === plan.id && new Date(e.sent_at) > new Date(a.crawled_at))
    );
    const ag = (plan.recipientGroups || []).filter(g => g.active);
    if (pending.length === 0 || ag.length === 0) return;
    const em = [...new Set(ag.flatMap(g => g.emails))];
    if (em.length === 0) return;

    await sendEmailForPlan(plan, currentStore, dispatch, null, pending, em, null);
  }, [dispatch]);

  // Track which plans are currently registered so we don't re-register on every crawl dispatch
  const registeredPlansRef = useRef({});

  useEffect(() => {
    const runningPlans = store.plans.filter(p => p.status === "running");
    const runningIds = new Set(runningPlans.map(p => p.id));

    // Clear jobs for plans that are now paused/deleted
    Object.keys(registeredPlansRef.current).forEach(planId => {
      if (!runningIds.has(planId)) {
        SCH.clearPlan(planId);
        delete registeredPlansRef.current[planId];
      }
    });

    runningPlans.forEach(p => {
      // Build a signature of schedule settings — only re-register if something changed
      const sig = `${p.schedFreq}|${p.schedTime}|${p.intervalMinutes}|${p.schedCustomUnit}|${p.autoMail}|${p.sendMode}|${p.sendTime}`;
      if (registeredPlansRef.current[p.id] === sig) return; // nothing changed
      registeredPlansRef.current[p.id] = sig;

      // Clear old jobs for this plan before re-registering
      SCH.clearPlan(p.id);

      const freq = p.schedFreq || "daily";
      const time = p.schedTime || "06:30";

      // Daily / Weekly / Monthly exact-time trigger
      if (freq === "daily" || freq === "weekly" || freq === "monthly") {
        const period = freq === "weekly" ? "week" : freq === "monthly" ? "month" : "day";
        SCH.register(p.id, period, time, () => {
          dispatch({ type: "ADD_LOG", entry: { type: "crawl", event: `⏰ Scheduled crawl triggered (${freq} at ${time})`, plan: p.name } });
          // Show pop notification when scheduler fires
          const _st = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
          // We can't call showToast here (outside React), post a custom event instead
          window.dispatchEvent(new CustomEvent("if:notify", {detail:{msg:`Scheduler fired — crawling now`,type:"sched",sub:`${p.name} · ${_st}`}}));
          runBackgroundCrawl(p.id);
        }, p.schedWeekDays);
      }

      // Custom interval (every N minutes/hours/days)
      if (freq === "custom" && p.intervalMinutes) {
        const unit = p.schedCustomUnit || "minutes";
        const minutes = unit === "hours"  ? Number(p.intervalMinutes) * 60
                      : unit === "days"   ? Number(p.intervalMinutes) * 1440
                      : Number(p.intervalMinutes);
        SCH.registerInterval(p.id, "interval", minutes, () => {
          dispatch({ type: "ADD_LOG", entry: { type: "crawl", event: `⏰ Interval crawl triggered (every ${p.intervalMinutes} ${unit})`, plan: p.name } });
          window.dispatchEvent(new CustomEvent("if:notify", {detail:{msg:`Interval crawl started`,type:"sched",sub:`${p.name} · every ${p.intervalMinutes} ${unit}`}}));
          runBackgroundCrawl(p.id);
        });
      }

      // Scheduled email send (independent of crawl)
      if (p.autoMail && p.sendMode === "scheduled" && p.sendTime) {
        SCH.register(p.id, "email_send", p.sendTime, () => {
          dispatch({ type: "ADD_LOG", entry: { type: "email", event: `⏰ Scheduled email send triggered (${p.sendTime})`, plan: p.name } });
          runScheduledSend(p.id);
        });
      }


    });

    // Cleanup on unmount only
    return () => {};
  // Only re-run when plan statuses or schedule fields change — NOT on every article/log dispatch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Serialize the fields we care about so the effect is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    store.plans.map(p => `${p.id}:${p.status}:${p.schedFreq}:${p.schedTime}:${(p.schedWeekDays||[]).join(",")}:${p.schedMonthDay}:${p.intervalMinutes}:${p.schedCustomUnit}:${p.autoMail}:${p.sendMode}:${p.sendTime}`).join("|"),
    dispatch, runBackgroundCrawl, runScheduledSend
  ]);

  const hasErrors=store.activityLog.slice(-10).some(l=>l.type==="error");
  const openPlanFresh=store.plans.find(p=>p.id===(openPlan?.id || openPlan))||null;

  let body=null;
  let crumbs=[{label:"InsightFlow AI"}];
  if(page==="plans"){
    if(openPlan){
      crumbs=[{label:"Plans",onClick:()=>setOpenPlan(null)},{label:openPlanFresh?.name||"Plan"}];
      body=<PlanDetail plan={openPlanFresh} autoRun={openPlan?.autoRun} store={store} dispatch={dispatch} onBack={()=>setOpenPlan(null)} showToast={showToast}/>;
    }else{
      crumbs=[{label:"Plans"}];
      body=<PlansPage store={store} dispatch={dispatch} onOpen={p=>setOpenPlan(p)} showToast={showToast}/>;
    }
  }else if(page==="monitoring"){crumbs=[{label:"Monitor"}];body=<MonitoringPage store={store} dispatch={dispatch} showToast={showToast}/>;}
  else if(page==="logs"){crumbs=[{label:"Logs"}];body=<LogsPage store={store} dispatch={dispatch} showToast={showToast}/>;}
  else if(page==="dashboard"){crumbs=[{label:"Stats"}];body=<DashboardPage store={store} dispatch={dispatch}/>;}
  else if(page==="settings"){crumbs=[{label:"Settings"}];body=<SettingsPage store={store} dispatch={dispatch} showToast={showToast}/>;}

  return <div style={{display:"flex",height:"100vh",background:C.paper,color:C.ink,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",fontSize:13}}>
    <style>{`
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes toastIn{from{opacity:0;transform:translateX(60px) scale(.92)}to{opacity:1;transform:translateX(0) scale(1)}}
      *{box-sizing:border-box;}
      ::-webkit-scrollbar{width:8px;height:8px;}
      ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;}
    `}</style>
    <Rail page={page} setPage={(p)=>{setPage(p);if(p!=="plans")setOpenPlan(null);}} hasErrors={hasErrors}/>
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
      <Topbar crumbs={crumbs} actions={<NotificationCenter store={store} dispatch={dispatch} />} />
      <div style={{flex:1,overflowY:"auto",padding:20}}>{body}</div>
    </div>
    <Toast toasts={toasts} dismiss={dismissToast}/>
  </div>;
}
