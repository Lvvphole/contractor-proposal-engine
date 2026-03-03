import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function getTenantId(): Promise<string> {
  const { sessionClaims } = await auth();
  const tenantId = (sessionClaims as Record<string, unknown>)?.tenant_id as string | undefined;
  if (!tenantId) redirect('/');
  return tenantId;
}
