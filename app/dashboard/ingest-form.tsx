'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function IngestForm() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/quotes/ingest', {
      method: 'POST',
      body: new FormData(e.currentTarget),
    });
    const data: { proposal_id?: string; error?: string } = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Ingest failed');
      return;
    }
    setOpen(false);
    formRef.current?.reset();
    router.push(`/dashboard/proposals/${data.proposal_id}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
      >
        + Upload Quote
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-base font-semibold mb-4">Upload Quote PDF</h2>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">PDF File</label>
            <input type="file" name="file" accept=".pdf" required className="w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Client Email</label>
            <input
              type="email"
              name="recipient_email"
              required
              placeholder="client@example.com"
              className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Processing…' : 'Upload & Generate'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(''); }}
              className="px-4 py-2 border rounded-md text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
