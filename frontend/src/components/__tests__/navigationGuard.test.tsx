import React from "react";
import ReactDOMServer from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavigationGuardModal } from "../shared/NavigationGuardModal";
import { useOverlayBackHandler } from "../../hooks/useOverlayBackHandler";

const StandaloneModalProbe: React.FC = () => {
  useOverlayBackHandler({
    id: "standalone-probe",
    isOpen: true,
    isDirty: true,
    onClose: () => {},
  });
  return <div>probe-ok</div>;
};

describe("NavigationGuardModal & useOverlayBackHandler SSR safety", () => {
  it("renders nothing when prompt is null", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NavigationGuardModal prompt={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(html).toBe("");
  });

  it("renders title, message, and Stay / Discard actions when prompt is active", () => {
    const html = ReactDOMServer.renderToStaticMarkup(
      <NavigationGuardModal
        prompt={{
          kind: "overlay",
          title: "Discard unsaved character changes?",
          message: "You have unsaved edits to this character.",
          confirmLabel: "Discard",
          cancelLabel: "Stay",
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(html).toContain("Discard unsaved character changes?");
    expect(html).toContain("You have unsaved edits to this character.");
    expect(html).toContain("Stay");
    expect(html).toContain("Discard");
  });

  it("allows useOverlayBackHandler to no-op cleanly outside NavigationHistoryProvider", () => {
    const html = ReactDOMServer.renderToStaticMarkup(<StandaloneModalProbe />);
    expect(html).toContain("probe-ok");
  });
});
