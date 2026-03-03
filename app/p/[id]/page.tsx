import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';
import { parseProposalDocument } from '@/lib/vault-parser';

type Props = {
  params: { id: string };
  searchParams: { token?: string };
};

export default async function ProposalPage({ params, searchParams }: Props) {
  const supabase = createServerClient();

  const { data: row } = await supabase
    .from('proposals_cache')
    .select('vault_path, status')
    .eq('proposal_id', params.id)
    .single();

  if (!row?.vault_path) return notFound();

  let proposal, contractor;
  try {
    const { data } = await createTools(supabase).vault.read(row.vault_path);
    ({ proposal, contractor } = parseProposalDocument(data));
  } catch {
    return notFound();
  }

  if (!proposal.public_token || proposal.public_token !== searchParams.token) {
    return notFound();
  }

  const showDeposit = proposal.deposit_amount !== undefined && row.status !== 'accepted';
  const payHref = proposal.stripe_payment_link ?? '#';

  return (
    <main className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-1">Proposal from {contractor.name}</h1>
      <p className="text-gray-500 mb-8">Prepared for {proposal.client.name}</p>

      <table className="w-full text-sm border-collapse mb-8">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 font-medium text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {proposal.line_items.map((item, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2">{item.description}</td>
              <td className="py-2 text-right">${item.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <td className="py-3 font-semibold">Total</td>
            <td className="py-3 text-right font-semibold">${proposal.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      {proposal.stripe_payment_link && (
        <div className="flex flex-col sm:flex-row gap-3">
          {showDeposit && proposal.deposit_amount !== undefined && (
            <a
              href={payHref}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-center"
            >
              Pay Deposit — ${proposal.deposit_amount.toFixed(2)}
            </a>
          )}
          <a
            href={payHref}
            className="px-6 py-3 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 text-center"
          >
            Pay in Full — ${proposal.total.toFixed(2)}
          </a>
        </div>
      )}
    </main>
  );
}
