import Link from 'next/link';
import { createServerClient } from '@/lib/supabase';
import { getTenantId } from '../_lib/get-tenant';
import { StatusBadge } from '../_components/status-badge';

export default async function ProposalsPage() {
  const tenantId = await getTenantId();
  const supabase = createServerClient();

  const { data: proposals } = await supabase
    .from('proposals_cache')
    .select(
      'proposal_id, status, contractor_name, project_name, proposal_total, deposit_amount, created_at'
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Proposals</h1>
      <div className="bg-white rounded-lg border overflow-hidden">
        {proposals?.length ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Project</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Total</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Deposit</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Date</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {proposals.map(p => (
                <tr key={p.proposal_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/proposals/${p.proposal_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {p.project_name ?? p.contractor_name ?? p.proposal_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2 text-right">${Number(p.proposal_total).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">
                    {p.deposit_amount ? `$${Number(p.deposit_amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/proposals/${p.proposal_id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-gray-400">No proposals yet.</p>
        )}
      </div>
    </div>
  );
}
