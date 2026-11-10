import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentsView } from "./DocumentsView";

describe("DocumentsView Phase 9 Attachment Management", () => {
  it("renders empty attachment state and security banner", () => {
    const html = renderToStaticMarkup(
      <DocumentsView
        records={[]}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        onDelete={vi.fn()}
        activeVaultId="vault-1"
        activeVek={null}
      />,
    );

    expect(html).toContain("Documents &amp; Attachments (0)");
    expect(html).toContain("Phase 9 Streaming AEAD Active");
    expect(html).toContain("No binary attachments uploaded yet");
    expect(html).toContain("Files up to 100MB are streamed and encrypted");
  });

  it("renders upload button disabled when activeVek is null (locked vault)", () => {
    const html = renderToStaticMarkup(
      <DocumentsView
        records={[]}
        onOpenCreate={vi.fn()}
        onOpenEdit={vi.fn()}
        onDelete={vi.fn()}
        activeVaultId="vault-1"
        activeVek={null}
      />,
    );

    expect(html).toContain('title="Unlock vault to upload attachments"');
  });
});
