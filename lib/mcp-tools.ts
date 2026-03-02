import { vi } from "vitest";

export interface MCPTools {
  vault: {
    write(path: string, bytes: Buffer, sha256: string): Promise<{ ok: boolean }>;
    append_event(event: unknown): Promise<{ ok: boolean }>;
    read(path: string): Promise<{ data: Buffer; sha256: string }>;
    list(prefix: string): Promise<string[]>;
  };
  pdf: {
    extract_text(path: string): Promise<{ text: string; page_count: number }>;
  };
  claude: {
    structured_extract(
      text: string,
      schema_hint: string
    ): Promise<{ json: unknown; confidence: number }>;
  };
  stripe: {
    create_checkout(
      proposal_id: string,
      mode: "deposit" | "full"
    ): Promise<{ session_id: string; url: string }>;
  };
  financing: {
    create_link(
      proposal_id: string,
      amount: number
    ): Promise<{ url: string; provider: string }>;
  };
  webhook: {
    verify(
      provider: string,
      payload: unknown,
      signature: string
    ): Promise<{ valid: boolean; event_type: string }>;
  };
  email: {
    send(
      template: string,
      payload: unknown
    ): Promise<{ message_id: string }>;
  };
  cache: {
    rebuild(tenant_id: string): Promise<{ rows_affected: number }>;
  };
  quickbooks: {
    export_invoice(
      proposal_id: string
    ): Promise<{ invoice_id: string; status: string }>;
  };
}

export function createMockTools(): MCPTools {
  return {
    vault: {
      write: vi.fn().mockResolvedValue({ ok: true }),
      append_event: vi.fn().mockResolvedValue({ ok: true }),
      read: vi.fn().mockResolvedValue({ data: Buffer.alloc(0), sha256: "" }),
      list: vi.fn().mockResolvedValue([]),
    },
    pdf: {
      extract_text: vi.fn().mockResolvedValue({ text: "", page_count: 1 }),
    },
    claude: {
      structured_extract: vi
        .fn()
        .mockResolvedValue({ json: {}, confidence: 1 }),
    },
    stripe: {
      create_checkout: vi
        .fn()
        .mockResolvedValue({ session_id: "cs_test_mock", url: "https://checkout.stripe.com/mock" }),
    },
    financing: {
      create_link: vi
        .fn()
        .mockResolvedValue({ url: "https://financing.example.com/mock", provider: "mock" }),
    },
    webhook: {
      verify: vi.fn().mockResolvedValue({ valid: true, event_type: "mock.event" }),
    },
    email: {
      send: vi.fn().mockResolvedValue({ message_id: "msg_mock" }),
    },
    cache: {
      rebuild: vi.fn().mockResolvedValue({ rows_affected: 0 }),
    },
    quickbooks: {
      export_invoice: vi
        .fn()
        .mockResolvedValue({ invoice_id: "inv_mock", status: "pending" }),
    },
  };
}
