'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  proposalId: string;
  defaultMarginPct: number;   // 0–100
  depositPct: number;         // 0–100
  disabled: boolean;
};

export default function MarginEditor({ proposalId, defaultMarginPct, depositPct, disabled }: Props) {
  const [margin, setMargin] = useState(String(defaultMarginPct));
  const [deposit, setDeposit] = useState(String(depositPct));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    const res = await fetch(`/api/proposals/${proposalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        default_margin_percent: Number(margin),
        category_overrides: {},
        deposit_percent: Number(deposit),
      }),
    });
    const data: { total?: number; error?: string } = await res.json();
    setSaving(false);
    if (!res.ok) {
      setResult({ ok: false, message: data.error ?? 'Update failed' });
      return;
    }
    setResult({ ok: true, message: `Updated — new total $${data.total?.toFixed(2)}` });
    router.refresh();
  }

  return (
    <div className="bg-white rounded-lg border p-5">
      <h2 className="text-sm font-semibold mb-4">Adjust Margins</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Default Margin %"
          hint="Applied to all line items"
          value={margin}
          onChange={setMargin}
          disabled={disabled}
        />
        <Field
          label="Deposit %"
          hint="Percentage of total required upfront"
          value={deposit}
          onChange={setDeposit}
          disabled={disabled}
        />
        {disabled && (
          <p className="text-xs text-gray-400">Margins cannot be changed after payment.</p>
        )}
        {!disabled && (
          <button
            type="submit"
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Recalculate & Save'}
          </button>
        )}
        {result && (
          <p className={`text-sm ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
            {result.message}
          </p>
        )}
      </form>
    </div>
  );
}

function Field({
  label, hint, value, onChange, disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-0.5">{label}</label>
      <p className="text-xs text-gray-400 mb-1">{hint}</p>
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  );
}
