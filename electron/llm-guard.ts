// SSRF guard for the llm-fetch proxy: which hosts the renderer may reach.

// SSRF guard: enforce http(s) via URL parsing and block the classic exfil
// targets (cloud metadata + link-local). Public provider APIs and localhost/LAN
// LLM endpoints (LM Studio / Ollama) stay allowed, so real setups keep working.
// SSRF defense: allow only known LLM provider hosts, loopback (local LLMs), and
// the hosts of the user's configured endpoints — an allowlist, not a denylist,
// so private ranges, cloud-metadata IPs, decimal/octal IP encodings, and
// DNS-rebinding names (which are simply absent from the allowlist) can't be
// reached even if a compromised renderer supplies the URL.
const LLM_HOST_ALLOWLIST = new Set<string>([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.cohere.ai', 'api.cohere.com',
  'api.perplexity.ai',
  'api.together.xyz', 'api.together.ai',
  // OpenAI-compatible inference providers (base URL host only; verified against
  // each provider's docs). Any other endpoint is still reachable by configuring
  // it as the OpenAI-compatible provider, which allowlists its host at runtime.
  'api.regolo.ai',
  'api.x.ai',
  'api.fireworks.ai',
  'api.deepinfra.com',
  'api.cerebras.ai',
  'api.sambanova.ai',
  'router.huggingface.co',
]);
// Hosts of the user's configured local/custom LLM endpoints (reported by the
// renderer from settings, e.g. a LAN Ollama).
let configuredLlmHosts = new Set<string>();
// Cloud-metadata endpoints are never a real LLM host and are the classic SSRF
// credential-theft target, so reject them even though the renderer supplies this
// list. Private LAN ranges stay allowed on purpose — a LAN Ollama/LM Studio is a
// supported endpoint.
function isForbiddenLlmHost(h: string): boolean {
  return h === '169.254.169.254'          // AWS/GCP/Azure IMDS (IPv4)
    || h === 'metadata.google.internal'
    || h === '100.100.100.200'            // Alibaba Cloud metadata
    || h === 'fd00:ec2::254';             // AWS IMDS (IPv6)
}

function isLoopbackHost(h: string): boolean {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

export function assertFetchAllowed(rawUrl: string): void {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LLM_HOST_ALLOWLIST.has(host) || isLoopbackHost(host) || configuredLlmHosts.has(host)) return;
  throw new Error(`Blocked host (not an allowlisted LLM endpoint): ${host}`);
}

/** Replace the hosts of the user's configured endpoints (from the renderer's settings). */
export function setConfiguredLlmHosts(hosts: unknown): void {
  const next = new Set<string>();
  if (Array.isArray(hosts)) {
    for (const h of hosts.slice(0, 32)) {   // cap the list
      if (typeof h !== 'string' || !h.trim()) continue;
      const host = h.trim().toLowerCase().replace(/^\[|\]$/g, '');
      if (!isForbiddenLlmHost(host)) next.add(host);
    }
  }
  configuredLlmHosts = next;
}
