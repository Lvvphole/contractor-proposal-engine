import { createServerClient } from '@/lib/supabase';
import { getTenantId } from '../_lib/get-tenant';
import { StatusBadge } from '../_components/status-badge';

export default async function QuotesPage() {
  const tenantId = await getTenantId();
  const supabase = createServerClient();

  const { data: quotes } = await supabase
    .from('quotes_cache')
    .select('quote_id, status, project_name, subtotal, tax, total, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Quotes</h1>
      <div className="bg-white rounded-lg border overflow-hidden">
        {quotes?.length ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">ID</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Subtotal</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Tax</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Total</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {quotes.map(q => (
                <tr key={q.quote_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    {q.project_name ?? q.quote_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-4 py-2 text-right">${Number(q.subtotal).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right">${Number(q.tax).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-medium">${Number(q.total).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right text-gray-400">
                    {new Date(q.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-gray-400">No quotes yet.</p>
        )}
      </div>
    </div>
  );
}
