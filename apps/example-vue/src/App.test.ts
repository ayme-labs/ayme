import { DOMWrapper, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ListDemo from "./demo/ListDemo.vue";

describe("The example application", () => {
  it("adds, renames, and archives list items", async () => {
    // The archive dialog is portalled to <body>, so the component is attached
    // to the document and the dialog is queried from there.
    const wrapper = mount(ListDemo, { attachTo: document.body });
    const document_ = new DOMWrapper(document.body);

    await wrapper.get("#new-item").setValue("Write the release notes");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("Write the release notes");

    await wrapper.get('[data-action="rename"]').trigger("click");
    await wrapper
      .get('[aria-label="Item name"]')
      .setValue("Prepare the launch notes");
    await wrapper.get('[aria-label="Item name"]').trigger("keyup.enter");
    expect(wrapper.text()).toContain("Prepare the launch notes");

    await wrapper.get('[aria-label="Archive item-1"]').trigger("click");
    await document_
      .get('[role="dialog"] [data-action="confirm-archive"]')
      .trigger("click");
    expect(document_.get("[data-archived-label]").text()).toBe("Archived");

    wrapper.unmount();
  });
});
