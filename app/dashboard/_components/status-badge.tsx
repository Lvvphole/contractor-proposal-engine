const styles: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-600',
  priced:   'bg-indigo-100 text-indigo-700',
  sent:     'bg-blue-100 text-blue-700',
  viewed:   'bg-purple-100 text-purple-700',
  accepted: 'bg-yellow-100 text-yellow-700',
  paid:     'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  expired:  'bg-gray-100 text-gray-400',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}
