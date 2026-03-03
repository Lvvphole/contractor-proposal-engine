import fs from 'fs/promises';
import nodePath from 'path';
import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import { PDFParse } from 'pdf-parse';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MCPTools } from './mcp-tools';

const VAULT_ROOT = process.env.VAULT_ROOT ?? nodePath.join(process.cwd(), 'vault');

function abs(relPath: string): string {
  return nodePath.join(VAULT_ROOT, relPath);
}

async function mkdirFor(filePath: string): Promise<void> {
  await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
}

const vault: MCPTools['vault'] = {
  async read(relPath) {
    const data = await fs.readFile(abs(relPath));
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    return { data, sha256 };
  },
  async write(relPath, bytes, _sha256) {
    const p = abs(relPath);
    await mkdirFor(p);
    await fs.writeFile(p, bytes);
    return { ok: true };
  },
  async append_event(event) {
    const ev = event as { id: string; tenant_id: string };
    const p = abs(`tenants/${ev.tenant_id}/events/${ev.id}.json`);
    await mkdirFor(p);
    await fs.writeFile(p, JSON.stringify(event, null, 2) + '\n', 'utf8');
    return { ok: true };
  },
  async list(prefix) {
    const root = abs(prefix);
    async function walk(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const out: string[] = [];
      for (const e of entries) {
        const full = nodePath.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(full)));
        else out.push(nodePath.relative(VAULT_ROOT, full).replace(/\\/g, '/'));
      }
      return out;
    }
    return walk(root);
  },
};

const pdf: MCPTools['pdf'] = {
  async extract_text(vaultPath) {
    const { data } = await vault.read(vaultPath);
    const parser = new PDFParse({ data });
    const [textResult, infoResult] = await Promise.all([parser.getText(), parser.getInfo()]);
    await parser.destroy();
    return { text: textResult.text, page_count: infoResult.total };
  },
};

const claude: MCPTools['claude'] = {
  async structured_extract(text, schema_hint) {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Extract a ${schema_hint} JSON object from the following text. Return only valid JSON with no surrounding text.\n\n${text}`,
        },
      ],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Claude response type');
    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in Claude response');
    return { json: JSON.parse(match[0]), confidence: 1 };
  },
};

function makeStripe(supabase: SupabaseClient): MCPTools['stripe'] {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!;
  return {
    async create_checkout(proposal_id, mode) {
      const { data, error } = await supabase
        .from('proposals_cache')
        .select('proposal_total, deposit_amount, tenant_id')
        .eq('proposal_id', proposal_id)
        .single();
      if (error || !data) throw new Error(`Proposal not found: ${proposal_id}`);
      const amountCents =
        mode === 'deposit'
          ? Math.round((data.deposit_amount ?? data.proposal_total) * 100)
          : Math.round(data.proposal_total * 100);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Contractor Proposal' },
              unit_amount: amountCents,
            },
            quantity: 1,
          },
        ],
        metadata: { proposal_id, tenant_id: String(data.tenant_id), mode },
        success_url: `${baseUrl}/p/${proposal_id}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/p/${proposal_id}`,
      });
      return { session_id: session.id, url: session.url! };
    },
  };
}

function makeCache(supabase: SupabaseClient): MCPTools['cache'] {
  return {
    async rebuild(tenant_id) {
      const { error } = await supabase.rpc('rebuild_tenant_cache', { p_tenant_id: tenant_id });
      if (error) throw new Error(`Cache rebuild failed: ${error.message}`);
      return { rows_affected: 0 };
    },
  };
}

export function createTools(supabase: SupabaseClient): MCPTools {
  return {
    vault,
    pdf,
    claude,
    stripe: makeStripe(supabase),
    cache: makeCache(supabase),
    webhook: {
      async verify(_provider, _payload, _signature) {
        // Overridden per-route for raw-body access (see webhooks/stripe/route.ts)
        throw new Error('webhook.verify must be overridden in the route handler');
      },
    },
    financing: {
      async create_link(_proposal_id, _amount) {
        throw new Error('Financing integration not configured');
      },
    },
    email: {
      async send(template, payload) {
        console.log(`[email] template=${template}`, payload);
        return { message_id: crypto.randomUUID() };
      },
    },
    quickbooks: {
      async export_invoice(_proposal_id) {
        throw new Error('QuickBooks integration not configured');
      },
    },
  };
}
