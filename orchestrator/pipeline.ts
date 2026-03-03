import type { MCPTools } from "../lib/mcp-tools";
import type { Quote, Proposal } from "../lib/schemas";
import type { PricingConfig } from "./pricing";
import type { Contractor } from "./stages/proposal";
import { ingestQuote } from "./stages/ingest";
import { createProposal } from "./stages/proposal";
import { sendProposal } from "./stages/send";

export type PipelineInput = {
  tenant_id: string;
  pdf_vault_path: string;
  pricing_config: PricingConfig;
  contractor: Contractor;
  recipient_email: string;
  proposal_base_url: string;
};

export type PipelineOutput = {
  quote: Quote;
  proposal: Proposal;
  proposal_url: string;
};

function buildClient(email: string): Proposal["client"] {
  const name = email.split("@")[0] ?? email;
  return { name, email };
}

function buildProposalUrl(base_url: string, proposal: Proposal): string {
  return `${base_url}/${proposal.id}?token=${proposal.public_token ?? ""}`;
}

export async function runPipeline(
  tools: MCPTools,
  input: PipelineInput
): Promise<PipelineOutput> {
  const { tenant_id, pdf_vault_path, pricing_config, contractor, recipient_email, proposal_base_url } = input;

  const quote = await ingestQuote(tenant_id, pdf_vault_path, tools);
  const client = buildClient(recipient_email);
  const draft = await createProposal(quote, pricing_config, client, contractor, tools);
  const proposal = await sendProposal(draft, contractor, tools);
  const proposal_url = buildProposalUrl(proposal_base_url, proposal);

  return { quote, proposal, proposal_url };
}
