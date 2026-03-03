import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';
import { parseProposalDocument } from '@/lib/vault-parser';
import { getTenantId } from '../../_lib/get-tenant';
import { StatusBadge } from '../../_components/status-badge';
import MarginEditor from './margin-editor';

type Params = { params: { id: string } };

const TERMINAL = new Set(['paid', 'rejected', 'expired']);

export default async function ProposalDetailPage({ params }: Params) {
  const tenantId = await getTenantId();
  const supabase = createServerClient();

  const { data: row } = await supabase
    .from('proposals_cache')
    .select(`
      proposal_id, quote_id, status,
      contractor_name, project_name,
      materials_total, tax, proposal_total,
      deposit_percent, deposit_amount,
      vault_path, created_at,
      proposal_items_cache (
        line_number, description, category,
        cost, margin_percent, sell_price, extended_sell
      )
    `)
    .eq('proposal_id', params.id)
    .eq('tenant_id', tenantId)
    .single();

  if (!row) return notFound();

  // Read client + payment details from vault
  let clientName = '—';
  let clientEmail = '—';
  let publicUrl: string | null = null;

  if (row.vault_path) {
    try {
      const { data } = await createTools(supabase).vault.read(row.vault_path);
      const { proposal } = parseProposalDocument(data);
      clientName = proposal.client.name;
      clientEmail = proposal.client.email;
      if (proposal.public_token) {
        publicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/p/${proposal.id}?token=${proposal.public_token}`;
      }
    } catch {
      // vault read optional — cache data is still shown
    }
  }

  const items = (row.proposal_items_cache ?? []) as {
    line_number: number;
    description: string;
    category: string | null;
    cost: number;
    margin_percent: number;
    sell_price: number;
    extended_sell: number;
  }[];
  items.sort((a, b) => a.line_number - b.line_number);

  const depositPct = row.deposit_percent ? Number(row.deposit_percent) * 100 : 0;
  // Infer representative margin from first line item (fallback 25)
  const defaultMarginPct = items[0] ? Number(items[0].margin_percent) * 100 : 25;
  const editorDisabled = TERMINAL.has(row.status);

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb */}
      <p className="text-xs text-gray-400 mb-4">
        <a href="/dashboard/proposals" className="hover:underline">Proposals</a>
        {' / '}
        <span className="text-gray-600">{params.id.slice(0, 8)}</span>
      </p>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {row.project_name ?? row.contractor_name ?? 'Proposal'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clientName} &middot; {clientEmail}
          </p>
        </div>
        <StatusBadge status={row.status} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <InfoCard label="Materials" value={`$${Number(row.materials_total).toFixed(2)}`} />
        <InfoCard label="Tax" value={`$${Number(row.tax).toFixed(2)}`} />
        <InfoCard label="Total" value={`$${Number(row.proposal_total).toFixed(2)}`} bold />
        <InfoCard
          label="Deposit"
          value={row.deposit_amount ? `$${Number(row.deposit_amount).toFixed(2)}` : '—'}
        />
      </div>

      {publicUrl && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-blue-700 mb-0.5">Public proposal link</p>
            <p className="text-xs text-blue-600 break-all">{publicUrl}</p>
          </div>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700"
          >
            Preview
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Line items */}
        <div className="lg:col-span-2 bg-white rounded-lg border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-medium">Line Items</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Description</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Cost</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Margin</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(item => (
                <tr key={item.line_number} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span>{item.description}</span>
                    {item.category && (
                      <span className="ml-2 text-xs text-gray-400">{item.category}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">${Number(item.cost).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {(Number(item.margin_percent) * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right font-medium">${Number(item.sell_price).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Margin editor */}
        <MarginEditor
          proposalId={params.id}
          defaultMarginPct={defaultMarginPct}
          depositPct={depositPct}
          disabled={editorDisabled}
        />
      </div>
    </div>
  );
}

function InfoCard({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-lg ${bold ? 'font-semibold' : ''}`}>{value}</p>
    </div>
  );
}
