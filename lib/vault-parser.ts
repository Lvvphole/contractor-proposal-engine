import { QuoteSchema, ProposalSchema } from './schemas';
import type { Quote, Proposal } from './schemas';

export type Contractor = { name: string; logo_url?: string };

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('Invalid vault document: missing frontmatter');
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    result[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return result;
}

function parseJsonBody(content: string): unknown {
  const match = content.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error('Invalid vault document: missing JSON body');
  return JSON.parse(match[1]);
}

export function parseProposalDocument(bytes: Buffer): { proposal: Proposal; contractor: Contractor } {
  const content = bytes.toString('utf8');
  const fm = parseFrontmatter(content);
  const proposal = ProposalSchema.parse({
    id: fm['id'],
    tenant_id: fm['tenant_id'],
    quote_id: fm['quote_id'],
    created_at: fm['created_at'],
    status: fm['status'],
    client: {
      name: fm['client_name'],
      email: fm['client_email'],
      ...(fm['client_phone'] ? { phone: fm['client_phone'] } : {}),
      ...(fm['client_address'] ? { address: fm['client_address'] } : {}),
    },
    line_items: parseJsonBody(content),
    subtotal: parseFloat(fm['subtotal']),
    margin_total: parseFloat(fm['margin_total']),
    total: parseFloat(fm['total']),
    ...(fm['deposit_pct'] ? { deposit_pct: parseFloat(fm['deposit_pct']) } : {}),
    ...(fm['deposit_amount'] ? { deposit_amount: parseFloat(fm['deposit_amount']) } : {}),
    ...(fm['stripe_payment_link'] ? { stripe_payment_link: fm['stripe_payment_link'] } : {}),
    ...(fm['public_token'] ? { public_token: fm['public_token'] } : {}),
  });
  const contractor: Contractor = {
    name: fm['contractor_name'],
    ...(fm['contractor_logo_url'] ? { logo_url: fm['contractor_logo_url'] } : {}),
  };
  return { proposal, contractor };
}

export function parseQuoteDocument(bytes: Buffer): Quote {
  const content = bytes.toString('utf8');
  const fm = parseFrontmatter(content);
  return QuoteSchema.parse({
    id: fm['id'],
    tenant_id: fm['tenant_id'],
    created_at: fm['created_at'],
    status: fm['status'],
    source_file: fm['source_file'],
    ...(fm['supplier'] ? { supplier: fm['supplier'] } : {}),
    line_items: parseJsonBody(content),
    subtotal: parseFloat(fm['subtotal']),
    tax: parseFloat(fm['tax']),
    total: parseFloat(fm['total']),
  });
}
